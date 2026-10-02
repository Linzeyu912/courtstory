"""Shared conservative team hints and deterministic observation-only presentation."""
from collections import Counter
import copy
import json
from pathlib import Path

POLICY_PATH=Path(__file__).resolve().parents[1]/'tools/player-review/team-overlay-policy.json'

def load_policy():
    return json.loads(POLICY_PATH.read_text(encoding='utf-8'))

def effective_team_group(entity):
    if entity.get('teamGroupSource')=='human':return entity.get('teamGroup') if entity.get('teamGroup') in ('A','B') else None
    return next((entity.get(field) for field in ('teamGroup','modelTeamGroup') if entity.get(field) in ('A','B')),None)

def overlay_style(entity,point,policy):
    group=effective_team_group(entity);tentative=point.get('identitySource')=='model_suggestion'
    team_pending=not group or entity.get('teamGroupSource')!='human'
    estimated=point.get('source') in ('interpolated','manual_path')
    return {'group':group,'color':policy['teams'][group]['color'] if group else policy['pendingColor'],
        'dashed':tentative or estimated or team_pending,'label':entity['id'].removeprefix('P')+('?' if tentative or team_pending else '')+('~' if estimated else ''),
        'footMethod':'human_image_anchor' if point.get('footMethod')=='human_image_anchor' else policy['foot']['method']}

def _smoothable(point):
    return (point.get('source')=='tracked' and point.get('x') is not None and point.get('y') is not None
        and point.get('footMethod')=='bbox_bottom_center' and isinstance(point.get('box'),list)
        and len(point['box'])==4 and point.get('trackId') is not None)

def _identity_token(point):
    return tuple(point.get(field) for field in ('trackId','identitySource','identityStartFrame','identityOrder','modelSuggestionMethod'))

def stabilize_points(points,cuts,width,height,policy):
    output=copy.deepcopy(points);limit=policy['filter']['maximumCoordinateDeviationAt720']*height/720
    for index in range(1,len(points)-1):
        left,current,right=points[index-1:index+2]
        if (not all(_smoothable(point) for point in (left,current,right)) or any(index-1<cut<=index+1 for cut in cuts)
            or _identity_token(left)!=_identity_token(current) or _identity_token(right)!=_identity_token(current)
            or not 0<current['time']-left['time']<=policy['filter']['maximumFrameGapSeconds']
            or not 0<right['time']-current['time']<=policy['filter']['maximumFrameGapSeconds']):continue
        box=[]
        for axis,value in enumerate(current['box']):
            median=sorted((left['box'][axis],value,right['box'][axis]))[1]
            delta=max(-limit,min(limit,(median-value)*policy['filter']['blend']))
            box.append(max(0,min(height if axis%2 else width,value+delta)))
        if box[2]<=box[0] or box[3]<=box[1] or box==current['box']:continue
        output[index]={**current,'box':box,'x':(box[0]+box[2])/2,'y':box[3],
            'presentationMethod':policy['filter']['method'],'presentationFootMethod':policy['foot']['method'],
            'presentationSupportFrames':[index-1,index,index+1]}
    return output

