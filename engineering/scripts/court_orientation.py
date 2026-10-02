"""Reviewable court orientation from floor geometry and a separate hoop detection.

This supports ordinary sideline broadcast views with near floor points lower in
the image. ``side`` describes the local screen-oriented court template, not a
persistent physical basket or a team's attacking end. The elevated hoop is only
an orientation check; it never enters the ground homography fit.
"""
import itertools

import cv2
import numpy as np

from court_propagation import LANDMARKS, LENGTH, WIDTH


SLOTS = {
    'left': {'A': 3, 'B': 12, 'C': 14, 'D': 4, 'E': 0, 'I': 1, 'J': 6},
    'right': {'A': 38, 'B': 29, 'C': 31, 'D': 39, 'E': 35, 'I': 36, 'J': 41},
}
POINT_THRESHOLD = .5
HOOP_THRESHOLD = .35


def _project(h, points):
    points = np.column_stack((np.asarray(points, dtype=float), np.ones(len(points)))) @ h.T
    if np.any(np.abs(points[:, 2]) < 1e-8):
        return None
    answer = points[:, :2] / points[:, 2:]
    return answer if np.isfinite(answer).all() else None


def _normalise(points):
    center = points.mean(axis=0)
    scale = np.sqrt(np.mean(np.sum((points-center)**2, axis=1)))
    if scale < 1e-8:
        return None
    return (points-center)/scale


def _determines_homography(floor, pixels):
    """Rank two alone does not exclude three collinear points plus one point."""
    source, target = _normalise(floor), _normalise(pixels)
    if source is None or target is None:
        return False
    # Three ground points on one line plus a fourth elsewhere remain
    # underconstrained even if prediction noise makes image points noncollinear.
    def general_position(quad):
        for a, b, c in itertools.combinations(quad, 3):
            ab, ac = b-a, c-a
            if abs(float(ab[0]*ac[1]-ab[1]*ac[0])) < 1e-4:
                return False
        return True
    if not any(general_position(source[list(ids)]) and general_position(target[list(ids)])
               for ids in itertools.combinations(range(len(floor)), 4)):
        return False
    rows = []
    for (x, y), (u, v) in zip(source, target):
        rows.extend(([-x, -y, -1, 0, 0, 0, u*x, u*y, u],
                     [0, 0, 0, -x, -y, -1, v*x, v*y, v]))
    singular = np.linalg.svd(np.asarray(rows), compute_uv=False)
    return len(singular) >= 8 and singular[7]/singular[0] > 1e-5


