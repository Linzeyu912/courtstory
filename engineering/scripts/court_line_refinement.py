"""Refine a proposed lane from painted stripes and long colour boundaries.

This is local image evidence, not a learned semantic court-line detector. Three
observed lines plus a free-throw prior, or four observed lines, define the lane.
Missing support or excessive changes preserve the proposal.
"""
import cv2
import numpy as np


def _project(h, points):
    return cv2.perspectiveTransform(np.asarray(points, np.float64).reshape(-1, 1, 2), h).reshape(-1, 2)


def _sample(image, xy):
    return cv2.remap(image, xy[..., 0].astype(np.float32), xy[..., 1].astype(np.float32),
                     cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)


def _joint_fit(h, controls, corners, lines, keep_free_throw):
    """Balance original point evidence with distances to observed image lines."""
    rows, targets = [], []
    for (x, y), (u, v) in zip(controls, _project(h, controls)):
        weight = 1/max(abs(float(h[2] @ [x, y, 1])), 1e-6)
        rows.extend((np.array([x, y, 1, 0, 0, 0, -u*x, -u*y])*weight,
                     np.array([0, 0, 0, x, y, 1, -v*x, -v*y])*weight))
        targets.extend((u*weight, v*weight))
    for index, (a, b, c) in enumerate(lines):
        if index == 1 and keep_free_throw:
            continue  # The unchanged model line is a prior, not new evidence.
        for t in (.1, .5, .9):
            x, y = corners[index]*(1-t) + corners[(index+1) % 4]*t
            weight = 1/max(abs(float(h[2] @ [x, y, 1])), 1e-6)
            rows.append(np.array([a*x, a*y, a, b*x, b*y, b, c*x, c*y])*weight)
            targets.append(-c*weight)
    answer, _, rank, _ = np.linalg.lstsq(rows, targets, rcond=None)
    return np.r_[answer, 1.].reshape(3, 3) if rank == 8 else h


