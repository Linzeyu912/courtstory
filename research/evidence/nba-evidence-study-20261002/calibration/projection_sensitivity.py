#!/usr/bin/env python3
"""Offline candidate-H sensitivity, reflection ambiguity, and stale-H experiment.

No detector inference; no annotations adopted in the real app. Requires numpy,
PyAV, matplotlib and Node. Uses repository geometry in a read-only Node helper.
"""
from __future__ import annotations
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import platform
import runpy
import subprocess
import sys

import av
import numpy as np

LENGTH, WIDTH = 28.6512, 15.24
REFLECTION = np.array([[-1., 0., LENGTH], [0., 1., 0.], [0., 0., 1.]])
RADII = [3, 10]
DIRECTIONS = np.column_stack((np.cos(np.arange(16)*math.pi/8), np.sin(np.arange(16)*math.pi/8)))


def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1024*1024), b''):
            h.update(block)
    return h.hexdigest()


def stats(values):
    values = np.asarray(list(values), dtype=float)
    values = values[np.isfinite(values)]
    if not values.size:
        return {'n': 0, 'min': None, 'median': None, 'p95': None, 'max': None}
    return {'n': int(values.size), 'min': float(np.min(values)), 'median': float(np.median(values)),
        'p95': float(np.quantile(values, .95)), 'max': float(np.max(values))}


def project(h, xy):
    points = np.atleast_2d(np.asarray(xy, dtype=float))
    homogeneous = np.column_stack((points, np.ones(len(points)))) @ h.T
    valid = np.isfinite(homogeneous).all(axis=1) & (np.abs(homogeneous[:, 2]) >= 1e-9)
    result = np.full((len(points), 2), np.nan)
    result[valid] = homogeneous[valid, :2] / homogeneous[valid, 2, None]
    return result


def inside_hull(hull, point):
    if len(hull) < 3 or not np.isfinite(point).all():
        return False
    for a, b in zip(np.asarray(hull), np.roll(np.asarray(hull), -1, axis=0)):
        edge, offset = b-a, point-a
        if edge[0]*offset[1]-edge[1]*offset[0] < -1e-8:
            return False
    return True


def inside_court(point):
    return bool(0 <= point[0] <= LENGTH and 0 <= point[1] <= WIDTH)


def local_gain(h, xy, q):
    denominator = h[2, 0]*xy[0]+h[2, 1]*xy[1]+h[2, 2]
    jacobian = np.array([[(h[0, 0]-q[0]*h[2, 0])/denominator, (h[0, 1]-q[0]*h[2, 1])/denominator],
        [(h[1, 0]-q[1]*h[2, 0])/denominator, (h[1, 1]-q[1]*h[2, 1])/denominator]])
    return float(np.linalg.svd(jacobian, compute_uv=False)[0])


def point_cloud(records, feet):
    by_frame = defaultdict(list)
    for row in records:
        for track in row['tracks']:
            identifier = int(track[4])
            if row.get('track_roles', {}).get(str(identifier)) != 'player':
                continue
            by_frame[row['frame']].append({'track_id': identifier, 'kind': 'bbox_bottom_center',
                'image': [(track[0]+track[2])/2, track[3]], 'score': track[5]})
    for row in feet['frames']:
        for observation in row['feet']:
            for side in ['left', 'right']:
                foot = observation.get(side)
                if foot:
                    by_frame[row['frame']].append({'track_id': observation['trackId'], 'kind': side+'_foot_candidate',
                        'image': [foot['x'], foot['y']], 'score': foot['score']})
    return by_frame


def summarize_points(observations):
    result = {}
    for kind in sorted({o['kind'] for o in observations}):
        selected = [o for o in observations if o['kind'] == kind]
        groups = {'all': selected, 'inside_controls': [o for o in selected if o['inside_controls']],
            'outside_controls': [o for o in selected if not o['inside_controls']],
            'inside_court_rectangle': [o for o in selected if o['inside_court_rectangle']]}
        result[kind] = {'observations': len(selected), 'inside_controls': len(groups['inside_controls']),
            'inside_court_rectangle': len(groups['inside_court_rectangle']), 'by_scope': {}}
        for scope, group in groups.items():
            result[kind]['by_scope'][scope] = {str(radius): {
                'sampled_max_projection_change_m': stats(o['sensitivity'][radius]['max_shift_m'] for o in group),
                'linearized_max_projection_change_m': stats(o['sensitivity'][radius]['linear_max_m'] for o in group),
            } for radius in RADII}
        result[kind]['stale_reference_H_vs_framewise_H_distance_m'] = stats(o['stale_distance_m'] for o in selected)
    return result


