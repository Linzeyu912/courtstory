"""Preserve established visual evidence across a targeted model repair."""
import json
import math
from collections import Counter

from tactics_visual_facts import MOVING_ACTIONS, VisualFactsFailure, _check, visual_facts_schema


def _key(value):
    # Evidence frame / observation order is immaterial. Route point order is not.
    if isinstance(value, dict):
        value = {k:sorted(v, key=lambda item:json.dumps(item,sort_keys=True)) if k == 'evidenceFrames' and isinstance(v, list) else v for k,v in value.items()}
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def check_facts_repair(previous, current, repair_needs, pack):
    if not isinstance(previous, dict):
        return  # A malformed first response has no established person records.
    old_list = previous.get('people')
    if not isinstance(old_list, list):
        return
    grouped_people = {}
    for person in old_list:
        if isinstance(person,dict) and isinstance(person.get('id'),str):
            grouped_people.setdefault(person['id'],{})[_key(person)] = person
    if not grouped_people:
        return
    # Conflicting duplicate IDs are invalid input, not trustworthy positions.
    people = {id:next(iter(group.values())) for id,group in grouped_people.items() if len(group)==1}
    new_list = current.get('people', []) if isinstance(current, dict) else []
    new_people = {p['id']:p for p in new_list if isinstance(p, dict) and isinstance(p.get('id'), str)} if isinstance(new_list,list) else {}
    needs = repair_needs if isinstance(repair_needs,list) else []
    targets = {n['personId'] for n in needs if isinstance(n,dict) and isinstance(n.get('personId'),str)}
    schema = visual_facts_schema(pack)
    images = {item['frame'] for item in pack['images']}
    failures = []

    def fail(person, reason):
        failures.append({'personId':person, 'code':'facts_retention', 'reason':reason})

    for id in grouped_people:
        if id not in new_people:fail(id,'修复不能删除已有局部人物。')

    def valid(value, item_schema):
        try:
            _check(value, item_schema)
            return True
        except VisualFactsFailure:
            return False

    def point(value):
        return (isinstance(value,list) and len(value)==2 and all(type(v) in (int,float) and math.isfinite(v) for v in value)
                and 0 <= value[0] <= pack['width'] and 0 <= value[1] <= pack['height'])

    def observations(person):
        rows = person.get('observations', [])
        if not isinstance(rows,list):return {}
        grouped = {}
        for row in rows:
            if isinstance(row,dict) and type(row.get('frame')) is int and row['frame'] in images and point(row.get('foot')):
                grouped.setdefault(row['frame'],{})[_key(row)] = row
        # A contradictory duplicate frame is itself invalid and may be repaired.
        return {frame:next(iter(rows.values())) for frame,rows in grouped.items() if len(rows)==1}

    old_observations = {id:observations(p) for id,p in people.items()}
    corrected_observations = {id:{f for n in needs if isinstance(n,dict) and n.get('personId')==id and n.get('code')=='duplicate_local_observation'
                                  for f in n.get('evidenceFrames',[]) if type(f) is int} for id in people}
    for id,old in people.items():
        new = new_people.get(id)
        if new is None:
            fail(id,'修复不能删除已有局部人物。');continue
        if old.get('action') in MOVING_ACTIONS and new.get('action') not in MOVING_ACTIONS:
            fail(id,'已明确移动的人不能改为静止或未知以绕过路线缺项。')
        if targets and id not in targets and valid(old,schema['properties']['people']['items']):
            if {k:v for k,v in old.items() if k!='observations'} != {k:v for k,v in new.items() if k!='observations'}:
                fail(id,'未指定修复的人物属性必须保留。')
        new_rows = observations(new)
        corrected_duplicate_frames = corrected_observations[id]
        for frame,row in old_observations[id].items():
            if frame not in corrected_duplicate_frames and new_rows.get(frame) != row:
                fail(id,'已有有效脚点观察不能删除或重新定位；只能增补观察。')

    def valid_route(route):
        if not valid(route,schema['properties']['routes']['items']):return False
        id=route['personId'];person=people.get(id,{});rows=old_observations.get(id,{})
        anchor,evidence=route['anchorFrame'],route['evidenceFrames']
        if set(evidence) & corrected_observations.get(id,set()):return False
        if (person.get('action') not in MOVING_ACTIONS or person.get('continuity')!='observed' or
            len(set(evidence))!=len(evidence) or len(set(evidence))<2 or anchor not in evidence or max(evidence)<=anchor or
            not set(evidence)<=set(rows) or route['cameraReference']=='unresolved' or
            any(min(evidence)<cut<=max(evidence) for cut in pack.get('sampling',{}).get('cutFrames',[])) or
            not all(point(p) for p in route['points']) or len({_key(p) for p in route['points']})<2):return False
        return math.dist(route['points'][0],rows[anchor]['foot']) <= max(20,min(pack['width'],pack['height'])*.025)

    for field in ('routes','ball','static'):
        old_items = previous.get(field,[])
        new_items = current.get(field,[]) if isinstance(current,dict) else []
        if not isinstance(old_items,list):continue
        new_keys = {_key(item) for item in new_items} if isinstance(new_items,list) else set()
        for item in old_items:
            if not isinstance(item,dict) or not isinstance(item.get('personId'),str):continue
            id=item['personId'];untargeted=bool(targets) and id not in targets
            structural=valid(item,schema['properties'][field]['items'])
            if field=='routes':established=valid_route(item)
            else:
                frame=item.get('frame');row=old_observations.get(id,{}).get(frame)
                established=(structural and row is not None and point(item.get('point')) and
                             math.dist(item['point'],row['foot'])<=max(20,min(pack['width'],pack['height'])*.025))
                if frame in corrected_observations.get(id,set()):established=False
                if field=='ball' and sum(isinstance(other,dict) and other.get('frame')==frame for other in old_items)>1:
                    established=False
            if (established or untargeted and structural) and _key(item) not in new_keys:
                fail(id,f'已有有效{field}记录不得删除或改变；本轮只能修复指定的无效项。')
    if failures:
        raise VisualFactsFailure('facts_retention','修复改变了已建立的动作或观察，不能将覆盖降级为完成。',failures)


