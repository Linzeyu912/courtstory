"""Offline research contract. Never imports or writes production code.

Run: python -X utf8 contract_probe.py --repo {repo}
Requires existing local av, numpy, jsonschema. No network or inference.
"""
from __future__ import annotations
import argparse, copy, hashlib, json, math
from pathlib import Path
import av
import numpy as np
from jsonschema import Draft202012Validator

VERSION = 'evidence-contract-research-v1'
ROOT = Path(__file__).resolve().parent

def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
        separators=(',', ':'), allow_nan=False).encode()).hexdigest()

def file_sha(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1024*1024), b''): h.update(block)
    return h.hexdigest()

def pointer(doc, path):
    for token in path.split('/')[1:]:
        token = token.replace('~1','/').replace('~0','~')
        doc = doc[int(token)] if isinstance(doc, list) else doc[token]
    return doc

def obj(props, required=None):
    return {'type':'object','properties':props,'required':list(props) if required is None else required,
            'additionalProperties':False}

def arr(items, n=None):
    d={'type':'array','items':items}
    if n is not None: d.update(minItems=n,maxItems=n)
    return d

def enum(*values): return {'enum':list(values)}
S={'type':'string'}; N={'type':'number'}; I={'type':'integer','minimum':0}; B={'type':'boolean'}
H={'type':'string','pattern':'^[a-f0-9]{64}$'}
NULL={'type':'null'}
def nullable(v): return {'anyOf':[v,NULL]}
def ref(name): return {'$ref':'#/$defs/'+name}

def schema():
    defs={
      'source_ref':obj({'source_id':S,'json_pointer':{'type':'string','pattern':'^(/|$)'},'value_sha256':H}),
      'track':obj({'variant_id':S,'local_id':I}),
      'scope':obj({'variant_id':S,'start_frame':I,'end_frame_inclusive':I,'cut_version':S}),
      'dependency':obj({'kind':enum('observation','binding','calibration','cuts','fact'),'id':S,'version':S}),
      'score':obj({'value':N,'semantics':enum('uncalibrated_model_score'),'probability':NULL}),
      'geometry':obj({'space':enum('image_px','court_m_candidate'),'xyxy':nullable(arr(N,4)),
          'xy':nullable(arr(N,2)),'ground_contact':enum('unknown','reviewed_contact'),
          'metric_accuracy':enum('not_applicable','unvalidated','validated')}),
      'time':obj({'frame':I,'raw_time_seconds':N,'raw_time_basis':enum('verified_container_pts_seconds'),
          'pts_ticks':{'type':'integer'},'time_base':arr({'type':'integer'},2),
          'pts_seconds':N,'local_elapsed_seconds':N,'shot_segment':S,'shot_segmentation':enum('declared_boundaries_only_unreviewed')}),
      'source':obj({'path':S,'sha256':H,'format_version':S,'kind':enum('tracks','metadata','feet','court','library')}),
      'variant':obj({'clip_id':S,'video_path':S,'video_sha256':H,'tracks_source':S,'meta_source':S,
          'width':I,'height':I,'frame_count':I,'timeline':arr(ref('time')),'cut_version':S,
          'cut_frames':arr(I),'cut_review_status':enum('unknown'),'objects_channel':enum('available','not_provided')}),
      'observation':obj({'id':S,'version':H,'variant_id':S,'time':ref('time'),
          'track':nullable(ref('track')),'kind':enum('detection_observation','pose_landmark_candidate'),
          'class':enum('player','referee','ball','hoop'),'raw_class':{'type':['string','integer']},
          'geometry':ref('geometry'),'score':ref('score'),'visibility':enum('detected'),
          'occlusion':enum('unknown'),'provenance':arr(ref('source_ref'))}),
      'binding':obj({'id':S,'version':H,'scope':ref('scope'),'track':ref('track'),
          'p_slot':{'type':'string','pattern':'^P([1-9]|10)$'},
          'status':enum('model_candidate','human_reviewed'),
          'nba_identity':nullable(obj({'namespace':S,'player_id':S,'name':S,'season':S})),
          'review_evidence':arr(ref('source_ref')),'provenance':arr(ref('source_ref'))}),
      'calibration':obj({'id':S,'version':H,'scope':ref('scope'),'frame':I,'reference_frame':I,
          'court_to_image':arr(N,9),'status':enum('candidate','human_reviewed'),
          'metric_accuracy_validated':B,'tracking_fingerprint':H,'provenance':arr(ref('source_ref'))}),
      'fact':obj({'id':S,'version':H,'kind':enum('track_image_displacement','slot_image_position',
          'court_projection_hypothesis','ball_near_player','possession','pass','shot'),
          'scope':ref('scope'),'epistemic_status':enum('derived_candidate','reviewed_fact'),
          'dependencies':arr(ref('dependency')),'geometry':nullable(ref('geometry')),
          'values':{'type':'object'},'review_evidence':arr(ref('source_ref')),'limitations':arr(S)}),
      'revision':obj({'sequence':I,'prev_sha256':nullable(H),'sha256':H,'target_kind':enum('binding','calibration','cuts'),
          'target_id':S,'old_version':S,'new_version':S,'replacement':{'type':'object'},
          'reason':S,'actor':S,'mode':enum('controlled_test_only')}),
    }
    for name in ['observation','binding','calibration']:
        defs[name]['properties']['provenance']['minItems']=1
    defs['fact']['allOf']=[]
    values_by_kind={
      'track_image_displacement':obj({'delta_image_px':arr(N,2),'dt_seconds':{'type':'number','exclusiveMinimum':0}}),
      'slot_image_position':obj({'p_slot':{'type':'string','pattern':'^P([1-9]|10)$'},'nba_identity':NULL}),
      'court_projection_hypothesis':obj({'plane_assumption':enum('hypothetical ground plane')}),
      'ball_near_player':obj({'center_to_player_bbox_distance_px':{'type':'number','minimum':0},
           'threshold_px':enum(40),'method':enum('2d_ball_center_to_bbox_v1')})}
    for kind,value_schema in values_by_kind.items():
        defs['fact']['allOf'].append({'if':{'properties':{'kind':{'const':kind}}},'then':{'properties':{'values':value_schema}}})
    top=obj({'contract_version':enum(VERSION),'research_only':enum(True),'sources':{'type':'object','additionalProperties':ref('source')},
      'variants':{'type':'object','additionalProperties':ref('variant')},'observations':arr(ref('observation')),
      'bindings':arr(ref('binding')),'calibrations':arr(ref('calibration')),'facts':arr(ref('fact')),
      'revisions':arr(ref('revision')),'availability':arr(obj({'variant_id':S,'frame':I,
          'ball':enum('detected','not_detected_reason_unknown','not_provided'),
          'person_identity':enum('unverified'),'court':enum('candidate_only','not_provided'),
          'occlusion':enum('unknown')}))})
    top.update({'$schema':'https://json-schema.org/draft/2020-12/schema','$id':'urn:offline:research:evidence-contract:v1','$defs':defs})
    return top

