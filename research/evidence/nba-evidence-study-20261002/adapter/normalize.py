"""Minimal offline normalization adapter. No production writes, network or inference.

Public API: normalize_source(repo, relative_path, json_pointer, context=None).
Context never authorizes truth promotion; unknowns require source evidence.
"""
import argparse
import copy
import hashlib
import importlib.util
import json
import math
import re
from pathlib import Path

from jsonschema import Draft202012Validator

HERE=Path(__file__).resolve().parent
WORK=HERE.parent
spec=importlib.util.spec_from_file_location('research_contract',WORK/'evidence/contract/contract_probe.py')
contract=importlib.util.module_from_spec(spec);spec.loader.exec_module(contract)
SCHEMA_VERSION='source-semantics-adapter-v1'
READS={}

def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def digest(value):return contract.digest(value)
def pointer(doc,path):return contract.pointer(doc,path)
def allowed_source_path(repo,path):
    relative=Path(path)
    if relative.is_absolute() or '..' in relative.parts or relative.suffix.lower()!='.json':raise ValueError('Only repository-relative research JSON paths are supported')
    file=(Path(repo)/path).resolve()
    if not file.is_relative_to(Path(repo).resolve()):raise ValueError('Source must remain inside read-only repository')
    canonical=relative.as_posix()
    allowed=(canonical.startswith('data/videos/tactics/acceptance/tracks/') or
        (canonical.startswith('artifacts/player-recovery/') and relative.name in ['recovered.json','qwen-events.json']) or
        canonical in ['research/vision/player-tracking-spotchecks-20261002.json','engineering/experiments/player_recovery/annotations.json'])
    if not allowed:raise ValueError('Source JSON is outside the explicit research adapter allowlist')
    return file

def load(repo,path):
    file=allowed_source_path(repo,path)
    READS.setdefault(str(file),sha(file))
    return json.loads(file.read_text(encoding='utf-8'))

def source_ref(repo,path,ptr,value):
    return {'relative_path':path,'file_sha256':sha(Path(repo)/path),'json_pointer':ptr,'payload_sha256':digest(value)}

def known(value,status='source_declared'):return {'value':value,'status':status}
def unknown():return known(None,'unknown')

def existing_contract_ref(repo,path,ptr,snapshot=None):
    file=WORK/'evidence/contract/source_grounded_examples.json'
    if not file.exists():return None,None,None
    doc=json.loads(file.read_text(encoding='utf-8')) if snapshot is None else snapshot
    # The legacy validator can read every source it is given. Constrain those
    # indirect reads before invoking it, including the explicitly used caches.
    try:
        for source in doc['sources'].values():
            relative=Path(source['path']);resolved=(Path(repo)/relative).resolve()
            if relative.is_absolute() or '..' in relative.parts or not resolved.is_relative_to(Path(repo).resolve()):return None,None,None
            canonical=relative.as_posix()
            if not (canonical.startswith('data/videos/tactics/acceptance/tracks/') and relative.suffix.lower()=='.json') and canonical not in [
                'data/videos/tactics/acceptance/review-library.json',
                'research/vision/vision-player-refinement/feet-candidates-005.json',
                'research/vision/vision-player-refinement/court-candidates-005.json']:return None,None,None
    except (KeyError,TypeError,ValueError):return None,None,None
    # Pinned source SHA alone cannot authenticate an edited normalized timeline.
    # Re-run the original semantic contract checker before trusting its bridge.
    validation=contract.validate(doc,Path(repo))
    if validation['errors'] or validation['blocked_facts'] or validation['stale_facts']:return None,None,None
    for sid,src in doc['sources'].items():
        if src['path']==path and src['sha256']==sha(Path(repo)/path):
            for obs in doc['observations']:
                primary=obs['provenance'][0]
                frame_match=re.match(r'^/(\d+)/(?:tracks|objects)/\d+$',ptr)
                if primary['source_id']==sid and primary['json_pointer']==ptr and frame_match and obs['time']['frame']==int(frame_match.group(1)):
                    return doc,obs,str(file)
    return None,None,None

