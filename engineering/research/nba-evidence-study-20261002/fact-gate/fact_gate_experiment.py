"""Analytic candidate-fact gate experiment. No narrative generation or model calls.

Candidates and hidden world/source truth are serialized separately. Gate functions
receive only public candidates. Counterexample pairs have byte-equivalent public
inputs and different analytic truth values.
"""
from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import math
from collections import Counter
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location('fault_experiments',ROOT/'faults'/'run_fault_experiments.py')
FAULTS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(FAULTS)

CAPABILITIES = ('identity','time','geometry','camera','calibration','orientation','synchronization')
DEPENDENCIES = {
    'named_actor_position': ('identity','time','geometry'),
    'named_actor_label': ('identity','time'),
    'world_speed_mps': ('identity','time','geometry','camera','calibration'),
    'court_x_m': ('time','geometry','calibration','orientation'),
    'event_before': ('identity','time','synchronization'),
    'ball_detected': ('time','geometry','object_classification'),
}


def canonical(obj):
    return json.dumps(obj,sort_keys=True,ensure_ascii=False,separators=(',',':'),allow_nan=False)


def digest(obj):
    return hashlib.sha256(canonical(obj).encode('utf-8')).hexdigest()


def candidate(kind,value,category='world',score=.95):
    return {'kind':kind,'value':value,'category':category,'confidence':score,
            'entity_scope':{'actor':'A','track_id':'T1','identity_interval':[0,999],
                            'target_frame':40,'source_namespace':'synthetic-stream'},
            'source_provenance':{'chain_complete':True,'integrity':'verified',
                                 'source_ref':'synthetic/artifact','payload_sha256':'set-by-fixture',
                                 'evidence_kind':'detector_observation','data_layer':'raw',
                                 'reported_value':None,'sources':[]},
            'states':{cap:'verified' for cap in CAPABILITIES},
            'timing':{'usage_context':'causal_replay_as_of_source_time','as_of_seconds':4.,
                      'target_time_seconds':1.6},
            'availability':{'exact_available_at_source_seconds':1.6,
                            'known_source_lower_bound_seconds':1.6,'dependency_completeness':'complete',
                            'wall_clock_available_at':None},
            'observations':{},'claim_component':'raw_location'}


def point_truth(point):
    return {'predicate':'actor_position','world':{'actors':{'A':{'40':list(map(float,point))}}}}


def speed_truth(points,times,scale):
    return {'predicate':'speed','world':{'points':points,'times':times,'scale_m_per_px':scale}}


def report_truth(value,direct=True):
    return {'predicate':'source_payload','source_artifact':{'reported_value':value,'direct_observation':direct}}


def add_case(items,name,cand,truth,scene_ref,pair=None,actual_available=1.6):
    cand=copy.deepcopy(cand)
    truth=copy.deepcopy(truth)
    if cand['source_provenance']['payload_sha256']=='set-by-fixture':
        cand['source_provenance']['payload_sha256']=digest({'observations':cand['observations'],
                                                         'reported_value':cand['source_provenance']['reported_value']})
    truth['exact_available_at_source_seconds']=actual_available
    # IDs and scenario labels are outside the public candidate, preventing a
    # gate from learning which world in an equivalence pair it is evaluating.
    items.append({'case_id':name,'candidate':cand,'truth_context':truth,
                  'scene_ref':scene_ref,'equivalence_pair':pair})


