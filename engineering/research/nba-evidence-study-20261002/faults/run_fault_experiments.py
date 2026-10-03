"""Offline controlled interventions; no tracker changes and no natural-error accuracy claims.

Reproduce with the repository venv Python; --repo only reads four shared snapshots.
All thresholds below are illustrative hypotheses, not tuned or NBA physical limits.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
import platform
import time
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

SPEED = 600.0  # pixels / second, deliberately image-space only
NEAR = 18.0
EPS = 1e-6


def point_box(x, y):
    return [float(x - 15), float(y - 80), float(x + 15), float(y)]


def foot(box):
    return np.array([(box[0] + box[2]) / 2, box[3]], dtype=float)


def shifted(box, dx, dy=0):
    return [box[0] + dx, box[1] + dy, box[2] + dx, box[3] + dy]


def iou(a, b):
    area = max(0., min(a[2], b[2]) - max(a[0], b[0])) * max(0., min(a[3], b[3]) - max(a[1], b[1]))
    den = (a[2]-a[0])*(a[3]-a[1]) + (b[2]-b[0])*(b[3]-b[1]) - area
    return area / den if den > 0 else 0.


def event(name, keys, onset, description):
    return {'name': name, 'keys': set(keys), 'onset': onset, 'description': description}


def synthetic(name='healthy_linear', frames=90):
    obs = {}
    for f in range(frames):
        for tid in range(6):
            x = 160 + tid * 155 + f * (1.2 if tid % 2 else -.8)
            y = 340 + (tid % 2) * 110 + .25 * f
            obs[f, tid] = point_box(x, y)
    return {'name': name, 't': np.arange(frames) / 25, 'obs': obs, 'truth': copy.deepcopy(obs),
            'events': [], 'calibration_status': 'independently_validated_synthetic', 'metric_scale': .025,
            'true_metric_scale': .025, 'source': 'analytic_synthetic_truth'}


def policy(scene, mode, speed_threshold=SPEED):
    obs, ts = scene['obs'], scene['t']
    by_frame, by_id = defaultdict(dict), defaultdict(list)
    for (f, tid), box in obs.items():
        by_frame[f][tid] = box
        by_id[tid].append(f)
    flags, detected_at = defaultdict(set), {}

    def flag(key, reason, at=None):
        flags[key].add(reason)
        at = key[0] if at is None else at
        detected_at[key] = min(at, detected_at.get(key, at))

    typical_dt = float(np.median(np.diff(ts)[np.diff(ts) > 0]))
    common = {}
    invalid_frames = set()
    review = mode.startswith('review_raw')
    if review:
        for f in range(1, len(ts)):
            dt = ts[f] - ts[f-1]
            if dt <= 0 or dt < .25*typical_dt or dt > 3*typical_dt:
                invalid_frames.add(f)
                for tid in by_frame[f]:
                    flag((f, tid), 'timestamp_invalid')
            both = set(by_frame[f]) & set(by_frame[f-1])
            if len(both) >= 4:
                disps = np.array([foot(by_frame[f][tid])-foot(by_frame[f-1][tid]) for tid in sorted(both)])
                med = np.median(disps, axis=0)
                spread = float(np.quantile(np.linalg.norm(disps-med, axis=1), .8))
                if np.linalg.norm(med) > 10 and spread < 4:
                    common[f] = med
                    for tid in by_frame[f]:
                        flag((f, tid), 'common_motion_unresolved')
        for f, boxes in by_frame.items():
            ids = sorted(boxes)
            for i, a in enumerate(ids):
                for b in ids[i+1:]:
                    if iou(boxes[a], boxes[b]) > .9:
                        flag((f, a), 'duplicate_or_occlusion_review')
                        flag((f, b), 'duplicate_or_occlusion_review')
                    elif np.linalg.norm(foot(boxes[a])-foot(boxes[b])) < NEAR:
                        flag((f, a), 'identity_ambiguous')
                        flag((f, b), 'identity_ambiguous')

    for tid, frames in by_id.items():
        frames.sort()
        for a, b in zip(frames, frames[1:]):
            dt = ts[b] - ts[a]
            d = foot(obs[b, tid]) - foot(obs[a, tid])
            if review and b == a+1 and b in common:
                d = d - common[b]
            if dt <= 0 or np.linalg.norm(d) / max(dt, 1e-9) > speed_threshold:
                flag((b, tid), 'pixel_speed_exceeds_hypothesis')
            if review and b > a+1:
                for f in range(a+1, b):
                    flag((f, tid), 'missing_observation', at=b)
                flag((b, tid), 'reappearance_identity_unverified', at=b)

    if mode == 'review_raw_segment':
        # Second round hypothesis: unknown continuity survives a local trigger.
        # This is intentionally conservative, not an automatic identity repair.
        # No synthetic hidden truth or injected support is read here. An optional
        # independent anchor releases a segment; experiments supply none.
        hazard = {'pixel_speed_exceeds_hypothesis','identity_ambiguous',
                  'duplicate_or_occlusion_review','reappearance_identity_unverified',
                  'common_motion_unresolved'}
        first_by_id = {}
        for (f, tid), reasons in list(flags.items()):
            if reasons & hazard:
                first_by_id[tid] = min(first_by_id.get(tid,f),f)
        anchors = scene.get('independent_identity_anchors',{})
        for tid, first in first_by_id.items():
            end = min([f for f in anchors.get(tid,[]) if f > first],default=len(ts))
            for f in by_id[tid]:
                if first <= f < end:
                    flag((f,tid),'continuity_abstain_until_independent_anchor',at=f)
    out = {k: foot(v) for k, v in obs.items()}
    if mode in {'naive_interpolate', 'naive_repair'}:
        # Simple automatic repair hypothesis: flagged points become missing; short
        # gaps are interpolated, then every emitted point receives centered 3 MA.
        for key in flags:
            out.pop(key, None)
        for tid, frames in by_id.items():
            retained = [f for f in frames if (f, tid) in out]
            for a, b in zip(retained, retained[1:]):
                if 1 < b-a <= 4 and ts[b] > ts[a]:
                    for f in range(a+1, b):
                        frac = (ts[f] - ts[a]) / (ts[b] - ts[a])
                        out[f, tid] = out[a, tid] * (1-frac) + out[b, tid] * frac
                        if (f, tid) not in obs:
                            flag((f, tid), 'automatic_gap_fill', at=b)
        if mode == 'naive_repair':
            pre_smooth = {k: v.copy() for k, v in out.items()}
            for (f, tid) in out:
                if (f-1, tid) in pre_smooth and (f+1, tid) in pre_smooth:
                    out[f, tid] = (pre_smooth[f-1, tid]+pre_smooth[f, tid]+pre_smooth[f+1, tid])/3
    eligible = set(out) - set(flags) if review else set(out)
    return {'flags': dict(flags), 'detected_at': detected_at, 'out': out, 'eligible': eligible,
            'metric_available': scene['calibration_status'] == 'independently_validated_synthetic',
            'mode': mode}


def summarize(scene, result, baseline=None):
    obs, truth = scene['obs'], scene.get('truth')
    flags, out = set(result['flags']), result['out']
    support = set().union(*(e['keys'] for e in scene['events'])) if scene['events'] else set()
    observed_healthy = set(obs) - support
    detected_events = []
    for e in scene['events']:
        hits = e['keys'] & flags
        ats = [result['detected_at'][k] for k in hits]
        first = min(ats) if ats else None
        timely = first is not None and e['onset'] <= first <= e['onset']+3
        detected_events.append({'name': e['name'], 'onset_frame': e['onset'], 'support_slots': len(e['keys']),
                                'flagged_support_slots': len(hits), 'detected': timely,
                                'detected_at_any_time': bool(hits),
                                'predeclared_detection_window_frames': [e['onset'],e['onset']+3],
                                'cause_identification_scored': False,
                                'first_detection_frame': first,
                                'delay_seconds': None if first is None else float(scene['t'][first]-scene['t'][e['onset']]),
                                'description': e['description']})
    changed = {k for k in set(obs) & set(out) if np.linalg.norm(out[k]-foot(obs[k])) > EPS}
    lost = set(obs)-set(out)
    summary = {
        'mode': result['mode'], 'observed_slots': len(obs), 'fault_support_slots': len(support),
        'flagged_slots': len(flags), 'flagged_observed_slots': len(flags & set(obs)),
        'event_detected': sum(e['detected'] for e in detected_events), 'event_total': len(detected_events),
        'fault_slot_recall': len(flags & support)/len(support) if support else None,
        'fault_slot_misses': len(support-flags),
        'untouched_observed_alerts': len(flags & observed_healthy),
        'untouched_observed_alert_rate': len(flags & observed_healthy)/len(observed_healthy) if observed_healthy else None,
        'changed_observed_positions': len(changed), 'removed_observed_positions': len(lost),
        'changed_untouched_positions': len(changed & observed_healthy),
        'removed_untouched_positions': len(lost & observed_healthy),
        'new_positions': len(set(out)-set(obs)), 'output_slots': len(out),
        'policy_accepted_observed_coverage': len(result['eligible'] & set(obs))/len(obs),
        'raw_preserved': result['mode'].startswith('review_raw') or result['mode'] == 'naive_speed',
        'reasons': dict(Counter(r for vals in result['flags'].values() for r in vals)),
        'event_results': detected_events,
    }
    if truth is not None:
        common = set(out) & set(truth)
        errors = [float(np.linalg.norm(out[k]-foot(truth[k]))) for k in common]
        worsened = [k for k in changed if k in truth and np.linalg.norm(out[k]-foot(truth[k])) > np.linalg.norm(foot(obs[k])-foot(truth[k])) + EPS]
        support_errors = [float(np.linalg.norm(out[k]-foot(truth[k]))) for k in common & support]
        healthy_errors = [float(np.linalg.norm(out[k]-foot(truth[k]))) for k in common-support]
        accepted = result['eligible'] & set(truth)
        summary.update({'ground_truth_kind': 'analytic_synthetic',
                        'false_alarm_slots': len(flags & observed_healthy),
                        'false_alarm_rate': summary['untouched_observed_alert_rate'],
                        'worsened_positions': len(worsened),
                        'worsened_healthy_positions': len(set(worsened) & observed_healthy),
                        'wrong_emitted_positions_over_1px': sum(e > 1 for e in errors),
                        'position_rmse_px_available': math.sqrt(np.mean(np.square(errors))) if errors else None,
                        'position_rmse_px_fault_support_available': math.sqrt(np.mean(np.square(support_errors))) if support_errors else None,
                        'position_rmse_px_healthy_available': math.sqrt(np.mean(np.square(healthy_errors))) if healthy_errors else None,
                        'accepted_wrong_truth_slots_over_1px': int(sum(np.linalg.norm(out[k]-foot(truth[k])) > 1 for k in accepted)),
                        'accepted_correct_truth_availability_1px': float(sum(np.linalg.norm(out[k]-foot(truth[k])) <= 1 for k in accepted)/len(truth)),
                        'missing_truth_slots': len(set(truth)-set(out)),
                        'spurious_output_slots': len(set(out)-set(truth)),
                        'truth_slot_availability': len(common)/len(truth),
                        'metric_scale_relative_error': abs(scene['metric_scale']/scene['true_metric_scale']-1),
                        'hypothetical_metric_claim_permitted': result['metric_available'] if result['mode'].startswith('review_raw') else True})
    else:
        summary['ground_truth_kind'] = 'none_model_outputs_are_not_truth'
        summary['natural_false_positive_rate'] = None
        summary['natural_identity_accuracy'] = None
    if baseline is not None:
        pre_flags = set(baseline['flags'])
        summary['preexisting_alert_support_slots'] = len(pre_flags & support)
        summary['newly_alerted_injected_slots'] = len((flags-pre_flags) & support)
        summary['additional_alerts_outside_injection'] = len((flags-pre_flags)-support)
        summary['removed_baseline_alerts'] = len(pre_flags-flags)
    return summary


def make_synthetic_cases():
    cases = []
    base = synthetic()
    cases.append(base)
    s = synthetic('healthy_acceleration_and_turn')
    for f in range(len(s['t'])):
        s['obs'][f, 0] = point_box(120+0.045*f*f, 320+30*math.sin(f/6))
    s['truth'] = copy.deepcopy(s['obs'])
    cases.append(s)
    s = synthetic('healthy_fast_full_scene_camera_pan')
    for f in range(90):
        for tid in range(6):
            s['obs'][f, tid] = shifted(s['obs'][f, tid], 27*min(max(f-40,0),8))
    s['truth'] = copy.deepcopy(s['obs'])
    cases.append(s)
    s = synthetic('isolated_geometry_spike')
    s['obs'][40, 0] = shifted(s['obs'][40, 0], 120)
    s['events'] = [event('geometry_spike', [(40, 0)], 40, 'One known point translated +120 px; neighboring truth unchanged.')]
    cases.append(s)
    s = synthetic('duplicate_candidate')
    for f in range(40, 45):
        s['obs'][f, 99] = s['obs'][f, 0].copy()
    s['events'] = [event('duplicate', [(f, 99) for f in range(40, 45)], 40, 'Five exact duplicates under new ID 99; source ID is healthy.')]
    cases.append(s)
    s = synthetic('three_frame_gap')
    for f in range(40, 43):
        del s['obs'][f, 0]
    s['events'] = [event('gap', [(f, 0) for f in range(40, 43)], 40, 'Three removed observations; source remains in scene by construction.')]
    cases.append(s)
    s = synthetic('three_frame_gap_hidden_curve')
    for f in range(40, 43):
        s['truth'][f, 0] = shifted(s['truth'][f, 0], 0, 25*math.sin(math.pi*(f-39)/4))
        del s['obs'][f, 0]
    s['events'] = [event('gap', [(f, 0) for f in range(40, 43)], 40, 'Same observed endpoints as linear gap, but hidden motion curves by up to 25 px; no method is told this.')]
    cases.append(s)
    s = synthetic('distant_id_swap')
    for f in range(40, 90):
        s['obs'][f, 0], s['obs'][f, 5] = s['obs'][f, 5], s['obs'][f, 0]
    s['events'] = [event('id_swap', [(f, tid) for f in range(40, 90) for tid in [0, 5]], 40, 'IDs 0 and 5 exchange continuously through end; geometric jump only at onset.')]
    cases.append(s)
    s = synthetic('same_team_crossing_id_swap')
    for f in range(90):
        s['obs'][f, 0] = point_box(350+2*(f-40), 220)
        s['obs'][f, 1] = point_box(350-2*(f-40), 220)
    s['truth'] = copy.deepcopy(s['obs'])
    for f in range(41, 90):
        s['obs'][f, 0], s['obs'][f, 1] = s['obs'][f, 1], s['obs'][f, 0]
    s['events'] = [event('id_swap_at_crossing', [(f, tid) for f in range(41, 90) for tid in [0, 1]], 41, 'Identical appearance / same-team assumption; both assignments have low speed.')]
    cases.append(s)
    s = synthetic('healthy_full_scene_camera_pan')
    for f in range(90):
        for tid in range(6):
            s['obs'][f, tid] = shifted(s['obs'][f, tid], 18*min(max(f-40,0),8))
    # Image coordinates really move; 144px pan stays within synthetic image bounds.
    s['truth'] = copy.deepcopy(s['obs'])
    cases.append(s)
    s = synthetic('valid_cut_with_reused_ids')
    for f in range(40, 90):
        for tid in range(6):
            s['obs'][f, tid] = shifted(s['obs'][f, tid], 140, 30)
    s['truth'] = copy.deepcopy(s['obs'])
    s['events'] = [event('cross_shot_continuity_invalid', [(40, tid) for tid in range(6)], 40,
                         'Coordinates correct in both shots; only cross-shot continuity is invalid. No shot label supplied.')]
    cases.append(s)
    s = synthetic('repeated_pts')
    s['t'][40] = s['t'][39]
    s['events'] = [event('nonmonotonic_pts', [(40, tid) for tid in range(6)], 40, 'Frame 40 PTS repeats frame 39; point coordinates remain correct.')]
    cases.append(s)
    s = synthetic('silent_calibration_scale_error')
    s['metric_scale'] *= 2
    s['events'] = [event('silent_metric_scale_error', list(s['obs']), 0, 'Wrong 2x metres/px with falsely trusted status; geometry contains no independent scale reference.')]
    cases.append(s)
    s = copy.deepcopy(s)
    s['name'] = 'same_scale_error_with_unverified_provenance'
    s['calibration_status'] = 'unverified'
    cases.append(s)
    return cases


def load_real(repo, name):
    relative = Path('data/videos/tactics/acceptance/tracks/basketball-20261002') / (name+'-team-stable.json')
    path = repo/relative
    raw = path.read_bytes()
    rows = json.loads(raw)
    meta_path = path.with_name(path.stem+'.meta.json')
    meta = json.loads(meta_path.read_bytes())
    obs = {(i, int(t[4])): list(map(float, t[:4])) for i, r in enumerate(rows) for t in r['tracks']}
    ts = np.array([r['source_frame_pts']*r['source_time_base'][0]/r['source_time_base'][1] for r in rows])
    scene = {'name': name, 't': ts, 'obs': obs, 'events': [], 'source': 'real_model_snapshot',
             'calibration_status': 'unverified', 'metric_scale': None, 'true_metric_scale': None}
    info = {'clip': name, 'path_relative_to_repo': relative.as_posix(), 'sha256': hashlib.sha256(raw).hexdigest(),
            'metadata_sha256': hashlib.sha256(meta_path.read_bytes()).hexdigest(),
            'frames': len(rows), 'track_observations': len(obs), 'track_ids': len(set(k[1] for k in obs)),
            'time_basis': 'source_frame_pts * source_time_base; differences only',
            'first_pts_seconds': float(ts[0]), 'first_time_field': rows[0]['time'],
            'median_dt': float(np.median(np.diff(ts))), 'width': meta['width'], 'height': meta['height'],
            'track_columns': ['x1','y1','x2','y2','track_id','score','class_id'],
            'coordinate_used': 'bbox bottom center, image-space proxy, not validated ground contact',
            'pending_detections_preserved_in_source_but_not_evaluated': sum(len(r.get('pending_detections',[])) for r in rows),
            'objects_rows': sum('objects' in r for r in rows),
            'identity_verified_in_metadata': meta.get('identity_verified'),
            'metric_accuracy_validated_in_metadata': meta.get('metric_accuracy_validated')}
    return scene, info


def real_interventions(base):
    obs = base['obs']
    n = len(base['t'])
    candidates = [(abs(f-n//2), f, tid) for (f, tid) in obs if 8 <= f < n-8 and all((q,tid) in obs for q in range(f-4,f+7))]
    _, f, tid = min(candidates)
    new_id = max(k[1] for k in obs)+1000
    others = [j for (q,j) in obs if q==f and j!=tid and all((z,j) in obs for z in range(f,f+5))]
    other = max(others,key=lambda j: np.linalg.norm(foot(obs[f,j])-foot(obs[f,tid])))
    results = []
    for kind in ['geometry_spike','duplicate','gap','id_swap_five_frames','common_translation_one_frame','repeated_pts']:
        s = copy.deepcopy(base)
        s['name'] = base['name']+'__'+kind
        manifest = {'kind': kind, 'frame': f, 'track_id': tid}
        if kind == 'geometry_spike':
            s['obs'][f,tid] = shifted(s['obs'][f,tid],120)
            keys = [(f,tid)]
            manifest['dx_px'] = 120
        elif kind == 'duplicate':
            s['obs'][f,new_id] = s['obs'][f,tid].copy()
            keys = [(f,new_id)]
            manifest['new_track_id'] = new_id
        elif kind == 'gap':
            keys = [(q,tid) for q in range(f,f+3)]
            for k in keys: del s['obs'][k]
            manifest['length_frames'] = 3
        elif kind == 'id_swap_five_frames':
            keys = [(q,j) for q in range(f,f+5) for j in [tid,other]]
            for q in range(f,f+5):
                s['obs'][q,tid],s['obs'][q,other] = s['obs'][q,other],s['obs'][q,tid]
            manifest.update(other_track_id=other, length_frames=5)
        elif kind == 'common_translation_one_frame':
            keys = [k for k in obs if k[0]==f]
            for k in keys: s['obs'][k] = shifted(s['obs'][k],120)
            manifest['dx_px'] = 120
        else:
            s['t'][f] = s['t'][f-1]
            keys = [k for k in obs if k[0]==f]
        s['events'] = [event(kind,keys,f,'Known artificial intervention, not an annotation of a natural error.')]
        manifest['affected_keys'] = [list(k) for k in keys]
        results.append((s,manifest))
    return results


def equivalence_witnesses():
    ts = np.arange(21)/25
    # Both worlds produce exactly the same observed boxes. In W1 the tracker
    # swapped identities at occlusion; in W2 the two players turned back.
    centered = ts-.4
    observed_a = np.column_stack((120+200*centered**3,np.full(len(ts),200.)))
    observed_b = np.column_stack((120-200*centered**3,np.full(len(ts),200.)))
    world1_a = observed_a.copy()
    world2_a = np.column_stack((120-200*np.abs(centered)**3,np.full(len(ts),200.)))
    world2_b = np.column_stack((240-world2_a[:,0],np.full(len(ts),200.)))
    world2_tracker_a = np.where((centered <= 0)[:,None],world2_a,world2_b)
    world2_tracker_b = np.where((centered <= 0)[:,None],world2_b,world2_a)
    motion = np.column_stack((80*ts,np.zeros(len(ts))))
    stationary_players = np.array([[100.,200.],[300.,220.],[500.,240.]])
    images_camera = stationary_players[None,:,:]+motion[:,None,:]
    images_players = (stationary_players[None,:,:]+motion[:,None,:])+np.zeros_like(motion[:,None,:])
    return {
        'same_team_occlusion': {'observation_equal': bool(np.allclose(observed_a,world2_tracker_a,atol=1e-12) and np.allclose(observed_b,world2_tracker_b,atol=1e-12)),
            'observation_sha256': hashlib.sha256(np.stack([observed_a,observed_b]).tobytes()).hexdigest(),
            'world_1': 'Two visually indistinguishable players pass through occlusion along +/-200*(t-.4)^3; IDs stay correct.',
            'world_2': 'Players turn back along +/-200*abs(t-.4)^3 under occlusion; IDs swap after t=.4.',
            'true_identity_trajectory_difference_px_at_end': float(np.linalg.norm(world1_a[-1]-world2_a[-1])),
            'assumption': 'No usable jersey, face, appearance, ball-contact, or independent identity evidence. Both worlds have continuous velocity and acceleration; crossing idealizes an unobserved occlusion interval.',
            'conclusion': 'Position/box geometry alone cannot choose the correct identity assignment.'},
        'global_translation': {'observation_equal': bool(np.array_equal(images_camera,images_players)),
            'observation_sha256': hashlib.sha256(images_camera.tobytes()).hexdigest(),
            'world_1': 'Stationary players, camera image translation 80 px/s.',
            'world_2': 'Static camera, all players translate 80 px/s.',
            'true_player_speed_world_1_px_s': 0, 'true_player_speed_world_2_px_s': 80,
            'conclusion': 'Subtracting median track displacement declares world 2 motion zero. Require background/court evidence to attribute camera motion.'},
        'metric_scale': {'observation_equal': True, 'world_1_m_per_px': .025, 'world_2_m_per_px': .05,
            'speed_relative_difference': 1., 'conclusion': 'Image trajectories alone do not identify absolute metric scale or silently wrong calibration.'}}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--repo', type=Path, required=True)
    ap.add_argument('--out', type=Path, default=Path(__file__).parent)
    args = ap.parse_args()
    args.out.mkdir(parents=True,exist_ok=True)
    modes = ['naive_speed','naive_interpolate','naive_repair','review_raw','review_raw_segment']
    result = {'version': 1, 'thresholds': {'speed_px_s': SPEED,'near_px':NEAR,'duplicate_iou':.9,
               'common_displacement_px':10,'common_residual_p80_px':4,'minimum_common_tracks':4},
              'environment': {'python': platform.python_version(),'numpy':np.__version__},
              'metric_definitions': {
                'event_recall': 'An alert on explicitly injected support, available within onset through onset+3 frames; long ID-swap tails also reported by slot recall. Symptom alert is not cause identification.',
                'false_alarm': 'Only synthetic healthy observed slots outside known support; real data has no natural-error false-positive labels.',
                'worsened': 'Synthetic output position has greater error than input by >1e-6 px.',
                'availability': 'Policy-accepted observed coverage: review excludes flagged slots; naive policies release all emitted positions, even flagged. This is not a shared unflagged rate or accuracy. Missing truth and spurious candidates are separate.',
                'metric_permission': 'Hypothetical capability gate comparison only: pixel-only naive methods have no calibration gate, modeled as permission=True; they do not actually emit metric estimates.',
                'delay': 'First alert availability minus injected onset in PTS seconds. Gap alerts require reappearance.',
                'actual_input_disturbance': 'Changes to untouched model-output coordinates; not a natural accuracy metric.',
                'source_fields': 'Original files remain byte-identical; analysis uses separate bbox-center views. All raw fields remain available.'},
              'synthetic': [], 'real_sources': [], 'real_baselines': [], 'real_interventions': [],
              'small_threshold_sensitivity': [],
              'identifiability_witnesses': equivalence_witnesses(),
              'latency_notes': {'review_geometry': 'Causal incoming transition and same-frame ambiguity: zero additional frames.',
                                'review_gap': 'Offline retrospective gap annotation at reappearance, three-frame gap = 3 frame periods.',
                                'naive_repair': 'Centered smoothing requires one future frame; interpolation needs next retained endpoint, up to four frame periods. No live-system timing claim.',
                                'identity_resolution': 'Not achieved by any method; review alerts are not repaired identity.'}}
    start = time.perf_counter()
    for scene in make_synthetic_cases():
        result['synthetic'].append({'name':scene['name'],'known_truth':True,
                                    'results':[summarize(scene,policy(scene,m)) for m in modes]})
    for name in ['004','005','006','nba-lal-min-005']:
        scene,info = load_real(args.repo,name)
        result['real_sources'].append(info)
        baselines = {m:policy(scene,m) for m in modes}
        result['real_baselines'].append({'clip':name,'results':[summarize(scene,baselines[m]) for m in modes]})
        for threshold in [300.,600.,1200.]:
            probed = policy(scene,'naive_speed',speed_threshold=threshold)
            result['small_threshold_sensitivity'].append({'clip':name,'threshold_px_s':threshold,
                'flagged_observed_slots':len(set(probed['flags'])&set(scene['obs'])),
                'observed_slots':len(scene['obs']),
                'interpretation':'Alert volume only; no natural-error labels, not threshold optimization.'})
        for altered,manifest in real_interventions(scene):
            result['real_interventions'].append({'clip':name,'intervention':manifest,
                'results':[summarize(altered,policy(altered,m),baselines[m]) for m in modes]})
    result['elapsed_seconds'] = time.perf_counter()-start
    result['script_sha256'] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    target = args.out/'fault_results.json'
    target.write_text(json.dumps(result,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf-8')
    print(json.dumps({'results':str(target),'synthetic_cases':len(result['synthetic']),
                      'real_interventions':len(result['real_interventions']),
                      'elapsed_seconds':result['elapsed_seconds']},ensure_ascii=False))


if __name__ == '__main__':
    main()
