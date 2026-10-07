"""Derive role-review evidence from a validated, same-video reference variant.

Reference tracker IDs live in a separate namespace. Only same-frame box geometry
connects them to the active tracker; raw detections and identity bindings stay as
recorded. A conflict is a reason to withhold an automatic player label, not a
claim that either detector has supplied human ground truth.
"""
from copy import deepcopy
import math


METHOD = 'same-video-referee-overlap-v1'
MIN_IOU = .70
MIN_REFERENCE_CONFIDENCE = .25
MAX_CONTINUITY_GAP_SECONDS = .25
MIN_INTERVAL_HITS = 3
MIN_INTERVAL_SPAN_SECONDS = .10


def _iou(left, right):
    intersection = (max(0, min(left[2], right[2]) - max(left[0], right[0])) *
                    max(0, min(left[3], right[3]) - max(left[1], right[1])))
    union = ((left[2] - left[0]) * (left[3] - left[1]) +
             (right[2] - right[0]) * (right[3] - right[1]) - intersection)
    return intersection / union if union > 0 else 0


def _box(row):
    return (isinstance(row, (list, tuple)) and len(row) >= 7 and
            all(isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)
                for x in row[:7]) and row[2] > row[0] and row[3] > row[1])


def _role(record, row, names):
    declared = record.get('track_roles', {}).get(str(int(row[4])))
    name = names.get(str(int(row[6])), names.get(int(row[6])))
    return 'referee' if declared == 'referee' or name == 'referee' else declared or name


def _continuous(previous, current, records, cuts):
    left, a = previous
    right, b = current
    elapsed = records[right]['time'] - records[left]['time']
    if elapsed <= 0 or elapsed > MAX_CONTINUITY_GAP_SECONDS or any(left < cut <= right for cut in cuts):
        return False
    size = max(a[2] - a[0], a[3] - a[1], b[2] - b[0], b[3] - b[1])
    distance = math.hypot((a[0] + a[2] - b[0] - b[2]) / 2,
                          (a[1] + a[3] - b[1] - b[3]) / 2)
    area_a, area_b = (a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1])
    return distance <= size and max(area_a, area_b) <= 3 * min(area_a, area_b)


def _without_derived_role_evidence(record):
    """Recompute our layer after a trim instead of keeping parent frame ranges."""
    evidence = record.get('track_evidence', {})
    own = {key: item for key, item in evidence.items()
           if item.get('role_evidence', {}).get('method') == METHOD}
    conflicts = record.get('role_conflicts', [])
    own_conflicts = isinstance(conflicts, list) and any(item.get('source') == METHOD for item in conflicts)
    if not own and not own_conflicts:
        return record
    result = {**record, 'track_evidence': deepcopy(evidence)}
    if own_conflicts:
        remaining = [item for item in conflicts if item.get('source') != METHOD]
        if remaining: result['role_conflicts'] = deepcopy(remaining)
        else: result.pop('role_conflicts', None)
    for key, item in own.items():
        prior = item['role_evidence'].get('prior', {})
        restored = result['track_evidence'][key]
        restored.pop('role_evidence', None)
        for field in ('identity_review_required', 'role_conflict'):
            if field in prior: restored[field] = prior[field]
            else: restored.pop(field, None)
    return result