def fixtures():
    scenes={s['name']:s for s in FAULTS.make_synthetic_cases()}
    items=[]
    healthy=scenes['healthy_linear']
    pt=FAULTS.foot(healthy['truth'][40,0]).tolist()
    c=candidate('named_actor_position',pt)
    c['observations']={'box':healthy['obs'][40,0]}
    add_case(items,'healthy_named_actor',c,point_truth(pt),'healthy_linear')
    low=copy.deepcopy(c);low['confidence']=.4
    add_case(items,'healthy_low_detector_score',low,point_truth(pt),'healthy_linear')
    s=scenes['distant_id_swap']
    c=candidate('named_actor_position',FAULTS.foot(s['obs'][60,0]).tolist(),score=.65)
    c['states']['identity']='unverified'
    c['entity_scope']['target_frame']=60
    c['observations']={'box':s['obs'][60,0]}
    t=point_truth(FAULTS.foot(s['truth'][60,0]));t['world']['actors']['A']['60']=t['world']['actors']['A'].pop('40')
    add_case(items,'distant_swap_named_actor',c,t,'distant_id_swap')

    # Smooth identity equivalence: the same observed tracks can mean pass-through
    # or turn-back under occlusion. Velocity and acceleration are continuous.
    ts=np.arange(21)/25;u=ts-.4
    track_a=np.column_stack((120+200*u**3,np.full(len(ts),200.)))
    track_b=np.column_stack((120-200*u**3,np.full(len(ts),200.)))
    turn_a=np.column_stack((120-200*np.abs(u)**3,np.full(len(ts),200.)))
    for verified in (False,True):
        c=candidate('named_actor_position',track_a[-1].tolist())
        c['entity_scope']['target_frame']=20
        c['observations']={'times':ts.tolist(),'T1':track_a.tolist(),'T2':track_b.tolist(),
                           'initial_identity_anchor':{'actor':'A','track':'T1','frame':0,'status':'independently_verified'}}
        c['states']['identity']='verified' if verified else 'ambiguous'
        pair='smooth_identity_'+('declared_verified' if verified else 'ambiguous')
        for label,p in [('pass',track_a[-1]),('turn',turn_a[-1])]:
            t=point_truth(p);t['world']['actors']['A']['20']=t['world']['actors']['A'].pop('40')
            add_case(items,pair+'_'+label,c,t,'identifiability_witnesses.same_team_occlusion',pair)

    times=[0.,.04,.08,.12]
    pixels=[[100+80*t,200.] for t in times]
    for verified in (False,True):
        c=candidate('world_speed_mps',2.)
        c['observations']={'points':pixels,'times':times,'claimed_m_per_px':.025}
        c['states']['camera']='verified' if verified else 'unresolved_common_motion'
        pair='common_motion_'+('declared_static_camera' if verified else 'unknown_camera')
        for label,wp in [('all_players_move',pixels),('camera_moves',[[100.,200.]]*4)]:
            add_case(items,pair+'_'+label,c,speed_truth(wp,times,.025),
                     'identifiability_witnesses.global_translation',pair)
    c=candidate('pixel_track_displacement_px_s',80.,'source_report')
    c['observations']={'points':pixels,'times':times}
    c['states']['camera']='unknown';c['source_provenance']['reported_value']=80.
    add_case(items,'source_pixel_motion_does_not_claim_world_motion',c,
             {'predicate':'pixel_derivation','source_artifact':{'points':pixels,'times':times}},
             'identifiability_witnesses.global_translation')

    s=scenes['repeated_pts'];points=[FAULTS.foot(s['obs'][f,1]).tolist() for f in [40,41]]
    corrupt_t=[float(s['t'][f]) for f in [40,41]]
    claimed=float(np.linalg.norm(np.array(points[1])-points[0])/(corrupt_t[1]-corrupt_t[0])*.025)
    c=candidate('world_speed_mps',claimed);c['states']['time']='invalid'
    c['source_provenance']['integrity']='claimed_unverified'
    c['observations']={'points':points,'times':corrupt_t,'m_per_px':.025}
    add_case(items,'repeated_pts_wrong_derived_speed',c,speed_truth(points,[1.6,1.64],.025),'repeated_pts')
    for verified in (False,True):
        c=candidate('world_speed_mps',2.)
        c['observations']={'points':pixels,'times':times,'calibration_file':{'m_per_px':.025,'verified':verified}}
        c['states']['calibration']='verified' if verified else 'unverified'
        pair='metric_scale_'+('declared_verified' if verified else 'unknown')
        for label,scale in [('correct',.025),('silently_wrong',.05)]:
            add_case(items,pair+'_'+label,c,speed_truth(pixels,times,scale),'silent_calibration_scale_error',pair)
    for status,mirrored in [('unverified',True),('verified',True),('verified',False)]:
        c=candidate('court_x_m',2.)
        c['observations']={'image_x_px':80.,'claimed_m_per_px':.025,'claimed_half_orientation':'normal'}
        c['states']['orientation']=status
        t={'predicate':'court_x','world':{'image_x_px':80.,'m_per_px':.025,'court_length_m':28.,'mirrored':mirrored}}
        add_case(items,'court_orientation_'+status+('_mirrored' if mirrored else '_correct'),c,t,'analytic_half_court_mirror')

    s=scenes['healthy_full_scene_camera_pan'];rawpt=FAULTS.foot(s['obs'][40,0]).tolist()
    smoothed=FAULTS.policy(s,'naive_repair')['out'][40,0].tolist()
    for label,value,layer in [('smoothing_claimed_as_raw',smoothed,'display_smoothing'),('raw_report_exact',rawpt,'raw')]:
        c=candidate('detector_reported_position',value,'source_report')
        c['source_provenance'].update(reported_value=rawpt,data_layer=layer)
        add_case(items,label,c,report_truth(rawpt),'healthy_full_scene_camera_pan')
    proposed=[450.,310.]
    c=candidate('direct_observation_status',True,'source_report')
    c['source_provenance'].update(evidence_kind='model_inferred_location',reported_value=False)
    add_case(items,'qwen_inference_mislabeled_observed',c,report_truth(False,False),'synthetic_model_proposal')
    c=candidate('model_proposed_position',proposed,'source_report')
    c['source_provenance'].update(evidence_kind='model_inferred_location',reported_value=proposed)
    add_case(items,'qwen_proposal_reported_as_proposal',c,report_truth(proposed,False),'synthetic_model_proposal')

    base=candidate('named_actor_position',pt)
    base['availability'].update(exact_available_at_source_seconds=5.,known_source_lower_bound_seconds=5.)
    for mode in ['causal_replay_as_of_source_time','offline_retrospective']:
        c=copy.deepcopy(base);c['timing']['usage_context']=mode
        add_case(items,'late_identity_evidence_'+mode,c,point_truth(pt),'analytic_delayed_anchor',actual_available=5.)
    c=copy.deepcopy(base)
    c['availability'].update(exact_available_at_source_seconds=None,known_source_lower_bound_seconds=1.6,
                             dependency_completeness='incomplete_full_clip_selection')
    add_case(items,'lower_bound_is_not_known_readiness',c,point_truth(pt),'analytic_incomplete_dependency',actual_available=5.)

    # Two individually valid source clocks do not establish cross-source ordering.
    c=candidate('event_before',True)
    c['observations']={'first':{'clock':'A','time':10.,'event':'accelerate'},
                       'second':{'clock':'B','time':10.2,'event':'catch'},'claimed_clock_offsets':{'A':0.,'B':0.}}
    c['timing'].update(as_of_seconds=20.,target_time_seconds=10.2)
    for label,offset in [('aligned',0.),('silent_offset',.5)]:
        t={'predicate':'event_order','world':{'first_time':10.,'second_time':10.2,'clock_A_offset':0.,'clock_B_offset':offset}}
        add_case(items,'cross_source_time_'+label,c,t,'analytic_cross_source_alignment','cross_source_time')
    c=candidate('independent_model_agreement',2,'source_report')
    c['source_provenance']['sources']=[{'variant':'team-stable','file_sha256':'same-bytes','correlation_group':'same-run'},
                                       {'variant':'optimized','file_sha256':'same-bytes','correlation_group':'same-run'}]
    c['source_provenance']['reported_value']=2
    t={'predicate':'independent_source_count','source_artifact':{'independent_generation_ids':['run-1','run-1']}}
    add_case(items,'copied_variants_are_not_two_independent_votes',c,t,'same_byte_snapshot_counterexample')
    return items


