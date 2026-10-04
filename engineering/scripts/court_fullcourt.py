"""Offline, shot-local joint calibration of both ends of an NBA court.

This is a separate review candidate, not a player-position filter. Floor feature
matches constrain camera motion; measured court points/lines constrain geometry.
All matrices use one sideline-oriented full-court frame, never a per-half reset.
"""
from collections import defaultdict

import cv2
import numpy as np
from scipy.optimize import least_squares
from scipy.sparse import lil_matrix

from court_propagation import LANDMARKS, LENGTH, WIDTH, project, floor_mask
from court_line_refinement import fit_painted_line

VERSION = 'joint-floor-graph-v1'
CENTER_RADIUS = 1.8288  # NBA six-foot radius; hidden circles are not observations.


def normalize(h):
    h = np.asarray(h, float).reshape(3, 3)
    if not np.isfinite(h).all() or abs(h[2, 2]) < 1e-9:
        raise ValueError('Invalid homography')
    return h/h[2, 2]


def valid_geometry(h):
    corners = np.array([[0, 0], [LENGTH, 0], [LENGTH, WIDTH], [0, WIDTH]])
    d = np.column_stack([corners, np.ones(4)]) @ h[2]
    if not (np.all(d > 1e-5) or np.all(d < -1e-5)):
        return False
    p = project(h, corners)
    return bool(np.isfinite(p).all() and cv2.isContourConvex(p.astype(np.float32))
                and cv2.contourArea(p.astype(np.float32), oriented=True) > 0)


def masked_features(gray, boxes, h=None, scale=1.):
    mask = np.full(gray.shape, 255, np.uint8)
    if h is not None:
        mask = floor_mask(gray.shape, h, (), scale)
        mask = cv2.dilate(mask, np.ones((31, 31), np.uint8))
    mask[:round(gray.shape[0]*.36)] = 0
    mask[round(gray.shape[0]*.85):] = 0
    for box in boxes:
        x1, y1, x2, y2 = np.asarray(box[:4])*scale
        cv2.rectangle(mask, (int(x1)-10, int(y1)-10), (int(x2)+10, int(y2)+10), 0, -1)
    k, d = cv2.SIFT_create(nfeatures=2200, contrastThreshold=.025).detectAndCompute(gray, mask)
    return np.array([v.pt for v in k], np.float32).reshape(-1, 2), d


def match_features(first, second, shape, minimum=18):
    a, da = first; b, db = second
    if da is None or db is None or min(len(da), len(db)) < minimum:
        return None
    matches = [m for pair in cv2.BFMatcher().knnMatch(da, db, k=2)
               if len(pair) == 2 for m, n in [pair] if m.distance < .72*n.distance]
    matches = list({m.trainIdx: m for m in sorted(matches, key=lambda m: -m.distance)}.values())
    if len(matches) < minimum:
        return None
    p = a[[m.queryIdx for m in matches]]; q = b[[m.trainIdx for m in matches]]
    h, keep = cv2.findHomography(p, q, cv2.RANSAC, 2., maxIters=3000, confidence=.999)
    if h is None or keep is None:
        return None
    keep = keep.ravel().astype(bool); p = p[keep]; q = q[keep]
    area = min(abs(cv2.contourArea(cv2.convexHull(v)))/np.prod(shape) for v in (p, q)) if len(p) >= 3 else 0
    if len(p) < minimum or keep.mean() < .65 or area < .02:
        return None
    # Spread support over the floor instead of over-weighting a textured logo.
    order = np.lexsort((p[:, 0], p[:, 1]))
    ids = order[np.linspace(0, len(order)-1, min(70, len(order))).astype(int)]
    return {'h': normalize(h), 'a': p[ids], 'b': q[ids], 'inliers': len(p),
            'ratio': float(keep.mean()), 'coverage': float(area)}