def summarize_speed(observations, times):
    lookup = {(o['frame'], o['track_id'], o['kind']): o for o in observations}
    pairs = []
    for observation in observations:
        previous = lookup.get((observation['frame']-1, observation['track_id'], observation['kind']))
        if previous is None:
            continue
        dt = times[observation['frame']] - times[previous['frame']]
        if dt <= 0:
            continue
        base = float(np.linalg.norm(observation['court']-previous['court'])/dt)
        stale = float(np.linalg.norm(observation['stale_court']-previous['stale_court'])/dt)
        pair = {'frame': observation['frame'], 'track_id': observation['track_id'], 'kind': observation['kind'],
            'dt': dt, 'nominal_speed_m_s': base, 'stale_speed_m_s': stale,
            'inside_controls_both': observation['inside_controls'] and previous['inside_controls'],
            'inside_court_both': observation['inside_court_rectangle'] and previous['inside_court_rectangle'], 'radii': {}}
        for radius in RADII:
            a, b = previous['sensitivity'][radius]['projections'], observation['sensitivity'][radius]['projections']
            speeds = np.linalg.norm(b[:, None, :]-a[None, :, :], axis=2)/dt
            low, high = float(np.nanmin(speeds)), float(np.nanmax(speeds))
            pair['radii'][radius] = {'sampled_min_speed_m_s': low, 'sampled_max_speed_m_s': high,
                'max_absolute_change_from_nominal_m_s': max(abs(high-base), abs(base-low))}
        pairs.append(pair)
    result = {}
    for kind in sorted({p['kind'] for p in pairs}):
        subset = [p for p in pairs if p['kind'] == kind]
        result[kind] = {}
        for scope, group in [('all', subset), ('inside_controls_both', [p for p in subset if p['inside_controls_both']]),
            ('inside_court_both', [p for p in subset if p['inside_court_both']])]:
            result[kind][scope] = {'consecutive_frame_pairs': len(group),
                'nominal_candidate_speed_m_s': stats(p['nominal_speed_m_s'] for p in group),
                'stale_vs_framewise_speed_absolute_difference_m_s': stats(abs(p['nominal_speed_m_s']-p['stale_speed_m_s']) for p in group),
                'by_radius': {str(r): {'sampled_max_absolute_speed_change_m_s':
                    stats(p['radii'][r]['max_absolute_change_from_nominal_m_s'] for p in group)} for r in RADII}}
    examples = sorted([p for p in pairs if p['inside_court_both']],
        key=lambda p: -p['radii'][10]['max_absolute_change_from_nominal_m_s'])[:3]
    return result, examples


