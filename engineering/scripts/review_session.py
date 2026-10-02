"""Validate and edit a browser-owned review draft without persisting it."""

from copy import deepcopy
import math
import re


IDENTITY_BINDING_MODE = 'forward_only_v1'
PLAYER_IDS = {f'P{i}' for i in range(1, 11)}
IDENTITY_KINDS = {'track', 'untracked', 'out_of_view', 'unassigned'}
PERSON_RECORDS = ('anchors', 'identityKeyframes', 'bindings', 'courtAnchors', 'events')


def _integer(value, name, low=0, high=2**53 - 1):
    if type(value) is not int or not low <= value <= high:
        raise ValueError(f'{name} 必须是 {low}–{high} 范围内的整数。')
    return value


def _number(value, name):
    try:
        valid = type(value) in (int, float) and math.isfinite(value)
    except OverflowError:
        valid = False
    if not valid:
        raise ValueError(f'{name} 必须是有限数值。')


def _json_values(value, depth=0):
    if depth > 64:
        raise ValueError('草稿结构过深。')
    if isinstance(value, dict):
        for key, child in value.items():
            if not isinstance(key, str):
                raise ValueError('草稿字段名称必须是文本。')
            _json_values(child, depth + 1)
    elif isinstance(value, list):
        for child in value:
            _json_values(child, depth + 1)
    elif type(value) in (int, float):
        _number(value, '草稿数值')
    elif value is not None and type(value) not in (str, bool):
        raise ValueError('草稿包含不支持的数据类型。')


def _list(container, key):
    value = container.get(key, [])
    if not isinstance(value, list):
        raise ValueError(f'{key} 必须是列表。')
    return value


def _roles(value):
    if value is None:
        return
    if (not isinstance(value, dict) or set(value) != {'red', 'blue'} or
            (value['red'], value['blue']) not in (('offense', 'defense'), ('defense', 'offense'))):
        raise ValueError('红蓝两队须分别设为进攻和防守，或将攻守设为空。')


def _identity_record(record, frame_count, interval=False):
    if (not isinstance(record, dict) or not isinstance(record.get('kind'), str) or
            record['kind'] not in IDENTITY_KINDS):
        raise ValueError('身份记录类型不正确。')
    if interval:
        start = _integer(record.get('start'), '身份区间起点', high=frame_count - 1)
        end = _integer(record.get('end'), '身份区间终点', high=frame_count - 1)
        if start > end:
            raise ValueError('身份区间起点不能晚于终点。')
    else:
        _integer(record.get('frame'), '身份确认帧', high=frame_count - 1)
    if record['kind'] == 'track':
        _integer(record.get('trackId'), '临时编号')
    elif record.get('trackId') is not None:
        raise ValueError('未关联或出画记录不能带临时编号。')
    if 'order' in record:
        _integer(record['order'], '身份顺序')


def validate_session(session, clip):
    """Validate the supported draft contract before making a private copy."""
    if not isinstance(session, dict) or type(session.get('version')) is not int or session['version'] != 1:
        raise ValueError('仅支持 version 1 的工作台草稿。')
    _json_values(session)
    frames = clip.get('frames')
    if not isinstance(frames, list) or not frames:
        raise ValueError('视频帧数据不可用。')
    frame_count = len(frames)
    if not isinstance(session.get('videoHash'), str) or session['videoHash'] != clip.get('video_sha256'):
        raise ValueError('草稿与当前视频不匹配。')
    if session.get('identityBindingMode', IDENTITY_BINDING_MODE) != IDENTITY_BINDING_MODE:
        raise ValueError('草稿身份关联版本不受支持。')
    _number(session.get('maxGapSeconds'), '补点间隔')
    if session['maxGapSeconds'] < 0:
        raise ValueError('补点间隔不能为负数。')
    for cut in _list(session, 'cuts'):
        _integer(cut, '切镜帧', high=frame_count - 1)
    if 'identitySequence' in session:
        _integer(session['identitySequence'], '身份顺序')
    _roles(session.get('teamRoles'))
    entities = _list(session, 'entities')
    ids = set()
    for entity in entities:
        if not isinstance(entity, dict):
            raise ValueError('人物记录必须是对象。')
        ident = entity.get('id')
        if not isinstance(ident, str) or ident in ids or not re.fullmatch(r'P(?:[1-9]|10)|R[1-3]', ident):
            raise ValueError('人物槽位必须是唯一的 P1–P10 或 R1–R3。')
        ids.add(ident)
        if entity.get('role') != ('player' if ident.startswith('P') else 'referee'):
            raise ValueError('人物角色与槽位不匹配。')
        for field in ('name', 'team', 'jersey', 'description'):
            if field in entity and not isinstance(entity[field], str):
                raise ValueError(f'{ident} 的 {field} 必须是文本。')
        if 'teamSide' in entity and entity['teamSide'] not in (None, 'red', 'blue'):
            raise ValueError('队伍颜色必须是 red 或 blue。')
        for field in ('anchors', 'courtAnchors', 'events'):
            for record in _list(entity, field):
                if not isinstance(record, dict):
                    raise ValueError(f'{field} 记录必须是对象。')
                _integer(record.get('frame'), f'{field} 帧', high=frame_count - 1)
                if field != 'events':
                    _number(record.get('x'), f'{field} 横坐标')
                    _number(record.get('y'), f'{field} 纵坐标')
                if record.get('trackId') is not None:
                    _integer(record['trackId'], '临时编号')
                if 'box' in record and record['box'] is not None:
                    box = record['box']
                    if not isinstance(box, list) or len(box) != 4:
                        raise ValueError('人物框须包含四个坐标。')
                    for value in box:
                        _number(value, '人物框坐标')
                    if box[0] > box[2] or box[1] > box[3]:
                        raise ValueError('人物框坐标顺序不正确。')
        for key in _list(entity, 'identityKeyframes'):
            _identity_record(key, frame_count)
        for binding in _list(entity, 'bindings'):
            _identity_record(binding, frame_count, interval=True)
    if not PLAYER_IDS.issubset(ids):
        raise ValueError('草稿必须包含完整的 P1–P10 球员槽位。')
    return frame_count