def true_value(truth,cand):
    p=truth['predicate'];w=truth.get('world',{});src=truth.get('source_artifact',{})
    if p=='actor_position':
        return w['actors'][cand['entity_scope']['actor']][str(cand['entity_scope']['target_frame'])]
    if p=='speed':
        return float(np.linalg.norm(np.array(w['points'][-1])-w['points'][0])/(w['times'][-1]-w['times'][0])*w['scale_m_per_px'])
    if p=='court_x':
        x=w['image_x_px']*w['m_per_px'];return w['court_length_m']-x if w['mirrored'] else x
    if p=='source_payload':return src['reported_value']
    if p=='pixel_derivation':
        return float(np.linalg.norm(np.array(src['points'][-1])-src['points'][0])/(src['times'][-1]-src['times'][0]))
    if p=='event_order':return (w['first_time']-w['clock_A_offset']) < (w['second_time']-w['clock_B_offset'])
    if p=='independent_source_count':return len(set(src['independent_generation_ids']))
    raise ValueError(p)


def equal_value(a,b):
    if isinstance(a,bool) or isinstance(b,bool):return type(a)==type(b) and a==b
    try:return bool(np.allclose(np.array(a,dtype=float),np.array(b,dtype=float),atol=1e-6,rtol=0))
    except (TypeError,ValueError):return a==b