def check_audited_facts_repair(previous, current, report, pack):
    """Only an independent audit can release a specifically rejected item.

    Unlike structural repairs, identity corrections may replace the rejected
    person's observation coordinates. Accepted drawings and their observations
    remain frozen; deleting a rejected drawing cannot masquerade as fixing it.
    """
    _check(current, visual_facts_schema(pack))
    needs = report.get('repairNeeds', [])
    excluded_frames = {person['id']:{frame for n in needs if n.get('itemType')=='people' and n.get('personId')==person['id']
                                    and n.get('code') in ('bench','non_player','wrong_foot') for frame in n.get('evidenceFrames',[])}
                       for person in previous['people']}
    excluded_ids = {person['id'] for person in previous['people']
                    if {row['frame'] for row in person['observations']} <= excluded_frames[person['id']]}
    route_targets = {n['personId'] for n in needs if n.get('itemType') == 'routes' or n.get('itemType')=='people'}
    wrong_frames = excluded_frames
    mutable_frames = {id:{frame for n in needs if (n.get('itemType')=='routes' or n.get('code') in ('bench','non_player','wrong_foot')) and n.get('personId')==id
                          for frame in n.get('evidenceFrames',[])} for id in route_targets}
    rejected = {field:{n['itemIndex'] for n in needs if n.get('itemType') == field} for field in ('routes','ball')}
    failures = []
    def fail(id, reason):
        failures.append({'personId':id,'code':'audit_repair_retention','reason':reason})
    new_people = {p['id']:p for p in current['people']}
    original_ids = {person['id'] for person in previous['people']}
    addition_frames = {frame for n in needs if n.get('allowNewLocalPerson') is True or n.get('itemType')=='ball'
                       for frame in n.get('evidenceFrames',[])}
    for id,person in new_people.items():
        if id not in original_ids and not ({row['frame'] for row in person['observations']} & addition_frames):
            failures.append({'personId':id,'code':'audit_repair_retention','reason':'新增人物必须对应明确漏人或错误持球目标的原观察帧。'})
    protected_frames = {}
    for field in ('routes','ball'):
        new_keys = Counter(_key(item) for item in current[field])
        for index,item in enumerate(previous[field]):
            if index in rejected[field] or item['personId'] in excluded_ids:continue
            key = _key(item)
            if new_keys[key] <= 0:
                fail(item['personId'], '已审核通过的图形不可更改。')
            new_keys[key] -= 1
            protected_frames.setdefault(item['personId'],set()).update(item['evidenceFrames'] if field=='routes' else [item['frame']])
    for old in previous['people']:
        id = old['id'];new = new_people.get(id)
        if new is None:
            if id in excluded_ids:continue
            fail(id,'定点修复不能删除原人物。');continue
        if id not in route_targets and _key(old) != _key(new):
            fail(id,'未指定的原人物必须保留。')
        if old['action'] in MOVING_ACTIONS and new['action'] not in MOVING_ACTIONS:
            fail(id,'不能通过把移动变成未知或静止消除审核失败。')
        new_rows = {row['frame']:row for row in new['observations']}
        for row in old['observations']:
            if row['frame'] not in new_rows:
                if row['frame'] not in wrong_frames.get(id,set()):fail(id,'旧观察帧不可删除，只可按原图纠正错误位置。')
            elif row['frame'] in protected_frames.get(id,set()) and row != new_rows[row['frame']]:
                fail(id,'已审核通过图形依赖的脚点不能更改。')
            elif row['frame'] not in mutable_frames.get(id,set()) and row != new_rows[row['frame']]:
                fail(id,'审核未指出的观察帧不能重新定位。')
    for id,count in Counter(item['personId'] for item in previous['routes']).items():
        if id in excluded_ids:continue
        if sum(item['personId']==id for item in current['routes']) < count:
            fail(id,'被拒路线必须修正后复审，不能静默删除。')
    available = set(range(len(current['routes'])))
    for index,old in enumerate(previous['routes']):
        if index in rejected['routes'] or old['personId'] in excluded_ids:continue
        match = next((i for i in available if _key(current['routes'][i])==_key(old)),None)
        if match is not None:available.remove(match)
    for index in sorted(rejected['routes'],key=lambda i:-len(previous['routes'][i]['evidenceFrames'])):
        old = previous['routes'][index]
        if old['personId'] in excluded_ids:continue
        match = next((i for i in available if current['routes'][i]['personId']==old['personId']
                      and current['routes'][i]['anchorFrame']==old['anchorFrame']
                      and current['routes'][i]['meaning']==old['meaning']
                      and set(old['evidenceFrames']) <= set(current['routes'][i]['evidenceFrames'])),None)
        if match is None:
            fail(old['personId'],'被拒路线的原参考帧、动作含义和全部依据帧必须继续复审，不能缩短逃避。')
        else:available.remove(match)
    old_ball_frames = Counter(item['frame'] for item in previous['ball'] if item['personId'] not in excluded_ids)
    new_ball_frames = Counter(item['frame'] for item in current['ball'])
    if any(new_ball_frames[frame] < count for frame,count in old_ball_frames.items()):
        fail(None,'错误持球项必须纠正人物后复审，不能删除参考帧。')
    if any(_key(item) not in {_key(value) for value in current['static']} for item in previous['static']
           if item['personId'] not in excluded_ids and item['frame'] not in wrong_frames.get(item['personId'],set())):
        fail(None,'已有位置标记必须保留。')
    if failures:
        raise VisualFactsFailure('audit_repair_retention','审核修复越过了指定范围或删除了原覆盖义务。',failures)