def compare_speed_windows(points_by_frame, observations, maps, times):
    """Endpoint finite differences; every intervening T ID and H must be present."""
    raw = {(f, p['track_id']): p for f, points in points_by_frame.items() for p in points if p['kind'] == 'bbox_bottom_center'}
    projected = {(p['frame'], p['track_id']): p for p in observations if p['kind'] == 'bbox_bottom_center'}
    results, records_by_lag = {}, {}
    for lag in [1, 5, 15]:
        eligible, excluded, denominator, warmup = [], Counter(), 0, 0
        for frame, identifier in sorted(raw):
            if frame < lag:
                warmup += 1; continue
            denominator += 1
            span = range(frame-lag, frame+1)
            if any((f, identifier) not in raw for f in span):
                excluded['temporary_id_not_continuous'] += 1; continue
            if any(f not in maps for f in span):
                excluded['court_mapping_unavailable_somewhere_in_window'] += 1; continue
            start, end = projected.get((frame-lag, identifier)), projected.get((frame, identifier))
            if start is None or end is None:
                excluded['endpoint_projection_invalid'] += 1; continue
            dt = times[frame]-times[frame-lag]
            nominal = float(np.linalg.norm(end['court']-start['court'])/dt)
            a, b = start['sensitivity'][3]['projections'], end['sensitivity'][3]['projections']
            scenarios = np.linalg.norm(b[:, None, :]-a[None, :, :], axis=2)/dt
            max_change = float(np.max(np.abs(scenarios-nominal)))
            eligible.append({'end_frame': frame, 'track_id': identifier, 'history_seconds': dt,
                'nominal_endpoint_speed_m_s': nominal, 'max_abs_speed_change_m_s': max_change})
        records_by_lag[lag] = {(p['end_frame'], p['track_id']): p for p in eligible}
        results[str(lag)] = {'candidate_end_observations_after_initial_warmup': denominator,
            'observations_before_enough_initial_history': warmup, 'eligible_windows': len(eligible),
            'excluded_windows': denominator-len(eligible),
            'excluded_window_fraction': (denominator-len(eligible))/denominator if denominator else None,
            'exclusive_exclusion_reasons_in_check_order': dict(excluded),
            'history_seconds': stats(p['history_seconds'] for p in eligible),
            'sampled_max_abs_speed_change_m_s': stats(p['max_abs_speed_change_m_s'] for p in eligible),
            'nominal_endpoint_speed_m_s': stats(p['nominal_endpoint_speed_m_s'] for p in eligible)}
    common = set.intersection(*(set(rows) for rows in records_by_lag.values()))
    return {'point_kind': 'bbox_bottom_center', 'pixel_radius': 3, 'lags_frames': [1, 5, 15],
        'denominator': 'All observed E-BARD player-box endpoint (frame,T-ID) rows at frame>=lag, before requiring full-window T continuity and H availability.',
        'velocity_definition': 'Euclidean distance between endpoint projections divided by elapsed source PTS; not path length or validated player speed.',
        'continuity_gate': 'Same temporary T ID labelled player in every one of lag+1 frames, and accepted-in-memory H in every frame; do not bridge internal gaps.',
        'causal_timing': 'A trailing estimate needs no future frames after its endpoint, but needs lag frames of history before its first output. An estimate assigned to the start must wait until the end.',
        'identity_limit': 'Unbroken temporary T ID does not establish that the same real player occupies the full window; within-window switches are unknown.',
        'all_eligible_windows': results, 'common_endpoint_cohort_count': len(common),
        'same_endpoints_all_three_lags': {str(lag): {
            'sampled_max_abs_speed_change_m_s': stats(records_by_lag[lag][key]['max_abs_speed_change_m_s'] for key in common),
            'history_seconds': stats(records_by_lag[lag][key]['history_seconds'] for key in common)} for lag in [1, 5, 15]}}


