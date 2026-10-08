"""Source-image selection, local identity anchors and bounded visual continuation."""
import base64
import io
import json
import threading
from pathlib import Path

from PIL import Image

from identity_ocr import jersey_number


def _confidence(reading):
    value = reading.get('confidence')
    return float(value) if type(value) in (int, float) and 0 <= value <= 1 else 0


def _owned(reading):
    return reading.get('targetConfirmed') is not False and reading.get('visibility') != 'unreadable'


def _clear(reading):
    return (reading.get('targetConfirmed') is True and reading.get('visibility') == 'clear'
            and _confidence(reading) >= .92)


def _supported(readings, evidence, player_data, season, team):
    """A clear owned reading or two source frames, never duplicate output records."""
    groups, invalid = {}, set()
    from player_name_identity import _team_code
    for item in readings:
        label = item.get('evidenceId')
        if label not in evidence or not _owned(item):
            continue
        visible_team=_team_code(item.get('teamText',''))
        if team and visible_team and visible_team!=team:
            evidence[label]['teamConflict']=True
            continue
        number = jersey_number(item.get('jerseyText', ''))
        if number is not None:
            groups.setdefault(label, {}).setdefault(number, item)
    votes = {}
    for label, numbers in groups.items():
        if len(numbers) != 1:
            evidence[label]['readConflict'] = True
            continue
        number, item = next(iter(numbers.items()))
        if team and player_data.lookup(season, team, number).get('status') != 'unique_candidate':
            evidence[label]['rosterMismatch'] = True
            invalid.add(number)
            continue
        votes.setdefault(number, []).append(item)
    supported = {number: items for number, items in votes.items()
                 if len({evidence[x['evidenceId']]['frame'] for x in items}) >= 2 or any(_clear(x) for x in items)}
    repeated={number:items for number,items in supported.items()
              if len({evidence[x['evidenceId']]['frame'] for x in items})>=2}
    if len(repeated)==1 and len(supported)>1:
        # One contradictory still image can be a digit/occlusion misread. Preserve
        # it in evidence, while reserving identity switches for repeated support.
        supported=repeated
    return supported, votes, invalid


def _partition(segment, supported, evidence):
    """Split an ordered number change; interleaved claims remain ambiguous."""
    if len(supported) <= 1:
        return [(segment, supported)]
    runs = sorted((min(evidence[x['evidenceId']]['frame'] for x in items),
                   max(evidence[x['evidenceId']]['frame'] for x in items), number, items)
                  for number, items in supported.items())
    if any(first[1] >= second[0] for first, second in zip(runs, runs[1:])):
        return [(segment, supported)]
    result = []
    for index, (start, end, number, items) in enumerate(runs):
        lower = segment['start'] if index == 0 else start
        upper = segment['end'] if index == len(runs)-1 else end
        part = {**segment, 'start': lower, 'end': upper,
                'values': [v for v in segment['values'] if lower <= v[0] <= upper]}
        result.append((part, {number: items}))
        if index<len(runs)-1 and end+1<runs[index+1][0]:
            gap={**segment,'start':end+1,'end':runs[index+1][0]-1,
                 'values':[v for v in segment['values'] if end<v[0]<runs[index+1][0]],'identitySwitchGap':True}
            result.append((gap,{}))
    return result


def _anchor_bounds(segment, supported, votes, evidence):
    """A clear opposing terminal read limits the span of a dominant anchor."""
    if len(supported)!=1:
        return _partition(segment,supported,evidence)
    number,items=next(iter(supported.items()))
    frames=[evidence[x['evidenceId']]['frame'] for x in items]
    opposing=[evidence[x['evidenceId']]['frame'] for other,rows in votes.items() if other!=number
              for x in rows if _clear(x)]
    lower=min(frames) if any(f<min(frames) for f in opposing) else segment['start']
    upper=max(frames) if any(f>max(frames) for f in opposing) else segment['end']
    if (lower,upper)==(segment['start'],segment['end']):
        return [(segment,supported)]
    result=[]
    for start,end,local in ((segment['start'],lower-1,{}),(lower,upper,supported),(upper+1,segment['end'],{})):
        if start<=end:
            result.append(({**segment,'start':start,'end':end,
                'values':[v for v in segment['values'] if start<=v[0]<=end],
                'identitySwitchGap':not bool(local)},local))
    return result