def add_reference_role_evidence(records, reference_records, *, video_sha256,
                                reference_video_sha256, reference_fingerprint,
                                class_names=None, reference_class_names=None, source_cuts=()):
    """Return derived records and provenance without modifying either input.

    The caller validates both inputs against the decoded video. This additional
    boundary rejects wrong videos or frame mappings before joining any evidence.
    A repeated overlap only extends between its observed endpoints in a bounded
    continuous track segment. It never fills missing boxes or labels a whole T ID.
    """
    if not video_sha256 or reference_video_sha256 != video_sha256:
        raise ValueError('Role reference must belong to the same source video.')
    if not reference_fingerprint:
        raise ValueError('Role reference must include its raw tracking fingerprint.')
    if not isinstance(records, list) or not isinstance(reference_records, list) or len(records) != len(reference_records):
        raise ValueError('Role reference frame count does not match the active variant.')
    for index, (record, reference) in enumerate(zip(records, reference_records)):
        if record.get('frame') != index or reference.get('frame') != index:
            raise ValueError('Role reference frame indices do not match.')
        a, b = record.get('time'), reference.get('time')
        if (not isinstance(a, (int, float)) or not isinstance(b, (int, float)) or
                not math.isfinite(a) or not math.isfinite(b) or abs(a - b) > .001):
            raise ValueError('Role reference frame timestamps do not match.')
        for field in ('source_frame', 'source_frame_pts', 'source_time_base'):
            if field in record and field in reference and record[field] != reference[field]:
                raise ValueError('Role reference source frame mapping does not match.')

    records = [_without_derived_role_evidence(record) for record in records]

    names = dict(enumerate(class_names)) if isinstance(class_names, list) else class_names or {}
    reference_names = dict(enumerate(reference_class_names)) if isinstance(reference_class_names, list) else reference_class_names or {}
    direct, observations = {}, {}
    for frame, (record, reference) in enumerate(zip(records, reference_records)):
        referees = [row for row in reference.get('tracks', [])
                    if _box(row) and _role(reference, row, reference_names) == 'referee'
                    and row[5] >= MIN_REFERENCE_CONFIDENCE]
        for row in record.get('tracks', []):
            if not _box(row) or _role(record, row, names) == 'referee':
                continue
            track_id = int(row[4])
            observations.setdefault(track_id, []).append((frame, row))
            overlaps = [(ref, _iou(row, ref)) for ref in referees]
            overlaps = [(ref, overlap) for ref, overlap in overlaps if overlap >= MIN_IOU]
            if overlaps:
                ref, overlap = max(overlaps, key=lambda pair: (pair[1], pair[0][5]))
                direct[frame, track_id] = {'method': METHOD, 'kind': 'same_frame_referee_overlap',
                    'iou': round(overlap, 6), 'reference': {'variant': 'ebard',
                        'trackId': int(ref[4]), 'frame': frame, 'box': list(ref[:4]), 'score': ref[5]}}

    risks = deepcopy(direct)
    intervals = []
    for track_id, observed in observations.items():
        segments = []
        for item in observed:
            if not segments or not _continuous(segments[-1][-1], item, records, source_cuts):
                segments.append([])
            segments[-1].append(item)
        for segment in segments:
            hits = [frame for frame, _ in segment if (frame, track_id) in direct]
            if len(hits) < MIN_INTERVAL_HITS or records[hits[-1]]['time'] - records[hits[0]]['time'] < MIN_INTERVAL_SPAN_SECONDS:
                continue
            interval = {'trackId': track_id, 'start': hits[0], 'end': hits[-1],
                        'evidenceFrames': hits, 'reviewRequired': True}
            intervals.append(interval)
            for frame, _ in segment:
                if hits[0] <= frame <= hits[-1] and (frame, track_id) not in risks:
                    risks[frame, track_id] = {'method': METHOD, 'kind': 'repeated_referee_overlap_interval',
                        'start': hits[0], 'end': hits[-1], 'evidenceFrames': hits}

    by_frame = {}
    for (frame, track_id), evidence in risks.items():
        by_frame.setdefault(frame, []).append((track_id, evidence))
    derived = []
    for frame, record in enumerate(records):
        flagged = by_frame.get(frame, [])
        if not flagged:
            derived.append(record)
            continue
        updated = {**record, 'track_evidence': deepcopy(record.get('track_evidence', {}))}
        conflicts = record.get('role_conflicts', [])
        # Existing imported conflict maps are supported without dropping their IDs.
        if isinstance(conflicts, dict):
            conflicts = [{'trackIds': [int(key)], 'status': 'needs_review'}
                         for key, value in conflicts.items() if value and str(key).isdigit()]
        updated['role_conflicts'] = deepcopy(conflicts)
        for track_id, evidence in flagged:
            # Never put the reference T ID in trackIds/refereeTrackId: a different
            # person in the active tracker may coincidentally have that number.
            updated['role_conflicts'].append({'trackIds': [track_id], 'playerTrackId': track_id,
                'status': 'needs_review', 'source': METHOD, **evidence})
            existing = updated['track_evidence'].get(str(track_id), {})
            prior = {field: existing[field] for field in ('identity_review_required', 'role_conflict') if field in existing}
            updated['track_evidence'][str(track_id)] = {**existing,
                'identity_review_required': True, 'role_conflict': True,
                'role_evidence': {**evidence, 'prior': prior}}
        derived.append(updated)
    source = {'method': METHOD, 'variant': 'ebard', 'videoSha256': video_sha256,
        'trackingRawFingerprint': reference_fingerprint, 'reviewRequired': True,
        'minimumIoU': MIN_IOU, 'minimumReferenceConfidence': MIN_REFERENCE_CONFIDENCE,
        'maximumContinuityGapSeconds': MAX_CONTINUITY_GAP_SECONDS,
        'directConflictObservations': len(direct), 'reviewObservations': len(risks),
        'intervals': intervals, 'rawRecordsUnchanged': True, 'humanIdentityOverridesPreserved': True}
    return derived, source