def output(decision,reasons,cand):
    return {'decision':decision,'reason':reasons,'kind':cand['kind'],'value':cand['value'],
            'entity_scope':cand['entity_scope'],'category':cand['category'],
            'value_modified':False,'statement_generation_performed':False}


def gate(cand,method):
    if method=='confidence_only':
        score=cand.get('confidence',0)
        return output('certain' if score>=.8 else 'qualified' if score>=.5 else 'silent',
                      ['confidence_threshold_only'],cand)
    p=cand['source_provenance']
    if method=='provenance_only':
        if not p.get('chain_complete') or not p.get('source_ref'):
            return output('silent',['missing_provenance_chain'],cand)
        return output('certain' if p.get('integrity')=='verified' else 'qualified',
                      ['source_chain_integrity_is_not_world_truth'],cand)
    if method!='capability_dependencies':raise ValueError(method)
    reasons=[]
    if not p.get('chain_complete') or p.get('integrity')!='verified':reasons.append('source_chain_unverified')
    timing=cand['timing'];av=cand['availability']
    if timing['usage_context']=='causal_replay_as_of_source_time':
        bound=av.get('known_source_lower_bound_seconds')
        if bound is not None and bound>timing['as_of_seconds']:
            reasons.append('dependency_definitely_after_as_of')
        exact=av.get('exact_available_at_source_seconds')
        if av.get('dependency_completeness')!='complete' or exact is None:
            reasons.append('causal_readiness_unknown_lower_bound_insufficient')
        elif exact>timing['as_of_seconds']:reasons.append('exact_dependency_after_as_of')
    elif timing['usage_context']!='offline_retrospective':reasons.append('unknown_usage_context')
    if cand['category']=='world':
        for dep in DEPENDENCIES.get(cand['kind'],('unsupported_world_claim',)):
            if cand['states'].get(dep)!='verified':reasons.append(dep+'_not_verified')
        target=cand['entity_scope'].get('target_frame')
        interval=cand['entity_scope'].get('identity_interval')
        if 'identity' in DEPENDENCIES.get(cand['kind'],()) and interval is not None and not interval[0]<=target<=interval[1]:
            reasons.append('identity_anchor_does_not_cover_target_interval')
        if cand['kind']=='named_actor_position' and p.get('evidence_kind') in {'model_inferred_location','interpolated_location'}:
            reasons.append('inferred_location_not_independent_world_observation')
    elif cand['category']=='source_report':
        expected=p.get('reported_value')
        if cand['kind']=='independent_model_agreement':
            sources=p.get('sources',[])
            expected=len({s.get('correlation_group') or s.get('file_sha256') for s in sources})
        if not equal_value(cand['value'],expected):reasons.append('claim_not_equal_to_cited_source_payload')
        if cand['kind']=='detector_reported_position' and p.get('data_layer')!='raw':reasons.append('render_or_derived_value_cannot_be_raw_detector_report')
        if cand['kind']=='detector_reported_position' and p.get('evidence_kind')!='detector_observation':
            reasons.append('inferred_raw_bbox_is_not_detector_observation')
        if cand['kind']=='direct_observation_status' and cand['value'] is True and p.get('evidence_kind')!='detector_observation':
            reasons.append('inferred_or_interpolated_is_not_direct_observation')
    else:reasons.append('unsupported_claim_category')
    if reasons:return output('silent',sorted(set(reasons)),cand)
    if cand['category']=='source_report' and str(p.get('evidence_kind','')).startswith('model_inferred'):
        return output('qualified',['accurate_report_of_model_proposal_only_not_world_confirmation'],cand)
    return output('certain',['declared_dependencies_satisfied_not_a_truth_oracle'],cand)


