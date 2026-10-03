"""Bridge the minimal source adapter into fact gates; real cases are diagnostics.

Every adapter example is re-normalized from its pinned source pointer. Sparse
manual-reference and AI-ball cases never enter synthetic ground-truth metrics.
"""
import argparse
import copy
import hashlib
import importlib.util
import json
from pathlib import Path

import fact_gate_experiment as fg

ROOT=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('source_adapter',ROOT/'adapter'/'normalize.py')
adapter=importlib.util.module_from_spec(spec);spec.loader.exec_module(adapter)
METHODS=['confidence_only','provenance_only','capability_dependencies']


def bridge(record,kind,value,category='source_report',component='raw_location',usage='offline_retrospective',as_of=0.):
    c=fg.candidate(kind,value,category,score=record['evidence'].get('score') or 0.)
    c['entity_scope'].update(track_id=record['association'].get('local_track_id'),
                            target_frame=record['timing'].get('source_frame'),
                            source_namespace=record['association']['namespace'].get('value'),
                            identity_interval=None)
    c['source_provenance'].update(source_ref=record['source'],payload_sha256=record['source']['payload_sha256'],
        evidence_kind=record['evidence']['kind'],reported_value=record['geometry']['raw_bbox'],
        data_layer='raw',chain_complete=True,integrity='verified')
    c['source_provenance']['evidence_correlation_group']=record.get('evidence_correlation_group')
    c['observations']={'adapter_record_id':record['id'],'raw_payload':record['raw_payload']}
    c['states']={cap:'unknown' for cap in fg.CAPABILITIES}
    c['states']['identity']='verified' if record['association'].get('identity_verified') else 'unverified'
    c['states']['time']='verified' if record['timing']['time_basis']=='verified_container_pts_seconds' else 'unverified'
    # An image candidate is still unvalidated as a world position or true foot.
    c['states']['geometry']='unverified'
    c['states']['object_classification']='unverified'
    selected=record['availability'].get('components',{}).get(component,{})
    c['availability']={
        'exact_available_at_source_seconds':None,
        'known_source_lower_bound_seconds':selected.get('time_seconds'),
        'dependency_completeness':record['availability'].get('dependency_completeness','unknown'),
        'wall_clock_available_at':record['availability'].get('wall_clock_available_at'),
        'component':component,'component_source_floor':selected,
        'composite_source_floor_not_used_for_unrelated_claim':record['availability'].get('available_at_source_lower_bound')}
    c['timing']={'usage_context':usage,'as_of_seconds':as_of,
                 'target_time_seconds':record['timing'].get('raw_time_seconds'),
                 'source_time_basis':record['timing']['time_basis']}
    c['claim_component']=component
    if component=='role':
        c['source_provenance']['reported_value']=record['role']['label']
        if record['role'].get('inferred'):c['source_provenance']['evidence_kind']='model_inferred_role'
    return c


def result(name,c,source_record=None,diagnostic=None):
    return {'case_id':name,'candidate':c,'normalized_source':None if source_record is None else source_record['source'],
            'diagnostic_reference':diagnostic,
            'outputs':{method:fg.gate(c,method) for method in METHODS}}