def floor_flow(first, second, h, first_boxes, second_boxes, scale):
    """Short measured transfer with forward/backward and spatial support checks."""
    mask = floor_mask(first.shape, h, first_boxes, scale)
    mask[:round(len(first)*.36)] = 0
    points = cv2.goodFeaturesToTrack(first, maxCorners=500, qualityLevel=.007, minDistance=6, mask=mask)
    if points is None or len(points) < 24: return None
    following, ok, _ = cv2.calcOpticalFlowPyrLK(first, second, points, None, winSize=(31, 31), maxLevel=4)
    back, back_ok, _ = cv2.calcOpticalFlowPyrLK(second, first, following, None, winSize=(31, 31), maxLevel=4)
    p = points.reshape(-1, 2); q = following.reshape(-1, 2)
    keep = ok.ravel().astype(bool)&back_ok.ravel().astype(bool)&(np.linalg.norm(points-back, axis=2).ravel()<.8)
    keep &= (q[:, 0]>=0)&(q[:, 0]<second.shape[1])&(q[:, 1]>=second.shape[0]*.36)&(q[:, 1]<second.shape[0]*.85)
    for box in second_boxes:
        x1,y1,x2,y2 = np.asarray(box[:4])*scale
        keep &= ~((q[:, 0]>=x1-10)&(q[:, 0]<=x2+10)&(q[:, 1]>=y1-10)&(q[:, 1]<=y2+10))
    p, q = p[keep], q[keep]
    if len(p)<24: return None
    transform, inliers = cv2.findHomography(p,q,cv2.RANSAC,1.8,maxIters=3000,confidence=.999)
    if transform is None: return None
    keep = inliers.ravel().astype(bool)
    p, q = p[keep], q[keep]
    area = min(abs(cv2.contourArea(cv2.convexHull(v)))/np.prod(first.shape) for v in (p,q)) if len(p)>=3 else 0
    if len(p)<24 or keep.mean()<.8 or area<.04: return None
    ids = np.linspace(0,len(p)-1,min(70,len(p))).astype(int)
    return {'h':normalize(transform),'a':p[ids],'b':q[ids],'inliers':len(p),
            'ratio':float(keep.mean()),'coverage':float(area),'method':'forward_backward_floor_flow'}


def absolute_observations(scans):
    rows = []
    for scan in scans:
        proposal = scan['proposal']
        if proposal['status'] != 'needs_review':
            continue
        for p in proposal['points']:
            x, y = LANDMARKS[p['id']]
            if proposal['side'] == 'right':
                x = LENGTH-x
            rows.append({'frame': scan['frame'], 'world': [x, y], 'image': p['image'],
                         'score': p['score'], 'side': proposal['side'], 'id': p['id']})
    return rows


def initialize_graph(indices, edges, absolute, cuts=()):
    """BFS through accepted image correspondences, then one shared metric fit."""
    adjacency = defaultdict(list)
    for edge in edges:
        i, j = edge['frames']; h = edge['h']
        if any(min(i, j) < cut <= max(i, j) for cut in cuts):
            raise ValueError('Floor graph edge crosses a camera cut')
        adjacency[i].append((j, h)); adjacency[j].append((i, np.linalg.inv(h)))
    camera = {indices[0]: np.eye(3)}; queue = [indices[0]]
    for i in queue:
        for j, h in adjacency[i]:
            if j not in camera:
                camera[j] = normalize(h@camera[i]); queue.append(j)
    # A disconnected section must get its own initialization; never bridge a cut.
    if len(camera) != len(indices):
        raise ValueError(f'Disconnected floor graph: {len(camera)}/{len(indices)} keyframes')
    world = np.array([r['world'] for r in absolute])
    ref = np.array([project(np.linalg.inv(camera[r['frame']]), [r['image']])[0] for r in absolute])
    h, keep = cv2.findHomography(world, ref, cv2.RANSAC, 12., maxIters=10000)
    if h is None or keep.sum() < 8:
        raise ValueError('Insufficient mutually consistent court observations')
    return {i: normalize(camera[i]@h) for i in indices}


