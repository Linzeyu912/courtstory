"""Validate camera and foot proposals before exposing them to the browser."""
import json
import math

COURT_IDS = frozenset('ABCDEFGHIJ')
COURT_STATUSES = frozenset(('needs_review', 'accepted_reference', 'invalid'))


def finite_number(value):
    return type(value) in (int, float) and math.isfinite(value)


def finite_json(value, label):
    try:
        json.dumps(value, allow_nan=False)
    except (ValueError, TypeError, OverflowError) as error:
        raise ValueError(f'{label} contains a non-finite or non-JSON value') from error


def validate_court_candidates(profile, video_hash, frame_count):
    if not isinstance(profile, dict) or profile.get('videoHash') != video_hash or profile.get('template') != 'NBA':
        raise ValueError('Court candidates must match this video and NBA template')
    finite_json(profile, 'Court candidates')
    rows = profile.get('keyframes')
    if not isinstance(rows, list):
        raise ValueError('Court candidates require a keyframes array')
    seen, invalid = set(), set()
    for row in rows:
        if not isinstance(row, dict) or type(row.get('frame')) is not int or not 0 <= row['frame'] < frame_count:
            raise ValueError('Court candidate frame is outside this video')
        if row['frame'] in seen:
            raise ValueError('Court candidate frames must be unique')
        seen.add(row['frame'])
        if row.get('side') not in ('left', 'right') or row.get('status') not in COURT_STATUSES:
            raise ValueError('Court candidate side or status is invalid')
        if row['status'] == 'invalid':
            invalid.add(row['frame'])
        quality = row.get('quality')
        if quality is not None:
            if not isinstance(quality, dict):
                raise ValueError('Court quality metadata must be an object')
            for name in ('referenceFrame', 'cameraSupportFrame'):
                value = quality.get(name)
                if value is not None and (type(value) is not int or not 0 <= value < frame_count):
                    raise ValueError('Court camera reference or support frame is outside this video')
            root_reference = quality.get('sourceReferenceFrame')
            if root_reference is not None and (type(root_reference) is not int or root_reference < 0):
                raise ValueError('Court source reference must be a nonnegative root frame')
        points = row.get('points')
        if not isinstance(points, list) or len(points) > len(COURT_IDS):
            raise ValueError('Court candidate points must be a list of named controls')
        ids = set()
        for point in points:
            if not isinstance(point, dict) or not isinstance(point.get('id'), str) or point['id'] not in COURT_IDS or point['id'] in ids:
                raise ValueError('Court candidate point names must be unique A-J controls')
            ids.add(point['id'])
            xy = point.get('image')
            if not isinstance(xy, list) or len(xy) != 2 or not all(finite_number(v) for v in xy):
                raise ValueError('Court candidate coordinates must be finite pixel pairs')
    listed = profile.get('invalidFrames', [])
    if not isinstance(listed, list) or any(type(i) is not int or not 0 <= i < frame_count for i in listed) or len(set(listed)) != len(listed) or set(listed) != invalid:
        raise ValueError('Court invalidFrames must match invalid keyframes exactly')
    reference = profile.get('referenceFrame')
    if reference is not None and (type(reference) is not int or not 0 <= reference < frame_count):
        raise ValueError('Court reference frame is outside this video')
    gap = profile.get('maxKeyframeGapSeconds')
    if gap is not None and (not finite_number(gap) or gap < 0):
        raise ValueError('Court maximum keyframe gap must be finite and nonnegative')
    return profile


def validate_feet_candidates(profile, video_hash, records_by_fingerprint, width, height):
    if not isinstance(profile, dict) or profile.get('videoHash') != video_hash:
        raise ValueError('Feet candidates must match this video')
    fingerprint = profile.get('trackingFingerprint')
    if not isinstance(fingerprint, str) or fingerprint not in records_by_fingerprint:
        raise ValueError('Feet candidates must match a detection version')
    finite_json(profile, 'Feet candidates')
    records = records_by_fingerprint[fingerprint]
    frames = profile.get('frames')
    if not isinstance(frames, list) or len(frames) != len(records):
        raise ValueError('Feet candidate frames must match the complete video')
    for index, (frame, record) in enumerate(zip(frames, records)):
        if not isinstance(frame, dict) or type(frame.get('frame')) is not int or frame['frame'] != index:
            raise ValueError('Feet candidate frame indices must be sequential integers')
        if not finite_number(frame.get('time')) or abs(frame['time'] - record['time']) > .001:
            raise ValueError('Feet candidate frame times must match detection frames')
        feet = frame.get('feet')
        if not isinstance(feet, list):
            raise ValueError('Feet frame must contain a feet array')
        available_ids = {r[4] for r in record['tracks']}
        seen = set()
        for observation in feet:
            if not isinstance(observation, dict) or type(observation.get('trackId')) is not int or observation['trackId'] not in available_ids or observation['trackId'] in seen:
                raise ValueError('Feet track IDs must be unique and present in this detector frame')
            seen.add(observation['trackId'])
            if observation.get('groundPoint') is not False or observation.get('contactState') != 'unknown':
                raise ValueError('Automatic feet proposals cannot confirm ground contact')
            for side in ('left', 'right'):
                point = observation.get(side)
                if point is None:
                    continue
                if not isinstance(point, dict) or not all(finite_number(point.get(k)) for k in ('x', 'y', 'score')):
                    raise ValueError('Feet proposal coordinates and score must be finite')
                if not (0 <= point['x'] < width and 0 <= point['y'] < height and 0 <= point['score'] <= 1):
                    raise ValueError('Feet proposal must be inside the image with a valid score')
                if point.get('groundPoint') is not False or point.get('contactState') != 'unknown' or point.get('needsReview') is not True:
                    raise ValueError('Feet proposal must remain an unconfirmed reference')
    return profile