def apply_reference_slot_identities(result):
    """Pure offline analysis of saved proposals; never edits raw model results.

    Stable slot profiles come only from observed, clear QA reference readings
    matched to a unique roster candidate. A different observed person may move
    to their uniquely anchored slot only with two target-owned source frames.
    """
    from copy import deepcopy
    from player_name_identity import _team_code
    output=deepcopy(result)
    wrapped=isinstance(output,dict) and isinstance(output.get('candidate'),dict)
    data=output['candidate'] if wrapped else output
    if not isinstance(data,dict) or not isinstance(data.get('candidates'),list):
        raise ValueError('稳定身份后处理需要已有姓名候选结果。')
    originals=deepcopy(data['candidates'])
    data['analysisVersion']='reference-slot-identities-v1'
    data['rawAlgorithm']=data.get('algorithm')
    data.setdefault('issues',[])

    def matched_evidence(candidate,clear=False,qa=False):
        rows=[]
        number=jersey_number(candidate.get('jersey'))
        team=candidate.get('team')
        for row in candidate.get('evidence',[]):
            if (not isinstance(row,dict) or row.get('targetConfirmed') is not True
                or row.get('readConflict') or row.get('rosterMismatch') or row.get('teamConflict')
                or jersey_number(row.get('jerseyText',''))!=number or number is None
                or type(row.get('frame')) is not int or row.get('trackId')!=candidate.get('trackId')
                or not candidate['start']<=row['frame']<=candidate['end']
                or _team_code(row.get('teamText','')) not in (None,team)):
                continue
            if clear and not _clear(row):
                continue
            if not clear and (_confidence(row)<.8 or row.get('visibility')=='unreadable'):
                continue
            if qa and not row.get('quality',{}).get('qaReference'):
                continue
            rows.append(row)
        return rows

    groups={}
    for candidate in originals:
        person=candidate.get('nameCandidate')
        if (candidate.get('status')!='candidate' or not isinstance(person,dict)
            or person.get('lookupStatus')!='unique_candidate'
            or candidate.get('evidenceMethod')!='direct_jersey'):
            continue
        evidence=matched_evidence(candidate,clear=True,qa=True)
        if not evidence:
            continue
        player=candidate.get('playerId') or person.get('player_id')
        if not player:
            continue
        record=groups.setdefault(candidate['entityId'],{}).setdefault(player,{
            'entityId':candidate['entityId'],'status':'reference_candidate','playerId':player,
            'nameCandidate':deepcopy(person),'team':candidate.get('team'),'jersey':candidate.get('jersey'),
            'season':candidate.get('season'),'evidence':[],'verified':False,'reviewRequired':True})
        seen={x.get('evidenceId') for x in record['evidence']}
        record['evidence'].extend(deepcopy(x) for x in evidence if x.get('evidenceId') not in seen)
    profiles={entity:next(iter(people.values())) for entity,people in groups.items() if len(people)==1}
    data['playerProfiles']=[profiles[entity] for entity in sorted(profiles)]
    data['ambiguousReferenceSlots']=[{'entityId':entity,'playerIds':sorted(people)}
        for entity,people in groups.items() if len(people)>1]
    destinations={}
    for profile in profiles.values():
        destinations.setdefault(profile['playerId'],[]).append(profile)
    routed=blocked=0
    for candidate in data['candidates']:
        if candidate.get('status')!='candidate' or not isinstance(candidate.get('nameCandidate'),dict):
            continue
        entity=candidate['entityId'];profile=profiles.get(entity)
        player=candidate.get('playerId') or candidate['nameCandidate'].get('player_id')
        foreign=profile is not None and profile['playerId']!=player
        if not foreign:
            continue
        observed=deepcopy(candidate['nameCandidate'])
        rows=matched_evidence(candidate)
        choices=destinations.get(player,[])
        unique=(len(choices)==1 and choices[0]['entityId']!=entity and
            choices[0]['team']==candidate.get('team') and choices[0]['season']==candidate.get('season') and
            str(choices[0]['jersey'])==str(candidate.get('jersey')))
        independent=len({row['frame'] for row in rows})>=2
        reference=deepcopy(profile['evidence'])
        issue={'kind':'association_conflict','entityId':entity,'trackId':candidate['trackId'],
            'start':candidate['start'],'end':candidate['end'],'evidence':deepcopy(rows),
            'evidenceIds':[x.get('evidenceId') for x in rows],
            'referenceEvidence':reference,'referenceEvidenceIds':[x.get('evidenceId') for x in reference],
            'observedNameCandidate':observed,'referenceNameCandidate':deepcopy(profile['nameCandidate']),
            'reason':'该有限段的实际目标号码与该P的清晰唯一参考身份不同。'}
        candidate['observedNameCandidate']=observed
        candidate['sourceEntityId']=entity
        if independent and unique:
            destination=choices[0]
            candidate.update(entityId=destination['entityId'],originalEntityId=entity,bindingCorrection=True,
                reason='两个目标归属明确的源帧号码与另一P的清晰唯一身份参考一致，有限修正人物关联。',
                slotReferenceEvidence=deepcopy(destination['evidence']),
                slotReferenceEvidenceIds=[x.get('evidenceId') for x in destination['evidence']])
            issue.update(resolution='routed',routedEntityId=destination['entityId'])
            routed+=1
        else:
            candidate.update(status='unknown',nameCandidate=None,playerId=None,observedPlayerId=player,
                reason='该段属于另一身份，但缺少两份明确目标读数或唯一目标P参考，保留读数并释放有限旧AI错绑。')
            issue['resolution']='unassigned'
            blocked+=1
        data['issues'].append(issue)
    data['correctedBindings']=[deepcopy(x) for x in data['candidates']
        if x.get('status')=='candidate' and x.get('bindingCorrection') is True]
    data['referenceSlotAnalysis']={'profiles':len(profiles),'routedSegments':routed,
        'unassignedSegments':blocked,'newModelRequests':0,'rawModelResultsChanged':False}
    return output