def mirror_example(observations, maps, times, frame_count):
    by_frame, lookup = defaultdict(list), {}
    for o in observations:
        lookup[(o['frame'], o['track_id'], o['kind'])] = o
        if o['kind'] == 'bbox_bottom_center' and o['inside_court_rectangle']:
            by_frame[o['frame']].append(o)
    candidates = sorted(by_frame, key=lambda f: abs(f-(frame_count-1)/2))
    for f in candidates:
        people = sorted(by_frame[f], key=lambda o: o['track_id'])
        if len(people) < 2:
            continue
        a = next((p for p in people if (f+1, p['track_id'], p['kind']) in lookup), None)
        if a is None:
            continue
        b = next(p for p in people if p is not a)
        later = lookup[(f+1, a['track_id'], a['kind'])]
        h = np.asarray(maps[f]['toCourt']).reshape(3, 3)
        h_next = np.asarray(maps[f+1]['toCourt']).reshape(3, 3)
        ma, mb = project(REFLECTION @ h, [a['image'], b['image']])
        mlater = project(REFLECTION @ h_next, later['image'])[0]
        dt = times[f+1]-times[f]
        velocity = (later['court']-a['court'])/dt
        mirrored_velocity = (mlater-ma)/dt
        left_basket, right_basket = np.array([1.6002, 7.62]), np.array([LENGTH-1.6002, 7.62])
        def side_info(q):
            distances = {'left': float(np.linalg.norm(q-left_basket)), 'right': float(np.linalg.norm(q-right_basket))}
            return {'coordinate_m': q.tolist(), 'distance_to_fixed_basket_m': distances,
                'nearer_basket_label': min(distances, key=distances.get)}
        invh = np.linalg.inv(h)
        original_image = project(invh, [a['court'], b['court']])
        reflected_image = project(invh @ REFLECTION, [ma, mb])
        return {'frame': f, 'next_frame': f+1, 'track_ids': [a['track_id'], b['track_id']], 'point_kind': a['kind'],
            'formula': "H_mirror = [[-1,0,28.6512],[0,1,0],[0,0,1]] @ H",
            'H_image_to_court': h.tolist(), 'H_image_to_mirrored_court': (REFLECTION@h).tolist(),
            'first_point_original': side_info(a['court']), 'first_point_mirrored': side_info(ma),
            'second_point_original': side_info(b['court']), 'second_point_mirrored': side_info(mb),
            'pair_distance_original_m': float(np.linalg.norm(a['court']-b['court'])),
            'pair_distance_mirrored_m': float(np.linalg.norm(ma-mb)),
            'velocity_original_m_s': velocity.tolist(), 'velocity_mirrored_m_s': mirrored_velocity.tolist(),
            'speed_original_m_s': float(np.linalg.norm(velocity)), 'speed_mirrored_m_s': float(np.linalg.norm(mirrored_velocity)),
            'same_image_reprojection_max_difference_px': float(np.max(np.linalg.norm(original_image-reflected_image, axis=1))),
            'interpretation': 'A global left/right reflection preserves Euclidean distances and scalar speeds while swapping basket-side labels and x direction; this cannot verify real side or identity.'}
    return None


