"""Read-only source inspection and conservative detector evidence adapters.

The native review deliberately has no foot trajectories for bounding-box body
points. They can support reference-frame annotations, never native foot follow.
All frame numbers in this module index the registered asset, not source labels.
"""
from copy import deepcopy
import hashlib
import json
import math
from pathlib import Path
import subprocess
import sys

ADAPTER_VERSION = 'player-evidence-1'


class AdapterError(ValueError):
    def __init__(self, reason_code, message, *, affected_ranges=None, evidence_refs=None, suggested_action=None):
        super().__init__(message)
        self.reason_code = reason_code
        self.affected_ranges = affected_ranges or []
        self.evidence_refs = evidence_refs or []
        self.suggested_action = suggested_action


def canonical_digest(value):
    data = json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
    return hashlib.sha256(data.encode('utf-8')).hexdigest()


def file_sha256(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for data in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(data)
    return digest.hexdigest()


def read_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + '.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')
    temp.replace(path)
    return path


def finite(value):
    return type(value) in (int, float) and math.isfinite(value)


def _mapping_from_registered(registered, count):
    if not registered:
        return None
    rows = registered.get('sourceFrameMapping')
    if rows is None and isinstance(registered.get('frames'), list):
        rows = [{'frame': f.get('frame'), 'time': f.get('time'),
                 'sourceFrame': f.get('source_frame', f.get('frame')),
                 'sourceTime': f.get('source_time', f.get('time'))} for f in registered['frames']]
    if rows is None:
        return None
    if not isinstance(rows, list) or len(rows) != count:
        raise AdapterError('source_mismatch', 'Registered frame mapping does not cover every decoded asset frame.')
    return rows


def inspect_video(video_path, registered=None, expected_sha=None, checkpoint=lambda: None):
    """Decode all PTS values; nominal FPS is never used as a substitute."""
    import av
    video_path = Path(video_path).resolve()
    sha = file_sha256(video_path)
    declared = (registered or {}).get('video_sha256', (registered or {}).get('videoSha256'))
    if expected_sha and expected_sha != sha or declared and declared != sha:
        raise AdapterError('source_mismatch', 'Registered video digest does not match the actual source bytes.')
    decoded = []
    with av.open(str(video_path)) as container:
        if not container.streams.video:
            raise AdapterError('invalid_input', 'The asset has no video stream.')
        stream = container.streams.video[0]
        width, height = stream.width, stream.height
        audio = bool(container.streams.audio)
        duration_end = (float((stream.start_time or 0) * stream.time_base + stream.duration * stream.time_base)
                        if stream.duration is not None else None)
        for index, frame in enumerate(container.decode(video=0)):
            if index % 30 == 0:
                checkpoint()
            if frame.pts is None or frame.time_base is None or frame.time is None:
                raise AdapterError('source_mismatch', 'A decoded frame has no accurate PTS/time base.')
            if (frame.width, frame.height) != (width, height):
                raise AdapterError('source_mismatch', 'Variable source dimensions are not supported.')
            timestamp = float(frame.pts * frame.time_base)
            if decoded and timestamp <= decoded[-1]['time']:
                raise AdapterError('source_mismatch', 'Decoded frame presentation times must strictly increase.')
            decoded.append({'assetFrame': index, 'pts': frame.pts,
                            'timeBase': [frame.time_base.numerator, frame.time_base.denominator],
                            'time': timestamp, 'duration': float(frame.duration * frame.time_base) if frame.duration else None})
    if not decoded:
        raise AdapterError('invalid_input', 'The source did not decode any video frames.')
    registered = registered or {}
    for key in ('width', 'height'):
        if key in registered and registered[key] != (width if key == 'width' else height):
            raise AdapterError('source_mismatch', 'Registered dimensions differ from the decoded source.')
    supplied = _mapping_from_registered(registered, len(decoded))
    mapping, frames = [], []
    for index, record in enumerate(decoded):
        value = supplied[index] if supplied else {'frame': index, 'time': record['time'],
                                                'sourceFrame': index, 'sourceTime': record['time']}
        if (value.get('frame') != index or not finite(value.get('time'))
                or abs(value['time'] - record['time']) > 1e-7
                or type(value.get('sourceFrame')) is not int or value['sourceFrame'] < 0
                or not finite(value.get('sourceTime'))):
            raise AdapterError('source_mismatch', 'Registered asset/source frame mapping disagrees with decoded PTS.')
        mapping.append({key: value[key] for key in ('frame', 'time', 'sourceFrame', 'sourceTime')})
        frames.append({'frame': index, 'time': value['time'], 'source_frame': value['sourceFrame'],
                       'source_time': value['sourceTime'], 'source_frame_pts': record['pts'],
                       'source_time_base': record['timeBase'], 'tracks': [], 'pending_detections': []})
    last = decoded[-1]
    end = last['time'] + last['duration'] if last['duration'] and last['duration'] > 0 else duration_end
    if end is None or not finite(end) or end <= last['time']:
        raise AdapterError('source_mismatch', 'The exact media end time is unavailable; refusing a nominal FPS guess.')
    if registered.get('mediaEndTime') is not None and abs(registered['mediaEndTime'] - end) > 1e-7:
        raise AdapterError('source_mismatch', 'Registered media end does not match the decoded source.')
    if file_sha256(video_path) != sha:
        raise AdapterError('source_mismatch', 'Source bytes changed during inspection.')
    clip = {'video_sha256': sha, 'source_video_sha256': registered.get('source_video_sha256') or registered.get('sourceVideoSha256') or sha,
            'width': width, 'height': height, 'mediaEndTime': end, 'frames': frames,
            'sourceCuts': registered.get('sourceCuts', registered.get('settings', {}).get('sourceCuts', [])),
            'tracking_fingerprint': registered.get('tracking_fingerprint', registered.get('trackingFingerprint')),
            'tracking_revision': registered.get('tracking_revision', registered.get('trackingRevision'))}
    return {'clip': clip, 'decodedFrames': decoded, 'sourceFrameMapping': mapping,
            'frameMappingDigest': canonical_digest(mapping), 'ptsDigest': canonical_digest(decoded),
            'hasAudio': audio, 'decoder': 'PyAV ' + av.__version__, 'adapterVersion': ADAPTER_VERSION}