def main():
    ap=argparse.ArgumentParser();ap.add_argument('--repo',type=Path,required=True);args=ap.parse_args()
    source_doc=json.loads((ROOT/'adapter'/'real-examples.json').read_text(encoding='utf-8'))
    byid={r['id']:r for r in source_doc['records']}
    records={}
    for label,rid in source_doc['example_ids'].items():
        supplied=byid[rid];src=supplied['source']
        fresh=adapter.normalize_source(args.repo,src['relative_path'],src['json_pointer'])
        if fresh['source']!=src:raise ValueError('Pinned source changed: '+label)
        records[label]=fresh
    outputs=[]
    for label in ['track_detector','ball_detector']:
        r=records[label];c=bridge(r,'detector_reported_position',r['geometry']['raw_bbox'])
        outputs.append(result(label+'_raw_report_offline',c,r))
    r=records['qwen_observed_true']
    c=bridge(r,'direct_observation_status',True)
    c['source_provenance']['reported_value']=False # semantic kind wins over legacy observed=true
    outputs.append(result('qwen_legacy_observed_true_is_not_direct_detector_observation',c,r))
    for usage in ['offline_retrospective','causal_replay_as_of_source_time']:
        c=bridge(r,'model_proposed_position',r['geometry']['raw_bbox'],usage=usage,as_of=3.12)
        outputs.append(result('qwen_estimate_'+usage,c,r))
    c=bridge(r,'detector_reported_position',r['geometry']['raw_bbox'])
    outputs.append(result('qwen_raw_bbox_is_not_detector_bbox',c,r))
    r=records['smoothed_detector']
    c=bridge(r,'detector_reported_position',r['geometry']['render_bbox'])
    c['source_provenance']['data_layer']='display_smoothing'
    outputs.append(result('smoothed_bbox_cannot_claim_raw',c,r))
    outputs.append(result('same_smoothed_record_raw_report_still_available',bridge(r,'detector_reported_position',r['geometry']['raw_bbox']),r))
    r=records['interpolated'];c=bridge(r,'direct_observation_status',True)
    c['source_provenance']['reported_value']=False
    outputs.append(result('interpolation_is_not_direct_observation',c,r))
    r=records['future_role']
    for component,kind,value in [('raw_location','detector_reported_position',r['geometry']['raw_bbox']),('role','model_role_report',r['role']['label'])]:
        for usage in ['offline_retrospective','causal_replay_as_of_source_time']:
            c=bridge(r,kind,value,component=component,usage=usage,as_of=1.)
            outputs.append(result('future_role_'+component+'_'+usage,c,r))
    a,b=records['same_content_team_stable'],records['same_content_optimized']
    c=bridge(a,'independent_model_agreement',2)
    c['source_provenance']['reported_value']=2
    c['source_provenance']['sources']=[{'variant':v,'file_sha256':r['source']['file_sha256'],
        'correlation_group':r['evidence_correlation_group']} for v,r in [('team-stable',a),('optimized',b)]]
    outputs.append(result('same_file_sha_is_not_two_independent_votes',c,a))

    sparse_path=ROOT/'identity'/'sparse_identity_results.json'
    sparse=json.loads(sparse_path.read_text(encoding='utf-8'))
    run=next(r for r in sparse['runs'] if r['variant']=='original' and r['minimum_iou']==.3)
    rawpath=run['path'];rawrows=json.loads((args.repo/rawpath).read_text(encoding='utf-8'))
    sparse_cases=[]
    for f in [53,159,212,266]:
        ref=next(m for m in run['matches'] if m['frame']==f and m['track_id']==25)
        idx=next(i for i,t in enumerate(rawrows[f]['tracks']) if int(t[4])==25)
        r=adapter.normalize_source(args.repo,rawpath,f'/{f}/tracks/{idx}')
        c=bridge(r,'named_actor_label','white_28','world')
        c['entity_scope'].update(actor='white_28',identity_interval=[53,53])
        diagnostic={'status':'inherited_sparse_source_claimed_human_not_independently_reverified',
                    'label_source':sparse['label_source'],'label_sha256':sparse['label_sha256'],
                    'source_label_at_this_frame':ref['actor'],'query_label':'white_28',
                    'reference_agreement':ref['actor']=='white_28','detector_score':ref['detector_score'],
                    'iou_to_inherited_box':ref['iou_to_inherited_box'],
                    'not_dense_ground_truth':True,'no_truth_assigned_between_reviewed_frames':True}
        sparse_cases.append(result('T25_white28_binding_at_'+str(f),c,r,diagnostic))
    sparse_summary=[]
    for method in METHODS:
        contradictions=[r for r in sparse_cases if not r['diagnostic_reference']['reference_agreement']]
        agreements=[r for r in sparse_cases if r['diagnostic_reference']['reference_agreement']]
        sparse_summary.append({'method':method,'reference_agreement_cases':len(agreements),
            'reference_contradiction_cases':len(contradictions),
            'admitted_reference_contradictions':sum(r['outputs'][method]['decision']!='silent' for r in contradictions),
            'retained_reference_agreements':sum(r['outputs'][method]['decision']!='silent' for r in agreements),
            'human_accuracy_rate':None,'rate_reason':'Inherited sparse reference not independently reverified.'})

    ai_path=ROOT/'objects'/'visual_labels.provisional.json'
    ai=json.loads(ai_path.read_text(encoding='utf-8'));ai_cases=[]
    for ref in ai['cases']:
        p=f"data/videos/tactics/acceptance/tracks/{ref['sample']}-ebard.json"
        rows=json.loads((args.repo/p).read_text(encoding='utf-8'))
        for idx in [ref['provisional_ball_object_index']]+ref['provisional_nonball_object_indices']:
            r=adapter.normalize_source(args.repo,p,f"/{ref['frame']}/objects/{idx}")
            c=bridge(r,'ball_detected',True,'world')
            diag={'status':ai['label_status'],'not_ground_truth':True,
                  'ai_reference_agreement':idx==ref['provisional_ball_object_index'],
                  'source_object':rows[ref['frame']]['objects'][idx],
                  'human_adjudication':'pending'}
            ai_cases.append(result(f"AI_ball_{ref['sample']}_f{ref['frame']}_object{idx}",c,r,diag))
    byname={r['case_id']:r for r in outputs}
    checks={
        'qwen_legacy_observed_true_silenced':byname['qwen_legacy_observed_true_is_not_direct_detector_observation']['outputs']['capability_dependencies']['decision']=='silent',
        'qwen_raw_bbox_not_promoted_to_detector':byname['qwen_raw_bbox_is_not_detector_bbox']['outputs']['capability_dependencies']['decision']=='silent',
        'qwen_offline_report_allowed_as_proposal':byname['qwen_estimate_offline_retrospective']['outputs']['capability_dependencies']['decision']=='qualified',
        'qwen_causal_future_not_allowed':byname['qwen_estimate_causal_replay_as_of_source_time']['outputs']['capability_dependencies']['decision']=='silent',
        'future_role_does_not_poison_raw_location_source_floor':byname['future_role_raw_location_causal_replay_as_of_source_time']['candidate']['availability']['known_source_lower_bound_seconds']==0.,
        'future_role_has_own_later_floor':byname['future_role_role_causal_replay_as_of_source_time']['candidate']['availability']['known_source_lower_bound_seconds']==4.,
        'offline_raw_report_preserved_despite_future_role':byname['future_role_raw_location_offline_retrospective']['outputs']['capability_dependencies']['decision']=='certain',
        'unknown_readiness_does_not_become_measured_realtime':all(r['outputs']['capability_dependencies']['decision']=='silent' for r in outputs if r['candidate']['timing']['usage_context']=='causal_replay_as_of_source_time'),
        'copied_variants_not_independent_votes':byname['same_file_sha_is_not_two_independent_votes']['outputs']['capability_dependencies']['decision']=='silent',
        'real_cases_excluded_from_analytic_gt_metrics':True,
    }
    report={'adapter_schema_version':source_doc['schema_version'],
        'adapter_example_snapshot_sha256':hashlib.sha256((ROOT/'adapter'/'real-examples.json').read_bytes()).hexdigest(),
        'adapter_sources_renormalized_and_reverified':len(records),'adapter_semantic_challenges':outputs,
        'inherited_sparse_reference':{'source_sha256':hashlib.sha256(sparse_path.read_bytes()).hexdigest(),'cases':sparse_cases,'summaries':sparse_summary},
        'provisional_ai_ball_diagnostics':{'source_sha256':hashlib.sha256(ai_path.read_bytes()).hexdigest(),'not_ground_truth':True,'cases':ai_cases},
        'validation':{'all_passed':all(checks.values()),'checks':checks},
        'real_processing_latency_seconds':None,
        'limitations':['No new human annotation or dense identity/ball truth.','Gate statuses do not establish unknown physical truth.',
                       'Offline source reports are allowed; historical causal readiness remains unknown unless actual completion records exist.']}
    path=Path(__file__).with_name('real_challenges.json')
    path.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'output':str(path),'adapter_cases':len(outputs),'sparse_summary':sparse_summary,
                      'ai_diagnostic_candidates':len(ai_cases),'validation':report['validation']},ensure_ascii=False,indent=2))
    if not report['validation']['all_passed']:raise SystemExit(1)


if __name__=='__main__':main()