def fit_painted_line(gray, endpoints, mask, radius, mode='stripe'):
    """Fit a painted stripe or colour boundary using unoccluded stretches.

    A stripe must have two darker sides; a boundary must have sustained contrast
    across its normal. The caller chooses the expected feature's identity.
    Offsets and changes of angle are bounded around the current proposal.
    """
    endpoints = np.asarray(endpoints, np.float64)
    if not np.isfinite(endpoints).all() or np.max(np.abs(endpoints)) > 1e6:
        return None, {'reason': 'short_or_invalid_line'}
    # Search the visible portion of a long sideline, even when its endpoints
    # are outside the image. No visible endpoint is required for a line fit.
    visible, first, last = cv2.clipLine((0, 0, gray.shape[1], gray.shape[0]),
        tuple(np.rint(endpoints[0]).astype(int)), tuple(np.rint(endpoints[1]).astype(int)))
    if not visible:
        return None, {'reason': 'outside_frame'}
    first, last = np.asarray(first, np.float64), np.asarray(last, np.float64)
    delta = last-first
    length = float(np.linalg.norm(delta))
    if not np.isfinite(endpoints).all() or length < 35:
        return None, {'reason': 'short_or_invalid_line'}
    tangent = delta/length
    normal = np.array([-tangent[1], tangent[0]])
    t = np.linspace(.03, .97, min(160, max(40, int(length/4))))
    offsets = np.arange(-radius-9, radius+9.01, .5)
    centers = first + t[:, None]*delta
    xy = centers[:, None, :] + offsets[None, :, None]*normal
    values = _sample(gray.astype(np.float32), xy)
    allowed = _sample(mask, xy) > 254
    ridge = np.zeros_like(values)
    if mode == 'boundary':
        # The outside of a coloured key can be a single step edge. Require a
        # persistent change across a wide profile, excluding an inner stripe.
        left = sum(values[:, 16-shift:-16-shift] for shift in (8, 10, 12, 14))/4
        right = sum(values[:, 16+shift:values.shape[1]-16+shift] for shift in (8, 10, 12, 14))/4
        broad = np.abs(left-right)
        sharp = np.abs(values[:, 18:-14]-values[:, 14:-18])*2
        valid = allowed[:, 16:-16] & allowed[:, 2:-30] & allowed[:, 30:-2]
        ridge[:, 16:-16] = np.where(valid & (broad >= 25), np.minimum(broad, sharp), 0)
    else:
        for distance in (2, 3, 4):
            shift = distance*2
            contrast = np.minimum(values[:, shift:-shift]-values[:, :-2*shift],
                                  values[:, shift:-shift]-values[:, 2*shift:])
            valid = allowed[:, shift:-shift] & allowed[:, :-2*shift] & allowed[:, 2*shift:]
            ridge[:, shift:-shift] = np.maximum(ridge[:, shift:-shift], np.where(valid, contrast, 0))

    # A bounded two-parameter search gathers support along the whole segment,
    # instead of snapping each location to an unrelated nearby image edge.
    intercepts = np.arange(-radius, radius+.01, .5)
    slopes = np.arange(-min(radius, length*.08), min(radius, length*.08)+.01, 1.)
    params = np.array([(a, b) for a in intercepts for b in slopes])
    predicted = params[:, :1] + params[:, 1:]*(t[None, :]-.5)
    columns = np.rint((predicted-offsets[0])/.5).astype(int)
    columns = np.clip(columns, 0, len(offsets)-1)
    score = ridge[np.arange(len(t))[None, :], columns]
    visibility = allowed[np.arange(len(t))[None, :], columns]
    visible_counts = visibility.sum(axis=1)
    support = (score >= 20).sum(axis=1)
    # Long painted stretches dominate isolated lettering or player edges.
    strength = np.minimum(score, 60).sum(axis=1)/len(t)
    eligible = (visible_counts >= len(t)*.3) & (support >= np.maximum(12, visible_counts*.7))
    ranking = np.where(eligible, strength-.15*np.abs(params[:, 0])/radius, -1)
    best = int(np.argmax(ranking))
    if ranking[best] < 8:
        return None, {'reason': 'insufficient_painted_line_support'}

    chosen = predicted[best]
    # Subpixel center estimates use ridge strength near the selected straight
    # line. Robust fitting suppresses remaining occluders and stripe junctions.
    nearby = np.abs(offsets[None, :]-chosen[:, None]) <= 1.5
    weights = np.where(nearby & (ridge >= 20), ridge, 0)
    keep = weights.sum(axis=1) > 0
    supported_t = t[keep]
    bins = np.unique(np.minimum((supported_t*8).astype(int), 7))
    if len(bins) < 3 or np.ptp(supported_t) < .35:
        return None, {'reason': 'painted_support_too_local', 'bins': len(bins),
                      'coverage': float(np.ptp(supported_t)), 'supportSamples': int(keep.sum())}
    shifts = (weights[keep]*offsets).sum(axis=1)/weights[keep].sum(axis=1)
    pixels = centers[keep]+shifts[:, None]*normal
    vx, vy, x, y = cv2.fitLine(pixels.astype(np.float32), cv2.DIST_HUBER, 0, .01, .01).ravel()
    line = np.array([-vy, vx, vy*x-vx*y], dtype=np.float64)
    residual = np.abs(np.column_stack((pixels, np.ones(len(pixels)))) @ line)
    detail = {'supportSamples': int(keep.sum()), 'visibleSamples': int(visible_counts[best]),
              'coverage': round(float(np.ptp(supported_t)), 3),
              'medianResidualPixels': round(float(np.median(residual)), 3),
              'normalOffsetPixels': round(float(params[best, 0]), 3),
              'meanContrast': round(float(strength[best]), 3)}
    if np.median(residual) > 1.5:
        return None, {**detail, 'reason': 'inconsistent_painted_line'}
    return line, detail


