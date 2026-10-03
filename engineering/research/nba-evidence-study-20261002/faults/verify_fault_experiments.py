"""Independent consistency/reproduction checks, not model accuracy evaluation."""
import argparse
import ast
import hashlib
import inspect
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

import run_fault_experiments as exp


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--repo',type=Path,required=True)
    args = ap.parse_args()
    out = Path(__file__).parent
    subprocess.run([sys.executable,'-X','utf8',str(out/'run_fault_experiments.py'),'--repo',str(args.repo)],check=True)
    first = json.loads((out/'fault_results.json').read_text(encoding='utf-8'))
    subprocess.run([sys.executable,'-X','utf8',str(out/'run_fault_experiments.py'),'--repo',str(args.repo),'--out',str(out/'reproduction')],check=True)
    second = json.loads((out/'reproduction'/'fault_results.json').read_text(encoding='utf-8'))
    first.pop('elapsed_seconds')
    second.pop('elapsed_seconds')
    checks = {'repeat_semantically_identical_excluding_runtime':first == second}
    source_checks = []
    for info in first['real_sources']:
        p = args.repo/info['path_relative_to_repo']
        m = p.with_name(p.stem+'.meta.json')
        source_checks.append({'clip':info['clip'],
                              'data_sha256_unchanged':hashlib.sha256(p.read_bytes()).hexdigest()==info['sha256'],
                              'metadata_sha256_unchanged':hashlib.sha256(m.read_bytes()).hexdigest()==info['metadata_sha256']})
    checks['eight_source_files_sha256_match'] = all(x['data_sha256_unchanged'] and x['metadata_sha256_unchanged'] for x in source_checks)
    tree = ast.parse(inspect.getsource(exp.policy))
    forbidden = {'truth','events','fault_support','true_metric_scale'}
    consumed = set()
    for node in ast.walk(tree):
        if isinstance(node,ast.Subscript) and isinstance(node.value,ast.Name) and node.value.id=='scene' and isinstance(node.slice,ast.Constant):
            consumed.add(node.slice.value)
        if isinstance(node,ast.Call) and isinstance(node.func,ast.Attribute) and isinstance(node.func.value,ast.Name) and node.func.value.id=='scene' and node.func.attr=='get' and node.args and isinstance(node.args[0],ast.Constant):
            consumed.add(node.args[0].value)
    checks['policy_does_not_read_synthetic_truth_or_injection_locations'] = not bool(consumed & forbidden)
    scenes = {s['name']:s for s in exp.make_synthetic_cases()}
    checks['hidden_straight_and_curved_gap_observations_identical'] = scenes['three_frame_gap']['obs']==scenes['three_frame_gap_hidden_curve']['obs']
    checks['hidden_gap_truths_differ'] = scenes['three_frame_gap']['truth']!=scenes['three_frame_gap_hidden_curve']['truth']
    checks['identity_and_camera_observation_equivalence_witnesses'] = all(v['observation_equal'] for v in first['identifiability_witnesses'].values())
    checks['review_preserves_all_observed_positions_and_never_fills'] = True
    for s in scenes.values():
        for mode in ['review_raw','review_raw_segment']:
            r = exp.policy(s,mode)
            if set(r['out']) != set(s['obs']) or any(not np.array_equal(r['out'][k],exp.foot(s['obs'][k])) for k in s['obs']):
                checks['review_preserves_all_observed_positions_and_never_fills'] = False
    checks['real_data_accuracy_fields_explicitly_null'] = all(r['natural_false_positive_rate'] is None and r['natural_identity_accuracy'] is None for x in first['real_baselines'] for r in x['results'])
    checks['each_real_clip_has_six_predeclared_interventions'] = all(sum(x['clip']==info['clip'] for x in first['real_interventions'])==6 for info in first['real_sources'])
    # Independent closed-form error: hidden deviations are 25/sqrt(2),25,25/sqrt(2).
    curved = next(x for x in first['synthetic'] if x['name']=='three_frame_gap_hidden_curve')
    interp = next(r for r in curved['results'] if r['mode']=='naive_interpolate')
    checks['curved_gap_error_matches_closed_form'] = bool(abs(interp['position_rmse_px_fault_support_available']-np.sqrt(1250/3)) < 1e-9)
    report = {'all_passed':all(checks.values()),'checks':checks,'source_hash_checks':source_checks,
              'policy_scene_fields_consumed':sorted(consumed),
              'not_claimed':'No independent annotation of natural tracking errors; no model accuracy validation.'}
    (out/'validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False,indent=2))
    if not report['all_passed']:
        raise SystemExit(1)


if __name__=='__main__':
    main()
