"""Propagate named floor controls within one camera shot; outputs stay reviewable.

Anchor SIFT matching avoids cumulative drift. LK is an explicitly labelled
fallback and stops at experimental quality gates. Neither measures accuracy.
"""
import copy
import time
from functools import lru_cache

import cv2
import numpy as np

LENGTH, WIDTH = 28.6512, 15.24
LANDMARKS = {'A': (0, 5.1816), 'B': (5.7912, 5.1816), 'C': (5.7912, 10.0584),
             'D': (0, 10.0584), 'E': (0, 0), 'F': (LENGTH/2, 0), 'G': (0, WIDTH),
             'H': (LENGTH/2, WIDTH), 'I': (0, .9144), 'J': (0, WIDTH-.9144)}


def project(h, points):
    return cv2.perspectiveTransform(np.asarray(points, np.float64).reshape(-1, 1, 2), h).reshape(-1, 2)


@lru_cache(maxsize=2)
def court_line_samples(step=.35):
    """Sample the NBA floor markings in court coordinates, retaining families."""
    lines = [
        ('far_sideline', [(0, 0), (LENGTH, 0)]),
        ('near_sideline', [(0, WIDTH), (LENGTH, WIDTH)]),
        ('midline', [(LENGTH/2, 0), (LENGTH/2, WIDTH)]),
        ('left_baseline', [(0, 0), (0, WIDTH)]),
        ('right_baseline', [(LENGTH, 0), (LENGTH, WIDTH)]),
        ('left_key', [(0, 5.1816), (5.7912, 5.1816), (5.7912, 10.0584), (0, 10.0584)]),
        ('right_key', [(LENGTH, 5.1816), (LENGTH-5.7912, 5.1816),
                       (LENGTH-5.7912, 10.0584), (LENGTH, 10.0584)]),
    ]
    theta = np.arcsin((7.62-.9144)/7.239)
    arc = [(1.6002+7.239*np.cos(a), 7.62+7.239*np.sin(a))
           for a in np.linspace(-theta, theta, 65)]
    lines.extend((('left_three', [(0, .9144), *arc, (0, WIDTH-.9144)]),
                  ('right_three', [(LENGTH, .9144),
                                   *[(LENGTH-x, y) for x, y in arc],
                                   (LENGTH, WIDTH-.9144)])))
    samples = []
    for family, vertices in lines:
        for first, second in zip(vertices, vertices[1:]):
            a, b = np.asarray(first, float), np.asarray(second, float)
            count = max(1, int(np.ceil(np.linalg.norm(b-a)/step)))
            samples.extend((family, a+(b-a)*t/count) for t in range(count))
        samples.append((family, np.asarray(vertices[-1], float)))
    return samples


def _edge_field(gray, h, boxes, scale):
    mask = floor_mask(gray.shape, h, boxes, scale)
    edge = cv2.Canny(gray, 55, 155)
    edge[mask == 0] = 0
    # Court lines are often anti-aliased / low contrast; join only tiny gaps.
    edge = cv2.dilate(edge, np.ones((3, 3), np.uint8), iterations=1)
    edge[mask == 0] = 0
    distances = cv2.distanceTransform(255-edge, cv2.DIST_L2, 3)
    return mask, edge, distances