def refine_lane_corners(gray, h, floor_corners, control_floor, boxes=(), scale=1., baseline_floor=None,
                        mode='stripe'):
    """Fit the lane from supported lines, optionally retaining a free-throw prior."""
    detail = {'method': 'painted_lane_intersections', 'refinementApplied': False,
              'independentAccuracyValidated': False, 'lines': {}}
    mask = np.full(gray.shape, 255, np.uint8)
    mask[round(gray.shape[0]*.75):] = 0
    for row in boxes:
        x1, y1, x2, y2 = np.asarray(row[:4])*scale
        cv2.rectangle(mask, (int(x1)-4, int(y1)-4), (int(x2)+4, int(y2)+4), 0, -1)
    corners = _project(h, floor_corners)
    radius = max(6., gray.shape[1]*.025)
    lines = []
    for index, name in enumerate(('AB', 'BC', 'CD', 'DA')):
        endpoints = (_project(h, baseline_floor) if index == 3 and baseline_floor is not None
                     else corners[[index, (index+1) % 4]])
        line, evidence = fit_painted_line(gray, endpoints, mask, radius,
                                         'stripe' if index == 3 else mode)
        detail['lines'][name] = evidence
        lines.append(line)
    # The free-throw side of a painted key can be a colour boundary instead of
    # a separate bright stripe. Keep its original location when the baseline
    # and both long lane stripes agree, rather than inventing a stripe there.
    if lines[1] is None and all(lines[index] is not None for index in (0, 2, 3)):
        line = np.cross(np.r_[corners[1], 1.], np.r_[corners[2], 1.])
        lines[1] = line/np.linalg.norm(line[:2])
        detail['lines']['BC']['retainedModelLine'] = True
    if any(line is None for line in lines):
        return h, {**detail, 'refinementReason': 'insufficient_lane_stripes'}
    intersections = []
    for index in range(4):
        point = np.cross(lines[index-1], lines[index])
        if abs(point[2]) < .12:
            return h, {**detail, 'refinementReason': 'unstable_line_intersection'}
        intersections.append(point[:2]/point[2])
    intersections = np.asarray(intersections)
    if not cv2.isContourConvex(intersections.astype(np.float32)):
        return h, {**detail, 'refinementReason': 'nonconvex_lane'}
    refined = cv2.getPerspectiveTransform(np.asarray(floor_corners, np.float32), intersections.astype(np.float32))
    controls = np.vstack((floor_corners, control_floor)) if len(control_floor) else floor_corners
    displacement = np.linalg.norm(_project(refined, controls)-_project(h, controls), axis=1)
    area_before = cv2.contourArea(corners.astype(np.float32), oriented=True)
    area_after = cv2.contourArea(intersections.astype(np.float32), oriented=True)
    ratio = area_after/area_before if abs(area_before) > 1e-6 else 0
    if (not np.isfinite(refined).all() or not np.isfinite(displacement).all()
            or float(displacement.max()) > radius*1.5 or not .7 < ratio < 1.4):
        return h, {**detail, 'refinementReason': 'stripe_fit_exceeds_local_geometry'}
    # A local lane fit alone can distort distant sidelines. Retain every
    # original control as a soft constraint while fitting the observed lines.
    refined = _joint_fit(h, control_floor, np.asarray(floor_corners), lines,
                          detail['lines']['BC'].get('retainedModelLine', False))
    displacement = np.linalg.norm(_project(refined, controls)-_project(h, controls), axis=1)
    if not np.isfinite(refined).all() or not np.isfinite(displacement).all() or displacement.max() > radius*1.5:
        return h, {**detail, 'refinementReason': 'joint_fit_exceeds_local_geometry'}
    detail.update(refinementApplied=True, refinementReason='painted_lines_with_free_throw_prior'
                  if detail['lines']['BC'].get('retainedModelLine') else 'four_painted_lane_lines',
                  cornerAdjustmentPixels={name: round(float(value/scale), 3)
                                          for name, value in zip('ABCD', displacement[:4])},
                  intersectionsPixels=(intersections/scale).tolist())
    return refined, detail