def validate_range(value, count):
    if (not isinstance(value, dict) or set(value) != {'startFrame', 'endFrameExclusive'}
            or type(value['startFrame']) is not int or type(value['endFrameExclusive']) is not int
            or not 0 <= value['startFrame'] < value['endFrameExclusive'] <= count):
        raise AdapterError('invalid_input', 'range must be a nonempty half-open interval of decoded asset frames.')
    return range(value['startFrame'], value['endFrameExclusive'])


def contiguous_ranges(values):
    values = sorted(set(values))
    result = []
    for value in values:
        if result and result[-1]['endFrameExclusive'] == value:
            result[-1]['endFrameExclusive'] += 1
        else:
            result.append({'startFrame': value, 'endFrameExclusive': value + 1})
    return result


def _validate_box(box, width, height):
    return (isinstance(box, list) and len(box) >= 4 and all(finite(v) for v in box[:4])
            and 0 <= box[0] < box[2] <= width and 0 <= box[1] < box[3] <= height)


def _native_review_observations(review, clip, frame_range):
    """Preserve native provenance. Only explicit observed source types are usable."""
    players = []
    times = clip['frames']
    allowed = {'tracked', 'manual', 'manual_range'}
    for entity in review.get('entities', []):
        if not isinstance(entity.get('id'), str):
            raise AdapterError('source_mismatch', 'Native review entity has no identifier.')
        index = {p['frame']: p for p in entity.get('trajectory', [])}
        records = []
        for f in frame_range:
            point = index.get(f, {})
            x, y = point.get('x'), point.get('y')
            located = finite(x) and finite(y) and 0 <= x <= clip['width'] and 0 <= y <= clip['height']
            observed = located and point.get('source') in allowed and point.get('reviewExcluded') is not True
            # Native x/y is a candidate foot location; still not a verified ground contact.
            records.append({'assetFrame': f, 'sourceFrame': times[f]['source_frame'], 'pts': times[f]['time'],
                            'position': [x, y] if located else None, 'bbox': point.get('box'),
                            'sourceSpace': 'image_pixels', 'anchorSemantics': 'foot_candidate',
                            'observationStatus': 'observed' if observed else 'estimated' if located else 'unknown',
                            'visibility': 'visible' if observed else 'out_of_view' if point.get('source') == 'out_of_view' else 'unknown',
                            'identityConfidence': None, 'locationConfidence': None,
                            'sourceMethod': 'native_review:' + str(point.get('source', 'missing')),
                            'evidenceRef': f'native:{entity["id"]}:asset:{f}'})
        if any(p['position'] is not None for p in records):
            players.append({'playerId': entity['id'], 'trackId': None, 'identityStatus': 'upstream_unverified',
                            'identityEvidenceFrames': [], 'teamCandidate': entity.get('teamSide'),
                            'name': None, 'jerseyNumber': None, 'frames': records})
    return players