def projected_line_quality(gray, h, boxes=(), scale=1., max_distance=3.):
    """Measure template-line proximity to image edges; this is not accuracy."""
    mask, _, distances = _edge_field(gray, h, boxes, scale)
    per_family = {}
    visible_court, visible_image = [], []
    samples = court_line_samples()
    image_points = project(h, [point for _, point in samples])
    for (family, court_point), image_point in zip(samples, image_points):
        if not np.isfinite(image_point).all():
            continue
        x, y = np.rint(image_point).astype(int)
        if 0 <= x < gray.shape[1] and 0 <= y < gray.shape[0] and mask[y, x]:
            per_family.setdefault(family, []).append(float(distances[y, x]))
            visible_court.append(court_point)
            visible_image.append((float(image_point[0])/scale, float(image_point[1])/scale))
    visible = {name: values for name, values in per_family.items() if len(values) >= 5}
    all_distances = [distance for values in visible.values() for distance in values]
    supported = sorted(name for name, values in visible.items()
                       if float(np.mean(np.asarray(values) <= max_distance)) >= .35)
    court = np.asarray(visible_court, float).reshape(-1, 2) if visible_court else np.empty((0, 2))
    image = np.asarray(visible_image, float).reshape(-1, 2) if visible_image else np.empty((0, 2))
    return {
        'method': 'canny_edge_distance',
        'medianResidualPixels': round(float(np.median(all_distances)/scale), 3) if all_distances else None,
        'supportWithin3Pixels': round(float(np.mean(np.asarray(all_distances) <= max_distance*scale)), 4) if all_distances else None,
        'visibleFamilies': sorted(visible),
        'supportedFamilies': supported,
        'uncertaintyHint': 'insufficient_line_evidence' if len(supported) < 3 else 'not_quantified_from_edges',
        'visibleCourtBoundsMeters': ([round(float(v), 3) for v in (court[:, 0].min(), court[:, 1].min(),
                                    court[:, 0].max(), court[:, 1].max())] if len(court) else None),
        'visibleImageBoundsPixels': ([round(float(v), 1) for v in (image[:, 0].min(), image[:, 1].min(),
                                    image[:, 0].max(), image[:, 1].max())] if len(image) else None),
        'sampleCount': len(all_distances),
        'independentAccuracyValidated': False,
    }


def refine_from_court_lines(gray, h, side, boxes=(), scale=1., control_points=()):
    """Refine automatic controls using named lane geometry and local line fits."""
    from court_line_refinement import refine_lane_corners
    before = projected_line_quality(gray, h, boxes, scale)
    detail = {**before, 'refinementApplied': False}
    controls = [point for point in control_points if isinstance(point, dict)
                and point.get('id') in LANDMARKS and point.get('enabled', True)
                and point.get('role') != 'check']
    if len(controls) < 4 or any(point.get('source') == 'human' for point in controls):
        return h, {**detail, 'refinementReason': 'preserve_manual_or_insufficient_controls'}
    def floor_point(name):
        x, y = LANDMARKS[name]
        return (LENGTH-x if side == 'right' else x, y)
    outer = np.asarray([floor_point(name) for name in 'ABCD'], np.float64)
    control_floor = np.asarray([floor_point(point['id']) for point in controls], np.float64)
    attempts = []
    # NBA diagrams include 16 ft outer lane boundaries and 12 ft inner lines.
    # Keep these identities distinct: never assign the inner stripe to A-D.
    for feet, mode in ((16, 'boundary'), (16, 'stripe'), (12, 'stripe')):
        floor_corners = outer.copy()
        floor_corners[:, 1] = [WIDTH/2-feet*.3048/2, WIDTH/2-feet*.3048/2,
                               WIDTH/2+feet*.3048/2, WIDTH/2+feet*.3048/2]
        refined, evidence = refine_lane_corners(gray, h, floor_corners, control_floor,
                                                boxes, scale, outer[[3, 0]], mode)
        evidence.update(laneWidthFeet=feet, laneEvidence=mode)
        if evidence['refinementApplied']:
            after = projected_line_quality(gray, refined, boxes, scale)
            old_distance, new_distance = before['medianResidualPixels'], after['medianResidualPixels']
            old_support, new_support = before['supportWithin3Pixels'], after['supportWithin3Pixels']
            if ((old_distance is not None and new_distance is not None and new_distance > old_distance+3.)
                    or (old_support is not None and new_support is not None and new_support < old_support-.12)):
                attempts.append({'laneWidthFeet': feet, 'laneEvidence': mode, 'reason': 'other_court_lines_regressed'})
                continue
            displacement = np.linalg.norm(project(refined, outer)-project(h, outer), axis=1)/scale
            evidence['cornerAdjustmentPixels'] = {name: round(float(value), 3)
                                                   for name, value in zip('ABCD', displacement)}
            return refined, {**after, **evidence,
                             'modelControlAdjustmentPixels': round(float(np.median(
                                 np.linalg.norm(project(refined, control_floor)-project(h, control_floor), axis=1)/scale)), 3)}
        attempts.append({'laneWidthFeet': feet, 'laneEvidence': mode,
                         'reason': evidence['refinementReason']})
    return h, {**detail, 'refinementReason': 'no_consistent_lane_lines', 'lineAttempts': attempts}