def run(repo, out):
    inventory = {}
    def read(relative, parse=True):
        path = (repo/relative).resolve()
        if not path.is_relative_to(repo):
            raise ValueError('Input path outside repository')
        inventory[path.relative_to(repo).as_posix()] = {'sha256': sha(path), 'bytes': path.stat().st_size}
        return json.loads(path.read_text(encoding='utf-8')) if parse else path
    library = read('data/videos/tactics/acceptance/review-library.json')
    for path in ['engineering/tools/player-review/court.mjs', 'engineering/tools/player-review/court-geometry.mjs',
        'engineering/tools/player-review/calibration-guide.mjs', 'engineering/scripts/scene_profiles.py']:
        read(path, False)
    validators = runpy.run_path(str(repo/'engineering/scripts/scene_profiles.py'))
    helper = Path(__file__).with_name('candidate_matrices.mjs')
    result = {'schema_version': 1, 'created_at_utc': datetime.now(timezone.utc).isoformat(),
        'experiment': 'Candidate projection sensitivity and identifiability; not accuracy or true error.',
        'environment': {'python': platform.python_version(), 'numpy': np.__version__, 'pyav': av.__version__,
            'script_sha256': sha(Path(__file__)), 'node_helper_sha256': sha(helper)},
        'parameters': {'samples': ['005', '006'], 'pixel_radii': RADII, 'perturbation_directions': 16,
            'perturbation_definition': '16 evenly spaced directions at exact radius, plus unchanged point; perturb two consecutive frame endpoints independently for speed envelopes.',
            'H_error_perturbed': False, 'time_step': 'Decoded source PTS; only consecutive frames and same temporary T ID / point type.',
            'stale_H': 'First valid reference frame matrix held fixed at all later valid frames.',
            'units': 'Candidate metres and metres/second under an unvalidated NBA-template homography.',
            'feet_policy': 'Keep left and right separate; contact unknown; no averaging into a claimed ground point.',
            'identity_policy': 'Temporary T IDs, no verified continuity. Speeds are numerical proxies.',
            'court_dimensions_m': [LENGTH, WIDTH]}, 'samples': []}
    plotting_data = {}
    for sample in [s for s in library['samples'] if s['id'] in ['005', '006']]:
        sid = sample['id']
        tracks_path = next(v['tracks'] for v in sample['trackingVariants'] if v['id'] == 'ebard')
        records, feet, court = read(tracks_path), read(sample['feetCandidates']), read(sample['courtCandidates'])
        video_path = read(sample['video'], False)
        video_sha = inventory[sample['video']]['sha256']
        times = []
        with av.open(str(video_path)) as container:
            video = container.streams.video[0]; width, height = video.width, video.height
            for frame in container.decode(video):
                times.append(float(frame.pts*frame.time_base))
        if len(times) != len(records) or any(abs(a-b['time']) > .001 for a, b in zip(times, records)):
            raise ValueError('Tracking frames disagree with video PTS')
        if video_sha != sample['videoSha256']:
            raise ValueError('Video hash mismatch')
        validators['validate_feet_candidates'](feet, video_sha, {inventory[tracks_path]['sha256']: records}, width, height)
        validators['validate_court_candidates'](court, video_sha, len(times))
        proc = subprocess.run(['node', str(helper), str(repo), sample['courtCandidates'], tracks_path],
            capture_output=True, text=True, encoding='utf-8', check=True)
        geometry = json.loads(proc.stdout)
        maps = {int(row['frame']): {**row['mapping'], 'supportHull': row['mapping']['supportHulls'][0]}
            for row in geometry['keyframes'] if row.get('mapping') is not None}
        for source_path, expected_sha in geometry['source_sha256'].items():
            read(source_path, False)
            if inventory[source_path]['sha256'] != expected_sha:
                raise ValueError('Geometry helper source changed between reads')
        reference = min(maps)
        stale_h = np.asarray(maps[reference]['toCourt']).reshape(3, 3)
        points = point_cloud(records, feet)
        observations, failures, skipped = [], Counter(), Counter()
        for f, frame_points in sorted(points.items()):
            if f not in maps:
                skipped.update(p['kind'] for p in frame_points)
                continue
            mapping = maps[f]
            h = np.asarray(mapping['toCourt']).reshape(3, 3)
            for raw in frame_points:
                xy = np.asarray(raw['image']); q = project(h, xy)[0]
                if not np.isfinite(q).all():
                    failures['nominal_nonfinite'] += 1; continue
                entry = {**raw, 'frame': f, 'court': q, 'inside_controls': inside_hull(mapping['supportHull'], q),
                    'inside_court_rectangle': inside_court(q), 'stale_court': project(stale_h, xy)[0], 'sensitivity': {}}
                entry['stale_distance_m'] = float(np.linalg.norm(entry['stale_court']-q))
                gain = local_gain(h, xy, q)
                invalid = False
                for radius in RADII:
                    perturbations = np.vstack((xy, xy+radius*DIRECTIONS))
                    projected = project(h, perturbations)
                    if not np.isfinite(projected).all():
                        failures[f'perturbation_nonfinite_radius_{radius}'] += 1; invalid = True; break
                    entry['sensitivity'][radius] = {'max_shift_m': float(np.linalg.norm(projected-q, axis=1).max()),
                        'linear_max_m': gain*radius, 'projections': projected}
                if not invalid:
                    observations.append(entry)
        speed_summary, speed_cases = summarize_speed(observations, times)
        sample_result = {'id': sid, 'tracking_variant': 'ebard', 'tracking_sha256': inventory[tracks_path]['sha256'],
            'feet_fingerprint_matches': feet['trackingFingerprint'] == inventory[tracks_path]['sha256'],
            'decoded_frames': len(times), 'first_pts_seconds': times[0],
            'candidate_statuses': dict(Counter(k['status'] for k in court['keyframes'])),
            'geometry_contract': {k: v for k, v in geometry.items() if k != 'keyframes'},
            'research_projection_frames': len(maps), 'reference_frame_for_stale_H': reference,
            'projection_failure_counts': dict(failures), 'observations_skipped_no_candidate_H': dict(skipped),
            'projection_sensitivity': summarize_points(observations), 'consecutive_frame_speed_sensitivity': speed_summary,
            'speed_window_comparison': compare_speed_windows(points, observations, maps, times),
            'largest_inside_court_speed_sensitivity_examples': speed_cases,
            'reflection_example': mirror_example(observations, maps, times, len(times)),
            'framewise_stale_H_comparison': [],
            'ground_contact_confirmed': False, 'metric_accuracy_validated': False,
            'true_position_error_m': None, 'true_speed_error_m_s': None, 'correct_basket_side_verified': False}
        for f in sorted(maps):
            selected = [o for o in observations if o['frame'] == f and o['kind'] == 'bbox_bottom_center']
            sample_result['framewise_stale_H_comparison'].append({'frame': f, 'time': times[f],
                'distance_difference_m': stats(o['stale_distance_m'] for o in selected)})
        # Keep a reproducible finite case, including H and the original image point.
        example = max([o for o in observations if o['inside_controls']],
            key=lambda o: o['sensitivity'][10]['max_shift_m'], default=None)
        if example:
            sample_result['inside_controls_example'] = {k: example[k] for k in ['frame', 'track_id', 'kind', 'image', 'score']}
            sample_result['inside_controls_example'].update({'coordinate_m': example['court'].tolist(),
                'H': maps[example['frame']]['toCourt'], 'radius_3_max_shift_m': example['sensitivity'][3]['max_shift_m'],
                'radius_10_max_shift_m': example['sensitivity'][10]['max_shift_m'],
                'stale_H_position_difference_m': example['stale_distance_m']})
        result['samples'].append(sample_result)
        plotting_data[sid] = observations
        print(f"{sid}: {len(maps)}/{len(times)} research matrices; {len(observations)} projected candidate points", flush=True)
    result['source_inventory'] = inventory
    result['source_files_changed_during_experiment'] = [p for p, v in inventory.items() if sha(repo/p) != v['sha256']]
    out.parent.mkdir(parents=True, exist_ok=True)
    figure_path = out.with_suffix('.png')
    make_plot(result, plotting_data, figure_path)
    result['figure'] = figure_path.name
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False)+'\n', encoding='utf-8')
    return result