def regroup_suggestions(suggestions,records,policy):
    """New fixed slots only; unknown/conflicting/excess candidates stay unassigned."""
    candidates=[];unassigned=[];labels=policy['grouping']['compatibleLabels']
    for entity in suggestions.get('entities',[]):
        evidence=Counter();conflict=False
        for binding in entity.get('bindings',[]):
            for record in records[binding['start']:binding['end']+1]:
                observed=record.get('track_evidence',{}).get(str(binding['trackId']),{})
                conflict |= bool(observed.get('identity_review_required') or observed.get('color_conflict'))
                torso=observed.get('torso',{})
                if torso.get('reliable') and torso.get('template_safe') and torso.get('label') in labels:
                    evidence[labels[torso['label']]]+=1
        dominant,count=(evidence.most_common(1)[0] if evidence else (None,0))
        reason=('identity_conflict' if conflict else 'insufficient_team_evidence' if count<policy['grouping']['minimumReliableFrames']
            else 'conflicting_team_evidence' if count/sum(evidence.values())<policy['grouping']['minimumDominance'] else None)
        item={'sourcePlayerId':entity['id'],'trackIds':sorted({b['trackId'] for b in entity.get('bindings',[])}),'evidence':dict(evidence)}
        if reason:unassigned.append({**item,'reason':reason});continue
        candidates.append({'entity':copy.deepcopy(entity),'label':dominant,'count':count,'evidence':dict(evidence)})
    totals=Counter()
    for candidate in candidates:totals[candidate['label']]+=candidate['count']
    # Choose strongest evidence first, then order light/dark for stable display.
    strongest=sorted(totals,key=lambda label:(-totals[label],label))[:2]
    selected=sorted(strongest,key=lambda label:(label=='white',-totals[label],label))
    groups={label:('A' if index==0 else 'B') for index,label in enumerate(selected)}
    result=copy.deepcopy(suggestions);result.update(method='reliable-multiframe-team-slots-v1',verified=False,
        teamGrouping={'version':1,'layout':policy['layout'],'verified':False,'labels':{group:label for label,group in groups.items()},
            'minimumReliableFrames':policy['grouping']['minimumReliableFrames'],'minimumDominance':policy['grouping']['minimumDominance']},entities=[])
    for label,group in groups.items():
        available=sorted((c for c in candidates if c['label']==label),key=lambda c:(-c['count'],int(c['entity']['id'][1:])))
        kept=sorted(available[:policy['capacity']],key=lambda c:int(c['entity']['id'][1:]))
        for slot,candidate in zip(policy['teams'][group]['slots'],kept):
            original=candidate['entity'];result['entities'].append({**original,'id':f'P{slot}',
                'sourcePlayerId':original['id'],'teamGroup':group,'teamHint':label,'teamEvidence':candidate['evidence'],
                'reviewRequired':True,'identityConfirmed':False,'teamConfirmed':False})
        for candidate in available[policy['capacity']:]:
            original=candidate['entity'];unassigned.append({'sourcePlayerId':original['id'],
                'trackIds':sorted({b['trackId'] for b in original['bindings']}),'reason':'team_capacity_exceeded','evidence':candidate['evidence']})
    for candidate in candidates:
        if candidate['label'] not in groups:
            original=candidate['entity'];unassigned.append({'sourcePlayerId':original['id'],
                'trackIds':sorted({b['trackId'] for b in original['bindings']}),'reason':'third_team_color_pending','evidence':candidate['evidence']})
    result['unassignedTeamCandidates']=unassigned
    result['unassignedTrackIds']=sorted(set(suggestions.get('unassignedTrackIds',[]))|{track for item in unassigned for track in item['trackIds']})
    result['entities'].sort(key=lambda entity:int(entity['id'][1:]))
    return result

def proposal_points(suggestions,records,cuts=()):
    """Match the UI's unconfirmed identity lane, without filling any missing frame."""
    result={}
    for entity in suggestions.get('entities',[]):
        points=[]
        for record in records:
            frame=record['frame'];point={'frame':frame,'time':record['time'],'x':None,'y':None,'source':'missing'}
            binding=next((b for b in reversed(entity['bindings']) if b['start']<=frame<=b['end'] and not any(b['start']<c<=frame for c in cuts)),None)
            if binding:
                provenance={'identitySource':'model_suggestion','identityStartFrame':binding['start'],'identityOrder':0,
                    'identityExclusive':False,'identityConfirmed':False,'reviewRequired':True,'modelSuggestionMethod':suggestions.get('method')}
                row=next((row for row in record['tracks'] if int(row[4])==binding['trackId']),None)
                if row:point={**point,**provenance,'x':(row[0]+row[2])/2,'y':row[3],'box':row[:4],
                    'source':'tracked','trackId':binding['trackId'],'detectorScore':row[5],'footMethod':'bbox_bottom_center'}
                else:point.update(provenance,trackId=binding['trackId'],visibility='occluded_waiting')
            points.append(point)
        result[entity['id']]=points
    owners={}
    for entity_id,points in result.items():
        for index,point in enumerate(points):
            if point.get('x') is not None:owners.setdefault((index,point['trackId']),[]).append(entity_id)
    for (index,_),ids in owners.items():
        if len(ids)>1:
            for entity_id in ids:result[entity_id][index]={'frame':index,'time':records[index]['time'],'x':None,'y':None,
                'source':'conflict','identityConfirmed':False,'reviewRequired':True}
    return result