def fit_seed(seed, frame_count, width, height):
    if not isinstance(seed, dict) or type(seed.get('frame')) is not int or not 0 <= seed['frame'] < frame_count:
        raise ValueError('请先在当前视频保存一帧有效场地标定。')
    if seed.get('side') not in ('left', 'right'):
        raise ValueError('请选择场地左侧或右侧球篮。')
    points = copy.deepcopy(seed.get('points') or [dict(id=i, image=p) for i, p in zip('ABCD', seed.get('image', []))])
    if not isinstance(points, list) or any(not isinstance(p, dict) or not isinstance(p.get('id'), str) for p in points):
        raise ValueError('场地参照点必须包含点名与图像坐标。')
    if len(points) > 10 or len({p.get('id') for p in points}) != len(points):
        raise ValueError('场地参照点不能重复，最多10个。')
    floor, image = [], []
    for p in points:
        xy = p.get('image')
        if p.get('id') not in LANDMARKS or not isinstance(xy, list) or len(xy) != 2 or not all(type(v) in (int, float) and np.isfinite(v) for v in xy):
            raise ValueError('场地点名称或坐标无效。')
        if not (-width <= xy[0] <= width*2 and -height <= xy[1] <= height*2):
            raise ValueError('场地参照点离原画面过远，请重新核对。')
        if p.get('enabled', True) and p.get('role') != 'check':
            x, y = LANDMARKS[p['id']]
            floor.append((LENGTH-x if seed['side'] == 'right' else x, y)); image.append(xy)
    if len(floor) < 4:
        raise ValueError('至少需要4个有效地面标定点；仅作核验的点不参与拟合。')
    h, _ = cv2.findHomography(np.asarray(floor, np.float64), np.asarray(image, np.float64), 0)
    if h is None or not np.isfinite(h).all() or abs(np.linalg.det(h)) < 1e-8:
        raise ValueError('点的布局无法确定场地，请避免共线或重合。')
    error = np.linalg.norm(project(h, floor)-image, axis=1)
    if float(np.sqrt(np.mean(error**2))) > max(width, height)*.02:
        raise ValueError('场地点之间偏差较大，请先核对点名与位置。')
    return {**copy.deepcopy(seed), 'points': points}, h


def floor_mask(shape, h, boxes, scale):
    height, width = shape
    mask = np.zeros(shape, np.uint8)
    corners = project(h, [(0, 0), (LENGTH, 0), (LENGTH, WIDTH), (0, WIDTH)])
    if not np.isfinite(corners).all(): return mask
    cv2.fillPoly(mask, [np.clip(corners, -10000, 10000).astype(np.int32)], 255)
    # Broadcast graphics are not floor features. Keep this explicit in metadata.
    mask[round(height*.75):] = 0
    for row in boxes:
        x1, y1, x2, y2 = np.asarray(row[:4])*scale
        cv2.rectangle(mask, (int(x1)-8, int(y1)-8), (int(x2)+8, int(y2)+8), 0, -1)
    return mask


