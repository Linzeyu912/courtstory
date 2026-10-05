"""Third-round synthetic-only capability gates, using no hidden truth for decisions."""
import json
from collections import defaultdict
from pathlib import Path

import numpy as np
from scipy.optimize import linear_sum_assignment

import run_fault_experiments as exp


def capabilities(scene):
    local = exp.policy(scene,'review_raw')
    # Synthetic experiment assumes an independently confirmed initial identity
    # anchor. This assumption MUST NOT be imported into the real model outputs.
    invalid_time_frames = {f for (f,tid), rs in local['flags'].items() if 'timestamp_invalid' in rs}
    common_frames = {f for (f,tid), rs in local['flags'].items() if 'common_motion_unresolved' in rs}
    first_identity_risk = {}
    identity_risk = {'identity_ambiguous','duplicate_or_occlusion_review',
                     'reappearance_identity_unverified','common_motion_unresolved'}
    for (f,tid), rs in local['flags'].items():
        hazard = bool(rs & identity_risk)
        # Time metadata failure alone must not revoke an independently known
        # person's name; it invalidates dependent motion, including both edges.
        if 'pixel_speed_exceeds_hypothesis' in rs and f not in invalid_time_frames:
            hazard = True
        if hazard:
            first_identity_risk[tid] = min(f,first_identity_risk.get(tid,f))
    identity = {k for k in scene['obs'] if k[0] < first_identity_risk.get(k[1],len(scene['t']))}
    all_edges = {(f,tid) for f,tid in scene['obs'] if (f-1,tid) in scene['obs']}
    time_eligible = {k for k in all_edges if k[0] not in invalid_time_frames and k[0]-1 not in invalid_time_frames}
    motion = {k for k in time_eligible if k in identity and (k[0]-1,k[1]) in identity and k[0] not in common_frames}
    return {'raw_display':set(scene['obs']),'identity':identity,'all_edges':all_edges,
            'time_eligible':time_eligible,'motion':motion,'invalid_time_frames':invalid_time_frames,
            'common_frames':common_frames,'local':local}


def evaluate(scene, caps):
    # Independent evaluator reads analytic truth; gate function above does not.
    obs, truth = scene['obs'], scene['truth']
    anonymous_wrong = 0
    for f in range(len(scene['t'])):
        actual = [exp.foot(box) for (q,tid),box in obs.items() if q==f]
        expected = [exp.foot(box) for (q,tid),box in truth.items() if q==f]
        if not actual or not expected:
            continue
        costs = np.linalg.norm(np.array(actual)[:,None,:]-np.array(expected)[None,:,:],axis=2)
        rows, cols = linear_sum_assignment(costs)
        anonymous_wrong += int(sum(costs[rows,cols] > 1)) + max(0,len(actual)-len(expected))
    id_wrong = {k for k in obs if k in truth and np.linalg.norm(exp.foot(obs[k])-exp.foot(truth[k])) > 1}
    identity_events = [e for e in scene['events'] if e['name'] in {'id_swap','id_swap_at_crossing'}]
    identity_fault_slots = set().union(*(e['keys'] for e in identity_events)) if identity_events else None
    global_policy = exp.policy(scene,'review_raw_segment')
    # Known 25 Hz analytic clock; used only for independent error evaluation.
    bad_time_edges = {k for k in caps['all_edges'] if abs((scene['t'][k[0]]-scene['t'][k[0]-1])-.04)>1e-8}
    return {'scene':scene['name'],'observed_slots':len(obs),
            'hypothetical_display_slots_if_using_global_eligibility':len(global_policy['eligible']),
            'separate_raw_display_slots':len(caps['raw_display']),
            'additional_display_slots_under_separated_ui_policy':len(caps['raw_display'])-len(global_policy['eligible']),
            'raw_display_anonymous_matching_error_slots_over_1px':anonymous_wrong,
            'identity_attached_coordinate_error_slots_over_1px':len(id_wrong),
            'allowed_identity_claim_slots':len(caps['identity']),
            'accepted_assigned_coordinate_errors_over_1px':len(caps['identity'] & id_wrong),
            'known_injected_identity_fault_slots':None if identity_fault_slots is None else len(identity_fault_slots),
            'accepted_injected_wrong_identity_slots':None if identity_fault_slots is None else len(caps['identity'] & identity_fault_slots),
            'possible_motion_edges':len(caps['all_edges']),
            'time_gate_blocked_edges':len(caps['all_edges']-caps['time_eligible']),
            'known_bad_timestamp_edges':len(bad_time_edges),
            'known_bad_timestamp_edges_still_accepted':len(bad_time_edges & caps['time_eligible']),
            'allowed_identity_linked_motion_edges':len(caps['motion']),
            'common_motion_boundary_frames':sorted(caps['common_frames']),
            'local_review_flagged_observed_slots':len(set(caps['local']['flags']) & set(obs))}


def main():
    names = {'distant_id_swap','same_team_crossing_id_swap','repeated_pts',
             'valid_cut_with_reused_ids','isolated_geometry_spike','healthy_full_scene_camera_pan'}
    cases = [s for s in exp.make_synthetic_cases() if s['name'] in names]
    results = [evaluate(s,capabilities(s)) for s in cases]
    by_name = {r['scene']:r for r in results}
    checks = {
        'all_raw_observations_remain_visible':all(r['separate_raw_display_slots']==r['observed_slots'] for r in results),
        'pure_identity_swaps_keep_correct_anonymous_positions':all(by_name[n]['raw_display_anonymous_matching_error_slots_over_1px']==0 for n in ['distant_id_swap','same_team_crossing_id_swap']),
        'pure_identity_swaps_no_injected_wrong_identity_slots_released':all(by_name[n]['accepted_injected_wrong_identity_slots']==0 for n in ['distant_id_swap','same_team_crossing_id_swap']),
        'timestamp_failure_keeps_all_identity_slots_but_blocks_both_motion_edges':by_name['repeated_pts']['allowed_identity_claim_slots']==540 and by_name['repeated_pts']['time_gate_blocked_edges']==12 and by_name['repeated_pts']['known_bad_timestamp_edges_still_accepted']==0,
        'raw_preservation_is_not_position_accuracy':by_name['isolated_geometry_spike']['raw_display_anonymous_matching_error_slots_over_1px']==1,
    }
    output = {'round':3,'scope':'six analytic synthetic scenes; no rerun of the 24 real interventions',
              'comparison_semantics':'The previous review policy already preserved every raw point. The display comparison is counterfactual: if a UI also hid every globally ineligible slot, separating display would prevent that extra information loss. No implemented UI or actual raw recovery is claimed.',
              'assumption':'Initial identity anchor is independently confirmed in this synthetic experiment only.',
              'display_semantics':'Raw image bbox candidates remain visible with status. Display availability is not accepted metric position or identity accuracy.',
              'motion_semantics':'Identity-linked movement requires both endpoint identity continuity, valid endpoint timestamps, and no unresolved common-motion boundary. This toy gate does not validate camera/calibration quality for real scenes.',
              'results':results,'checks':checks,'all_checks_passed':all(checks.values())}
    path = Path(__file__).with_name('capability_results.json')
    path.write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(output,ensure_ascii=False,indent=2))
    if not output['all_checks_passed']:
        raise SystemExit(1)


if __name__=='__main__':
    main()
