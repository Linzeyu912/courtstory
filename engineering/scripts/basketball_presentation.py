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

def name_display_selected(entity,settings):
    if not settings or settings.get('enabled') is not True:return False
    ident=str(entity.get('id',''));number=ident.removeprefix('P')
    if not number.isdigit() or not 1<=int(number)<=10:return False
    group='A' if int(number)<=5 else 'B'
    return settings.get('groups',{}).get(group,True) is not False and settings.get('players',{}).get(ident,True) is not False

def name_overlay_at(name_data,player_id,frame,track_id):
    """Read only the matching exported observation; a missing point never reuses an old location."""
    if not isinstance(name_data,dict):return None
    entity=next((item for item in name_data.get('playerNameIdentities',[]) if item.get('id')==player_id),None)
    if not entity:return None
    observation=next((item for item in entity.get('observations',[]) if item.get('frame')==frame and item.get('trackId')==track_id and
        isinstance(item.get('x'),(int,float)) and isinstance(item.get('y'),(int,float))),None)
    if not observation:return None
    identity=observation.get('nameIdentity') or {}
    name=identity.get('name');jersey=identity.get('jersey')
    verified=identity.get('identityVerified') is True
    return {'x':float(observation['x']),'y':float(observation['y']),'name':name,'jersey':jersey,'identityVerified':verified,
        'nameStatus':identity.get('nameStatus'),'positionBindingStatus':identity.get('positionBindingStatus'),
        'showName':name_data.get('nameDisplay',{}).get('showName',True),'showJersey':name_data.get('nameDisplay',{}).get('showJersey',True),
        'showAnkleRing':name_data.get('nameDisplay',{}).get('showAnkleRing',True)}

def name_overlay_label(identity,player_id):
    identity=identity or {}
    number=str(player_id).removeprefix('P');name=identity.get('name')
    name_part=(str(name).strip() if identity.get('showName',True) and isinstance(name,str) and name.strip() else
        f'P{number} · pending' if identity.get('showName',True) else '')
    if name_part and name and not identity.get('identityVerified'):name_part+='?'
    if name and identity.get('showName',True) and identity.get('nameStatus')=='machine_accepted':
        name_part=f'P{number} {str(name).strip()}' + ('~' if identity.get('positionBindingStatus')=='needs_review' else '')
    jersey=identity.get('jersey');jersey_part=f'#{str(jersey).strip()}' if identity.get('showJersey',True) and jersey is not None and str(jersey).strip() else ''
    return ' · '.join(item for item in (name_part,jersey_part) if item)

def name_overlay_text(identity,player_id):
    """Return Hershey-font-safe text; OpenCV cannot draw the browser's middle-dot separator."""
    return name_overlay_label(identity,player_id).replace(' · ',' / ')


def layout_name_labels(items,width,height,scale=1):
    """Mirror browser label layout without moving the actual feet."""
    placed=[];pad=5*scale
    for item in items:
        center=item['x']-item['width']/2
        step=item['height']+12*scale
        bases=[item['y']+item['height']+12*scale,
            item['y']+item['height']+12*scale+step,item['y']+item['height']+12*scale+2*step,
            item['y']-18*scale,item['y']-18*scale-step]
        choice=None
        def overlaps(rect):
            return any(rect['left']<p['rect']['right'] and rect['right']>p['rect']['left'] and
                rect['top']<p['rect']['bottom'] and rect['bottom']>p['rect']['top'] for p in placed)
        for shift in (0,-.6*item['width'],.6*item['width'],-1.2*item['width'],1.2*item['width']):
            x=max(pad,min(width-item['width']-pad,center+shift))
            for proposed in bases:
                y=max(item['height']+pad,min(height-pad,proposed))
                rect={'left':x-pad,'top':y-item['height']-pad,'right':x+item['width']+pad,'bottom':y+pad}
                candidate={**item,'textX':x,'textY':y,'rect':rect}
                if choice is None:choice=candidate
                if not overlaps(rect):
                    choice=candidate;break
            if choice and not overlaps(choice['rect']):break
        placed.append(choice)
    return placed

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
