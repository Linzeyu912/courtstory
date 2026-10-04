"""Reproducible court-only joint calibration benchmark using cached detections.

Never edits detections, identity bindings, manual calibration or source videos.
The input experiment's hashes and presentation timestamps are checked first.
"""
import argparse
import json
from pathlib import Path
import time

import av
import cv2
import numpy as np

from benchmark_court_generalization import CONDITIONS, read, save, sha
from court_fullcourt import (VERSION, absolute_observations, masked_features,
    match_features, initialize_graph, joint_fit, center_evidence, normalize,
    valid_geometry, blend_projected_cameras, lane_evidence, floor_flow)
from court_propagation import project, LENGTH, WIDTH


def boxes_at(tracks, scene, i):
    return [t[:4] for t in tracks[i]['tracks']]+[o['box'] for o in scene['frames'][i]['objects'] if o['kind'] == 'referee']


def geometry_graph(video, manifest, tracks, scene, scans, baseline):
    width, height = manifest['dimensions']; scale = min(1., 1280/width)
    indices = sorted(set(range(0, len(tracks), 10)) | {len(tracks)-1} | {s['frame'] for s in scans})
    grays = {}; features = {}; s = np.diag([scale, scale, 1.])
    with av.open(str(video)) as container:
        for i, frame in enumerate(container.decode(video=0)):
            if abs(float(frame.time)-manifest['frames'][i]['time']) > .001:
                raise ValueError('Frame PTS mismatch')
            if i not in indices:
                continue
            gray = cv2.resize(frame.to_ndarray(format='gray'), (round(width*scale), round(height*scale)))
            row = baseline.get(i); h = np.array(row['courtToImage']).reshape(3, 3) if row and row.get('courtToImage') else None
            p, d = masked_features(gray, boxes_at(tracks, scene, i), s@h if h is not None else None, scale)
            grays[i] = gray; features[i] = (p, d)
    edges = []
    for a, i in enumerate(indices):
        for b in range(a+1, len(indices)):
            if b-a > 4 and not (a % 6 == 0 and b % 6 == 0):
                continue
            j = indices[b]; edge = match_features(features[i], features[j], next(iter(grays.values())).shape)
            if edge is None and j-i <= 20 and baseline.get(i, {}).get('courtToImage'):
                edge = floor_flow(grays[i], grays[j], s@np.asarray(baseline[i]['courtToImage']).reshape(3,3),
                                  boxes_at(tracks,scene,i), boxes_at(tracks,scene,j), scale)
            if edge:
                edge['frames'] = [i, j]; edge['a'] = (edge['a']/scale).tolist(); edge['b'] = (edge['b']/scale).tolist()
                edge['h'] = normalize(np.linalg.inv(s)@edge['h']@s).tolist()
                edges.append(edge)
    adjacency = {i: set() for i in indices}
    for edge in edges:
        a, b = edge['frames']; adjacency[a].add(b); adjacency[b].add(a)
    pending = set(indices); components = []
    while pending:
        first = min(pending); pending.remove(first); component = {first}; queue = [first]
        for i in queue:
            for j in adjacency[i]&pending:
                pending.remove(j); component.add(j); queue.append(j)
        components.append(sorted(component))
    # Register only the measured main component. Small disconnected pieces
    # remain excluded, even if they have their own plausible half-court fit.
    connected = set(max(components, key=len))
    edges = [e for e in edges if all(i in connected for i in e['frames'])]
    excluded = [i for i in indices if i not in connected]
    lane_lines = []
    for row in scans:
        i = row['frame']
        if i in connected and row['proposal']['status'] == 'needs_review':
            lane_lines.extend({'frame': i, **r} for r in lane_evidence(grays[i], row['proposal'], boxes_at(tracks, scene, i), scale))
    return {'indices': [i for i in indices if i in connected], 'edges': edges, 'laneLines': lane_lines,
            'excludedUnmatchedKeyframes': excluded, 'measuredComponents': components,
            'absolute': [r for r in absolute_observations(scans) if r['frame'] in connected],
            'scale': scale}, grays