def normalize_source(repo,relative_path,json_pointer,context=None):
    # Caller flags such as verified=True are deliberately ignored.
    repo=Path(repo);doc=load(repo,relative_path);raw=copy.deepcopy(pointer(doc,json_pointer))
    raw_before=digest(raw);parts=json_pointer.split('/');is_recovery=isinstance(doc,dict) and 'frames' in doc and 'model' in doc and isinstance(raw,dict) and 'track_id' in raw
    is_spotcheck=isinstance(doc,dict) and 'observations' in doc and 'method' in doc and json_pointer.startswith('/observations/')
    is_annotation=isinstance(doc,dict) and 'annotations' in doc and json_pointer.startswith('/annotations/')
    canonical_tracks=(relative_path.startswith('data/videos/tactics/acceptance/tracks/') and isinstance(doc,list))
    is_track_array=(canonical_tracks and bool(re.fullmatch(r'/\d+/tracks/\d+',json_pointer)) and isinstance(raw,list) and len(raw)==7
        and all(isinstance(v,(int,float)) and not isinstance(v,bool) and math.isfinite(v) for v in raw)
        and raw[6] in [2,3] and int(raw[4])==raw[4] and raw[4]>=0 and raw[2]>raw[0] and raw[3]>raw[1])
    is_object=(canonical_tracks and bool(re.fullmatch(r'/\d+/objects/\d+',json_pointer)) and isinstance(raw,dict)
        and raw.get('kind') in ['basketball','hoop'] and isinstance(raw.get('box'),list) and len(raw['box'])==4)
    frame=None;time=None;track_id=None;raw_box=None;render_box=None;kind='unknown_origin';review='unreviewed';role_label=None;role_ref=None;score=None;source_tag=None;source_observed=None
    basis='unknown';pts=None;timebase=None;original_annotation_method=None
    if is_recovery:
        fidx=int(parts[2]);frame=doc['frames'][fidx]['frame'];time=raw.get('time');track_id=raw['track_id'];source_tag=raw.get('source');source_observed=raw.get('observed')
        kind={'detector':'detector_observation','qwen':'model_inferred_location','interpolated':'interpolated_location','manual':'manual_annotation_claim'}.get(source_tag,'unknown_origin')
        review='source_claimed_human_unverified' if source_tag=='manual' else 'unreviewed'
        raw_box=raw.get('raw_bbox');render_box=raw.get('bbox');role_label=raw.get('person_role');role_ref=raw.get('role_reference_frame');score=raw.get('confidence')
        # Confirmed from this local implementation, never from round(time*fps).
        code=repo/'engineering/experiments/player_recovery/detect.py';READS.setdefault(str(code.resolve()),sha(code))
        basis='nominal_frame_index_over_fps'
        if abs(time-round(frame/doc['fps'],6))>1e-6:raise ValueError('Recovery row does not match recorded nominal frame-index/FPS time')
    elif is_track_array or is_object:
        frame=int(parts[1]);f=doc[frame];time=f['time'];basis='unknown'
        if 'source_frame_pts' in f:
            pts=f['source_frame_pts'];timebase=f['source_time_base'];basis='declared_container_pts_consistent' if abs(pts*timebase[0]/timebase[1]-time)<1e-6 else 'unknown'
        if is_track_array:raw_box=raw[:4];render_box=raw[:4];track_id=raw[4];score=raw[5];kind='detector_observation';source_tag='track_array'
        else:raw_box=raw['box'];render_box=raw['box'];score=raw['score'];kind='detector_observation';source_tag=raw.get('source')
    elif is_spotcheck:
        frame=raw['frame'];track_id=raw.get('baselineTrackId');raw_box=raw.get('box');render_box=raw.get('box');kind='manual_annotation_claim';review='source_claimed_human_unverified';source_tag='source_claimed_human';original_annotation_method=doc['method']
    elif is_annotation:
        parent=doc['annotations'][int(parts[2])];frame=parent['frame'];raw_box=raw.get('bbox');render_box=raw.get('bbox');kind='agent_annotation_claim';review='agent_drawn_unverified';source_tag='agent_annotation';original_annotation_method=doc.get('review_method')
    else:raise ValueError('Only canonical track/object rows, recovery track rows, and explicit annotation rows are supported')
    cdoc,cobs,cpath=existing_contract_ref(repo,relative_path,json_pointer)
    namespace=known('artifact:'+sha(repo/relative_path),'artifact_scoped_only') if track_id is not None and not is_spotcheck else unknown()
    version=unknown();contract_bridge={'contract_version':contract.VERSION,'status':'not_representable_without_additional_context','observation_id':None,'artifact_relative_path':None}
    if cobs:
        namespace=known(cobs['variant_id'],'contract_variant') if track_id is not None else unknown()
        timing=cobs['time'];pts=timing['pts_ticks'];timebase=timing['time_base'];basis='verified_container_pts_seconds'
        variant=cdoc['variants'][cobs['variant_id']];metadata=load(repo,cdoc['sources'][variant['meta_source']]['path'])
        version=known(metadata['pipeline_version']) if metadata.get('pipeline_version') else unknown()
        contract_bridge={'contract_version':contract.VERSION,'status':'existing_source_grounded_observation','observation_id':cobs['id'],'artifact_relative_path':'evidence/contract/source_grounded_examples.json'}
    def floor(f,basis_text):
        seconds=None
        if f is not None:
            if is_recovery and 0<=f<len(doc['frames']):seconds=doc['frames'][f]['time']
            elif f==frame:seconds=time
        return {'frame':f,'time_seconds':seconds,'time_basis':basis,'basis':basis_text}
    dependencies=[];raw_floor=frame;role_floor=max(frame,role_ref) if frame is not None and isinstance(role_ref,int) else frame
    if is_recovery:
        index={(f['frame'],r['track_id']):(fi,ri,r) for fi,f in enumerate(doc['frames']) for ri,r in enumerate(f['tracks'])}
        event_path=str(Path(relative_path).with_name('qwen-events.json')).replace('\\','/')
        events=load(repo,event_path) if (repo/event_path).exists() else []
        eventmap={(e.get('frame'),e.get('track_id')):(i,e) for i,e in enumerate(events)}
        seen=set()
        def combined_floor(key):
            if key in seen:return key[0]
            seen.add(key);values=[key[0]]
            if key not in index:return max(values)
            fi,ri,row=index[key]
            dependencies.append(source_ref(repo,relative_path,f'/frames/{fi}/tracks/{ri}',row))
            if isinstance(row.get('role_reference_frame'),int):values.append(row['role_reference_frame'])
            for af in row.get('anchors',[]):
                if isinstance(af,int):values.append(combined_floor((af,key[1])))
            if row.get('source')=='qwen' and key in eventmap:
                ei,event=eventmap[key];dependencies.append(source_ref(repo,event_path,f'/{ei}',event))
                for name in ['left_anchor','right_anchor']:
                    af=event.get('gap',{}).get(name,{}).get('frame')
                    if isinstance(af,int):values.append(combined_floor((af,key[1])))
            return max(values)
        if kind in ['model_inferred_location','interpolated_location']:raw_floor=combined_floor((frame,track_id))
    composite=max(x for x in [raw_floor,role_floor] if x is not None) if any(x is not None for x in [raw_floor,role_floor]) else None
    smoothed=bool(raw.get('smoothed')) if isinstance(raw,dict) else False
    geometry={'coordinate_space':'image_pixels','raw_bbox':raw_box,'render_bbox':render_box,
        'raw_bbox_status':'source_preserved' if raw_box is not None else 'missing',
        'raw_bbox_meaning':{'detector_observation':'detector_candidate_before_display_transform','model_inferred_location':'model_estimate_before_display_transform','interpolated_location':'interpolation_before_display_transform','manual_annotation_claim':'source_claimed_annotation','agent_annotation_claim':'source_claimed_annotation'}.get(kind,'unknown'),
        'render_transform':'offline_smoothing_or_clipping' if smoothed else ('same_as_source_not_ui_render' if raw_box==render_box else 'unknown'),
        'ground_contact':'unknown','metric_accuracy':'unvalidated'}
    availability={'available_at_source_lower_bound':floor(composite,'known_dependencies_only_not_actual_availability'),
        'components':{'raw_location':floor(raw_floor,'source_frame_or_known_inference_anchors'),
                      'role':floor(role_floor,'role_reference_frame_lower_bound'),
                      'display':floor(raw_floor,'smoothing_future_window_incomplete' if smoothed else 'source_geometry_only')},
        'wall_clock_available_at':None,'wall_clock_status':'unknown','dependency_completeness':'partial',
        'selection_horizon':'full_clip_or_track' if is_recovery else 'unknown',
        'realtime_eligible':False,'realtime_reason':'source_time_floor_is_not_processing_completion_or_publication_time'}
    record={'schema_version':SCHEMA_VERSION,'id':digest([relative_path,json_pointer,raw_before]),
      'source':source_ref(repo,relative_path,json_pointer,raw),'raw_payload':raw,
      'evidence_correlation_group':digest([sha(repo/relative_path),json_pointer]),
      'evidence':{'kind':kind,'source_tag':source_tag,'source_observed_flag':source_observed,'review_status':review,
                  'score':score,'score_semantics':'model_self_reported_uncalibrated' if kind=='model_inferred_location' else 'uncalibrated_not_probability','annotation_method_claim':original_annotation_method},
      'geometry':geometry,'association':{'local_track_id':track_id,'namespace':namespace,'variant_version':version,
                  'person_identity':None,'identity_verified':False},
      'timing':{'source_frame':frame,'raw_time_seconds':time,'time_basis':basis,'pts_ticks':pts,'time_base':timebase,
                'elapsed_seconds':None,'elapsed_time_origin':'unknown'},
      'availability':availability,'role':{'label':role_label,'reference_frame':role_ref,'inferred':role_label is not None,
                  'future_reference':isinstance(role_ref,int) and frame is not None and role_ref>frame},
      'court':{'half_orientation':'unknown','attack_direction':'unknown','camera_state':'unknown','metric_position':None},
      'dependencies':dependencies,'contract_bridge':contract_bridge}
    assert digest(raw)==raw_before
    return record

