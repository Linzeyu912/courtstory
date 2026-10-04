"""Local point/line calibration from floor evidence across one tracked shot.

Image homographies align a small set of frames. Masked temporal medians recover
some line stretches behind moving people; permanently hidden lines remain
geometric projections. No inferred endpoint is added as a measured control.
"""
import warnings

import cv2
import numpy as np

from court_line_refinement import _project, fit_painted_line


def evidence_mask(shape, boxes, scale):
    mask = np.full(shape, 255, np.uint8)
    # This is an exclusion heuristic, not spectator segmentation.
    mask[round(shape[0]*.75):] = 0
    for row in boxes:
        x1, y1, x2, y2 = np.asarray(row[:4])*scale
        cv2.rectangle(mask, (int(x1)-8, int(y1)-8), (int(x2)+8, int(y2)+8), 0, -1)
    return mask


def named_segments(side):
    from court_propagation import LANDMARKS, LENGTH, WIDTH
    points = {name: (LENGTH-x if side == 'right' else x, y)
              for name, (x, y) in LANDMARKS.items()}
    segments = {a+b: [points[a], points[b]] for a, b in ('AB', 'BC', 'CD', 'DA')}
    segments.update(far_sideline=[points['F'], points['E']],
                    near_sideline=[points['H'], points['G']])
    return points, {name: np.asarray(ends, np.float64) for name, ends in segments.items()}


def fuse_floor(grays, keys, records, reference, scale, max_frames=11):
    """Use only anchor matches, never model resets or adjacent-flow recovery."""
    indices = [i for i in sorted(keys) if keys[i].get('courtToImage')
               and keys[i].get('status') != 'invalid'
               and keys[i].get('quality', {}).get('method') in ('reference_seed', 'sift_anchor')
               and keys[i].get('quality', {}).get('calibrationBasisFrame', reference) == reference]
    if len(indices) < 3:
        return None, None, indices
    indices = [indices[i] for i in np.unique(np.linspace(0, len(indices)-1, min(max_frames, len(indices))).astype(int))]
    scaled = np.diag([scale, scale, 1.])
    h0 = scaled @ np.asarray(keys[reference]['courtToImage']).reshape(3, 3)
    height, width = grays[reference].shape
    layers = []
    for index in indices:
        hi = scaled @ np.asarray(keys[index]['courtToImage']).reshape(3, 3)
        motion = h0 @ np.linalg.inv(hi)
        mask = evidence_mask(grays[index].shape, records[index]['tracks'], scale)
        warped = cv2.warpPerspective(grays[index], motion, (width, height))
        valid = cv2.warpPerspective(mask, motion, (width, height)) > 254
        layers.append(np.where(valid, warped, np.nan).astype(np.float32))
    stack = np.stack(layers)
    count = np.isfinite(stack).sum(axis=0)
    with warnings.catch_warnings():
        warnings.simplefilter('ignore', RuntimeWarning)  # Empty masked pixels.
        median = np.nanmedian(stack, axis=0)
    mask = np.uint8(count >= 3)*255
    return np.nan_to_num(median).astype(np.uint8), mask, indices


def _fit_lines(h, controls, observations):
    """Refit all lines together, with the proposed controls as soft priors."""
    refined = h/h[2, 2]
    prior = _project(h, controls)
    for _ in range(3):
        rows, targets = [], []
        for (x, y), (u, v) in zip(controls, prior):
            weight = .6/max(abs(float(refined[2] @ [x, y, 1])), 1e-6)
            rows.extend((np.array([x, y, 1, 0, 0, 0, -u*x, -u*y])*weight,
                         np.array([0, 0, 0, x, y, 1, -v*x, -v*y])*weight))
            targets.extend((u*weight, v*weight))
        for ends, (a, b, c) in observations.values():
            for t in np.linspace(.1, .9, 5):
                x, y = ends[0]*(1-t)+ends[1]*t
                weight = 1/max(abs(float(refined[2] @ [x, y, 1])), 1e-6)
                rows.append(np.array([a*x, a*y, a, b*x, b*y, b, c*x, c*y])*weight)
                targets.append(-c*weight)
        answer, _, rank, _ = np.linalg.lstsq(rows, targets, rcond=None)
        if rank != 8:
            return None
        refined = np.r_[answer, 1.].reshape(3, 3)
    return refined


def _line_errors(h, observations):
    result = {}
    for name, (ends, line) in observations.items():
        samples = np.asarray([ends[0]*(1-t)+ends[1]*t for t in np.linspace(.1, .9, 9)])
        pixels = _project(h, samples)
        result[name] = float(np.mean(np.abs(np.column_stack((pixels, np.ones(len(pixels)))) @ line)))
    return result