def versioned(rec):
    rec['version']=digest({k:v for k,v in rec.items() if k!='version'});return rec

def build(repo):
    contract={'contract_version':VERSION,'research_only':True,'sources':{},'variants':{},
              'observations':[],'bindings':[],'calibrations':[],'facts':[],'revisions':[],'availability':[]}
    documents={}
    def source(key,path,kind):
        p=repo/path; value=json.loads(p.read_text(encoding='utf-8')); documents[key]=value
        contract['sources'][key]={'path':path,'sha256':file_sha(p),'format_version':str(value.get('schemaVersion',value.get('version','legacy-array-v1'))) if isinstance(value,dict) else 'legacy-array-v1','kind':kind}
        return value
    def ev(key,path): return {'source_id':key,'json_pointer':path,'value_sha256':digest(pointer(documents[key],path))}
    library=source('library','data/videos/tactics/acceptance/review-library.json','library')
    samples={s['id']:s for s in library['samples']}
    specifications=[('005:ebard','005','data/videos/tactics/acceptance/tracks/005-ebard.json'),
       ('005:team-stable','005','data/videos/tactics/acceptance/tracks/basketball-20261002/005-team-stable.json'),
       ('nba-lal-min-005:team-stable','nba-lal-min-005','data/videos/tactics/acceptance/tracks/basketball-20261002/nba-lal-min-005-team-stable.json')]
    decoded={}
    for vid,clip,path in specifications:
        ts=vid+':tracks'; ms=vid+':meta'; records=source(ts,path,'tracks'); meta=source(ms,path.replace('.json','.meta.json'),'metadata')
        sample=samples[clip]
        if clip not in decoded:
            frames=[]
            with av.open(str(repo/sample['video'])) as container:
                for i,frame in enumerate(container.decode(video=0)):
                    frames.append({'frame':i,'pts_ticks':frame.pts,'time_base':[frame.time_base.numerator,frame.time_base.denominator], 'pts_seconds':float(frame.pts*frame.time_base)})
            decoded[clip]=(frames,file_sha(repo/sample['video']))
        frames,sha=decoded[clip]
        assert meta['video_sha256']==sha and len(records)==len(frames)
        cuts=sample.get('sourceCuts',[]);cutversion=digest(cuts)
        timeline=[]
        for frame,raw in zip(frames,records):
            assert raw['frame']==frame['frame'] and abs(raw['time']-frame['pts_seconds'])<1e-6
            if 'source_frame_pts' in raw:
                assert raw['source_frame_pts']==frame['pts_ticks'] and raw['source_time_base']==frame['time_base']
            timeline.append({**frame,'raw_time_seconds':raw['time'],'raw_time_basis':'verified_container_pts_seconds',
                'local_elapsed_seconds':frame['pts_seconds']-frames[0]['pts_seconds'],
                'shot_segment':f'{clip}:segment:'+str(sum(c<=frame['frame'] for c in cuts)),
                'shot_segmentation':'declared_boundaries_only_unreviewed'})
        contract['variants'][vid]={'clip_id':clip,'video_path':sample['video'],'video_sha256':sha,'tracks_source':ts,'meta_source':ms,
            'width':meta['width'],'height':meta['height'],'frame_count':len(records),'timeline':timeline,'cut_version':cutversion,
            'cut_frames':cuts,'cut_review_status':'unknown','objects_channel':'available' if all('objects' in f for f in records) else 'not_provided'}
    def scope(vid,start,end=None): return {'variant_id':vid,'start_frame':start,'end_frame_inclusive':start if end is None else end,'cut_version':contract['variants'][vid]['cut_version']}
    def geom(box=None,xy=None,space='image_px'):
        return {'space':space,'xyxy':box,'xy':xy,'ground_contact':'unknown','metric_accuracy':'unvalidated' if space=='court_m_candidate' else 'not_applicable'}
    def obs(vid,frame,index,field='tracks'):
        key=vid+':tracks';raw=documents[key][frame][field][index]
        if field=='tracks':
            box=raw[:4];score=raw[5];rawclass=raw[6];cl={2:'player',3:'referee'}[rawclass];track={'variant_id':vid,'local_id':int(raw[4])}
        else:
            box=raw['box'];score=raw['score'];rawclass=raw['kind'];cl={'basketball':'ball','hoop':'hoop'}[rawclass];track=None
        rec=versioned({'id':f'{vid}:f{frame}:{field}:{index}','variant_id':vid,'time':contract['variants'][vid]['timeline'][frame],
          'track':track,'kind':'detection_observation','class':cl,'raw_class':rawclass,'geometry':geom(box=box),
          'score':{'value':score,'semantics':'uncalibrated_model_score','probability':None},'visibility':'detected','occlusion':'unknown',
          'provenance':[ev(key,f'/{frame}/{field}/{index}')]})
        if not any(o['id']==rec['id'] for o in contract['observations']): contract['observations'].append(rec)
        return rec
    def dep(kind,rec): return {'kind':kind,'id':rec['id'],'version':rec['version']}
    def cutdep(vid):return {'kind':'cuts','id':vid,'version':contract['variants'][vid]['cut_version']}
    def fact(ident,kind,sc,deps,geometry,values,limits):
        rec=versioned({'id':ident,'kind':kind,'scope':sc,'epistemic_status':'derived_candidate','dependencies':deps,
          'geometry':geometry,'values':values,'review_evidence':[],'limitations':limits});contract['facts'].append(rec);return rec
    vid='005:ebard';a=obs(vid,0,0);b=obs(vid,1,0)
    ca=[(a['geometry']['xyxy'][0]+a['geometry']['xyxy'][2])/2,a['geometry']['xyxy'][3]]
    cb=[(b['geometry']['xyxy'][0]+b['geometry']['xyxy'][2])/2,b['geometry']['xyxy'][3]]
    fact('image-motion-T1','track_image_displacement',scope(vid,0,1),[dep('observation',a),dep('observation',b),cutdep(vid)],None,
       {'delta_image_px':[cb[0]-ca[0],cb[1]-ca[1]],'dt_seconds':b['time']['pts_seconds']-a['time']['pts_seconds']},
       ['Same tracker label only; no same-person claim.','Image motion mixes camera and player motion.','Shot segmentation not visually reviewed.'])
    other=obs('005:team-stable',0,0);obs('nba-lal-min-005:team-stable',0,0)
    ms='005:team-stable:meta';bind=documents[ms]['identitySuggestions']['entities'][0];rb=bind['bindings'][0]
    binding=versioned({'id':'P1-model-binding','scope':scope('005:team-stable',rb['start'],rb['end']),
        'track':{'variant_id':'005:team-stable','local_id':rb['trackId']},'p_slot':bind['id'],'status':'model_candidate',
        'nba_identity':None,'review_evidence':[],'provenance':[ev(ms,'/identitySuggestions/entities/0')]})
    contract['bindings'].append(binding)
    raw=documents['005:team-stable:tracks'][0]['tracks'];idx=next(i for i,t in enumerate(raw) if t[4]==rb['trackId']);position=obs('005:team-stable',0,idx)
    slot=fact('slot-image-P1','slot_image_position',scope('005:team-stable',0),[dep('observation',position),dep('binding',binding),cutdep('005:team-stable')],position['geometry'],
         {'p_slot':'P1','nba_identity':None},['P1 is a model display slot, not verified person identity.'])
    feet=source('feet005','engineering/research/vision-player-refinement/feet-candidates-005.json','feet')
    court=source('court005','engineering/research/vision-player-refinement/court-candidates-005.json','court')
    assert feet['trackingFingerprint']==contract['sources'][vid+':tracks']['sha256']==court['trackingFingerprint']
    foot=feet['frames'][1]['feet'][0]['right'];frec=versioned({'id':'005:ebard:f1:right-foot-T1','variant_id':vid,'time':contract['variants'][vid]['timeline'][1],
       'track':{'variant_id':vid,'local_id':feet['frames'][1]['feet'][0]['trackId']},'kind':'pose_landmark_candidate','class':'player','raw_class':foot['sourceLandmark'],
       'geometry':geom(xy=[foot['x'],foot['y']]),'score':{'value':foot['score'],'semantics':'uncalibrated_model_score','probability':None},
       'visibility':'detected','occlusion':'unknown','provenance':[ev('feet005','/frames/1/feet/0/right')]});contract['observations'].append(frec)
    keyframe=court['keyframes'][1];cal=versioned({'id':'court005-f1','scope':scope(vid,1),'frame':1,'reference_frame':court['referenceFrame'],
      'court_to_image':keyframe['courtToImage'],'status':'candidate','metric_accuracy_validated':False,
      'tracking_fingerprint':court['trackingFingerprint'],'provenance':[ev('court005','/keyframes/1')]});contract['calibrations'].append(cal)
    projected=np.linalg.inv(np.array(cal['court_to_image']).reshape(3,3))@np.array([foot['x'],foot['y'],1]);projected=(projected[:2]/projected[2]).tolist()
    fact('court-projection-foot-T1','court_projection_hypothesis',scope(vid,1),[dep('observation',frec),dep('calibration',cal),cutdep(vid)],geom(xy=projected,space='court_m_candidate'),
        {'plane_assumption':'hypothetical ground plane'},['Foot contact unknown.','Calibration is unreviewed; no validated distance/speed.','Do not present as true court position.'])
    # Real object kind is basketball, explicitly normalized to ball.
    frame=2;record=documents[vid+':tracks'][frame];bi=next(i for i,o in enumerate(record['objects']) if o['kind']=='basketball');ball=obs(vid,frame,bi,'objects')
    ballbox=ball['geometry']['xyxy'];center=[(ballbox[0]+ballbox[2])/2,(ballbox[1]+ballbox[3])/2]
    def distance(box):return math.hypot(max(box[0]-center[0],0,center[0]-box[2]),max(box[1]-center[1],0,center[1]-box[3]))
    candidates=sorted((distance(t),i) for i,t in enumerate(record['tracks']) if t[6]==2)
    # Use all candidates within radius, not one nearest label as possession.
    near=[(d,i) for d,i in candidates if d<=40]
    for d,i in near:
        player=obs(vid,frame,i)
        fact('near-ball-f2-T'+str(player['track']['local_id']),'ball_near_player',scope(vid,frame),[dep('observation',ball),dep('observation',player),cutdep(vid)],None,
           {'center_to_player_bbox_distance_px':d,'threshold_px':40,'method':'2d_ball_center_to_bbox_v1'},
           ['Image-space proximity only.','Overlapping boxes and perspective are ambiguous.','No possession, pass, shot, or real-name claim.'])
    for v in contract['variants']:
        for f in ([0,2] if v==vid else [0]):
            raw=documents[v+':tracks'][f]
            state='not_provided' if 'objects' not in raw else ('detected' if any(o['kind']=='basketball' for o in raw['objects']) else 'not_detected_reason_unknown')
            contract['availability'].append({'variant_id':v,'frame':f,'ball':state,'person_identity':'unverified',
               'court':'candidate_only' if v==vid else 'not_provided','occlusion':'unknown'})
    return contract,documents