def prepare_player_evidence(inspection, registered, frame_range, detection_records=None):
    clip = deepcopy(inspection['clip'])
    indices = validate_range(frame_range, len(clip['frames']))
    registered = registered or {}
    records = detection_records if detection_records is not None else registered.get('frames')
    if records is None and registered.get('schemaVersion') == 2 and 'entities' in registered:
        players = _native_review_observations(registered, clip, indices)
        raw_digest = canonical_digest(registered)
    else:
        if not isinstance(records, list) or len(records) != len(clip['frames']):
            raise AdapterError('capability_unavailable', 'No matching detector records; configure the local detector adapter.')
        tracks_by_id = {}
        for f in indices:
            record = records[f]
            if record.get('frame') != f or not finite(record.get('time')) or abs(record['time'] - clip['frames'][f]['time']) > 1e-7:
                raise AdapterError('source_mismatch', 'Detector record indexes/times do not match decoded asset frames.')
            seen = set()
            for track in record.get('tracks', []):
                if (len(track) < 7 or not _validate_box(track, clip['width'], clip['height'])
                        or not finite(track[4]) or int(track[4]) != track[4] or track[4] <= 0
                        or not finite(track[5]) or not 0 <= track[5] <= 1 or int(track[4]) in seen):
                    raise AdapterError('source_mismatch', 'Malformed or duplicate detection track in the requested interval.')
                track_id = int(track[4]); seen.add(track_id)
                evidence = record.get('track_evidence', {}).get(str(track_id), {})
                is_observed = evidence.get('source') in {'detection', 'raw_detection', 'observed_detection'}
                tracks_by_id.setdefault(track_id, {})[f] = (track, evidence, is_observed)
        players = []
        for track_id, positions in sorted(tracks_by_id.items()):
            body_records = []
            team_values = set()
            for f in indices:
                track, evidence, observed = positions.get(f, (None, {}, False))
                if evidence.get('team_label') and not evidence.get('color_conflict'):
                    team_values.add(evidence['team_label'])
                body_records.append({'assetFrame': f, 'sourceFrame': clip['frames'][f]['source_frame'],
                                     'pts': clip['frames'][f]['time'],
                                     'position': [(track[0] + track[2]) / 2, (track[1] + track[3]) / 2] if track else None,
                                     'bbox': track[:4] if track else None, 'sourceSpace': 'image_pixels',
                                     'anchorSemantics': 'body_point',
                                     'observationStatus': 'observed' if observed else 'estimated' if track else 'unknown',
                                     'visibility': 'visible' if observed else 'unknown',
                                     'identityConfidence': None, 'locationConfidence': track[5] if track else None,
                                     'sourceMethod': 'detector_box_center' if observed else 'unverified_tracking' if track else 'missing',
                                     'evidenceRef': f'detector:T{track_id}:asset:{f}',
                                     'identityConflict': evidence.get('color_conflict') is True})
            players.append({'playerId': f'T{track_id}', 'trackId': track_id, 'identityStatus': 'anonymous_track_candidate',
                            'identityEvidenceFrames': [], 'teamCandidate': next(iter(team_values)) if len(team_values) == 1 else None,
                            'name': None, 'jerseyNumber': None, 'frames': body_records})
        raw_digest = canonical_digest(records)
        for f in indices:
            clip['frames'][f].update({key: deepcopy(records[f][key]) for key in
                                     ('tracks', 'pending_detections', 'track_evidence', 'detection_indices', 'raw_detection_count') if key in records[f]})
    if not players or not any(p['observationStatus'] == 'observed' for player in players for p in player['frames']):
        raise AdapterError('tracking_gap', 'No source-verified observed player locations exist in this interval.')
    fingerprint = canonical_digest({'adapterVersion': ADAPTER_VERSION, 'rawTrackingDigest': raw_digest,
                                    'frameMappingDigest': inspection['frameMappingDigest'],
                                    'players': players, 'range': frame_range})
    clip['tracking_fingerprint'] = fingerprint
    clip['tracking_revision'] = ADAPTER_VERSION + ':' + fingerprint[:16]
    review = {'schemaVersion': 2, 'videoSha256': clip['video_sha256'],
              'sourceVideoSha256': clip['source_video_sha256'], 'trackingFingerprint': fingerprint,
              'trackingRevision': clip['tracking_revision'], 'width': clip['width'], 'height': clip['height'],
              'mediaEndTime': clip['mediaEndTime'], 'coordinateSystem': 'image_pixels',
              'sourceFrameMapping': deepcopy(inspection['sourceFrameMapping']),
              'settings': {'cuts': clip['sourceCuts'], 'sourceCuts': clip['sourceCuts'], 'maxGapSeconds': 0},
              'selectionConfirmed': False, 'confirmedAt': None, 'allFramesManuallyVerified': False,
              'entities': [{'id': p['playerId'], 'name': p['playerId'], 'role': 'player',
                            'identityConfirmed': False, 'trajectory': [], 'courtTrajectory': []} for p in players]}
    # The first adapter deliberately does not create native foot-follow data,
    # including for upstream feet until a separate binding review is implemented.
    return {'clip': clip, 'review': review, 'playerEvidence': {'schemaVersion': '1.0', 'range': deepcopy(frame_range),
            'adapterVersion': ADAPTER_VERSION, 'rawTrackingDigest': raw_digest, 'players': players},
            'gapSummary': [{'playerId': p['playerId'], 'unknownRanges': contiguous_ranges(
                f['assetFrame'] for f in p['frames'] if f['observationStatus'] != 'observed')} for p in players]}