def recognize(session, clip, video, tactics, player_data, *, season=None, team_map=None,
              provider=None, max_frames_per_entity=8, max_extra_frames=4, work_dir=None,
              cancel_event=None, reference_frames=None, correction_targets=None, selected_entities=None):
    from player_name_identity import (REPO_ROOT, ALGORITHM, MAX_EVIDENCE_HARD_LIMIT,
        MAX_ENTITY_CALLS, _effective_ranges, _quality_pool, _image_quality, _select_evidence,
        _crop_frame, _comparison_frame, _mapped_team, _team_code)
    from review_session import validate_session
    if not isinstance(session, dict) or not isinstance(clip, dict) or not isinstance(video, (str, Path)):
        raise ValueError('姓名识别缺少 session、clip 或视频路径。')
    if type(max_frames_per_entity) is not int or not 4 <= max_frames_per_entity <= 12:
        raise ValueError('每位球员证据帧预算须为 4–12。')
    if type(max_extra_frames) is not int or not 0 <= max_extra_frames <= 4:
        raise ValueError('定向补看预算须为 0–4 帧。')
    validate_session(session, clip)
    options = player_data.options(season)
    if season is None:
        return {'status': 'pending_context', 'candidates': [], 'pendingContext': [
            {'kind': 'season_required', 'message': '需先确认视频比赛赛季。'}], 'verified': False, 'reviewRequired': True}
    if season not in options['seasons']:
        raise ValueError('赛季不在名单数据范围内。')
    if provider is None:
        raise ValueError('姓名识别必须显式传入已配置的视觉 provider。')
    entities = [e for e in session['entities'] if e.get('role') == 'player']
    if len(entities) > MAX_ENTITY_CALLS:
        raise ValueError('球员槽位超过本轮最多十位的预算。')
    if selected_entities is not None:
        if (not isinstance(selected_entities,(list,tuple,set)) or
            any(not isinstance(x,str) or x not in {e['id'] for e in entities} for x in selected_entities)):
            raise ValueError('选择处理的球员编号无效。')
    cancel = cancel_event or threading.Event()
    work = Path(work_dir) if work_dir else REPO_ROOT/'tmp/player-name-identity'
    work.mkdir(parents=True, exist_ok=True)
    all_segments = _effective_ranges(session, clip)
    # User/diagnostic proposed windows are observations to verify, not identity
    # truth. Rebinding proposals are limited to machine-owned source ranges.
    from initial_identity_review import rows_at
    entity_by_id = {e['id']:e for e in entities}
    for target in correction_targets or []:
        if not isinstance(target,dict) or target.get('entityId') not in entity_by_id:
            raise ValueError('身份修正目标格式无效。')
        lower,upper,track = target.get('start'),target.get('end'),target.get('trackId')
        if any(type(x) is not int for x in (lower,upper,track)) or not 0<=lower<=upper<len(clip['frames']):
            raise ValueError('身份修正目标范围无效。')
        requested=target.get('frames',[])
        if (not isinstance(requested,list) or any(type(frame) is not int or not lower<=frame<=upper for frame in requested)):
            raise ValueError('身份修正指定帧必须在目标范围内。')
        destination = entity_by_id[target['entityId']]
        originals = {s['entity']['id'] for s in all_segments if s['trackId']==track and s['start']<=upper and lower<=s['end']}
        if originals=={destination['id']} and any(s['entity']['id']==destination['id'] and
            s['trackId']==track and s['start']<=lower and upper<=s['end'] for s in all_segments):
            continue
        protected = False
        for original in originals:
            e=entity_by_id[original]
            protected |= any(b.get('start',0)<=upper and lower<=b.get('end',-1) and b.get('trackId')==track
                and not str(b.get('origin','')).startswith(('ai_','model')) for b in e.get('bindings',[]))
            protected |= any(lower<=a.get('frame',-1)<=upper and a.get('identityConfirmed') is not False
                for a in e.get('anchors',[]))
        if protected:
            continue
        values=[]
        for frame in range(lower,upper+1):
            row=rows_at(clip,frame).get(track)
            if row is not None and frame not in set(clip.get('sourceCuts',[]))|set(session.get('cuts',[])):
                from player_name_identity import _valid_box
                if _valid_box(row,clip['width'],clip['height']):
                    values.append((frame,row,'visual_correction_target'))
        # Missing observations/cuts do not become a fabricated continuous range.
        runs=[]
        for value in values:
            separate=not runs or value[0]!=runs[-1][-1][0]+1
            if runs and not separate:
                previous=runs[-1][-1]
                a,b=previous[1],value[1]
                scale=max(a[2]-a[0],a[3]-a[1],b[2]-b[0],b[3]-b[1],1)
                import math
                separate=math.hypot((a[0]+a[2]-b[0]-b[2])/2,(a[1]+a[3]-b[1]-b[3])/2)>scale
            if separate:
                runs.append([])
            runs[-1].append(value)
        for run in runs:
            all_segments.append({'entity':destination,'trackId':track,'start':run[0][0],'end':run[-1][0],
                'values':run,'bindingCorrection':True,'originalEntityIds':sorted(originals-{destination['id']}),
                'requestedFrames':[frame for frame in requested if frame in {v[0] for v in run}]})
        if any(frame not in {v[0] for v in values} for frame in requested):
            raise ValueError('身份修正指定帧缺少该T的有效源观察。')
    candidates, issues, corrections = [], [], []
    usage = {'modelRequests': 0, 'successfulModelRequests': 0, 'failedModelRequests': 0,
             'followupRequests': 0, 'evidenceImages': 0, 'sourceFramesScored': 0}
    reference_frames = reference_frames or {}

    def ask(images, labels, directory, context=None):
        if callable(getattr(provider, 'review', None)):
            invoke=lambda:provider.review(images, labels, context)
        elif callable(getattr(provider, 'read', None)):
            invoke=lambda:provider.read(images, labels)
        elif callable(getattr(provider, 'generate', None)):
            schema = directory/'schema.json'
            schema.write_text(json.dumps({'type': 'object', 'properties': {
                'readings': {'type': 'array', 'items': {'type': 'object'}},
                'continuities': {'type': 'array', 'items': {'type': 'object'}}}, 'required': ['readings']}), encoding='utf-8')
            prompt = ('读青色框所指目标自己的球衣号码/文字，不读邻人；不猜号码。号码0和00分开。'
                '输出readings:[{evidenceId,teamText,jerseyText,targetConfirmed,visibility:clear/partial/unreadable,'
                'confidence:0..1,reason}]。比较图输出continuities:[{targetEvidenceId,referenceEvidenceId,'
                'samePerson,confidence,reason}]，同P/T标签和同队颜色不足以认定同人。'
                '标签/参考：'+json.dumps({'labels': labels, 'context': context}, ensure_ascii=False))
            invoke=lambda:provider.generate(job={'purpose': 'player_name_identity', 'cancel': cancel, 'process': None,
                'jobId': 'player-name-'+directory.name}, directory=directory, schema=schema,
                result=directory/'result.json', images=images, prompt=prompt)
        else:
            raise ValueError('视觉 provider 没有可调用入口。')
        usage['modelRequests'] += 1; usage['evidenceImages'] += len(images)
        try:
            output=invoke()
            if not isinstance(output,dict) or not isinstance(output.get('readings'),list):
                raise ValueError('视觉号码读取结构无效。')
        except Exception:
            usage['failedModelRequests'] += 1
            raise
        usage['successfulModelRequests'] += 1
        return output

    for entity in entities:
        if selected_entities is not None and entity['id'] not in selected_entities:
            continue
        if cancel.is_set():
            break
        segments = [s for s in all_segments if s['entity']['id'] == entity['id']]
        team = _mapped_team(entity, team_map, player_data, season)
        directory = work/entity['id']; directory.mkdir(parents=True, exist_ok=True)
        evidence, label_segment, paths, readings, continuities = {}, {}, {}, [], []
        if not segments:
            candidates.append({'entityId': entity['id'], 'status': 'unknown', 'trackId': None,
                'start': None, 'end': None, 'nameCandidate': None, 'playerId': None, 'season': season,
                'team': team, 'jersey': None, 'evidence': [], 'method': ALGORITHM,
                'reason': '没有有效人物关联证据。'})
            continue
        pool = _quality_pool(segments)
        # Explicit QA references only prioritize actual observed frames in the
        # supplied session. Their jersey/profile fields never become truth.
        for segment in segments:
            for value in segment['values']:
                if (value[0] in reference_frames.get(entity['id'], []) or value[0] in segment.get('requestedFrames',[])) and all(
                    not (s is segment and v[0] == value[0]) for s,v in pool):
                    pool.append((segment,value))
        indices = sorted({v[0] for _,v in pool})
        by_frame = {}
        for start in range(0, len(indices), 40):
            if cancel.is_set():
                break
            by_frame.update({x['frame']:x for x in tactics.frames(video, clip, indices[start:start+40])})
        if cancel.is_set():
            break
        for segment,value in pool:
            frame,row,*_ = value
            if frame not in by_frame:
                continue
            image = Image.open(io.BytesIO(base64.b64decode(by_frame[frame]['dataUrl'].split(',',1)[-1],validate=True))).convert('RGB')
            if image.size != (clip['width'], clip['height']):
                raise ValueError('姓名识别原图尺寸与已登记视频不一致。')
            from initial_identity_review import rows_at
            quality = _image_quality(image,row,rows_at(clip,frame))
            # QA frames are explicit source-grounded preferences, not outputs.
            quality['qaReference'] = frame in reference_frames.get(entity['id'], [])
            if quality['qaReference']:
                quality['score'] += 100
            quality['requestedCorrectionFrame']=frame in segment.get('requestedFrames',[])
            segment.setdefault('quality',{})[frame] = quality
        usage['sourceFramesScored'] += len(indices)
        ranked = sorted(segments, key=lambda s:max((q['score'] for q in s.get('quality',{}).values()),default=-100), reverse=True)
        chosen = []
        def choose(segment,value):
            if len(chosen)<max_frames_per_entity and not any(
                s['trackId']==segment['trackId'] and v[0]==value[0] for s,v in chosen):
                chosen.append((segment,value))
        correction_segments=[s for s in ranked if s.get('bindingCorrection')]
        if correction_segments:
            requested_values=list({(s['trackId'],v[0]):(s,v) for s,v in pool
                if s.get('bindingCorrection') and v[0] in s.get('requestedFrames',[])}.values())
            if len(requested_values)>=max_frames_per_entity:
                raise ValueError('修正指定帧超出首轮预算，须为清晰参考至少保留一张模型图。')
            for segment,value in requested_values:
                choose(segment,value)
            qa_values=sorted([(s,v) for s,v in pool if s['quality'][v[0]].get('qaReference')],
                key=lambda x:x[0]['quality'][x[1][0]]['score'],reverse=True)
            external=[(s,v) for s,v in qa_values if not s.get('bindingCorrection') and not any(
                target['trackId']==s['trackId'] and target['start']<=v[0]<=target['end'] for target in correction_segments)]
            references=[]
            for segment,value in external+qa_values:
                key=(segment['trackId'],value[0])
                if any((s['trackId'],v[0])==key for s,v in references):
                    continue
                # Favor a second track reference when available instead of two
                # duplicate poses from the very window awaiting verification.
                if references and segment['trackId']==references[0][0]['trackId'] and any(
                    s['trackId']!=segment['trackId'] for s,v in external):
                    continue
                references.append((segment,value))
                if len(references)==2:
                    break
            for segment,value in references:
                choose(segment,value)
            # Explicit repair windows must actually reach the model. Previously
            # short ordinary segments could consume the entire evidence budget.
            for pass_index in range(2):
                for segment in correction_segments:
                    if sum(s is segment for s,v in chosen)>=2:
                        continue
                    options=_select_evidence(segment,2)
                    if pass_index<len(options):
                        choose(segment,options[pass_index])
        # Short fragments now get an opportunity to produce a clear anchor.
        if len(segments) <= max_frames_per_entity//2:
            for segment in ranked:
                for value in _select_evidence(segment,2):
                    choose(segment,value)
        else:
            for segment in ranked[:max_frames_per_entity-1]:
                for value in _select_evidence(segment,1):
                    choose(segment,value)
        while len(chosen) < max_frames_per_entity:
            unused = [(s,v) for s,v in pool if all(not (s['trackId']==a['trackId'] and v[0]==b[0]) for a,b in chosen)]
            if not unused:
                break
            segment,value=max(unused,key=lambda x:x[0]['quality'][x[1][0]]['score'])
            choose(segment,value)
        chosen.sort(key=lambda x:(x[0]['start'],x[1][0]))

        def prepare(selected, followup=False, reference=None):
            images,labels = [],[]
            for segment,value in selected:
                frame,row,*sources = value
                if frame not in by_frame:
                    continue
                label = f'{entity["id"]}-S{segment["start"]}-T{segment["trackId"]}-F{frame}'+('-extra' if followup else '')
                image = Image.open(io.BytesIO(base64.b64decode(by_frame[frame]['dataUrl'].split(',',1)[-1],validate=True))).convert('RGB')
                path = directory/(label+'.jpg'); _crop_frame(image,row,path)
                evidence[label] = {'evidenceId':label,'frame':frame,'trackId':segment['trackId'],
                    'box':list(row[:4]),'source':sources[0] if sources else '', 'time':clip['frames'][frame]['time'],
                    'teamText':'','jerseyText':'','quality':segment['quality'][frame], 'pass':2 if followup else 1}
                risk=clip['frames'][frame].get('track_evidence',{})
                risk=risk.get(str(segment['trackId']),risk.get(segment['trackId'],{}))
                evidence[label]['riskFlags']=[key for key in ('color_conflict','identity_review_required') if risk.get(key) is True]
                label_segment[label] = segment; paths[label] = path
                if reference:
                    comparison = directory/(label+'-comparison.jpg')
                    _comparison_frame(paths[reference],path,comparison); path=comparison
                    evidence[label]['comparisonReference'] = reference
                images.append(path);labels.append(label)
            return images,labels

        def collect(output):
            if not isinstance(output,dict) or not isinstance(output.get('readings'),list):
                raise ValueError('视觉号码读取结构无效。')
            for item in output['readings']:
                if not isinstance(item,dict) or item.get('evidenceId') not in evidence:
                    continue
                label = item['evidenceId']
                readings.append(item)
                evidence[label].update({key:item[key] for key in ('teamText','jerseyText','jerseyNameText',
                    'targetConfirmed','visibility','confidence','reason') if key in item})
            continuities.extend(x for x in output.get('continuities',[]) if isinstance(x,dict))

        error = None
        try:
            images,labels = prepare(chosen)
            if images and not cancel.is_set():
                collect(ask(images,labels,directory))
            if team is None:
                visible_teams={_team_code(x.get('teamText','')) for x in readings if _owned(x)}
                visible_teams.discard(None)
                if len(visible_teams)==1:
                    team=next(iter(visible_teams))
            extra_budget = min(max_extra_frames, MAX_EVIDENCE_HARD_LIMIT-len(images))
            anchored,_,_ = _supported(readings,evidence,player_data,season,team)
            # A single well-grounded identity is a reference, never the saved e.jersey.
            reference = None
            qa_readings=[x for x in readings if evidence[x['evidenceId']]['frame'] in reference_frames.get(entity['id'],[])
                and not label_segment[x['evidenceId']].get('bindingCorrection')]
            qa_anchors,_,_=_supported(qa_readings,evidence,player_data,season,team)
            if len(qa_anchors)==1:
                anchored=qa_anchors
            if len(anchored)==1:
                items = next(iter(anchored.values()))
                reference = max(items,key=lambda x:(_clear(x),_confidence(x),evidence[x['evidenceId']]['quality']['score']))['evidenceId']
            unresolved = []
            for segment in ranked:
                own = [x for x in readings if label_segment[x['evidenceId']] is segment]
                local,votes,_ = _supported(own,evidence,player_data,season,team)
                opposing = len(local)==1 and any(other not in local and any(_clear(x) for x in items)
                    for other,items in votes.items())
                if len(local)!=1 or opposing:
                    unresolved.append(segment)
            extras = []
            used = {v[0] for _,v in chosen}
            def extra_for(segment,reuse=False):
                if len(extras)>=extra_budget:
                    return
                available=[v for s,v in pool if s is segment and v[0] not in used]
                if not available and reuse:
                    prior={v[0] for s,v in extras if s is segment}
                    available=[v for s,v in chosen if s is segment and v[0] not in prior]
                if available:
                    selected=max(available,key=lambda v:segment['quality'][v[0]]['score'])
                    extras.append((segment,selected));used.add(selected[0])
            can_compare=reference and callable(getattr(provider,'review',None))
            repairs=[s for s in unresolved if s.get('bindingCorrection')]
            ordinary=[s for s in unresolved if not s.get('bindingCorrection')]
            # Two target comparisons before ordinary OCR/continuation. A declared
            # repair must not lose all its follow-up budget to tiny old fragments.
            for _ in range(2):
                for segment in repairs:
                    extra_for(segment,reuse=bool(can_compare))
            for _ in range(2):
                for segment in ordinary:
                    extra_for(segment)
            if can_compare:
                for segment in ordinary:
                    if not any(s is segment for s,v in extras):
                        extra_for(segment,reuse=True)
            if extras and not cancel.is_set():
                comparison_ref = reference if callable(getattr(provider,'review',None)) else None
                extra_images,extra_labels = prepare(extras,True,comparison_ref)
                usage['followupRequests'] += 1
                context = {'comparisons':[{'targetEvidenceId':label,'referenceEvidenceId':comparison_ref}
                    for label in extra_labels]} if comparison_ref else None
                try:
                    collect(ask(extra_images,extra_labels,directory,context))
                except ValueError as exc:
                    issues.append({'entityId':entity['id'],'kind':'followup_failed','reason':str(exc)[:300]})
        except ValueError as exc:
            error = str(exc)[:300]
        if cancel.is_set():
            break
        parts = []
        for segment in segments:
            own = [x for x in readings if label_segment[x['evidenceId']] is segment]
            local,votes,invalid = _supported(own,evidence,player_data,season,team)
            if any(evidence[x['evidenceId']].get('readConflict') for x in own):
                local={}
            if invalid:
                issues.append({'entityId':entity['id'],'kind':'roster_read_mismatch','trackId':segment['trackId'],
                    'start':segment['start'],'end':segment['end'],'numbers':sorted(invalid),
                    'reason':'读数没有比赛名单支持，保留读数供核对，不计作可靠身份冲突。'})
            parts.extend(_anchor_bounds(segment,local,votes,evidence))
        local_anchors = {}
        for segment,local in parts:
            if len(local)==1:
                number,items=next(iter(local.items()))
                for item in items:
                    local_anchors[item['evidenceId']] = number
        numbers={number for number in local_anchors.values()}
        if len(numbers)>1:
            issues.append({'entityId':entity['id'],'kind':'identity_conflict',
                'reason':'该工作身份存在不同号码的可靠局部证据，保留各有限段并复核关联。',
                'segments':[{'trackId':s['trackId'],'start':s['start'],'end':s['end'],'jersey':next(iter(local))}
                    for s,local in parts if len(local)==1]})
        for segment,local in parts:
            own=[e for label,e in evidence.items() if label_segment[label]['trackId']==segment['trackId']
                 and segment['start']<=e['frame']<=segment['end']]
            number=next(iter(local)) if len(local)==1 else None
            refs=[];links=[];method='direct_jersey'
            reason=error or '目标号码与同人续接证据不足。'
            if len(local)>1:
                reason='同一有限段的不同号码证据交错，须复核局部串人。'
            if segment.get('identitySwitchGap'):
                reason='两个可靠身份锚点之间发生串人，尚未定位切换源帧。'
            if number is None and not local and not segment.get('identitySwitchGap'):
                possible={}
                for link in continuities:
                    target=link.get('targetEvidenceId');ref=link.get('referenceEvidenceId')
                    if (target in evidence and ref in local_anchors and evidence[target] in own
                        and (evidence[target].get('targetConfirmed') is not False or link.get('targetVisible') is True)
                        and evidence[target].get('comparisonReference')==ref and link.get('samePerson') is True
                        and _confidence(link)>=.9 and str(link.get('reason','')).strip()):
                        possible.setdefault(local_anchors[ref],[]).append(link)
                if len(possible)==1:
                    number,links=next(iter(possible.items()));method='visual_same_person'
                    refs=[evidence[x] for x in sorted({l['referenceEvidenceId'] for l in links})]
                    # Opposing team text on an owned target vetoes that local claim.
                    if any(e.get('targetConfirmed') is True and _team_code(e.get('teamText')) not in (None,team) for e in own):
                        number=None;refs=[];links=[]
            if number is not None:
                direct_items = local.get(number,[])
                if any(_team_code(x.get('teamText')) not in (None,team) for x in direct_items if _owned(x)):
                    number=None;reason='目标的可见NBA球队文字与球队映射冲突。'
            candidate={'entityId':entity['id'],'status':'unknown','trackId':segment['trackId'],
                'start':segment['start'],'end':segment['end'],'nameCandidate':None,'playerId':None,
                'season':season,'team':team,'jersey':number,'evidence':own,'method':ALGORITHM,
                'reason':reason,'verified':False,'reviewRequired':True,'evidenceMethod':method}
            if number is not None and not team:
                candidate.update(status='pending',reason='号码可读，需确认球队映射。')
            elif number is not None:
                lookup=player_data.lookup(season,team,number)
                if lookup['status']=='unique_candidate':
                    person=lookup['candidates'][0]
                    candidate.update(status='candidate',playerId=person['player_id'],nameCandidate={
                        'name':person['name'],'player_id':person['player_id'],'namespace':'normalized_name_key',
                        'season':season,'team':team,'jersey':number,'lookupStatus':lookup['status'],
                        'seasonRoster':person.get('season_roster',[])},
                        reason='目标清晰号码锚点与连续观测支持该有限段。' if method=='direct_jersey' else '原图目标与清晰参考的同人比较支持该有限段。')
                    if method=='visual_same_person':
                        candidate.update(referenceEvidence=refs,continuity={
                            'referenceEvidenceIds':[e['evidenceId'] for e in refs],
                            'targetEvidenceIds':[l['targetEvidenceId'] for l in links],
                            'reason':'；'.join(l['reason'] for l in links),'comparisons':links})
                    if segment.get('bindingCorrection'):
                        # A target window must agree with the actual reference
                        # identity; direct readings of another player are retained
                        # as evidence, but never reassigned to this reference slot.
                        reference_number=local_anchors.get(reference) if reference else None
                        if reference_number is not None and reference_number==number:
                            candidate['bindingCorrection']=True
                            originals=segment.get('originalEntityIds',[])
                            if len(originals)==1:
                                candidate['originalEntityId']=originals[0]
                            corrections.append(dict(candidate))
                        else:
                            candidate.update(status='unknown',nameCandidate=None,playerId=None,
                                reason='修正目标尚未与该工作身份的清晰参考一致，保留原关联。')
            candidates.append(candidate)
    # Competing slots are restricted to their actual overlap, not discarded globally.
    for index,first in enumerate(candidates):
        if first['status']!='candidate':
            continue
        for second in candidates[index+1:]:
            if (second['status']=='candidate' and first['entityId']!=second['entityId']
                and first['playerId']==second['playerId'] and first['start']<=second['end'] and second['start']<=first['end']):
                issues.append({'kind':'overlapping_identity_claim','entityIds':[first['entityId'],second['entityId']],
                    'start':max(first['start'],second['start']),'end':min(first['end'],second['end']),
                    'reason':'两工作身份在局部时段竞争同一真人，需复核人物关联。'})
    state=provider.status() if callable(getattr(provider,'status',None)) else {}
    return {'status':'cancelled' if cancel.is_set() else 'ready','candidates':candidates,'issues':issues,
        'pendingContext':[],'verified':False,'reviewRequired':True,'algorithm':ALGORITHM,
        'model':state.get('model') or state.get('provider'), 'correctedBindings':corrections,
        'budget':{'maxPlayers':MAX_ENTITY_CALLS,'maxEvidenceImagesPerPlayer':max_frames_per_entity,
            'maxExtraEvidenceImagesPerPlayer':max_extra_frames,'maxImagesPerPlayerHardLimit':12,
            'maxRequestsPerPlayer':1+int(max_extra_frames>0),'sourceFramesScoredPerPlayer':40},'usage':usage}