def _validate_impl(contract,repo,documents=None):
    """Schema validates shape. This validates relationships and current eligibility."""
    errors=[];stale={}; blocked={}
    for e in Draft202012Validator(schema()).iter_errors(contract): errors.append({'code':'SCHEMA','path':'/'.join(map(str,e.path)),'detail':e.message})
    if errors:return {'errors':errors,'stale_facts':stale,'blocked_facts':blocked,'active_candidates':[]}
    documents={} if documents is None else documents
    def err(code,ident,detail):errors.append({'code':code,'id':ident,'detail':detail})
    for key,src in contract['sources'].items():
        path=repo/src['path']
        if file_sha(path)!=src['sha256']:err('SOURCE_HASH',key,'Current source bytes differ from pinned hash')
        if key not in documents:documents[key]=json.loads(path.read_text(encoding='utf-8'))
    def refs(record):
        for ev in record.get('provenance',[])+record.get('review_evidence',[]):
            try:
                if digest(pointer(documents[ev['source_id']],ev['json_pointer']))!=ev['value_sha256']:err('POINTER_HASH',record['id'],'JSON pointer value mismatch')
            except (KeyError,IndexError,ValueError,TypeError):err('BROKEN_REFERENCE',record['id'],'Source or pointer cannot resolve')
    registry={};records={};active={}
    for kind,field in [('observation','observations'),('binding','bindings'),('calibration','calibrations'),('fact','facts')]:
        for rec in contract[field]:
            key=(kind,rec['id'])
            if key in registry:err('DUPLICATE_ID',rec['id'],'Record IDs must be unique within kind')
            registry[key]=rec['version']; records[key]=rec;refs(rec)
            if rec['version']!=digest({k:v for k,v in rec.items() if k!='version'}):err('RECORD_HASH',rec['id'],'Immutable record payload changed')
    for v,variant in contract['variants'].items():
        registry[('cuts',v)]=variant['cut_version']
        if digest(variant['cut_frames'])!=variant['cut_version']:err('CUT_VERSION',v,'Cuts not bound to version')
        raw=documents[variant['tracks_source']];meta=documents[variant['meta_source']]
        if len(variant['timeline'])!=len(raw) or variant['frame_count']!=len(raw):err('FRAME_COUNT',v,'Frame timeline must cover every source record')
        if meta['video_sha256']!=variant['video_sha256']:err('VIDEO_BINDING',v,'Wrong video hash')
        for timing in variant['timeline']:
            f=timing['frame'];n,d=timing['time_base'];pts=timing['pts_ticks']*n/d
            if abs(pts-timing['pts_seconds'])>1e-8 or abs(pts-timing['raw_time_seconds'])>1e-6 or abs(raw[f]['time']-pts)>1e-6:err('PTS_MISMATCH',v+':'+str(f),'PTS, source time, and normalized time disagree')
            if abs(timing['local_elapsed_seconds']-(pts-variant['timeline'][0]['pts_seconds']))>1e-8:err('LOCAL_TIME_ORIGIN',v+':'+str(f),'Elapsed time has incorrect origin')
            if 'source_frame_pts' in raw[f] and (raw[f]['source_frame_pts']!=timing['pts_ticks'] or raw[f]['source_time_base']!=timing['time_base']):err('PTS_MISMATCH',v+':'+str(f),'Raw integer PTS/time base disagree')
    for o in contract['observations']:
        variant=contract['variants'][o['variant_id']];f=o['time']['frame'];refs0=o['provenance'][0];raw=pointer(documents[refs0['source_id']],refs0['json_pointer'])
        if o['time']!=variant['timeline'][f]:err('OBSERVATION_TIME',o['id'],'Observation timing differs from decoded timeline')
        if o['track'] and o['track']['variant_id']!=o['variant_id']:err('CROSS_VARIANT_TRACK',o['id'],'T label namespace changed')
        if o['kind']=='detection_observation':
            if refs0['source_id']!=variant['tracks_source']:err('CROSS_VARIANT_SOURCE',o['id'],'Observation attached to another variant')
            if not refs0['json_pointer'].startswith('/'+str(f)+'/'):err('OBSERVATION_SOURCE_FRAME',o['id'],'Evidence pointer does not address this source frame')
            if isinstance(raw,list):
                if raw[:4]!=o['geometry']['xyxy'] or raw[4]!=o['track']['local_id'] or raw[5]!=o['score']['value']:err('RAW_VALUE_CHANGED',o['id'],'Detection values differ from source')
                if {2:'player',3:'referee'}.get(raw[6])!=o['class'] or o['raw_class']!=raw[6]:err('CLASS_MAPPING',o['id'],'Source class and normalization disagree')
            else:
                if {'basketball':'ball','hoop':'hoop'}.get(raw['kind'])!=o['class']:err('CLASS_MAPPING',o['id'],'Source basketball must normalize to ball')
                if raw['box']!=o['geometry']['xyxy'] or raw['score']!=o['score']['value']:err('RAW_VALUE_CHANGED',o['id'],'Object values differ from source')
        else:
            rootdoc=documents[refs0['source_id']]
            if rootdoc['trackingFingerprint']!=contract['sources'][variant['tracks_source']]['sha256']:err('FEET_VARIANT_FINGERPRINT',o['id'],'Foot candidate belongs to different tracking bytes')
            if rootdoc['videoHash']!=variant['video_sha256']:err('VIDEO_BINDING',o['id'],'Foot candidate belongs to another video')
            if [raw['x'],raw['y']]!=o['geometry']['xy'] or raw['score']!=o['score']['value']:err('RAW_VALUE_CHANGED',o['id'],'Foot changed without append-only revision')
            parts=refs0['json_pointer'].split('/');footframe=rootdoc['frames'][int(parts[2])];footrow=footframe['feet'][int(parts[4])]
            if footframe['frame']!=f or footrow['trackId']!=o['track']['local_id']:err('FOOT_OBSERVATION_BINDING',o['id'],'Foot frame or T label differs from source')
        if o['geometry']['space']!='image_px':err('COORDINATE_PROMOTION',o['id'],'Raw detector/pose output is image space')
        if o['geometry']['ground_contact']!='unknown':err('UNSUPPORTED_GROUND_CONTACT',o['id'],'Raw pose score is not ground contact evidence')
    for b in contract['bindings']:
        if b['scope']['variant_id']!=b['track']['variant_id']:err('CROSS_VARIANT_BINDING',b['id'],'Binding track and scope differ')
        if b['nba_identity'] is not None or b['status']=='human_reviewed':err('UNSUPPORTED_REVIEW',b['id'],'No reviewed identity source adapter in this research dataset')
        evidence=b['provenance'][0];raw=pointer(documents[evidence['source_id']],evidence['json_pointer'])
        if evidence['source_id']!=contract['variants'][b['scope']['variant_id']]['meta_source']:err('BINDING_SOURCE_VARIANT',b['id'],'Binding metadata from wrong variant')
        if b['p_slot']!=raw['id'] or not any(r['trackId']==b['track']['local_id'] and r['start']==b['scope']['start_frame'] and r['end']==b['scope']['end_frame_inclusive'] for r in raw['bindings']):err('BINDING_SOURCE_MISMATCH',b['id'],'Normalized association not present in source model suggestions')
    for cal in contract['calibrations']:
        evidence=cal['provenance'][0];rootdoc=documents[evidence['source_id']];raw=pointer(rootdoc,evidence['json_pointer'])
        vid=cal['scope']['variant_id']
        if cal['court_to_image']!=raw['courtToImage'] or cal['frame']!=raw['frame'] or cal['reference_frame']!=rootdoc['referenceFrame']:err('CALIBRATION_SOURCE_MISMATCH',cal['id'],'Normalized matrix/frame differs from source')
        if cal['tracking_fingerprint']!=rootdoc['trackingFingerprint'] or rootdoc['videoHash']!=contract['variants'][vid]['video_sha256']:err('CALIBRATION_SOURCE_BINDING',cal['id'],'Calibration video/fingerprint mismatch')
        if cal['status']!='candidate' or cal['metric_accuracy_validated']:err('UNSUPPORTED_CALIBRATION_REVIEW',cal['id'],'Dataset calibration has not been reviewed or independently validated')
    prev=None;active=registry.copy();cut_overrides={}
    for seq,rev in enumerate(contract['revisions'],1):
        if rev['sequence']!=seq or rev['prev_sha256']!=prev or rev['sha256']!=digest({k:v for k,v in rev.items() if k!='sha256'}):err('LEDGER_CHAIN',str(seq),'Revision sequence or hash chain invalid')
        key=(rev['target_kind'],rev['target_id'])
        if active.get(key)!=rev['old_version']:err('REVISION_BASE',str(seq),'Revision not based on current version')
        if digest(rev['replacement'])!=rev['new_version']:err('REVISION_PAYLOAD',str(seq),'Replacement version not content-addressed')
        active[key]=rev['new_version'];prev=rev['sha256']
        if rev['target_kind']=='cuts':cut_overrides[rev['target_id']]=rev['replacement']['cut_frames']
    def in_scope(scope,frame): return scope['start_frame']<=frame<=scope['end_frame_inclusive']
    for f in contract['facts']:
        reasons=[];sc=f['scope'];vid=sc['variant_id'];variant=contract['variants'][vid]
        cuts=cut_overrides.get(vid,variant['cut_frames'])
        if sc['start_frame']>sc['end_frame_inclusive']:reasons.append('INVALID_INTERVAL')
        if any(sc['start_frame']<c<=sc['end_frame_inclusive'] for c in cuts):reasons.append('CROSS_CUT')
        if sc['cut_version']!=active[('cuts',vid)]:stale.setdefault(f['id'],[]).append('CUT_VERSION_STALE')
        deps=[]
        for d in f['dependencies']:
            key=(d['kind'],d['id']);r=records.get(key)
            if key not in active:reasons.append('DEPENDENCY_MISSING');continue
            if d['version']!=active[key]:stale.setdefault(f['id'],[]).append(d['kind'].upper()+'_VERSION_STALE')
            # The prototype invalidates revisions but has no replacement materializer.
            # Merely replacing a dependency version must never resurrect old payloads.
            if r and d['kind'] in ['binding','calibration'] and r['version']!=active[key]:
                stale.setdefault(f['id'],[]).append('REVISION_REQUIRES_RECOMPUTE')
            if r:deps.append((d['kind'],r))
            if r and d['kind']=='observation':
                if r['variant_id']!=vid:reasons.append('CROSS_VARIANT_DEPENDENCY')
                if not in_scope(sc,r['time']['frame']):reasons.append('DEPENDENCY_OUTSIDE_INTERVAL')
            if r and d['kind'] in ['binding','calibration']:
                if r['scope']['variant_id']!=vid:reasons.append('CROSS_VARIANT_DEPENDENCY')
                if not in_scope(r['scope'],sc['start_frame']) or not in_scope(r['scope'],sc['end_frame_inclusive']):reasons.append('BINDING_OR_CALIBRATION_OUT_OF_SCOPE')
        obs=[r for k,r in deps if k=='observation'];bindings=[r for k,r in deps if k=='binding'];calibrations=[r for k,r in deps if k=='calibration']
        def close(actual,expected):
            try:return bool(np.allclose(actual,expected,rtol=0,atol=1e-8))
            except (TypeError,ValueError):return False
        if f['epistemic_status']=='reviewed_fact':reasons.append('REVIEW_NOT_SUPPORTED_BY_DATASET')
        if f['kind'] in ['possession','pass','shot']:reasons.append('HIGH_LEVEL_EVENT_RULE_NOT_IMPLEMENTED')
        if f['kind']=='ball_near_player':
            if not (len(obs)==2 and {o['class'] for o in obs}=={'ball','player'}):reasons.append('BALL_AND_PLAYER_EVIDENCE_REQUIRED')
            if len({o['time']['frame'] for o in obs})!=1:reasons.append('SIMULTANEOUS_OBSERVATIONS_REQUIRED')
            if len(obs)==2 and {o['class'] for o in obs}=={'ball','player'}:
                ball=next(o for o in obs if o['class']=='ball')['geometry']['xyxy'];box=next(o for o in obs if o['class']=='player')['geometry']['xyxy']
                center=[(ball[0]+ball[2])/2,(ball[1]+ball[3])/2]
                dist=math.hypot(max(box[0]-center[0],0,center[0]-box[2]),max(box[1]-center[1],0,center[1]-box[3]))
                if not close(f['values'].get('center_to_player_bbox_distance_px'),dist) or f['values'].get('threshold_px')!=40 or dist>40 or f['values'].get('method')!='2d_ball_center_to_bbox_v1':reasons.append('DERIVATION_MISMATCH')
        if f['kind']=='slot_image_position':
            if not bindings:reasons.append('BINDING_REQUIRED')
            elif any(o['track']!=bindings[0]['track'] for o in obs):reasons.append('BINDING_TRACK_MISMATCH')
            elif len(obs)!=1 or f['geometry']!=obs[0]['geometry'] or f['values']!={'p_slot':bindings[0]['p_slot'],'nba_identity':None}:reasons.append('DERIVATION_MISMATCH')
        if f['kind']=='track_image_displacement' and (len(obs)!=2 or obs[0]['track']!=obs[1]['track']):reasons.append('TRACK_CONTINUITY_REQUIRED')
        elif f['kind']=='track_image_displacement':
            a,b=obs;ab=a['geometry']['xyxy'];bb=b['geometry']['xyxy']
            delta=[(bb[0]+bb[2]-ab[0]-ab[2])/2,bb[3]-ab[3]];dt=b['time']['pts_seconds']-a['time']['pts_seconds']
            if dt<=0 or not close(f['values'].get('delta_image_px'),delta) or not close(f['values'].get('dt_seconds'),dt):reasons.append('DERIVATION_MISMATCH')
        if f['kind']=='court_projection_hypothesis':
            if not calibrations:reasons.append('CALIBRATION_REQUIRED')
            else:
                cal=calibrations[0]
                if cal['tracking_fingerprint']!=contract['sources'][variant['tracks_source']]['sha256']:reasons.append('CALIBRATION_VARIANT_FINGERPRINT')
                if any(cal['reference_frame']<c<=sc['end_frame_inclusive'] for c in cuts):reasons.append('CALIBRATION_CROSSES_CUT')
                if len(obs)!=1 or obs[0]['geometry']['xy'] is None:reasons.append('PROJECTION_INPUT_REQUIRED')
                else:
                    p=np.linalg.inv(np.array(cal['court_to_image']).reshape(3,3))@np.array(obs[0]['geometry']['xy']+[1])
                    if not close(f['geometry']['xy'],p[:2]/p[2]):reasons.append('DERIVATION_MISMATCH')
            if f['geometry']['metric_accuracy']!='unvalidated' or f['geometry']['ground_contact']!='unknown':reasons.append('UNSUPPORTED_METRIC_OR_CONTACT_CLAIM')
        if reasons:blocked[f['id']]=sorted(set(reasons))
    # Cascade invalidation through derived fact dependencies, without mutating history.
    changed=True
    while changed:
        changed=False
        for f in contract['facts']:
            for d in f['dependencies']:
                if d['kind']=='fact' and (d['id'] in stale or d['id'] in blocked) and f['id'] not in stale:
                    stale[f['id']]=['UPSTREAM_FACT_UNAVAILABLE'];changed=True
    active_facts=[] if errors else [f['id'] for f in contract['facts'] if f['id'] not in stale and f['id'] not in blocked]
    return {'errors':errors,'stale_facts':stale,'blocked_facts':blocked,'active_candidates':active_facts}

