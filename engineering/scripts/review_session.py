"""Validate and edit a browser-owned review draft without persisting it."""

from copy import deepcopy
import math
import re


IDENTITY_BINDING_MODE = 'forward_only_v1'
TRACK_OCCURRENCES_SCOPE = 'track_occurrences'
PLAYER_IDS = {f'P{i}' for i in range(1, 11)}
IDENTITY_KINDS = {'track', 'untracked', 'out_of_view', 'unassigned'}
PERSON_RECORDS = ('anchors', 'identityKeyframes', 'bindings', 'modelBindings', 'courtAnchors', 'events', 'frameConfirmations', 'visibilityRanges')
FRAME_CONFIRMATION_SCOPES = {'track_occurrences', 'manual_forward', 'manual_range', 'model_suggestion', 'manual_position'}


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


def _legacy_roles(value):
    """Read historical role labels for migration, without assigning new ones."""
    if value is None:
        return
    if (not isinstance(value, dict) or set(value) != {'red', 'blue'} or
            (value['red'], value['blue']) not in (('offense', 'defense'), ('defense', 'offense'))):
        raise ValueError('旧草稿的攻守字段格式不正确。')


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
    if 'scope' in record:
        if not interval or record['kind'] != 'track' or record['scope'] != TRACK_OCCURRENCES_SCOPE:
            raise ValueError('身份区间作用范围不受支持。')
        _integer(record.get('trackId'), '临时编号', low=1)
    if 'selectionFrame' in record:
        _integer(record['selectionFrame'], '选取帧', high=frame_count - 1)
    if record.get('origin') == 'human_range_replacement':
        if not interval or record['kind'] != 'track' or record.get('exclusive') is not True or 'scope' in record:
            raise ValueError('完整区间替换必须是有限的独占人物关联。')
        _integer(record.get('order'), '区间替换顺序', low=1)


def _range_correction(record, frames):
    """A relative edit carries original observations, not an invented detection."""
    evidence = record.get('rangeCorrection')
    if not isinstance(evidence, dict) or evidence.get('originalSource') not in ('tracked', 'manual'):
        raise ValueError('区间位置修正必须保留合法原始来源。')
    if not isinstance(evidence.get('operationId'), str) or not 0 < len(evidence['operationId']) <= 256:
        raise ValueError('区间位置修正缺少操作编号。')
    if evidence.get('method') != 'relative_keyframe_interpolation' or evidence.get('mode') not in ('box', 'foot'):
        raise ValueError('区间位置修正方法不正确。')
    support = evidence.get('supportFrames')
    if not isinstance(support, list) or not 1 <= len(support) <= 2:
        raise ValueError('区间位置修正须保留一或两个依据帧。')
    for frame in support:
        _integer(frame, '区间修正依据帧', high=len(frames) - 1)
    if len(set(support)) != len(support) or type(evidence.get('keyframe')) is not bool:
        raise ValueError('区间位置修正依据帧或关键帧标记不正确。')
    if evidence['keyframe'] != (record['frame'] in support):
        raise ValueError('区间位置修正关键帧标记与依据帧不符。')
    track_id = record.get('trackId')
    if evidence.get('originalTrackId') != track_id or (track_id is None and evidence['originalSource'] != 'manual'):
        raise ValueError('区间位置修正的原始人物编号不正确。')
    if track_id is not None and not any(isinstance(row, (list, tuple)) and len(row) > 4 and row[4] == track_id
                                       for row in frames[record['frame']].get('tracks', [])):
        raise ValueError('区间位置修正不能在缺测帧假造人物框。')


def _frame_confirmation(record, frame_count):
    if not isinstance(record, dict):
        raise ValueError('逐帧确认记录必须是对象。')
    _integer(record.get('frame'), '人工确认帧', high=frame_count - 1)
    _integer(record.get('identityOrder'), '确认关联顺序')
    scope = record.get('identityScope')
    if not isinstance(scope, str) or scope not in FRAME_CONFIRMATION_SCOPES:
        raise ValueError('逐帧确认的关联范围无效。')
    if record.get('trackId') is not None or scope != 'manual_position':
        _integer(record.get('trackId'), '确认临时编号', low=1)
    origin = record.get('origin')
    if origin not in ('human_track_selection', 'human_frame_review'):
        raise ValueError('逐帧确认来源无效。')
    if origin == 'human_track_selection' and scope != TRACK_OCCURRENCES_SCOPE:
        raise ValueError('编号点选确认只适用于实际出现帧。')
    for field in ('identityToken', 'anchorSignature'):
        required = (field == 'identityToken' and origin == 'human_frame_review' or
                    field == 'anchorSignature' and scope == 'manual_position')
        if required or field in record:
            value = record.get(field)
            if not isinstance(value, str) or not 0 < len(value) <= 8192:
                raise ValueError(f'逐帧确认的 {field} 必须是 1–8192 字符的文本。')