def evaluate(items):
    rows=[]
    for item in items:
        c=item['candidate'];t=item['truth_context'];tv=true_value(t,c)
        value_true=equal_value(c['value'],tv)
        available=(c['timing']['usage_context']=='offline_retrospective' or
                   t['exact_available_at_source_seconds']<=c['timing']['as_of_seconds'])
        rows.append({'case_id':item['case_id'],'category':c['category'],'kind':c['kind'],
                     'analytic_true_value':tv,'candidate_value_true':value_true,
                     'causally_admissible_under_simulated_exact_schedule':available,
                     'equivalence_pair':item['equivalence_pair'],
                     'outputs':{m:gate(c,m) for m in ['confidence_only','provenance_only','capability_dependencies']}})
    return rows


def fraction(n,d):return None if d==0 else n/d


def summarize(rows):
    summaries=[]
    for cat in ['world','source_report']:
        subset=[r for r in rows if r['category']==cat]
        for method in ['confidence_only','provenance_only','capability_dependencies']:
            false=[r for r in subset if not r['candidate_value_true']]
            true=[r for r in subset if r['candidate_value_true']]
            admissible_true=[r for r in true if r['causally_admissible_under_simulated_exact_schedule']]
            spoken=[r for r in subset if r['outputs'][method]['decision']!='silent']
            false_certain=sum(r['outputs'][method]['decision']=='certain' for r in false)
            false_spoken=sum(r['outputs'][method]['decision']!='silent' for r in false)
            true_retained=sum(r['outputs'][method]['decision']!='silent' for r in true)
            valid_retained=sum(r['outputs'][method]['decision']!='silent' for r in admissible_true)
            unavailable=[r for r in subset if not r['causally_admissible_under_simulated_exact_schedule']]
            leaked=sum(r['outputs'][method]['decision']!='silent' for r in unavailable)
            summaries.append({'category':cat,'method':method,'candidate_count':len(subset),
                'false_value_candidates':len(false),'certain_false_value_admissions':false_certain,
                'certain_false_value_admission_rate':fraction(false_certain,len(false)),
                'any_speech_false_value_admissions':false_spoken,
                'any_speech_false_value_admission_rate':fraction(false_spoken,len(false)),
                'any_speech_false_value_share':fraction(false_spoken,len(spoken)),
                'true_value_candidates':len(true),'true_value_retained':true_retained,
                'true_value_retention_rate':fraction(true_retained,len(true)),
                'true_and_causally_admissible_candidates':len(admissible_true),
                'true_and_causally_admissible_retained':valid_retained,
                'true_and_causally_admissible_retention_rate':fraction(valid_retained,len(admissible_true)),
                'true_value_silenced':len(true)-true_retained,'spoken_count':len(spoken),
                'decisions':dict(Counter(r['outputs'][method]['decision'] for r in subset)),
                'simulated_unavailable_candidates':len(unavailable),'availability_leaks':leaked,
                'availability_leak_rate':fraction(leaked,len(unavailable)),
                'real_processing_latency_seconds':None,
                'automatic_value_revisions':0,'wrong_automatic_revisions':0,'automatic_misrepair_rate':None})
    return summaries