def detect_local(video_path, inspection, frame_range, weights, output_path, *, python=None, checkpoint=lambda: None):
    """Run the explicitly configured local weights; do not download or install."""
    weights = Path(weights).resolve()
    if not weights.is_file():
        raise AdapterError('capability_unavailable', 'The configured detector weights are missing.')
    request = {'videoPath': str(Path(video_path).resolve()), 'weights': str(weights),
               'weightsSha256': file_sha256(weights), 'videoSha256': inspection['clip']['video_sha256'],
               'range': frame_range, 'frames': inspection['clip']['frames'], 'outputPath': str(Path(output_path).resolve())}
    input_path = Path(output_path).with_suffix('.request.json'); write_json(input_path, request)
    command = [str(python or sys.executable), str(Path(__file__).resolve()), '--detect', str(input_path)]
    error_path = Path(output_path).with_suffix('.stderr.txt')
    with error_path.open('w', encoding='utf-8') as errors:
        process = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=errors,
                                   creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        try:
            while process.poll() is None:
                checkpoint()
                try:
                    process.wait(timeout=.25)
                except subprocess.TimeoutExpired:
                    pass
            if process.returncode:
                raise AdapterError('capability_unavailable', 'Local detector execution failed; retained detector diagnostic artifact.')
        finally:
            if process.poll() is None:
                process.kill(); process.wait(timeout=10)
    result = read_json(output_path)
    if result['videoSha256'] != request['videoSha256'] or result['weightsSha256'] != request['weightsSha256']:
        raise AdapterError('source_mismatch', 'Detector provenance changed during execution.')
    return result