def make_plot(result, plotting_data, path):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    fig, axes = plt.subplots(2, 2, figsize=(12, 8), layout='constrained')
    colors = ['#2682a6', '#c9773a', '#69528b']
    kinds = ['bbox_bottom_center', 'left_foot_candidate', 'right_foot_candidate']
    for col, sample in enumerate(result['samples']):
        observed = plotting_data[sample['id']]
        data = [np.array([o['sensitivity'][10]['max_shift_m'] for o in observed if o['kind'] == kind]) for kind in kinds]
        box = axes[0, col].boxplot(data, tick_labels=['Box bottom', 'Left foot', 'Right foot'],
            showfliers=False, patch_artist=True)
        for patch, color in zip(box['boxes'], colors): patch.set_facecolor(color); patch.set_alpha(.6)
        axes[0, col].set_title(f"Sample {sample['id']}: 10 px radius, 16 directions")
        axes[0, col].set_ylabel('Projection change (candidate m)')
        axes[0, col].grid(axis='y', alpha=.2)
        rows = sample['framewise_stale_H_comparison']
        ts = [r['time'] for r in rows]
        med = [r['distance_difference_m']['median'] for r in rows]
        p95 = [r['distance_difference_m']['p95'] for r in rows]
        axes[1, col].plot(ts, med, '.', color=colors[0], label='Median box-bottom point')
        axes[1, col].plot(ts, p95, '.', color=colors[1], label='95th percentile')
        axes[1, col].set(xlabel='Source PTS (s)', ylabel='Stale H vs framewise H (candidate m)')
        axes[1, col].grid(alpha=.2); axes[1, col].legend(fontsize=8)
    fig.suptitle('Unvalidated court candidates: numerical sensitivity, not accuracy\n'
        'Foot contact and T-ID continuity are unknown; candidate adoption is simulated only in memory.', fontsize=12)
    fig.savefig(path, dpi=160)
    plt.close(fig)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    repo, out = args.repo.resolve(), args.out.resolve()
    if out.is_relative_to(repo):
        parser.error('--out must be outside the read-only repository')
    result = run(repo, out)
    return 0 if not result['source_files_changed_during_experiment'] else 2


if __name__ == '__main__':
    sys.exit(main())