def revision_probe():
    selected={'isolated_geometry_spike','healthy_full_scene_camera_pan','three_frame_gap_hidden_curve','valid_cut_with_reused_ids'}
    rows=[]
    for scene in FAULTS.make_synthetic_cases():
        if scene['name'] not in selected:continue
        for method in ['naive_interpolate','naive_repair']:
            out=FAULTS.policy(scene,method)['out'];obs=scene['obs'];truth=scene['truth']
            revisions={k for k in out if k not in obs or np.linalg.norm(out[k]-FAULTS.foot(obs[k]))>1e-6}
            wrong={k for k in revisions if k in truth and np.linalg.norm(out[k]-FAULTS.foot(truth[k]))>1.}
            damaged={k for k in wrong if k in obs and np.linalg.norm(FAULTS.foot(obs[k])-FAULTS.foot(truth[k]))<=1.}
            rows.append({'scene':scene['name'],'method':method,'operation_denominator':len(revisions),
                         'operations_are':'changed existing coordinates or inserted missing coordinates, excluding unchanged/dropped rows',
                         'wrong_outputs_over_1px':len(wrong),'misrepair_rate':fraction(len(wrong),len(revisions)),
                         'previously_correct_positions_damaged':len(damaged),
                         'new_positions':len(set(out)-set(obs)),
                         'raw_positions_dropped':len(set(obs)-set(out))})
    return rows


def verify(items,rows):
    bypair={}
    for item in items:
        if item['equivalence_pair']:bypair.setdefault(item['equivalence_pair'],[]).append(item)
    pairs=[]
    for key,pair in bypair.items():
        values=[equal_value(x['candidate']['value'],true_value(x['truth_context'],x['candidate'])) for x in pair]
        pairs.append({'pair':key,'identical_complete_public_candidate':len({canonical(x['candidate']) for x in pair})==1,
                      'opposite_analytic_value_truth':set(values)=={False,True},
                      'public_candidate_sha256':digest(pair[0]['candidate'])})
    capability_errors=[r['case_id'] for r in rows if not r['candidate_value_true'] and r['outputs']['capability_dependencies']['decision']!='silent']
    checks={'equivalence_inputs_identical_and_truth_opposite':all(p['identical_complete_public_candidate'] and p['opposite_analytic_value_truth'] for p in pairs),
            'capability_gate_failure_visible_on_hidden_bad_verification':len(capability_errors)>0,
            'all_methods_preserve_candidate_values':all(not o['value_modified'] for r in rows for o in r['outputs'].values()),
            'qualified_false_values_count_as_spoken':all((o['decision']!='silent')==(o['decision'] in {'certain','qualified'}) for r in rows for o in r['outputs'].values()),
            'no_narrative_generated':all(not o['statement_generation_performed'] for r in rows for o in r['outputs'].values())}
    return {'all_passed':all(checks.values()),'checks':checks,'equivalence_pairs':pairs,
            'capability_gate_wrong_admissions_explicit':capability_errors}


def main():
    out=Path(__file__).parent;items=fixtures();rows=evaluate(items)
    manifest={'schema_version':'candidate-fact-gate/0.1','items':items,
              'label_origin':'analytic scene state and source artifact predicates; no real-model output is independent truth',
              'gate_input_boundary':'Only item.candidate is passed to gate; case_id,scene_ref,truth_context and pair labels are withheld.'}
    (out/'synthetic_candidates.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    results={'candidate_count':len(items),'summaries':summarize(rows),'cases':rows,'automatic_revision_comparator':revision_probe(),
             'validation':verify(items,rows),
             'limitations':['Designed challenge cases, not sampled prevalence; no general precision/recall claim.',
                            'Verified dependency states are claims consumed by the gate, not guaranteed truth.',
                            'An accurate source report does not recover withheld world information.',
                            'Synthetic exact readiness times are simulated; real latency remains unknown.',
                            'Gates do not edit values, so their automatic misrepair denominator is zero and rate null.'],
             'script_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    (out/'synthetic_results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf-8')
    print(json.dumps({'candidates':len(items),'summary':results['summaries'],'validation':results['validation']},ensure_ascii=False,indent=2))
    if not results['validation']['all_passed']:raise SystemExit(1)


if __name__=='__main__':main()