def validate_identity_reference(reference, clip):
    """A saved visual reference identifies one registered observation only."""
    fields = {'version', 'videoHash', 'trackingFingerprint', 'frame', 'trackId', 'box', 'team', 'jersey'}
    if (not isinstance(reference, dict) or set(reference) != fields or
            type(reference.get('version')) is not int or reference['version'] != 1):
        raise ValueError('身份参考字段或版本不正确。')
    for field, source in (('videoHash', 'video_sha256'), ('trackingFingerprint', 'tracking_fingerprint')):
        value = reference[field]
        if not isinstance(value, str) or not value or value != clip.get(source):
            raise ValueError('身份参考与当前视频或跟踪版本不匹配。')
    frames = clip.get('frames')
    if not isinstance(frames, list) or not frames:
        raise ValueError('身份参考的视频帧不可用。')
    frame = _integer(reference['frame'], '身份参考帧', high=len(frames) - 1)
    track_id = _integer(reference['trackId'], '身份参考临时编号', low=1)
    box = reference['box']
    if not isinstance(box, list) or len(box) != 4:
        raise ValueError('身份参考框须包含四个坐标。')
    for value in box:
        _number(value, '身份参考框坐标')
    rows = [row for row in frames[frame].get('tracks', [])
            if isinstance(row, (list, tuple)) and len(row) > 4 and row[4] == track_id]
    if len(rows) != 1 or box != list(rows[0][:4]) or box[0] >= box[2] or box[1] >= box[3]:
        raise ValueError('身份参考必须使用所选帧的实际人物检测框。')
    team, jersey = reference['team'], reference['jersey']
    if not isinstance(team, str) or len(team) > 40 or re.search(r'[\x00-\x1f\x7f]', team):
        raise ValueError('参考球队或球衣描述须为不超过 40 字的文本。')
    if not isinstance(jersey, str) or not re.fullmatch(r'[0-9]{0,3}', jersey):
        raise ValueError('参考球衣号码须为空或 1–3 位数字。')
    return reference


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
    _legacy_roles(session.get('teamRoles'))
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
        if 'identityReference' in entity:
            validate_identity_reference(entity['identityReference'], clip)
        if 'teamSide' in entity and entity['teamSide'] not in (None, 'red', 'blue'):
            raise ValueError('队伍颜色必须是 red 或 blue。')
        if ('identitySuggestionsDismissed' in entity and
                type(entity['identitySuggestionsDismissed']) is not bool):
            raise ValueError('模型建议取消标记必须是布尔值。')
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
                if record.get('source') == 'manual_range':
                    if field != 'anchors':
                        raise ValueError('区间相对位置修正只适用于原图位置。')
                    _range_correction(record, frames)
        for key in _list(entity, 'identityKeyframes'):
            _identity_record(key, frame_count)
        for binding in _list(entity, 'bindings'):
            _identity_record(binding, frame_count, interval=True)
        for confirmation in _list(entity, 'frameConfirmations'):
            _frame_confirmation(confirmation, frame_count)
        visibility_end = -1
        for record in _list(entity, 'visibilityRanges'):
            if not isinstance(record, dict) or record.get('state') not in ('visible', 'occluded', 'out_of_view'):
                raise ValueError('球员画面状态不正确。')
            start = _integer(record.get('start'), '画面状态起点', high=frame_count - 1)
            end = _integer(record.get('end'), '画面状态终点', high=frame_count - 1)
            if start > end or start <= visibility_end:
                raise ValueError('画面状态区间必须按帧排序，且不能重叠。')
            visibility_end = end
        for field in ('modelBindings', 'dismissedModelBindings'):
            for binding in _list(entity, field):
                _identity_record(binding, frame_count, interval=True)
                if binding['kind'] != 'track' or binding['trackId'] < 1:
                    raise ValueError('模型建议须关联有效的临时编号。')
    if not PLAYER_IDS.issubset(ids):
        raise ValueError('草稿必须包含完整的 P1–P10 球员槽位。')
    return frame_count


def _prepare(session, source_cuts):
    session['cuts'] = sorted(set(session.get('cuts', []) + source_cuts))
    session['identityBindingMode'] = IDENTITY_BINDING_MODE
    # Colors identify roster groups; historical role labels have no evidence.
    session.pop('teamRoles', None)
    for field in ('automaticAnnotation', 'modelSuggestionLoad'):
        metadata = session.get(field)
        if isinstance(metadata, dict) and 'teamLayout' in metadata:
            metadata['teamLayout'] = 'fixed_red_blue_color_only_v1'
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