def schema():
    O=contract.obj;A=contract.arr;E=contract.enum;N=contract.N;S=contract.S;B=contract.B;I=contract.I;Z=contract.NULL;nullable=contract.nullable
    reference=O({'relative_path':S,'file_sha256':contract.H,'json_pointer':S,'payload_sha256':contract.H})
    status=O({'value':nullable(S),'status':E('unknown','source_declared','artifact_scoped_only','contract_variant')})
    sourcefloor=O({'frame':nullable(I),'time_seconds':nullable(N),'time_basis':S,'basis':S})
    d=O({'schema_version':E(SCHEMA_VERSION),'id':contract.H,'source':reference,'raw_payload':{'type':['object','array']},'evidence_correlation_group':contract.H,
      'evidence':O({'kind':E('unknown_origin','detector_observation','model_inferred_location','interpolated_location','manual_annotation_claim','agent_annotation_claim'),
       'source_tag':nullable(S),'source_observed_flag':nullable(B),'review_status':E('unreviewed','source_claimed_human_unverified','agent_drawn_unverified'),
       'score':nullable(N),'score_semantics':E('model_self_reported_uncalibrated','uncalibrated_not_probability'),'annotation_method_claim':nullable(S)}),
      'geometry':O({'coordinate_space':E('image_pixels'),'raw_bbox':nullable(A(N,4)),'render_bbox':nullable(A(N,4)),
         'raw_bbox_status':E('missing','source_preserved'),'raw_bbox_meaning':S,'render_transform':S,'ground_contact':E('unknown'),'metric_accuracy':E('unvalidated')}),
      'association':O({'local_track_id':nullable(I),'namespace':status,'variant_version':status,'person_identity':Z,'identity_verified':E(False)}),
      'timing':O({'source_frame':nullable(I),'raw_time_seconds':nullable(N),'time_basis':E('unknown','nominal_frame_index_over_fps','declared_container_pts_consistent','verified_container_pts_seconds'),
          'pts_ticks':nullable({'type':'integer'}),'time_base':nullable(A({'type':'integer'},2)),'elapsed_seconds':Z,'elapsed_time_origin':E('unknown')}),
      'availability':O({'available_at_source_lower_bound':sourcefloor,'components':O({'raw_location':sourcefloor,'role':sourcefloor,'display':sourcefloor}),
          'wall_clock_available_at':Z,'wall_clock_status':E('unknown'),'dependency_completeness':E('partial'),
          'selection_horizon':E('full_clip_or_track','unknown'),'realtime_eligible':E(False),'realtime_reason':S}),
      'role':O({'label':nullable(S),'reference_frame':nullable(I),'inferred':B,'future_reference':B}),
      'court':O({'half_orientation':E('unknown'),'attack_direction':E('unknown'),'camera_state':E('unknown'),'metric_position':Z}),
      'dependencies':A(reference),'contract_bridge':O({'contract_version':S,'status':E('not_representable_without_additional_context','existing_source_grounded_observation'),
       'observation_id':nullable(S),'artifact_relative_path':nullable(S)})})
    d['$schema']='https://json-schema.org/draft/2020-12/schema';return d