def joint_fit(initial, edges, absolute, lines=(), circles=(), width=1552, max_nfev=100):
    """Robust sparse fit of shot cameras, paired floor features and court evidence.

    No player coordinates or assumed smooth player trajectories enter this fit.
    Feature residuals are symmetric pixel reprojections, not metric ground truth.
    """
    initial = align_world(initial, absolute, lines)
    indices = sorted(initial); lookup = {i: j for j, i in enumerate(indices)}
    si = np.diag([1/width, 1/width, 1.]); sw = np.diag([LENGTH, LENGTH, 1.])
    params = np.array([normalize(si@initial[i]@sw).ravel()[:8] for i in indices])
    edge_arrays = [(lookup[e['frames'][0]], lookup[e['frames'][1]],
                    np.asarray(e['a'])/width, np.asarray(e['b'])/width) for e in edges]
    move_from = []; move_to = []; move_index = []; move_points = []; move_targets = []
    for i, j, a, b in edge_arrays:
        for src, dst, p, q in ((i, j, a, b), (j, i, b, a)):
            move_index.extend([len(move_from)]*len(p)); move_from.append(src); move_to.append(dst)
            move_points.extend(p); move_targets.extend(q)
    move_index = np.asarray(move_index, int)
    move_points = np.column_stack([np.asarray(move_points).reshape(-1, 2), np.ones(len(move_points))])
    move_targets = np.asarray(move_targets).reshape(-1, 2)
    ai = np.array([lookup[r['frame']] for r in absolute], int)
    aw = np.column_stack([np.array([r['world'] for r in absolute])/LENGTH, np.ones(len(absolute))])
    ap = np.array([r['image'] for r in absolute])/width
    line_arrays = [(lookup[r['frame']], np.column_stack([np.array(r['world'])/LENGTH,
                    np.ones(len(r['world']))]), np.array(r['line'])) for r in lines]
    circle_arrays = [(lookup[r['frame']], np.asarray(r['pixels'])/width) for r in circles]
    def matrices(x):
        return np.column_stack([x.reshape(-1, 8), np.ones(len(indices))]).reshape(-1, 3, 3)
    def proj(h, p):
        out = p@h.T
        return out[:, :2]/np.where(np.abs(out[:, 2:]) < 1e-8, 1e-8, out[:, 2:])
    def residual(x):
        hs = matrices(x); inverse = np.linalg.inv(hs); result = []
        if len(move_from):
            moves = hs[move_to]@inverse[move_from]
            out = np.einsum('nij,nj->ni', moves[move_index], move_points)
            result.append(((out[:, :2]/out[:, 2:]-move_targets)*width/2.5).ravel())
        out = np.einsum('nij,nj->ni', hs[ai], aw)
        result.append(((out[:, :2]/out[:, 2:]-ap)*width/6.).ravel())
        for i, world, line in line_arrays:
            pixels = proj(hs[i], world)*width
            result.append((pixels@line[:2]+line[2])/3.)
        for i, pixels in circle_arrays:
            ground = proj(inverse[i], np.column_stack([pixels, np.ones(len(pixels))]))*LENGTH
            result.append((np.linalg.norm(ground-[LENGTH/2, WIDTH/2], axis=1)-CENTER_RADIUS)/.06)
        return np.concatenate(result)
    count = sum(4*len(a) for _, _, a, _ in edge_arrays)+len(ai)*2+sum(len(w) for _, w, _ in line_arrays)+sum(len(p) for _, p in circle_arrays)
    sparse = lil_matrix((count, len(indices)*8), dtype=int); offset = 0
    for i, j, a, _ in edge_arrays:
        n = 4*len(a)
        sparse[offset:offset+n, i*8:(i+1)*8] = 1; sparse[offset:offset+n, j*8:(j+1)*8] = 1
        offset += n
    for i in ai:
        sparse[offset:offset+2, i*8:(i+1)*8] = 1; offset += 2
    for i, world, _ in line_arrays:
        sparse[offset:offset+len(world), i*8:(i+1)*8] = 1; offset += len(world)
    for i, pixels in circle_arrays:
        sparse[offset:offset+len(pixels), i*8:(i+1)*8] = 1; offset += len(pixels)
    fit = least_squares(residual, params.ravel(), jac_sparsity=sparse.tocsr(),
                        loss='soft_l1', f_scale=1., x_scale='jac', max_nfev=max_nfev,
                        ftol=1e-5, xtol=1e-7, gtol=1e-5)
    hs = matrices(fit.x)
    answer = {i: normalize(np.linalg.inv(si)@h@np.linalg.inv(sw)) for i, h in zip(indices, hs)}
    answer = align_world(answer, absolute, lines)
    if not all(valid_geometry(h) for h in answer.values()):
        raise ValueError('Joint solution folds or reverses the full court')
    return answer, {'evaluations': fit.nfev, 'converged': bool(fit.success), 'termination': fit.message,
                    'initialRobustMedian': float(np.median(np.abs(residual(params.ravel())))),
                    'finalRobustMedian': float(np.median(np.abs(fit.fun))), 'cost': float(fit.cost)}


def align_world(cameras, absolute, lines=()):
    """Solve the shared eight-parameter metric gauge without changing motion.

    Camera pair residuals cannot constrain this gauge. Solving it separately
    prevents thousands of feature residuals from stalling a global correction.
    """
    sw = np.diag([LENGTH, LENGTH, 1.])
    hs = np.array([cameras[r['frame']]@sw for r in absolute])
    world = np.column_stack([np.array([r['world'] for r in absolute])/LENGTH, np.ones(len(absolute))])
    pixels = np.array([r['image'] for r in absolute])
    def residual(x):
        g = np.r_[x, 1.].reshape(3, 3)
        out = np.einsum('nij,nj->ni', hs@g, world)
        result = [(out[:, :2]/out[:, 2:]-pixels).ravel()]
        for row in lines:
            h = cameras[row['frame']]@sw@g@np.linalg.inv(sw)
            projected = project(h, row['world']); line = np.asarray(row['line'])
            result.append((projected@line[:2]+line[2])*2.)
        return np.concatenate(result)
    fit = least_squares(residual, np.eye(3).ravel()[:8], loss='soft_l1', f_scale=6., x_scale='jac', max_nfev=150)
    g = sw@np.r_[fit.x, 1.].reshape(3, 3)@np.linalg.inv(sw)
    return {i: normalize(h@g) for i, h in cameras.items()}