def estimate_transform(a, b, shape, scale):
    detail = {'matches': len(a), 'inliers': 0, 'inlierRatio': 0., 'imageAreaCoverage': 0.}
    if len(a) < 12: return None, {**detail, 'reason': '可匹配的地面纹理不足'}
    h, inliers = cv2.findHomography(np.asarray(a), np.asarray(b), cv2.RANSAC, 2.)
    if h is None or inliers is None or not np.isfinite(h).all():
        return None, {**detail, 'reason': '图像变换拟合失败'}
    keep = inliers.ravel().astype(bool)
    count = int(keep.sum()); ratio = float(keep.mean())
    area = float(cv2.contourArea(cv2.convexHull(np.float32(a[keep])))/(shape[0]*shape[1])) if count >= 3 else 0.
    residual = float(np.median(np.linalg.norm(project(h, a[keep])-b[keep], axis=1))/scale) if count else 1e9
    detail.update(inliers=count, inlierRatio=ratio, imageAreaCoverage=area, medianResidualPixels=residual)
    if count < 12 or ratio < .65 or area < .02 or residual > 3.5:
        return None, {**detail, 'reason': '地面匹配质量不足，请补标定关键帧'}
    return h/h[2, 2], detail


def flow_transform(old, new, mask, scale):
    pts = cv2.goodFeaturesToTrack(old, maxCorners=240, qualityLevel=.015, minDistance=7, mask=mask)
    if pts is None or len(pts) < 12: return None, {'reason': '地面纹理不足'}
    nxt, ok, _ = cv2.calcOpticalFlowPyrLK(old, new, pts, None, winSize=(25, 25), maxLevel=3)
    back, back_ok, _ = cv2.calcOpticalFlowPyrLK(new, old, nxt, None, winSize=(25, 25), maxLevel=3)
    valid = (ok.ravel() == 1) & (back_ok.ravel() == 1) & (np.linalg.norm(pts-back, axis=2).ravel() < 1.)
    return estimate_transform(pts[valid].reshape(-1, 2), nxt[valid].reshape(-1, 2), old.shape, scale)