def validate_record(record,repo):
    errors=[{'code':'SCHEMA','detail':e.message} for e in Draft202012Validator(schema()).iter_errors(record)]
    if errors:return {'valid':False,'errors':errors}
    try:
        s=record['source'];path=allowed_source_path(repo,s['relative_path']);value=pointer(load(repo,s['relative_path']),s['json_pointer'])
        if sha(path)!=s['file_sha256']:errors.append({'code':'SOURCE_FILE_CHANGED'})
        if digest(value)!=s['payload_sha256'] or record['raw_payload']!=value:errors.append({'code':'RAW_PAYLOAD_CHANGED'})
        expected=normalize_source(repo,s['relative_path'],s['json_pointer'])
        for field,code in [('evidence','EVIDENCE_KIND_PROMOTION'),('geometry','RAW_DISPLAY_GEOMETRY_MISMATCH'),('association','UNSUPPORTED_NAMESPACE_OR_VERSION'),
             ('timing','TIME_BASIS_MISMATCH'),('availability','AVAILABILITY_DEPENDENCY_MISMATCH'),('role','ROLE_DEPENDENCY_MISMATCH'),
             ('court','UNSUPPORTED_COURT_ORIENTATION'),('dependencies','DEPENDENCY_MISMATCH'),('contract_bridge','CONTRACT_BRIDGE_MISMATCH')]:
            if record[field]!=expected[field]:errors.append({'code':code})
        if record['id']!=expected['id']:errors.append({'code':'RECORD_ID_MISMATCH'})
        if record['evidence_correlation_group']!=expected['evidence_correlation_group']:errors.append({'code':'EVIDENCE_CORRELATION_MISMATCH'})
    except (OSError,ValueError,KeyError,IndexError,TypeError) as error:errors.append({'code':'SOURCE_RESOLUTION_ERROR','detail':str(error)})
    return {'valid':not errors,'errors':errors}

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--repo',type=Path,required=True);args=ap.parse_args();repo=args.repo
    paths=[('track_detector','data/videos/tactics/acceptance/tracks/005-ebard.json','/2/tracks/1'),
      ('ball_detector','data/videos/tactics/acceptance/tracks/005-ebard.json','/2/objects/1'),
      ('qwen_observed_true','artifacts/player-recovery/batch-v3/s24-007/recovered.json','/frames/78/tracks/6'),
      ('interpolated','artifacts/player-recovery/batch-v3/s24-007/recovered.json','/frames/44/tracks/6'),
      ('smoothed_detector','artifacts/player-recovery/batch-v3/s24-007/recovered.json','/frames/0/tracks/0'),
      ('manual_claim_21','research/vision/player-tracking-spotchecks-20261002.json','/observations/0'),
      ('agent_annotation_56','engineering/experiments/player_recovery/annotations.json','/annotations/0/players/0')]
    paths.extend([('same_content_team_stable','data/videos/tactics/acceptance/tracks/basketball-20261002/005-team-stable.json','/0/tracks/0'),
        ('same_content_optimized','data/videos/tactics/acceptance/tracks/basketball-20261002/005-team-stable.json','/0/tracks/0')])
    rolepath='artifacts/player-recovery/batch-v3/s24-033/recovered.json';doc=load(repo,rolepath)
    ri=next(i for i,row in enumerate(doc['frames'][0]['tracks']) if row['track_id']==9)
    paths.append(('future_role',rolepath,f'/frames/0/tracks/{ri}'))
    records=[];ids={}
    for label,path,ptr in paths:
        record=normalize_source(repo,path,ptr);ids[label]=record['id'];records.append(record)
        assert validate_record(record,repo)['valid'],label
    examples={'schema_version':SCHEMA_VERSION,'example_ids':ids,'records':records}
    tests=[];counterexamples=[]
    def case(name,label,mutation,expected):
        rec=copy.deepcopy(next(r for r in records if r['id']==ids[label]));mutation(rec);result=validate_record(rec,repo)
        tests.append({'name':name,'passed':expected in [e['code'] for e in result['errors']],'expected_code':expected,
          'schema_valid':not any(Draft202012Validator(schema()).iter_errors(rec)),'result':result});counterexamples.append({'name':name,'record':rec})
    case('observed_true_qwen_is_not_detection','qwen_observed_true',lambda r:r['evidence'].update(kind='detector_observation'),'EVIDENCE_KIND_PROMOTION')
    case('raw_bbox_replaced_by_render','smoothed_detector',lambda r:r['geometry'].update(raw_bbox=r['geometry']['render_bbox']),'RAW_DISPLAY_GEOMETRY_MISMATCH')
    case('raw_bbox_lost','smoothed_detector',lambda r:r['geometry'].update(raw_bbox=None,raw_bbox_status='missing'),'RAW_DISPLAY_GEOMETRY_MISMATCH')
    case('invented_pipeline_version','qwen_observed_true',lambda r:r['association'].update(variant_version=known('production-v1')),'UNSUPPORTED_NAMESPACE_OR_VERSION')
    case('nominal_time_as_pts','qwen_observed_true',lambda r:r['timing'].update(time_basis='verified_container_pts_seconds',pts_ticks=78,time_base=[1,25]),'TIME_BASIS_MISMATCH')
    def past_role(r):
        r['availability']['available_at_source_lower_bound']['frame']=0;r['availability']['available_at_source_lower_bound']['time_seconds']=0
    case('future_role_hidden','future_role',past_role,'AVAILABILITY_DEPENDENCY_MISMATCH')
    case('future_role_pollutes_raw_location','future_role',lambda r:r['availability']['components'].update(raw_location=r['availability']['components']['role']),'AVAILABILITY_DEPENDENCY_MISMATCH')
    case('unknown_half_invented','track_detector',lambda r:r['court'].update(half_orientation='right'),'SCHEMA')
    case('manual_claim_as_truth','manual_claim_21',lambda r:r['association'].update(identity_verified=True),'SCHEMA')
    case('interpolation_as_detection','interpolated',lambda r:r['evidence'].update(kind='detector_observation'),'EVIDENCE_KIND_PROMOTION')
    case('raw_payload_overwrite','qwen_observed_true',lambda r:r['raw_payload'].update(observed=False),'RAW_PAYLOAD_CHANGED')
    case('source_lower_bound_as_wallclock','qwen_observed_true',lambda r:r['availability'].update(wall_clock_available_at='2026-10-02T00:00:05Z'),'SCHEMA')
    case('duplicate_variant_as_independent_vote','same_content_optimized',lambda r:r.update(evidence_correlation_group='0'*64),'EVIDENCE_CORRELATION_MISMATCH')
    def raw_rehash(r):
        r['raw_payload']['observed']=False;r['source']['payload_sha256']=digest(r['raw_payload'])
    case('raw_payload_rehash_cannot_forge_source','qwen_observed_true',raw_rehash,'RAW_PAYLOAD_CHANGED')
    path_tests=[]
    for invalid_path in ['../outside.json','engineering/experiments/player_recovery/not-supported.json','.env']:
        try:normalize_source(repo,invalid_path,'');passed=False
        except ValueError:passed=True
        path_tests.append({'input':invalid_path,'rejected':passed})
    context_record=normalize_source(repo,'research/vision/player-tracking-spotchecks-20261002.json','/observations/0',{'verified':True,'human_reviewed':True})
    context_ignored=not context_record['association']['identity_verified'] and context_record['evidence']['review_status']=='source_claimed_human_unverified'
    copies=[next(r for r in records if r['id']==ids[label]) for label in ['same_content_team_stable','same_content_optimized']]
    correlation={'same_content_sha':copies[0]['source']['file_sha256']==copies[1]['source']['file_sha256'],
        'same_evidence_correlation_group':copies[0]['evidence_correlation_group']==copies[1]['evidence_correlation_group'],
        'deduplicated_support_count':len({r['evidence_correlation_group'] for r in copies}),
        'independence_status':'not_established_even_when_content_hashes_differ'}
    tampered_contract=json.loads((WORK/'evidence/contract/source_grounded_examples.json').read_text(encoding='utf-8'))
    target=next(o for o in tampered_contract['observations'] if o['id']=='005:ebard:f2:tracks:1')
    target['time']['pts_seconds']=123;contract.versioned(target)
    bridge_rejected=existing_contract_ref(repo,'data/videos/tactics/acceptance/tracks/005-ebard.json','/2/tracks/1',snapshot=tampered_contract)==(None,None,None)
    (HERE/'bridge-tamper-example.json').write_text(json.dumps(tampered_contract,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    alias_contract=json.loads((WORK/'evidence/contract/source_grounded_examples.json').read_text(encoding='utf-8'))
    false_target=next(o for o in alias_contract['observations'] if o['id']=='005:ebard:f0:tracks:0')
    true_target=next(o for o in alias_contract['observations'] if o['id']=='005:ebard:f2:tracks:1')
    false_target['provenance'].append(copy.deepcopy(true_target['provenance'][0]));contract.versioned(false_target)
    for fact in alias_contract['facts']:
        for dependency in fact['dependencies']:
            if dependency['id']==false_target['id']:dependency['version']=false_target['version']
        contract.versioned(fact)
    _,resolved_alias,_=existing_contract_ref(repo,'data/videos/tactics/acceptance/tracks/005-ebard.json','/2/tracks/1',snapshot=alias_contract)
    alias_rejected=resolved_alias is not None and resolved_alias['id']==true_target['id']
    indirect_contract=copy.deepcopy(alias_contract)
    indirect_contract['sources']['forbidden_indirect_source']={'path':str(HERE/'real-examples.json'),'sha256':'0'*64,'format_version':'test','kind':'tracks'}
    indirect_rejected=existing_contract_ref(repo,'data/videos/tactics/acceptance/tracks/005-ebard.json','/2/tracks/1',snapshot=indirect_contract)==(None,None,None)
    unchanged=all(sha(Path(p))==h for p,h in READS.items())
    audit_dir=WORK/'recovery-provenance'
    audit_examples=json.loads((audit_dir/'adapter-examples.json').read_text(encoding='utf-8'))
    manifest=json.loads((audit_dir/'input-manifest.json').read_text(encoding='utf-8'))
    audited={str((repo/item['path']).resolve()):item['sha256'] for item in manifest}
    aligned_hashes=all(READS[p]==audited[p] for p in READS if p in audited)
    qwen=next(r for r in records if r['id']==ids['qwen_observed_true'])
    audit_alignment={'audit_files':[{'relative_workspace_path':'recovery-provenance/'+name,'sha256':sha(audit_dir/name)} for name in ['adapter-examples.json','audit.json','input-manifest.json']],
        'overlapping_source_hashes_match':aligned_hashes,
        'qwen_raw_bbox_matches_audit':qwen['geometry']['raw_bbox']==audit_examples['qwen_inference']['geometry']['bbox'],
        'qwen_known_source_floor_matches_audit':qwen['availability']['available_at_source_lower_bound']['frame']==audit_examples['qwen_inference']['known_source_frame_floor']}
    report={'passed':sum(t['passed'] for t in tests),'total':len(tests),'tests':tests,'source_files_unchanged':unchanged,
        'path_rejection_tests':path_tests,'context_truth_flags_ignored':context_ignored,'duplicate_variant_correlation':correlation,
        'contract_bridge_timing_tamper_rejected':bridge_rejected,
        'contract_bridge_secondary_provenance_alias_rejected':alias_rejected,
        'contract_bridge_indirect_path_rejected':indirect_rejected,
        'audit_alignment':audit_alignment,
        'input_manifest':[{'path':p,'sha256_before':h,'sha256_after':sha(Path(p))} for p,h in sorted(READS.items())],
        'contract_validation':'Existing contract imported read-only; two canonical track/object records map to exact contract observation IDs.',
        'limitations':['No production adapter integration.','No wall-clock availability is reconstructed.','Known source-time floors omit complete smoothing/batch selection dependencies.',
             'raw_bbox for qwen/interpolated means pre-display estimate, never detector measurement.','Source-declared human review is unverified; AI references kept separate.']}
    for name,data in [('observation.schema.json',schema()),('real-examples.json',examples),('validation-results.json',report),('counterexamples.json',counterexamples)]:
        (HERE/name).write_text(json.dumps(data,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf-8')
    print(json.dumps({'passed':report['passed'],'total':report['total'],'records':len(records),'source_files_unchanged':unchanged,
       'qwen_floor':next(r for r in records if r['id']==ids['qwen_observed_true'])['availability']['available_at_source_lower_bound'],
       'future_role_components':next(r for r in records if r['id']==ids['future_role'])['availability']['components']},ensure_ascii=False,indent=2))
    assert report['passed']==report['total'] and unchanged and all(t['rejected'] for t in path_tests) and context_ignored and correlation['deduplicated_support_count']==1 and bridge_rejected
    assert aligned_hashes and audit_alignment['qwen_raw_bbox_matches_audit'] and audit_alignment['qwen_known_source_floor_matches_audit']
    assert alias_rejected and indirect_rejected

if __name__=='__main__':main()