def validate(contract,repo,documents=None):
    try:
        return _validate_impl(contract,repo,documents)
    except (KeyError,IndexError,ZeroDivisionError,TypeError,ValueError,OSError,np.linalg.LinAlgError) as error:
        # Bad foreign keys / matrices / source files are invalid evidence, never
        # an excuse to return a partially accepted view or abort the audit run.
        return {'errors':[{'code':'SEMANTIC_INPUT_ERROR','detail':type(error).__name__+': '+str(error)}],
                'stale_facts':{},'blocked_facts':{},'active_candidates':[]}

def append_revision(contract,kind,ident,replacement,reason):
    if kind not in ['binding','calibration','cuts']:raise ValueError('Raw observations are immutable; revisions cannot target raw')
    if kind=='cuts':old=contract['variants'][ident]['cut_version']
    else:old=next(r['version'] for r in contract[{'binding':'bindings','calibration':'calibrations'}[kind]] if r['id']==ident)
    for r in contract['revisions']:
        if r['target_kind']==kind and r['target_id']==ident:old=r['new_version']
    rev={'sequence':len(contract['revisions'])+1,'prev_sha256':contract['revisions'][-1]['sha256'] if contract['revisions'] else None,
        'target_kind':kind,'target_id':ident,'old_version':old,'new_version':digest(replacement),'replacement':replacement,
        'reason':reason,'actor':'offline-controlled-fixture','mode':'controlled_test_only'}
    rev['sha256']=digest(rev);contract['revisions'].append(rev);return rev