def solve(graph, grays, tracks, scene, width):
    initial = initialize_graph(graph['indices'], graph['edges'], graph['absolute'])
    solved, info = joint_fit(initial, graph['edges'], graph['absolute'], lines=graph.get('laneLines', []), width=width)
    s = np.diag([graph['scale'], graph['scale'], 1.]); lines = list(graph.get('laneLines', [])); evidence = []
    for i in graph['indices']:
        line, detail = center_evidence(grays[i], s@solved[i], boxes_at(tracks, scene, i), graph['scale'])
        evidence.append({'frame': i, **detail, 'accepted': line is not None})
        if line is not None:
            lines.append({'frame': i, 'family': 'center_line', 'world': [[LENGTH/2, y] for y in (0, 2, 4, 11, 13, WIDTH)], 'line': line.tolist()})
    if lines:
        solved, line_info = joint_fit(solved, graph['edges'], graph['absolute'], lines=lines, width=width)
    else:
        line_info = None
    return solved, {'floorFit': info, 'centerFit': line_info, 'centerEvidence': evidence, 'lines': lines}


def dense(video, manifest, tracks, scene, cameras):
    """Direct floor matches to nearby optimized keyframes; no frozen matrices."""
    width, height = manifest['dimensions']; scale = min(1., 1280/width); s = np.diag([scale, scale, 1.])
    images = {}; features = {}; shape = (round(height*scale), round(width*scale))
    indices = sorted(cameras)
    with av.open(str(video)) as container:
        for i, frame in enumerate(container.decode(video=0)):
            if i in cameras:
                gray = cv2.resize(frame.to_ndarray(format='gray'), shape[::-1])
                images[i] = gray
                features[i] = masked_features(gray, boxes_at(tracks, scene, i), s@cameras[i], scale)
    rows = []
    with av.open(str(video)) as container:
        for i, frame in enumerate(container.decode(video=0)):
            if i in cameras:
                h = cameras[i]; detail = {'method': 'joint_keyframe', 'supportFrames': [i]}
            else:
                gray = cv2.resize(frame.to_ndarray(format='gray'), shape[::-1])
                neighbors = sorted(indices, key=lambda n: abs(n-i))[:4]
                # Union nearby projected floors permits genuine camera pan.
                current = masked_features(gray, boxes_at(tracks, scene, i), None, scale)
                candidates = []
                for j in neighbors:
                    if abs(i-j) > 30:
                        continue
                    e = match_features(features[j], current, shape)
                    if e is None and abs(i-j) <= 20:
                        e = floor_flow(images[j], gray, s@cameras[j], boxes_at(tracks,scene,j), boxes_at(tracks,scene,i), scale)
                    if e:
                        h = normalize(np.linalg.inv(s)@e['h']@s@cameras[j])
                        if valid_geometry(h): candidates.append((j, h, e))
                if not candidates:
                    rows.append({'frame': i, 'time': float(frame.time), 'courtToImage': None,
                                 'status': 'invalid', 'reason': 'no_measured_floor_transfer'})
                    continue
                candidates.sort(key=lambda item: abs(item[0]-i))
                j, h, e = candidates[0]
                detail = {'method': 'direct_floor_transfer', 'supportFrames': [j], 'inliers': e['inliers']}
                if len(candidates) > 1:
                    k, h2, e2 = candidates[1]
                    pixels = np.asarray(e['b'])/scale
                    disagreement = np.linalg.norm(project(np.linalg.inv(h), pixels)-project(np.linalg.inv(h2), pixels), axis=1)
                    detail['twoAnchorDifferenceMeters'] = {'median': float(np.median(disagreement)), 'p95': float(np.quantile(disagreement, .95))}
                    if np.quantile(disagreement, .95) > .75:
                        rows.append({'frame': i, 'time': float(frame.time), 'courtToImage': None,
                                     'status': 'invalid', 'reason': 'nearby_camera_conflict', 'quality': detail})
                        continue
                    weight = abs(i-j)/(abs(i-j)+abs(i-k))
                    h = blend_projected_cameras(h, h2, weight, pixels)
                    detail['supportFrames'].append(k)
            rows.append({'frame': i, 'time': float(frame.time), 'courtToImage': normalize(h).ravel().tolist(),
                         'imageToCourt': normalize(np.linalg.inv(h)).ravel().tolist(), 'status': 'needs_review',
                         'quality': detail, 'metricAccuracyValidated': False})
            if i % 300 == 0: print('dense', i, flush=True)
    return rows