def refine_fused_lines(gray, mask, h, side, control_ids, scale):
    points, segments = named_segments(side)
    detail = {'method': 'masked_temporal_point_line_fit', 'refinementApplied': False,
              'independentAccuracyValidated': False, 'lines': {}}
    radius = max(6., gray.shape[1]*.025)
    observations = {}
    # Require the outer key to be coherent. An inner 12 ft stripe cannot
    # silently stand in for the outer 16 ft landmarks A-D.
    for name, ends in segments.items():
        modes = ('stripe', 'boundary') if name == 'DA' else ('boundary', 'stripe')
        for mode in modes:
            line, evidence = fit_painted_line(gray, _project(h, ends), mask, radius, mode)
            if line is not None:
                break
        detail['lines'][name] = {**evidence, 'evidenceType': mode,
                                 'status': 'line_supported' if line is not None else 'inferred'}
        if line is not None:
            observations[name] = (ends, line)
    # B and C must be constrained by an actually supported free-throw line.
    # An unobserved near sideline is deliberately not needed.
    if not all(name in observations for name in ('AB', 'BC', 'CD', 'DA', 'far_sideline')):
        return h, {**detail, 'reason': 'insufficient_joint_line_evidence'}
    if detail['lines']['AB']['evidenceType'] != detail['lines']['CD']['evidenceType']:
        return h, {**detail, 'reason': 'mixed_lane_boundary_identity'}
    lane = []
    for first, second in (('DA', 'AB'), ('AB', 'BC'), ('BC', 'CD'), ('CD', 'DA')):
        q = np.cross(observations[first][1], observations[second][1])
        if abs(q[2]) < .12:
            return h, {**detail, 'reason': 'unstable_line_intersection'}
        lane.append(q[:2]/q[2])
    outer = np.asarray([points[i] for i in 'ABCD'])
    initial_lane = _project(h, outer)
    lane = np.asarray(lane, np.float32)
    area = cv2.contourArea(initial_lane.astype(np.float32), oriented=True)
    ratio = cv2.contourArea(lane, oriented=True)/area if abs(area) > 1e-6 else 0
    if not cv2.isContourConvex(lane) or not .78 < ratio < 1.28:
        return h, {**detail, 'reason': 'lane_identity_or_area_changed'}
    controls = np.asarray([points[i] for i in control_ids if i in points])
    refined = _fit_lines(h, controls, observations)
    if refined is None or not np.isfinite(refined).all() or abs(np.linalg.det(refined)) < 1e-8:
        return h, {**detail, 'reason': 'degenerate_joint_fit'}
    # Also gate extrapolated near-side corners and perspective denominators.
    anchors = np.asarray([points[i] for i in 'ABCDEFGH'])
    old, new = _project(h, anchors), _project(refined, anchors)
    z0, z1 = np.c_[anchors, np.ones(len(anchors))] @ h[2], np.c_[anchors, np.ones(len(anchors))] @ refined[2]
    shift = np.linalg.norm(new-old, axis=1)
    if (not np.isfinite(new).all() or np.any(z0*z1 <= 0)
            or shift[:5].max() > radius*1.5 or shift.max() > radius*3):
        return h, {**detail, 'reason': 'joint_fit_exceeds_local_geometry'}
    before, after = _line_errors(h, observations), _line_errors(refined, observations)
    detail.update(meanLineDistanceBeforePixels=round(float(np.mean(list(before.values()))/scale), 3),
                  meanLineDistanceAfterPixels=round(float(np.mean(list(after.values()))/scale), 3))
    if (np.mean(list(after.values())) >= np.mean(list(before.values()))-.25
            or max(after.values()) > 3. or any(after[k] > before[k]+1. for k in after)):
        return h, {**detail, 'reason': 'joint_lines_inconsistent_or_no_gain'}
    detail.update(refinementApplied=True, reason='joint_lane_and_far_sideline',
                  supportedLines=list(observations),
                  cornerAdjustmentPixels={i: round(float(v/scale), 3) for i, v in zip('ABCDEFGH', shift)})
    return refined, detail