def run_tests(base,repo,docs):
    tests=[];fixtures={}
    def case(name,mutate,expected,loss):
        c=copy.deepcopy(base);mutate(c);result=validate(c,repo,docs)
        codes={e['code'] for e in result['errors']}|{x for v in result['blocked_facts'].values() for x in v}|{x for v in result['stale_facts'].values() for x in v}
        ok=expected in codes;tests.append({'name':name,'passed':ok,'expected_block':expected,'schema_valid':not any(Draft202012Validator(schema()).iter_errors(c)),
                'what_is_withheld':loss,'result':result});fixtures[name]=c
    case('identity_revision',lambda c:append_revision(c,'binding','P1-model-binding',{'track':{'variant_id':'005:team-stable','local_id':1},'p_slot':'P1','status':'controlled_candidate_correction'},'Controlled switch of the P1 track association'),
         'BINDING_VERSION_STALE','Only slot-dependent position becomes stale; raw observations and track motion remain.')
    case('calibration_revision',lambda c:append_revision(c,'calibration','court005-f1',{'reason':'reference_geometry_changed','status':'needs_recompute'},'Controlled calibration version change'),
         'CALIBRATION_VERSION_STALE','Court projection is withheld; pixel observations remain.')
    def variant(c):
        o=c['observations'][0];o['track']['variant_id']='005:team-stable';versioned(o)
    case('same_T_cross_variant',variant,'CROSS_VARIANT_TRACK','Same numeric T1 cannot join different tracker outputs.')
    def foot_wrong_variant(c):
        o=next(o for o in c['observations'] if o['kind']=='pose_landmark_candidate');o['variant_id']='005:team-stable';o['track']['variant_id']='005:team-stable';versioned(o)
    case('feet_wrong_variant',foot_wrong_variant,'FEET_VARIANT_FINGERPRINT','Pose cached for E-BARD cannot be transferred to same-number team-stable track.')
    case('insert_cut',lambda c:append_revision(c,'cuts','005:ebard',{'cut_frames':[1]},'Controlled cut between source frames 0 and 1'),
         'CROSS_CUT','Cross-cut motion and propagated court mapping withheld; independent source observations remain.')
    def pts(c):
        c['variants']['nba-lal-min-005:team-stable']['timeline'][0]['raw_time_seconds']=0
    case('zero_origin_pts_confusion',pts,'PTS_MISMATCH','LAL source PTS .120 cannot be replaced by elapsed zero.')
    def stale_ref(c):c['observations'][0]['provenance'][0]['value_sha256']='0'*64;versioned(c['observations'][0])
    case('stale_json_pointer_hash',stale_ref,'POINTER_HASH','Record references that no longer match pinned source value are rejected.')
    def raw_edit(c):c['observations'][0]['geometry']['xyxy'][0]+=100;versioned(c['observations'][0])
    case('raw_overwrite_even_if_rehashed',raw_edit,'RAW_VALUE_CHANGED','Recomputing record hash cannot legitimize overwritten raw coordinates.')
    def label(c):
        b=next(o for o in c['observations'] if o['class']=='ball');b['class']='hoop';versioned(b)
    case('basketball_class_misread',label,'CLASS_MAPPING','An incorrect ball/hoop normalization loses useful candidates and must fail explicitly.')
    def promote(c):
        f=next(f for f in c['facts'] if f['kind']=='ball_near_player');f['kind']='possession';f['epistemic_status']='reviewed_fact';versioned(f)
    case('proximity_to_possession',promote,'HIGH_LEVEL_EVENT_RULE_NOT_IMPLEMENTED','Do not transform 2D proximity into possession, pass, or shot.')
    def review(c):c['bindings'][0]['status']='human_reviewed';versioned(c['bindings'][0])
    case('model_binding_to_human',review,'UNSUPPORTED_REVIEW','Model slot cannot be relabeled as human review.')
    def probability(c):c['observations'][0]['score']['probability']=c['observations'][0]['score']['value'];versioned(c['observations'][0])
    case('confidence_to_probability',probability,'SCHEMA','Uncalibrated score is not empirical probability.')
    def interval(c):
        f=next(f for f in c['facts'] if f['kind']=='slot_image_position');f['scope']['start_frame']=f['scope']['end_frame_inclusive']=142
        c['bindings'][0]['scope']['end_frame_inclusive']=1;versioned(c['bindings'][0]);versioned(f)
    case('binding_outside_interval',interval,'BINDING_OR_CALIBRATION_OUT_OF_SCOPE','P binding outside its validity interval cannot identify a later frame.')
    def binding_tamper(c):c['bindings'][0]['track']['local_id']=999;versioned(c['bindings'][0])
    case('binding_rehashed_tamper',binding_tamper,'BINDING_SOURCE_MISMATCH','A valid content hash cannot establish a fabricated association.')
    def cal_tamper(c):c['calibrations'][0]['court_to_image'][0]+=100;versioned(c['calibrations'][0])
    case('calibration_rehashed_tamper',cal_tamper,'CALIBRATION_SOURCE_MISMATCH','Fabricated matrix is rejected even if the record hash is updated.')
    def derive_tamper(c):c['facts'][0]['values']['delta_image_px']=[999,999];versioned(c['facts'][0])
    case('derived_value_tamper',derive_tamper,'DERIVATION_MISMATCH','Numeric derived values must recompute from declared inputs.')
    def hash_tamper(c):c['sources']['005:ebard:tracks']['sha256']='0'*64
    case('source_file_hash_mismatch',hash_tamper,'SOURCE_HASH','Changed source bytes cannot pass as the pinned source snapshot.')
    def forged_rebind(c):
        revision=append_revision(c,'binding','P1-model-binding',{'track':{'variant_id':'005:team-stable','local_id':999},'p_slot':'P10'},'Adversarial controlled replacement')
        fact=next(f for f in c['facts'] if f['kind']=='slot_image_position')
        next(d for d in fact['dependencies'] if d['kind']=='binding')['version']=revision['new_version'];versioned(fact)
    case('revision_dependency_relabel',forged_rebind,'REVISION_REQUIRES_RECOMPUTE','Relabeling dependency version cannot resurrect an old P1 observation under a revised identity.')
    def fake_class(c):
        o=c['observations'][0];o['class']='ball';o['raw_class']='basketball';versioned(o)
    case('player_to_ball_class',fake_class,'CLASS_MAPPING','Player class_id 2 cannot become ball after normalization.')
    def empty_provenance(c):c['observations'][0]['provenance']=[];versioned(c['observations'][0])
    case('empty_provenance',empty_provenance,'SCHEMA','An observation needs at least one resolvable evidence pointer.')
    def unknown_variant(c):c['observations'][0]['variant_id']='unknown';versioned(c['observations'][0])
    case('unknown_variant',unknown_variant,'SEMANTIC_INPUT_ERROR','Unknown foreign keys reject the view without aborting the audit.')
    def ledger_tamper(c):
        append_revision(c,'binding','P1-model-binding',{'status':'needs_recompute'},'Controlled revision')
        c['revisions'][0]['reason']='silently changed without updating chain hash'
    case('revision_history_tamper',ledger_tamper,'LEDGER_CHAIN','Changing an existing revision breaks the append-only hash chain.')
    return tests,fixtures

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--repo',type=Path,required=True);args=ap.parse_args()
    base,docs=build(args.repo);result=validate(base,args.repo,docs);assert not result['errors'] and not result['blocked_facts'] and not result['stale_facts'],result
    tests,fixtures=run_tests(base,args.repo,docs)
    # Save base and controlled history separately; never modify source or base records.
    revised=copy.deepcopy(base)
    raw_before=digest(revised['observations'])
    append_revision(revised,'binding','P1-model-binding',{'track':{'variant_id':'005:team-stable','local_id':1},'p_slot':'P1','status':'controlled_candidate_correction'},'Controlled association correction')
    append_revision(revised,'calibration','court005-f1',{'reference_geometry':'changed','status':'needs_recompute'},'Controlled court reference correction')
    revisions_result=validate(revised,args.repo,docs)
    raw_immutable=raw_before==digest(revised['observations'])
    counts={}
    for clip in ['004','005','006']:
        raw=json.loads((args.repo/f'data/videos/tactics/acceptance/tracks/{clip}-ebard.json').read_text())
        counts[clip]={'frames':len(raw),'basketball_candidates':sum(o['kind']=='basketball' for f in raw for o in f.get('objects',[])),
                     'frame_has_basketball':sum(any(o['kind']=='basketball' for o in f.get('objects',[])) for f in raw)}
    report={'base_validation':result,'tests':tests,'passed':sum(t['passed'] for t in tests),'total':len(tests),
      'raw_unchanged_after_revisions':raw_immutable,'revised_view':revisions_result,'object_mapping_audit':counts,
      'schema_role':'Structure, enums, coordinate tags; cannot establish evidence truth or cross-record consistency.',
      'semantic_checker_role':'Source bytes/pointers, PTS, namespace, interval, cut, current versions and unsupported promotion.',
      'limits':['Pinned SHA proves byte identity, not detector accuracy or human truth.',
       'Known declared cuts are enforced; undetected real cuts remain possible.',
       'No identity/calibration human review adapter is implemented: reviewed claims fail closed.',
       'High-level possession/pass/shot rules are not implemented and always withheld.',
       'Current source edits fail closed for the entire dataset; practical adapters should quarantine affected components.',
       'Revised records mark dependent facts stale; recomputation is explicit future work, never silently rewritten.']}
    for name,value in [('contract.schema.json',schema()),('source_grounded_examples.json',base),('revision_history_example.json',revised),('validation_results.json',report),('counterexamples.json',fixtures)]:
        (ROOT/name).write_text(json.dumps(value,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf-8')
    print(json.dumps({'passed':report['passed'],'total':report['total'],'observations':len(base['observations']),
        'facts':len(base['facts']),'active':result['active_candidates'],'revised_stale':revisions_result['stale_facts'],
        'raw_immutable':raw_immutable,'counts':counts},ensure_ascii=False,indent=2))
    assert report['passed']==report['total']

if __name__=='__main__':main()