def _hypothesis(kps, slot_side, width, height, hoop):
    points = [
        {'id': name, 'image': kps[slot, :2].tolist(), 'score': float(kps[slot, 2]),
         'modelSlot': slot, 'slotSide': slot_side, 'source': 'yolo11n-court48'}
        for name, slot in SLOTS[slot_side].items()
        if kps[slot, 2] >= POINT_THRESHOLD
        and 0 <= kps[slot, 0] <= width and 0 <= kps[slot, 1] <= height
    ]
    evidence = {'slotSide': slot_side, 'pointCount': len(points), 'accepted': False}

    def reject(reason):
        return None, {**evidence, 'reason': reason}

    if len(points) < 4:
        return reject('insufficient_ground_points')
    floor = np.asarray([LANDMARKS[p['id']] for p in points], dtype=float)
    pixels = np.asarray([p['image'] for p in points], dtype=float)
    if not _determines_homography(floor, pixels):
        return reject('degenerate_ground_layout')
    local, _ = cv2.findHomography(floor, pixels, 0)
    if local is None or not np.isfinite(local).all():
        return reject('ground_fit_failed')
    predicted = _project(local, floor)
    if predicted is None:
        return reject('invalid_ground_projection')
    errors = np.linalg.norm(predicted-pixels, axis=1)
    residual = float(np.sqrt(np.mean(errors**2)))
    evidence['fitResidualPixels'] = residual
    # All observed points must agree; a high confidence outlier is not discarded.
    if residual > max(3., width*.005) or float(errors.max()) > max(6., width*.01):
        return reject('inconsistent_ground_points')

    # Reject horizons or folds crossing the visible half template. The whole
    # other half may legitimately lie outside the image and is not clipped.
    corners = np.asarray([[0, 0], [LENGTH/2, 0], [LENGTH/2, WIDTH], [0, WIDTH]])
    denominator = np.column_stack((corners, np.ones(4))) @ local[2]
    if np.min(np.abs(denominator)) < 1e-7 or not (np.all(denominator > 0) or np.all(denominator < 0)):
        return reject('projection_horizon_crosses_half_court')
    lane = _project(local, [LANDMARKS[name] for name in 'ABCD'])
    if lane is None or not cv2.isContourConvex(lane.astype(np.float32)):
        return reject('invalid_lane_projection')
    if np.any(np.abs(lane) > np.asarray([width, height])*3):
        return reject('implausible_lane_extent')
    area = abs(float(cv2.contourArea(lane.astype(np.float32))))
    if area < width*height*.001 or area > width*height*2:
        return reject('implausible_lane_area')
    # Midpoints are projected in court coordinates, not averaged after the
    # perspective transform. The rim's known ground footprint is a check only.
    axis_points = _project(local, [[0, WIDTH/2], [5.7912, WIDTH/2],
                                   [1.6002, WIDTH/2], [2.8956, 5.1816], [2.8956, 10.0584]])
    if axis_points is None:
        return reject('invalid_lane_axis')
    baseline, free_throw, rim_floor, far, near = axis_points
    axis = free_throw-baseline
    axis_length = float(np.linalg.norm(axis))
    evidence.update(baselineCenter=baseline.tolist(), freeThrowCenter=free_throw.tolist(),
                    projectedRimGround=rim_floor.tolist(), laneAxis=axis.tolist())
    if abs(float(axis[0])) < max(width*.04, axis_length*.35):
        return reject('unsupported_endline_or_ambiguous_view')
    if float(near[1]-far[1]) < height*.02:
        return reject('unsupported_near_far_orientation')
    inferred = 'left' if axis[0] > 0 else 'right'
    evidence['inferredSide'] = inferred
    center = np.asarray(hoop['center'])
    offset_x = abs(float(center[0]-rim_floor[0]))
    # Allow moderate camera tilt / detector box bias, but reject a mirrored
    # phantom lane on the opposite side of the observed hoop. Not a metric test.
    tolerance_x = max(width*.025, abs(float(axis[0]))*.22, hoop['box'][2]-hoop['box'][0])
    elevation = float(rim_floor[1]-center[1])
    evidence.update(hoopHorizontalOffsetPixels=offset_x, hoopHorizontalTolerancePixels=tolerance_x,
                    hoopAboveGroundPixels=elevation)
    if offset_x > tolerance_x:
        return reject('hoop_conflicts_with_ground_geometry')
    if not height*.025 <= elevation <= height*.7:
        return reject('hoop_height_evidence_inconsistent')
    # Reinterpret semantic slot side when floor geometry requires it. This is
    # not image mirroring: actual image coordinates and model slots are kept.
    reflection = np.asarray([[-1., 0., LENGTH], [0., 1., 0.], [0., 0., 1.]])
    to_image = local @ reflection if inferred == 'right' else local.copy()
    try:
        to_court = np.linalg.inv(to_image)
    except np.linalg.LinAlgError:
        return reject('noninvertible_ground_mapping')
    if abs(float(to_image[2, 2])) < 1e-8 or abs(float(to_court[2, 2])) < 1e-8:
        return reject('unstable_ground_mapping')
    to_image /= to_image[2, 2]
    to_court /= to_court[2, 2]
    if not np.isfinite(to_image).all() or not np.isfinite(to_court).all():
        return reject('unstable_ground_mapping')
    evidence.update(accepted=True, reason='hoop_and_floor_geometry_agree',
                    reinterpreted=slot_side != inferred)
    return {'side': inferred, 'points': points, 'courtToImage': to_image.reshape(-1).tolist(),
            'imageToCourt': to_court.reshape(-1).tolist(), 'lane': lane, 'evidence': evidence}, evidence