def _prepare(session, source_cuts):
    session['cuts'] = sorted(set(session.get('cuts', []) + source_cuts))
    session['identityBindingMode'] = IDENTITY_BINDING_MODE
    for entity in session['entities']:
        if entity['role'] == 'player':
            entity['teamSide'] = 'red' if int(entity['id'][1:]) <= 5 else 'blue'
        if 'identityKeyframes' not in entity:
            keys = []
            for anchor in sorted(entity.get('anchors', []), key=lambda item: item['frame']):
                if anchor.get('trackId') is None or anchor.get('identityConfirmed') is False:
                    continue
                if keys and keys[-1]['trackId'] == anchor['trackId']:
                    continue
                keys.append({'frame': anchor['frame'], 'kind': 'track',
                             'trackId': anchor['trackId'], 'origin': 'legacy_anchor'})
            entity['identityKeyframes'] = keys


def _entity(session, ident):
    for entity in session['entities']:
        if entity['id'] == ident:
            return entity
    raise ValueError('找不到指定人物槽位。')


def apply_review_edit(session, operation, clip):
    """Return a complete edited draft; inputs and server/library data stay intact."""
    frame_count = validate_session(session, clip)
    if not isinstance(operation, dict):
        raise ValueError('operation 必须是对象。')
    _json_values(operation)
    source_cuts = clip.get('sourceCuts', [])
    if not isinstance(source_cuts, list):
        raise ValueError('来源切镜数据不正确。')
    for cut in source_cuts:
        _integer(cut, '固定拼接帧', high=frame_count - 1)
    draft = deepcopy(session)
    _prepare(draft, source_cuts)
    kind = operation.get('type')
    affected = None
    if kind == 'clear_player':
        entity = _entity(draft, operation.get('entityId'))
        for field in PERSON_RECORDS:
            entity[field] = []
        draft['identitySelection'] = None
        affected = {'start': 0, 'end': frame_count - 1}
        message = f"{entity['id']} 的整段关联与位置已清空，姓名和球队资料保留。"
    elif kind == 'release_identity':
        entity = _entity(draft, operation.get('entityId'))
        start = _integer(operation.get('frame'), '取消关联帧', high=frame_count - 1)
        boundaries = ([key['frame'] for key in entity['identityKeyframes']] +
                      [binding['start'] for binding in entity.get('bindings', [])] + draft['cuts'])
        end = min([frame_count] + [frame for frame in boundaries if frame > start]) - 1
        orders = [draft.get('identitySequence', 0)]
        for item in draft['entities']:
            orders += [record.get('order', 0) for field in ('identityKeyframes', 'bindings')
                       for record in item.get(field, [])]
        order = max(orders) + 1
        _integer(order, '身份顺序')
        draft['identitySequence'] = order
        entity.setdefault('bindings', []).append({
            'kind': 'unassigned', 'trackId': None, 'start': start, 'end': end,
            'order': order, 'exclusive': True, 'origin': 'human_release', 'identitySource': 'human',
        })
        draft['identitySelection'] = None
        affected = {'start': start, 'end': end}
        message = f"{entity['id']} 第 {start + 1}–{end + 1} 帧已取消关联，等待重新选择。"
    elif kind == 'swap_players':
        source = _entity(draft, operation.get('sourceId'))
        target = _entity(draft, operation.get('targetId'))
        if source['role'] != 'player' or target['role'] != 'player' or source is target:
            raise ValueError('请选择两个不同的球员槽位进行交换。')
        source_id, target_id = source['id'], target['id']
        source_data, target_data = deepcopy(source), deepcopy(target)
        source.clear()
        source.update(target_data, id=source_id, teamSide='red' if int(source_id[1:]) <= 5 else 'blue')
        target.clear()
        target.update(source_data, id=target_id, teamSide='red' if int(target_id[1:]) <= 5 else 'blue')
        draft['identitySelection'] = None
        affected = {'start': 0, 'end': frame_count - 1}
        message = f'{source_id} 与 {target_id} 的整段人物资料和轨迹已交换。'
    elif kind == 'set_team_roles':
        if 'teamRoles' not in operation:
            raise ValueError('缺少 teamRoles。')
        _roles(operation['teamRoles'])
        draft['teamRoles'] = deepcopy(operation['teamRoles'])
        message = '红蓝队攻守设置已保存。'
    else:
        raise ValueError('不支持的草稿操作。')
    result = {'session': draft, 'message': message}
    if affected is not None:
        result['affectedRange'] = affected
    return result