def run(args):
    cv2.setNumThreads(4)
    manifest = read(args.input/'manifest.json')
    if manifest.get('sourceCuts'):
        raise ValueError('Process each camera shot separately; this benchmark accepts one continuous shot')
    for name in args.conditions:
        started = time.perf_counter(); print(name, args.stage, flush=True)
        video = args.video if name == 'original' else args.input/(name+'.mp4')
        if sha(video) != manifest['conditions'][name]['hash']:
            raise ValueError('Source video hash mismatch')
        tracks = read(args.input/(name+'-tracks.json')); scene = read(args.input/(name+'-scene.json'))
        if scene['videoHash'] != manifest['conditions'][name]['hash']:
            raise ValueError('Scene cache belongs to a different source video')
        if len(tracks) != len(manifest['frames']) or len(scene['frames']) != len(tracks):
            raise ValueError('Detection/frame counts differ')
        if any(abs(t['time']-m['time']) > .001 for t, m in zip(tracks, manifest['frames'])):
            raise ValueError('Tracking PTS mismatch')
        target = args.output/(name+'-joint.json')
        if args.stage == 'fit':
            scans = read(args.input/(name+'-scan960.json'))['scan']
            baseline = {r['frame']: r for r in read(args.input/(name+'-windows.json'))['keyframes']}
            graph, grays = geometry_graph(video, manifest, tracks, scene, scans, baseline)
            graph['provenance'] = {'videoHash': sha(video), 'inputs': {
                suffix: sha(args.input/(name+suffix)) for suffix in ('-tracks.json', '-scene.json', '-scan960.json', '-windows.json')},
                'sourceCuts': [], 'version': VERSION}
            save(args.output/(name+'-graph.json'), graph)
            print('graph', len(graph['indices']), len(graph['edges']), len(graph['absolute']), flush=True)
            cameras, info = solve(graph, grays, tracks, scene, manifest['dimensions'][0])
            save(target, {'version': VERSION, 'videoHash': sha(video), 'sourceCuts': [],
                'coordinateConvention': 'same_sideline_full_court', 'physicalEndIdentityVerified': False,
                'cameras': {str(i): h.ravel().tolist() for i, h in cameras.items()}, 'fit': info,
                'provenance': graph['provenance'],
                'metricAccuracyValidated': False, 'seconds': time.perf_counter()-started})
            print('fit', info['floorFit'], 'center lines', len(info['lines']), flush=True)
        elif args.stage == 'dense':
            result = read(target)
            if result['videoHash'] != sha(video): raise ValueError('Calibration/source mismatch')
            cameras = {int(i): np.asarray(h).reshape(3, 3) for i, h in result['cameras'].items()}
            result['frames'] = dense(video, manifest, tracks, scene, cameras)
            result['denseSeconds'] = time.perf_counter()-started
            save(target, result)
            print('valid', sum(bool(r['courtToImage']) for r in result['frames']), '/', len(tracks), flush=True)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--input', type=Path, required=True); p.add_argument('--output', type=Path, required=True)
    p.add_argument('--video', type=Path, required=True); p.add_argument('--stage', choices=['fit', 'dense'], required=True)
    p.add_argument('--conditions', nargs='+', choices=CONDITIONS, default=list(CONDITIONS))
    args = p.parse_args(); args.output.mkdir(parents=True, exist_ok=True)
    if args.output.resolve() == args.input.resolve(): p.error('Preserve the previous benchmark; choose a new output directory')
    run(args)


if __name__ == '__main__':
    main()