def _label(entity):
    return ('球员 ' if entity['role'] == 'player' else '裁判 ') + entity['id'][1:]


def _next_identity_order(session):
    orders = [session.get('identitySequence', 0)]
    for entity in session['entities']:
        orders += [record.get('order', 0) for field in ('identityKeyframes', 'bindings')
                   for record in entity.get(field, [])]
    order = _integer(max(orders) + 1, '身份顺序')
    session['identitySequence'] = order
    return order


def _occurrence_ranges(frames, cuts):
    """Group observed frame indexes only; a gap or cut always starts a range."""
    ranges = []
    for frame in frames:
        if not ranges or frame != ranges[-1]['end'] + 1 or frame in cuts:
            ranges.append({'start': frame, 'end': frame})
        else:
            ranges[-1]['end'] = frame
    return ranges


def _bulk_bindings(entity):
    return [binding for binding in entity.get('bindings', [])
            if binding.get('scope') == TRACK_OCCURRENCES_SCOPE and binding['kind'] == 'track']


def _split_bulk_at_cuts(entity, track_id, cuts):
    """New cuts split stored occurrences without changing the original claim."""
    if 'bindings' not in entity:
        return
    segments = []
    for binding in entity['bindings']:
        if binding.get('scope') != TRACK_OCCURRENCES_SCOPE or binding.get('trackId') != track_id:
            segments.append(binding)
            continue
        boundaries = [binding['start'], *[cut for cut in cuts
                      if binding['start'] < cut <= binding['end']], binding['end'] + 1]
        segments.extend({**binding, 'start': start, 'end': stop - 1}
                        for start, stop in zip(boundaries, boundaries[1:]))
    entity['bindings'] = segments


def _dismiss_observations(entity, records):
    """Keep rejected observations with the person when records move to a slot."""
    for record in records:
        dismissed = entity.setdefault('dismissedModelBindings', [])
        if record not in dismissed:
            dismissed.append(deepcopy(record))