def center_evidence(gray, h, boxes, scale):
    """Look for a supported center stripe; an obscured logo is not a circle.

    Circle pixels need independent segment labels before use by joint_fit;
    raw Canny edges around a team logo are deliberately insufficient.
    """
    mask = np.full(gray.shape, 255, np.uint8)
    mask[:round(len(gray)*.36)] = 0; mask[round(len(gray)*.85):] = 0
    for box in boxes:
        a, b, c, d = np.asarray(box[:4])*scale
        cv2.rectangle(mask, (int(a)-8, int(b)-8), (int(c)+8, int(d)+8), 0, -1)
    # Exclude the center logo region from the straight-line fit. Both end
    # stretches remain eligible, even if the entire circle is hidden.
    theta = np.linspace(0, 2*np.pi, 64)
    logo = project(h, np.column_stack([LENGTH/2+2.7*np.cos(theta), WIDTH/2+2.7*np.sin(theta)]))
    cv2.fillPoly(mask, [np.clip(logo, -10000, 10000).astype(np.int32)], 0)
    endpoints = project(h, [[LENGTH/2, 0], [LENGTH/2, WIDTH]])
    candidates = []
    for polarity, image in [('bright', gray), ('dark', 255-gray)]:
        line, detail = fit_painted_line(image, endpoints, mask, radius=max(8., gray.shape[1]*.06))
        if line is not None and detail['coverage'] >= .45:
            candidates.append((line, {**detail, 'polarity': polarity}))
    if not candidates:
        return None, {'reason': 'no_unoccluded_center_stripe', 'circle': 'no_independent_visible_arc'}
    line, detail = max(candidates, key=lambda pair: pair[1]['meanContrast'])
    # Convert the observed line equation to original image coordinates.
    full = line*np.array([scale, scale, 1.]); full /= np.linalg.norm(full[:2])
    return full, {**detail, 'circle': 'no_independent_visible_arc'}


def lane_evidence(gray, proposal, boxes, scale):
    """Extract named outer-lane lines near a separately accepted local proposal."""
    mask = np.full(gray.shape, 255, np.uint8)
    mask[round(len(gray)*.85):] = 0
    for box in boxes:
        x1, y1, x2, y2 = np.asarray(box[:4])*scale
        cv2.rectangle(mask, (int(x1)-8, int(y1)-8), (int(x2)+8, int(y2)+8), 0, -1)
    h = np.diag([scale, scale, 1.])@np.asarray(proposal['courtToImage']).reshape(3, 3)
    corners = np.array([LANDMARKS[k] for k in 'ABCD'])
    if proposal['side'] == 'right': corners[:, 0] = LENGTH-corners[:, 0]
    lines = []
    for k, family in enumerate(('lane_far', 'free_throw', 'lane_near', 'baseline')):
        world = corners[[k, (k+1) % 4]]
        if family == 'baseline': world = np.array([[world[0, 0], 0], [world[0, 0], WIDTH]])
        endpoints = project(h, world)
        candidates = []
        for mode in (('stripe',) if family == 'baseline' else ('boundary', 'stripe')):
            line, detail = fit_painted_line(gray, endpoints, mask, radius=max(6., gray.shape[1]*.022), mode=mode)
            if line is not None and detail['coverage'] >= .5:
                candidates.append((line, {**detail, 'mode': mode}))
        if candidates:
            line, detail = max(candidates, key=lambda p: p[1]['meanContrast'])
            full = line*np.array([scale, scale, 1.]); full /= np.linalg.norm(full[:2])
            lines.append({'family': family, 'side': proposal['side'],
                          'world': [(world[0]*(1-t)+world[1]*t).tolist() for t in (.1, .5, .9)],
                          'line': full.tolist(), 'evidence': detail})
    return lines


def blend_projected_cameras(first, second, weight, pixels):
    """Reconcile two measured nearby camera transfers, never matrix coefficients."""
    world = project(np.linalg.inv(first), pixels)
    target = project(first, world)*(1-weight)+project(second, world)*weight
    h, _ = cv2.findHomography(world, target, 0)
    return normalize(h)