def estimate_court(kps, objects, width, height, locked_side=None):
    """Return a JSON-safe proposal; ambiguity and unsupported input stay invalid.

    ``locked_side`` is a confirmed direction for this same shot. A conflicting
    current direction invalidates the proposal; it never silently flips it.
    Callers must start a new lock on camera cuts / changes of viewing side.
    """
    orientation = {
        'method': 'hoop_relative_to_lane_geometry', 'reason': '', 'lockedSide': locked_side,
        'coordinateConvention': 'screen_oriented_sideline_template',
        'physicalEndIdentityVerified': False, 'hoopUsedForGroundFit': False,
        'pointThreshold': POINT_THRESHOLD, 'hoopThreshold': HOOP_THRESHOLD,
        'hypotheses': [],
    }

    def invalid(reason):
        orientation['reason'] = reason
        return {'side': None, 'status': 'invalid', 'points': [], 'courtToImage': None,
                'imageToCourt': None, 'orientation': orientation, 'reason': reason}

    if locked_side is not None and (not isinstance(locked_side, str) or locked_side not in ('left', 'right')):
        orientation['lockedSide'] = None
        return invalid('invalid_locked_side')
    try:
        width, height = float(width), float(height)
        kps = np.asarray(kps, dtype=float)
    except (TypeError, ValueError, OverflowError):
        return invalid('invalid_input')
    if not np.isfinite([width, height]).all() or min(width, height) <= 0:
        return invalid('invalid_image_dimensions')
    if kps.shape != (48, 3) or not np.isfinite(kps).all() or np.any((kps[:, 2] < 0) | (kps[:, 2] > 1)):
        return invalid('invalid_keypoints')
    if not isinstance(objects, (list, tuple)):
        return invalid('invalid_scene_objects')
    hoops = []
    malformed_hoop = False
    for obj in objects:
        if not isinstance(obj, dict) or obj.get('kind') != 'hoop':
            continue
        try:
            score = float(obj.get('score', 0))
            box = np.asarray(obj.get('box'), dtype=float)
        except (TypeError, ValueError, OverflowError):
            malformed_hoop = True
            continue
        if not np.isfinite(score) or not 0 <= score <= 1 or box.shape != (4,) or not np.isfinite(box).all():
            malformed_hoop = True
            continue
        if score < HOOP_THRESHOLD:
            continue
        x1, y1, x2, y2 = box
        if not (0 <= x1 < x2 <= width and 0 <= y1 < y2 <= height):
            malformed_hoop = True
            continue
        if x2-x1 > width*.3 or y2-y1 > height*.35:
            malformed_hoop = True
            continue
        hoops.append({'box': box.tolist(), 'score': score, 'center': [(x1+x2)/2, (y1+y2)/2]})
    orientation['hoopEvidence'] = hoops
    if malformed_hoop:
        return invalid('malformed_hoop_detection')
    if not hoops:
        return invalid('missing_reliable_hoop')
    if len(hoops) != 1:
        return invalid('multiple_hoops_ambiguous')
    candidates = []
    for slot_side in SLOTS:
        candidate, evidence = _hypothesis(kps, slot_side, width, height, hoops[0])
        orientation['hypotheses'].append(evidence)
        if candidate is not None:
            candidates.append(candidate)
    if not candidates:
        return invalid('no_consistent_ground_hypothesis')
    if len(candidates) > 1:
        # Only numerically equivalent hypotheses may be collapsed. Two
        # different geometries are not settled by confidence totals.
        for a, b in itertools.combinations(candidates, 2):
            if a['side'] != b['side'] or float(np.max(np.linalg.norm(a['lane']-b['lane'], axis=1))) > max(4., width*.005):
                return invalid('multiple_ground_hypotheses_ambiguous')
        candidates.sort(key=lambda row: row['evidence']['fitResidualPixels'])
        orientation['equivalentHypotheses'] = True
    selected = candidates[0]
    orientation.update(inferredSide=selected['side'], slotSide=selected['evidence']['slotSide'],
                       reinterpreted=selected['evidence']['reinterpreted'])
    if locked_side is not None and selected['side'] != locked_side:
        return invalid('locked_side_conflicts_with_current_evidence')
    reason = 'hoop_and_floor_geometry_agree'
    orientation['reason'] = reason
    return {key: selected[key] for key in ('side', 'points', 'courtToImage', 'imageToCourt')} | {
        'status': 'needs_review', 'orientation': orientation, 'reason': reason,
        'metricAccuracyValidated': False,
    }