def _detector_worker(request):
    import os
    import time
    from types import SimpleNamespace
    os.environ.update(YOLO_OFFLINE='true', YOLO_AUTOINSTALL='false')
    import av
    import numpy as np
    import torch
    import ultralytics
    from ultralytics import YOLO, settings
    from ultralytics.engine.results import Boxes
    from ultralytics.trackers.byte_tracker import BYTETracker
    if file_sha256(request['videoPath']) != request['videoSha256'] or file_sha256(request['weights']) != request['weightsSha256']:
        raise AdapterError('source_mismatch', 'Detector inputs changed before inference.')
    settings.update({'sync': False})
    model = YOLO(request['weights'])
    names = model.names
    classes = [int(key) for key, value in names.items() if str(value).lower() in {'person', 'player'}]
    if not classes:
        raise AdapterError('capability_unavailable', 'Configured detector has no declared person/player class.')
    tracker = BYTETracker(SimpleNamespace(track_high_thresh=.2, track_low_thresh=.07, new_track_thresh=.2,
                          track_buffer=30, match_thresh=.8, fuse_score=True))
    frames = deepcopy(request['frames']); started = time.monotonic(); device = 0 if torch.cuda.is_available() else 'cpu'
    with av.open(request['videoPath']) as container:
        for i, frame in enumerate(container.decode(video=0)):
            if i < request['range']['startFrame']:
                continue
            if i >= request['range']['endFrameExclusive']:
                break
            if frame.time is None or abs(float(frame.time) - frames[i]['time']) > 1e-7:
                raise AdapterError('source_mismatch', 'Detector decoded times changed.')
            image = frame.to_ndarray(format='bgr24')
            raw = model.predict(image, classes=classes, conf=.07, imgsz=960, device=device,
                                half=device != 'cpu', verbose=False)[0].boxes.data.cpu().numpy()
            associated = tracker.update(Boxes(raw, image.shape[:2]), image).reshape(-1, 8)
            tracks, evidence, used = [], {}, set()
            for row in associated:
                detection_index = int(row[7])
                if detection_index < 0 or detection_index >= len(raw) or detection_index in used:
                    raise AdapterError('source_mismatch', 'Tracker returned a non-observed detection association.')
                used.add(detection_index); detected = raw[detection_index]
                track_id = int(row[4])
                # Save the actual detector box, never the Kalman-smoothed box.
                tracks.append([*map(float, detected[:4]), track_id, float(detected[4]), int(detected[5])])
                evidence[str(track_id)] = {'source': 'detection', 'raw_detection_index': detection_index,
                                           'identity_verified': False}
            frames[i].update(tracks=tracks, pending_detections=[list(map(float, row)) for n, row in enumerate(raw) if n not in used],
                             track_evidence=evidence, raw_detection_count=len(raw), candidate_count=len(raw))
    if file_sha256(request['videoPath']) != request['videoSha256'] or file_sha256(request['weights']) != request['weightsSha256']:
        raise AdapterError('source_mismatch', 'Detector inputs changed during inference.')
    return {'frames': frames, 'videoSha256': request['videoSha256'], 'weightsSha256': request['weightsSha256'],
            'adapterVersion': ADAPTER_VERSION, 'modelNames': names, 'tracker': 'ByteTrack/raw_detector_boxes',
            'ultralyticsVersion': ultralytics.__version__, 'torchVersion': torch.__version__,
            'configuration': {'personClasses': classes, 'confidenceThreshold': .07, 'imageSize': 960,
                              'trackHighThreshold': .2, 'trackLowThreshold': .07, 'newTrackThreshold': .2,
                              'trackBuffer': 30, 'matchThreshold': .8, 'fuseScore': True},
            'identityVerified': False, 'elapsedSeconds': time.monotonic() - started, 'device': str(device)}


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--detect':
        request = read_json(sys.argv[2]); write_json(request['outputPath'], _detector_worker(request))
    else:
        raise SystemExit('This module is called by the workflow runner; --detect takes its internal request file.')