def propagate_court(video, payload, seed, cuts=(), max_seconds=20., max_fallback_frames=12,
                    predictor=None, object_records=None, unavailable_error=None,
                    refresh_interval_seconds=1.):
    import av
    started = time.perf_counter()
    width, height = payload['width'], payload['height']; records = payload['frames']
    if not np.isfinite(refresh_interval_seconds) or refresh_interval_seconds <= 0:
        raise ValueError('场地模型重估间隔必须大于0。')
    seed, h0 = fit_seed(seed, len(records), width, height)
    frame = seed['frame']; moment = records[frame]['time']
    boundaries = [0, len(records), *payload.get('sourceCuts', []), *cuts]
    if any(type(c) is not int or not 0 <= c <= len(records) for c in boundaries):
        raise ValueError('切镜边界超出视频范围。')
    boundaries = sorted(set(boundaries))
    if seed.get('source') == 'camera_propagation' or any(p.get('source') == 'camera_propagation' for p in seed['points']):
        quality = seed.get('quality') or {}
        support = seed.get('cameraSupportFrame', quality.get('cameraSupportFrame', quality.get('referenceFrame')))
        if type(support) is not int or not 0 <= support < len(records) or any(min(support, frame) < c <= max(support, frame) for c in boundaries):
            raise ValueError('这组传播参照跨过了切镜，请重新点选或核对当前帧投影后再生成。')
    start = max(c for c in boundaries if c <= frame); end = min(c for c in boundaries if c > frame)-1
    while start < frame and moment-records[start]['time'] > max_seconds: start += 1
    while end > frame and records[end]['time']-moment > max_seconds: end -= 1
    if end-start > 1800: raise ValueError('这段画面过长，请分成较短的镜头处理。')
    scale = min(1., 960/width)
    dimensions = (round(width*scale), round(height*scale))
    transform_scale = np.diag([scale, scale, 1.]); inv_scale = np.linalg.inv(transform_scale)
    h_seed = transform_scale@h0
    grays = {}; refresh_estimates = {}; refresh_diagnostics = {}
    refresh_indices = set()
    manual_seed = (seed.get('source') == 'human' or any(p.get('source') == 'human' for p in seed['points'])
                   or bool(seed.get('projectionReviewedAt'))
                   or (seed.get('quality') or {}).get('cameraSupportReviewSource') == 'human_projection_review')
    if not manual_seed and predictor is not None and isinstance(object_records, list) and len(object_records) == len(records):
        next_refresh = records[start]['time']
        for index in range(start, end+1):
            if index != frame and records[index]['time'] >= next_refresh:
                refresh_indices.add(index)
                next_refresh = records[index]['time']+refresh_interval_seconds
    refresh_unavailable_reason = None
    orientation_estimator = None
    if refresh_indices:
        from court_orientation import estimate_court
        orientation_estimator = estimate_court
    with av.open(str(video)) as container:
        for index, picture in enumerate(container.decode(video=0)):
            if index > end: break
            if index < start: continue
            if abs(float(picture.time)-records[index]['time']) > .001: raise ValueError('视频帧时间与检测记录不一致。')
            if index in refresh_indices and predictor is not None:
                image = picture.to_ndarray(format='bgr24')
                try:
                    proposal = orientation_estimator(predictor(image),
                        object_records[index].get('objects', []), width, height, locked_side=seed['side'])
                    refresh_diagnostics[index] = {'status': proposal['status'], 'reason': proposal.get('reason')}
                    if proposal['status'] == 'needs_review' and proposal.get('side') == seed['side']:
                        refresh_estimates[index] = proposal
                    image = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
                except Exception as error:
                    if unavailable_error is None or not isinstance(error, unavailable_error):
                        raise
                    predictor = None
                    refresh_unavailable_reason = str(error)
                    refresh_diagnostics[index] = {'status': 'unavailable', 'reason': refresh_unavailable_reason}
                    image = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
            elif index in refresh_indices:
                refresh_diagnostics[index] = {'status': 'unavailable', 'reason': refresh_unavailable_reason or '本地场地模型不可用'}
                image = picture.to_ndarray(format='gray')
            else:
                image = picture.to_ndarray(format='gray')
            grays[index] = cv2.resize(image, dimensions)
    if len(grays) != end-start+1: raise ValueError('视频解码未覆盖指定镜头。')
    cv2.setNumThreads(4)
    sift = cv2.SIFT_create(nfeatures=1800)
    # Refined controls change the court geometry, not the image motion. Keep
    # the original detector's feature support so a small line correction does
    # not swap SIFT anchors and degrade an otherwise stable camera track.
    motion_support = h_seed
    if seed.get('source') == 'hoop_constrained_court48' and any(p.get('modelImage') for p in seed['points']):
        raw_seed = {**seed, 'points': [{**p, 'image': p.get('modelImage', p['image'])} for p in seed['points']]}
        _, raw_h = fit_seed(raw_seed, len(records), width, height)
        motion_support = transform_scale @ raw_h
    seed_mask = floor_mask(grays[frame].shape, motion_support, records[frame]['tracks'], scale)
    anchor_keys, anchor_descriptors = sift.detectAndCompute(grays[frame], seed_mask)
    matcher = cv2.BFMatcher(cv2.NORM_L2)
    seed_lines = projected_line_quality(grays[frame], h_seed, records[frame]['tracks'], scale)
    keys = {frame: {**seed, 'source': seed.get('source', 'human'), 'status': 'needs_review', 'reviewRequired': True,
                   'courtToImage': h0.reshape(-1).tolist(),
                   'quality': {'method': 'reference_seed', 'referenceFrame': frame, 'cameraSupportFrame': frame,
                               'calibrationBasisFrame': frame,
                               'sourceReferenceFrame': (seed.get('quality') or {}).get('sourceReferenceFrame', (seed.get('quality') or {}).get('referenceFrame')),
                               'courtLineFit': (seed.get('quality') or {}).get('courtLineFit'),
                               'projectedLines': seed_lines,
                               'independentAccuracyValidated': False}}}
    original_points = np.asarray([p['image'] for p in seed['points']], np.float64)*scale
    anchor_quality = {'referenceFrame': frame, 'independentAccuracyValidated': False}
    for sequence in (range(frame+1, end+1), range(frame-1, start-1, -1)):
        previous = frame; previous_h = h_seed; previous_basis = frame; fallback_run = 0; active = True
        for index in sequence:
            gray = grays[index]; camera = None; detail = {}; method = 'sift_anchor'; motion = None
            basis = frame
            recovery_proposal = None
            refresh = refresh_diagnostics.get(index)
            proposal = refresh_estimates.get(index)
            if proposal is not None:
                camera = transform_scale @ np.asarray(proposal['courtToImage'], np.float64).reshape(3, 3)
                camera /= camera[2, 2]
                camera, line_fit = refine_from_court_lines(gray, camera, seed['side'],
                    records[index]['tracks'], scale, proposal.get('points', []))
                motion = camera @ np.linalg.inv(h_seed)
                method = 'court48_reinitialization'
                basis = index
                detail = {'court48Refresh': 'accepted', 'court48Reason': proposal.get('reason'),
                          'courtLineFit': line_fit}
                fallback_run = 0
                if not line_fit.get('refinementApplied'):
                    # Do not replace a corrected, stable camera estimate with
                    # a raw detector fit for just one refresh frame.
                    recovery_proposal = (camera, detail)
                    camera = None; motion = None; method = 'sift_anchor'; detail = {}
                    basis = frame
            if camera is None and anchor_descriptors is not None and len(anchor_descriptors) >= 12:
                # Excluding people is more important than restricting a moving court to its old polygon.
                image_mask = np.full(gray.shape, 255, np.uint8); image_mask[round(dimensions[1]*.75):] = 0
                for row in records[index]['tracks']:
                    x1, y1, x2, y2 = np.asarray(row[:4])*scale
                    cv2.rectangle(image_mask, (int(x1)-8, int(y1)-8), (int(x2)+8, int(y2)+8), 0, -1)
                now_keys, now_descriptors = sift.detectAndCompute(gray, image_mask)
                if now_descriptors is not None and len(now_descriptors) >= 2:
                    matches = [m for pair in matcher.knnMatch(anchor_descriptors, now_descriptors, k=2) if len(pair) == 2 for m, n in [pair] if m.distance < .72*n.distance]
                    # Repeated court markings can map several anchors onto one location.
                    matches = list({m.trainIdx: m for m in sorted(matches, key=lambda m: m.distance, reverse=True)}.values())
                    a = np.float32([anchor_keys[m.queryIdx].pt for m in matches]); b = np.float32([now_keys[m.trainIdx].pt for m in matches])
                    motion, detail = estimate_transform(a, b, gray.shape, scale)
                    if motion is not None: camera = motion@h_seed; fallback_run = 0
            if recovery_proposal is not None:
                if camera is None:
                    camera, detail = recovery_proposal
                    motion = camera @ np.linalg.inv(h_seed)
                    method = 'court48_reinitialization'
                    basis = index
                    fallback_run = 0
                else:
                    detail.update(court48Refresh='retained_camera', court48Reason='line_evidence_did_not_support_refresh',
                                  courtLineFit=recovery_proposal[1]['courtLineFit'])
            if refresh and refresh.get('status') != 'needs_review':
                detail['court48Refresh'] = refresh.get('status')
                detail['court48Reason'] = refresh.get('reason')
            if camera is None and active and fallback_run < max_fallback_frames:
                method = 'lk_adjacent'
                mask = floor_mask(gray.shape, previous_h, records[previous]['tracks'], scale)
                step, detail = flow_transform(grays[previous], gray, mask, scale)
                if step is not None:
                    camera = step@previous_h; motion = camera@np.linalg.inv(h_seed); fallback_run += 1
                    basis = previous_basis
            if camera is not None:
                candidate = project(motion, original_points)/scale
                quad0 = project(h_seed, [(0, 0), (LENGTH, 0), (LENGTH, WIDTH), (0, WIDTH)])
                quad1 = project(camera, [(0, 0), (LENGTH, 0), (LENGTH, WIDTH), (0, WIDTH)])
                area0 = abs(cv2.contourArea(np.float32(quad0))); area1 = abs(cv2.contourArea(np.float32(quad1)))
                if not np.isfinite(candidate).all() or not .25 < area1/max(area0, 1.) < 4.:
                    camera = None; detail['reason'] = '场地投影变化异常'
            if camera is not None:
                detail['projectedLines'] = projected_line_quality(
                    gray, camera, records[index]['tracks'], scale)
            if camera is None:
                keys[index] = {'frame': index, 'side': seed['side'], 'points': [], 'status': 'invalid',
                               'reason': detail.get('reason', '镜头匹配失败，请补标定'), 'quality': {**detail, **anchor_quality}}
                active = False
            else:
                pts = [{**p, 'image': [round(float(v), 4) for v in xy], 'source': 'camera_propagation', 'reviewRequired': True}
                       for p, xy in zip(seed['points'], candidate)]
                keys[index] = {'frame': index, 'side': seed['side'], 'source': 'camera_propagation', 'points': pts,
                               'status': 'needs_review', 'reviewRequired': True,
                               'quality': {**detail, **anchor_quality, 'method': method, 'adjacentFallbackFrames': fallback_run,
                                           'calibrationBasisFrame': basis},
                               'courtToImage': (inv_scale@camera).reshape(-1).tolist()}
                previous_h = camera; previous_basis = basis; active = True
            previous = index
    from court_temporal_refinement import refine_tracked_shot
    temporal_fit = refine_tracked_shot(grays, keys, records, frame, scale, manual=manual_seed)
    rows = [keys[i] for i in sorted(keys)]
    refresh_count = sum(row.get('quality', {}).get('court48Refresh') == 'accepted' for row in rows)
    return {'schemaVersion': 1, 'videoHash': payload['video_sha256'], 'source': 'camera_propagation',
            'label': '地面特征跟随镜头 · 待复核', 'template': 'NBA', 'referenceFrame': frame,
            'keyframes': rows, 'invalidFrames': [k['frame'] for k in rows if k['status'] == 'invalid'],
            'maxKeyframeGapSeconds': 0, 'reviewRequired': True, 'metricAccuracyValidated': False,
            'summary': {'startFrame': start, 'endFrame': end, 'validFrames': sum(bool(k['points']) for k in rows),
                        'totalFrames': len(rows), 'court48RefreshFrames': refresh_count,
                        'lineRefinedFrames': sum(bool((k.get('quality', {}).get('courtLineFit') or {}).get('refinementApplied')) for k in rows),
                        'temporalLineFit': temporal_fit,
                        'processingSeconds': time.perf_counter()-started},
            'notes': ['人工初始点的误差会保留；匹配残差不是独立地面精度。',
                      '最多在参考帧前后20秒、同一镜头内处理，切镜处停止。',
                      '屏蔽已有检测框与画面底部25%；字幕位置不同或移动广告仍可能影响结果。',
                      '自动参照可用同镜头多帧标线联合校正；近边线及遮挡端点无证据时只作推算，不增加实测控制点。',
                      ('每秒尝试用已有48点模型按锁定篮侧重估；不确定时才沿用通过门限的镜头匹配。'
                       if refresh_indices else '此入口未启用本地48点模型重估，只提供原有镜头匹配。'),
                      '投影线得分是画面边缘邻近度启发式，线缘可能来自球员、广告或地板纹理，不是标定准确率。']}
