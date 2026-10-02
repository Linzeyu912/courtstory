"""Propagate named floor controls within one camera shot; outputs stay reviewable.

Anchor SIFT matching avoids cumulative drift. LK is an explicitly labelled
fallback and stops at experimental quality gates. Neither measures accuracy.
"""
import copy
import time

import cv2
import numpy as np

LENGTH, WIDTH = 28.6512, 15.24
LANDMARKS = {'A': (0, 5.1816), 'B': (5.7912, 5.1816), 'C': (5.7912, 10.0584),
             'D': (0, 10.0584), 'E': (0, 0), 'F': (LENGTH/2, 0), 'G': (0, WIDTH),
             'H': (LENGTH/2, WIDTH), 'I': (0, .9144), 'J': (0, WIDTH-.9144)}


def project(h, points):
    return cv2.perspectiveTransform(np.asarray(points, np.float64).reshape(-1, 1, 2), h).reshape(-1, 2)


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


def propagate_court(video, payload, seed, cuts=(), max_seconds=20., max_fallback_frames=12):
    import av
    started = time.perf_counter()
    width, height = payload['width'], payload['height']; records = payload['frames']
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
    grays = {}
    with av.open(str(video)) as container:
        for index, picture in enumerate(container.decode(video=0)):
            if index > end: break
            if index < start: continue
            if abs(float(picture.time)-records[index]['time']) > .001: raise ValueError('视频帧时间与检测记录不一致。')
            image = picture.to_ndarray(format='gray')
            grays[index] = cv2.resize(image, dimensions)
    if len(grays) != end-start+1: raise ValueError('视频解码未覆盖指定镜头。')
    cv2.setNumThreads(4)
    sift = cv2.SIFT_create(nfeatures=1800)
    seed_mask = floor_mask(grays[frame].shape, h_seed, records[frame]['tracks'], scale)
    anchor_keys, anchor_descriptors = sift.detectAndCompute(grays[frame], seed_mask)
    matcher = cv2.BFMatcher(cv2.NORM_L2)
    keys = {frame: {**seed, 'source': seed.get('source', 'human'), 'status': 'needs_review', 'reviewRequired': True,
                   'quality': {'method': 'reference_seed', 'referenceFrame': frame, 'cameraSupportFrame': frame,
                               'sourceReferenceFrame': (seed.get('quality') or {}).get('sourceReferenceFrame', (seed.get('quality') or {}).get('referenceFrame')),
                               'independentAccuracyValidated': False}}}
    original_points = np.asarray([p['image'] for p in seed['points']], np.float64)*scale
    anchor_quality = {'referenceFrame': frame, 'independentAccuracyValidated': False}
    for sequence in (range(frame+1, end+1), range(frame-1, start-1, -1)):
        previous = frame; previous_h = h_seed; fallback_run = 0; active = True
        for index in sequence:
            gray = grays[index]; camera = None; detail = {}; method = 'sift_anchor'; motion = None
            if anchor_descriptors is not None and len(anchor_descriptors) >= 12:
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
            if camera is None and active and fallback_run < max_fallback_frames:
                method = 'lk_adjacent'
                mask = floor_mask(gray.shape, previous_h, records[previous]['tracks'], scale)
                step, detail = flow_transform(grays[previous], gray, mask, scale)
                if step is not None:
                    camera = step@previous_h; motion = camera@np.linalg.inv(h_seed); fallback_run += 1
            if camera is not None:
                candidate = project(motion, original_points)/scale
                quad0 = project(h_seed, [(0, 0), (LENGTH, 0), (LENGTH, WIDTH), (0, WIDTH)])
                quad1 = project(camera, [(0, 0), (LENGTH, 0), (LENGTH, WIDTH), (0, WIDTH)])
                area0 = abs(cv2.contourArea(np.float32(quad0))); area1 = abs(cv2.contourArea(np.float32(quad1)))
                if not np.isfinite(candidate).all() or not .25 < area1/max(area0, 1.) < 4.:
                    camera = None; detail['reason'] = '场地投影变化异常'
            if camera is None:
                keys[index] = {'frame': index, 'side': seed['side'], 'points': [], 'status': 'invalid',
                               'reason': detail.get('reason', '镜头匹配失败，请补标定'), 'quality': {**detail, **anchor_quality}}
                active = False
            else:
                pts = [{**p, 'image': [round(float(v), 4) for v in xy], 'source': 'camera_propagation', 'reviewRequired': True}
                       for p, xy in zip(seed['points'], candidate)]
                keys[index] = {'frame': index, 'side': seed['side'], 'source': 'camera_propagation', 'points': pts,
                               'status': 'needs_review', 'reviewRequired': True,
                               'quality': {**detail, **anchor_quality, 'method': method, 'adjacentFallbackFrames': fallback_run},
                               'courtToImage': (inv_scale@camera).reshape(-1).tolist()}
                previous_h = camera; active = True
            previous = index
    rows = [keys[i] for i in sorted(keys)]
    return {'schemaVersion': 1, 'videoHash': payload['video_sha256'], 'source': 'camera_propagation',
            'label': '地面特征跟随镜头 · 待复核', 'template': 'NBA', 'referenceFrame': frame,
            'keyframes': rows, 'invalidFrames': [k['frame'] for k in rows if k['status'] == 'invalid'],
            'maxKeyframeGapSeconds': 0, 'reviewRequired': True, 'metricAccuracyValidated': False,
            'summary': {'startFrame': start, 'endFrame': end, 'validFrames': sum(bool(k['points']) for k in rows),
                        'totalFrames': len(rows), 'processingSeconds': time.perf_counter()-started},
            'notes': ['人工初始点的误差会保留；匹配残差不是独立地面精度。',
                      '最多在参考帧前后20秒、同一镜头内处理，切镜处停止。',
                      '屏蔽已有检测框与画面底部25%；字幕位置不同或移动广告仍可能影响结果。']}