def attach_visibility(key, gray, h, boxes, scale, supported=()):
    """Support in other frames does not make an occluded pixel observable."""
    points, segments = named_segments(key['side'])
    mask = evidence_mask(gray.shape, boxes, scale)

    def visibility(xy):
        inside, allowed = 0, 0
        for x, y in xy:
            if np.isfinite([x, y]).all() and 0 <= x < gray.shape[1] and 0 <= y < gray.shape[0]:
                inside += 1
                allowed += bool(mask[int(y), int(x)])
        return inside, allowed

    line_status = {}
    for name, ends in segments.items():
        xy = _project(h, [ends[0]*(1-t)+ends[1]*t for t in np.linspace(0, 1, 60)])
        inside, allowed = visibility(xy)
        supported_here = name in supported and allowed >= max(6, inside*.3)
        line_status[name] = {'status': 'supported_projection' if supported_here else 'inferred',
                             'reason': 'outside_frame' if inside == 0 else
                                       'occluded_or_excluded' if allowed < max(6, inside*.3) else
                                       'temporal_line_support' if supported_here else 'no_line_support',
                             'visibleFraction': round(allowed/max(inside, 1), 3)}
    families = {name: line_status[name] for name in ('far_sideline', 'near_sideline')}
    families[f"{key['side']}_baseline"] = line_status['DA']
    families[f"{key['side']}_key"] = {'status': 'supported_projection' if all(
        line_status[n]['status'] == 'supported_projection' for n in ('AB', 'BC', 'CD')) else 'inferred'}
    adjacent = {'A': ('DA', 'AB'), 'B': ('AB', 'BC'), 'C': ('BC', 'CD'), 'D': ('CD', 'DA'),
                'E': ('DA', 'far_sideline'), 'F': ('far_sideline', 'midline'),
                'G': ('DA', 'near_sideline'), 'H': ('near_sideline', 'midline')}
    point_status = {}
    for name, floor in points.items():
        xy = _project(h, [floor])[0]
        inside, allowed = visibility([xy])
        supported_here = bool(allowed) and name in adjacent and all(n in supported for n in adjacent[name])
        point_status[name] = {'status': 'supported_projection' if supported_here else 'inferred',
                              'reason': 'outside_frame' if not inside else 'occluded_or_excluded' if not allowed else
                                        'temporal_line_support' if supported_here else 'no_line_support',
                              'image': [round(float(v/scale), 4) for v in xy]}
    key.setdefault('quality', {}).update(lineVisibility=families, pointVisibility=point_status)


def refine_tracked_shot(grays, keys, records, reference, scale, manual=False):
    """Apply one common floor correction; retain motion estimates and gaps."""
    scaled = np.diag([scale, scale, 1.])
    h0 = scaled @ np.asarray(keys[reference]['courtToImage']).reshape(3, 3)
    detail = {'refinementApplied': False, 'reason': 'preserve_manual_reference', 'sourceFrames': []}
    if not manual:
        gray, mask, indices = fuse_floor(grays, keys, records, reference, scale)
        if gray is not None:
            refined, detail = refine_fused_lines(gray, mask, h0, keys[reference]['side'],
                [p['id'] for p in keys[reference]['points'] if p.get('enabled', True) and p.get('role') != 'check'], scale)
        else:
            detail = {'refinementApplied': False, 'reason': 'insufficient_aligned_frames'}
        # Keep provenance in source-video coordinates, so trimming a saved
        # candidate does not silently relabel the frames used for the fit.
        detail['sourceFrames'] = [records[i].get('source_frame', i) for i in indices]
        detail['frameCoordinates'] = 'source_video'
    correction = np.linalg.inv(h0) @ refined if detail['refinementApplied'] else np.eye(3)
    for index, key in keys.items():
        if key.get('status') == 'invalid' or not key.get('courtToImage'):
            continue
        same_basis = key.get('quality', {}).get('calibrationBasisFrame', reference) == reference
        apply = detail['refinementApplied'] and same_basis
        h = np.asarray(key['courtToImage']).reshape(3, 3)
        if apply:
            h = h @ correction
            h /= h[2, 2]
            key['courtToImage'] = h.reshape(-1).tolist()
            inverse = np.linalg.inv(h)
            key['imageToCourt'] = (inverse/inverse[2, 2]).reshape(-1).tolist()
            points, _ = named_segments(key['side'])
            for point in key['points']:
                if point.get('enabled', True) and point.get('role') != 'check':
                    point.setdefault('beforeTemporalImage', list(point['image']))
                    point['image'] = _project(h, [points[point['id']]])[0].tolist()
            from court_propagation import projected_line_quality
            key['quality']['projectedLines'] = projected_line_quality(grays[index], scaled @ h, records[index]['tracks'], scale)
        key['quality']['temporalLineFit'] = detail if same_basis else {
            'refinementApplied': False, 'reason': 'different_calibration_basis'}
        attach_visibility(key, grays[index], scaled @ h, records[index]['tracks'], scale,
                          detail.get('supportedLines', ()) if apply else ())
        basis = key['quality'].pop('calibrationBasisFrame', reference)
        key['quality']['calibrationBasisSourceFrame'] = records[basis].get('source_frame', basis)
    return detail