def _release_boundaries(entity, start, cuts):
    records = [{**key, 'start': key['frame'], 'end': math.inf} for key in entity['identityKeyframes']]
    records += [binding for binding in entity.get('bindings', []) if binding.get('scope') != TRACK_OCCURRENCES_SCOPE]
    active = [record for record in records if record['start'] <= start <= record['end']]
    ordinary = max((record for record in active if record.get('origin') != 'human_range_replacement'),
                   key=lambda record: (record['start'], record.get('order', 0)), default=None)
    replacement = max((record for record in active if record.get('origin') == 'human_range_replacement'),
                      key=lambda record: record.get('order', 0), default=None)
    if replacement and (not ordinary or replacement['order'] >= ordinary.get('order', 0)):
        return [replacement['end'] + 1, *cuts, *[record['start'] for record in records
                                               if record.get('order', 0) > replacement['order']]]
    return ([key['frame'] for key in entity['identityKeyframes']] +
            [binding['start'] for binding in entity.get('bindings', [])] +
            [binding['end'] + 1 for binding in _bulk_bindings(entity)] + cuts)


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
    assignment = None
    if kind == 'assign_track':
        entity = _entity(draft, operation.get('entityId'))
        frame = _integer(operation.get('frame'), '选取帧', high=frame_count - 1)
        track_id = _integer(operation.get('trackId'), '临时编号', low=1)
        observed = [index for index, record in enumerate(clip['frames'])
                    if any(isinstance(row, (list, tuple)) and len(row) > 4 and
                           type(row[4]) in (int, float) and row[4] == track_id
                           for row in record.get('tracks', []))]
        if frame not in observed:
            raise ValueError('当前帧没有所选临时编号。')
        ranges = _occurrence_ranges(observed, set(draft['cuts']))
        _split_bulk_at_cuts(entity, track_id, draft['cuts'])
        existing = [binding for binding in _bulk_bindings(entity) if binding['trackId'] == track_id]
        missing = [index for index in observed if not any(
            binding['start'] <= index <= binding['end'] for binding in existing)]
        if missing:
            order = _next_identity_order(draft)
            entity.setdefault('bindings', []).extend({
                'kind': 'track', 'trackId': track_id, **span,
                'scope': TRACK_OCCURRENCES_SCOPE, 'origin': 'human_track_assignment',
                'selectionFrame': frame, 'order': order, 'exclusive': False, 'reviewRequired': True,
            } for span in _occurrence_ranges(missing, set(draft['cuts'])))
            draft['identitySelection'] = None
        selected_binding = max((binding for binding in _bulk_bindings(entity)
                                if binding['trackId'] == track_id and binding['start'] <= frame <= binding['end']),
                               key=lambda binding: binding.get('order', 0))
        confirmation = {'frame': frame, 'trackId': track_id, 'origin': 'human_track_selection',
                        'identityOrder': selected_binding.get('order', 0), 'identityScope': TRACK_OCCURRENCES_SCOPE}
        confirmations = entity.setdefault('frameConfirmations', [])
        if confirmation not in confirmations:
            confirmations.append(confirmation)
        assignment = {'trackId': track_id, 'observationCount': len(observed),
                      'rangeCount': len(ranges), 'ranges': ranges}
        message = (f'T{track_id} 的 {len(observed)} 个观测帧（{len(ranges)} 段）已归并到{_label(entity)}，'
                   f'仅第 {frame + 1} 帧记录了本次人工确认，其余仍待逐帧核对；已有人工位置、区间与取消记录保留。')
    elif kind == 'clear_player':
        entity = _entity(draft, operation.get('entityId'))
        # Rejection follows the observed track intervals as well as this person.
        # Otherwise swapping a cleared person into an empty slot could let the
        # same model observations reappear at their original numbered slot.
        _dismiss_observations(entity, entity.get('modelBindings', []) + _bulk_bindings(entity))
        for field in PERSON_RECORDS:
            entity[field] = []
        # The browser reloads model proposals on startup. Persist the user's
        # deliberate clearing so those proposals cannot silently fill it again.
        entity['identitySuggestionsDismissed'] = True
        for field in ('modelTeamGroup', 'modelTeamHint', 'automaticTeamEvidence', 'identityReference'):
            entity.pop(field, None)
        draft['identitySelection'] = None
        affected = {'start': 0, 'end': frame_count - 1}
        message = f"{_label(entity)} 的整段关联、位置与身份参考已清空，姓名和球队资料保留。"
    elif kind == 'release_identity':
        entity = _entity(draft, operation.get('entityId'))
        start = _integer(operation.get('frame'), '取消关联帧', high=frame_count - 1)
        boundaries = _release_boundaries(entity, start, draft['cuts'])
        end = min([frame_count] + [frame for frame in boundaries if frame > start]) - 1
        order = _next_identity_order(draft)
        entity.setdefault('bindings', []).append({
            'kind': 'unassigned', 'trackId': None, 'start': start, 'end': end,
            'order': order, 'exclusive': True, 'origin': 'human_release', 'identitySource': 'human',
        })
        if 'frameConfirmations' in entity:
            entity['frameConfirmations'] = [record for record in entity['frameConfirmations']
                                            if not start <= record['frame'] <= end]
        # Keep evidence outside the released interval. The human unassigned
        # binding remains authoritative if suggestions are reloaded later.
        if 'modelBindings' in entity:
            remaining = []
            for binding in entity['modelBindings']:
                if binding['end'] < start or binding['start'] > end:
                    remaining.append(binding)
                else:
                    _dismiss_observations(entity, [{
                        **binding, 'start': max(start, binding['start']), 'end': min(end, binding['end'])}])
                    if binding['start'] < start:
                        remaining.append({**binding, 'end': start - 1})
                    if binding['end'] > end:
                        remaining.append({**binding, 'start': end + 1})
            entity['modelBindings'] = remaining
        _dismiss_observations(entity, [{
            **binding, 'start': max(start, binding['start']), 'end': min(end, binding['end'])}
            for binding in _bulk_bindings(entity) if binding['start'] <= end and binding['end'] >= start])
        draft['identitySelection'] = None
        affected = {'start': start, 'end': end}
        message = f"{_label(entity)} 第 {start + 1}–{end + 1} 帧已取消关联，等待重新选择。"
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
        message = f'{_label(source)} 与 {_label(target)} 的整段人物资料和轨迹已交换。'
    elif kind == 'set_team_roles':
        if 'teamRoles' not in operation:
            raise ValueError('缺少 teamRoles。')
        if operation['teamRoles'] is not None:
            raise ValueError('当前只记录红蓝颜色分队，不设置进攻或防守；旧攻守字段只支持清除。')
        message = '旧攻守字段已清除，保留红蓝颜色分队。'
    else:
        raise ValueError('不支持的草稿操作。')
    result = {'session': draft, 'message': message}
    if affected is not None:
        result['affectedRange'] = affected
    if assignment is not None:
        result['assignment'] = assignment
    return result
