"""Bounded jersey-reading proposals linked to registered player observations.

Names come only from the season/team/jersey roster lookup. Vision output is
limited to visible text and never confirms a person's identity.
"""
import base64
import json
import math
import os
from pathlib import Path
import re
import threading
import urllib.error
import urllib.request

from PIL import Image, ImageOps, ImageDraw, ImageFilter, ImageStat

from identity_ocr import TEAM_ALIASES, jersey_number, team_codes
from initial_identity_review import rows_at

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[1]
DEFAULT_TOKEN_PLAN_URL = 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'
MAX_EVIDENCE_PER_PLAYER = 8
MAX_EVIDENCE_HARD_LIMIT = 12
MAX_ENTITY_CALLS = 10
ALGORITHM = 'target-evidence-continuity-roster-v4'


def _safe_request_error(exc, provider='Token Plan'):
    """Safe, useful transport diagnostics; never stringify an exception reason."""
    import ssl
    if isinstance(exc,urllib.error.HTTPError):
        return f'{provider} 视觉请求失败（http_error HTTP {int(exc.code)}）。'
    reason=exc.reason if isinstance(exc,urllib.error.URLError) else exc
    number=getattr(reason,'errno',None)
    number=number if type(number) is int else None
    known={'ConnectionResetError','ConnectionRefusedError','ConnectionAbortedError','TimeoutError',
        'OSError','gaierror','SSLError','SSLEOFError','SSLCertVerificationError'}
    reason_type=type(reason).__name__
    reason_type=reason_type if reason_type in known else 'unknown_error'
    if isinstance(reason,TimeoutError):
        category='timeout'
    elif isinstance(reason,ssl.SSLError):
        category='tls_error'
    elif isinstance(reason,ConnectionResetError) or number in (54,104,10054):
        category='connection_reset'
    elif isinstance(reason,ConnectionRefusedError):
        category='connection_refused'
    elif isinstance(exc,urllib.error.URLError):
        category='url_error'
    else:
        category='request_error'
    fields=[category,reason_type]
    if number is not None:
        fields.append('errno='+str(number))
    return provider+' 视觉请求失败（'+' '.join(fields)+'）。'


def _jpeg_request_payload(path,quality=85):
    """Keep source dimensions and avoid enlarging an already compressed JPEG."""
    import io
    original=Path(path).read_bytes()
    with Image.open(io.BytesIO(original)) as source:
        was_jpeg=source.format=='JPEG'
        output=io.BytesIO()
        source.convert('RGB').save(output,'JPEG',quality=quality,optimize=True)
    compressed=output.getvalue()
    return original if was_jpeg and len(original)<=len(compressed) else compressed


def _load_server_config():
    """Read only model configuration names from env / root .env; never return key."""
    values = dict(os.environ)
    path = REPO_ROOT / '.env'
    if path.is_file():
        for line in path.read_text(encoding='utf-8-sig').splitlines():
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, value = line.split('=', 1)
            key, value = key.strip(), value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
                value = value[1:-1]
            if key and key not in values:
                values[key] = value
    return values


class TokenPlanVision:
    """One request per player using the existing Qwen OpenAI-compatible endpoint."""
    provider_label = 'Token Plan'
    request_options = {'enable_thinking': False, 'max_tokens': 4096}
    def __init__(self, config=None, opener=None, timeout=90):
        self.config = _load_server_config() if config is None else config
        self.opener = opener or urllib.request.urlopen
        self.timeout = timeout
        self.key = str(self.config.get('QWEN_TOKEN_PLAN_KEY', '')).strip()
        self.model = str(self.config.get('QWEN_TOKEN_PLAN_MODEL') or 'qwen3.8-max').strip()
        self.base_url = str(self.config.get('QWEN_TOKEN_PLAN_BASE_URL') or DEFAULT_TOKEN_PLAN_URL).rstrip('/')
        # URL validation is kept strict so this bounded interactive adapter cannot
        # be pointed at an arbitrary endpoint by session/browser input.
        from urllib.parse import urlsplit
        endpoint = urlsplit(self.base_url)
        if (not self.key or endpoint.scheme != 'https' or endpoint.hostname != 'token-plan.cn-beijing.maas.aliyuncs.com'
                or endpoint.username or endpoint.password or endpoint.query or endpoint.fragment):
            raise ValueError('Token Plan 未配置；请在服务端 .env 设置 QWEN_TOKEN_PLAN_KEY。')

    def status(self):
        return {'available': True, 'provider': 'qwen-token-plan', 'model': self.model,
                'message': 'Qwen Token Plan 已配置，供用户发起的交互式姓名识别使用。'}

    def read(self, images, labels):
        return self.review(images, labels)

    def review(self, images, labels, context=None):
        content = [{'type': 'text', 'text': (
            '每张证据图包含全帧上下文和放大的目标人物；青色框/箭头指向目标，读取目标自己的球衣，不能读前景或邻人。'
            '读取实际可见的球队文字、号码、背部姓氏；不根据球员常识猜。若人物遮挡不能确定号码归属，targetConfirmed=false。'
            '检查清晰度、球衣朝向和号码可读性。visibility取clear/partial/unreadable；confidence为0到1。'
            '不能根据名单、球员常识或号码常见程度猜。号码保留前导零，0 与 00 必须分开；不完整或模糊填空字符串。'
            '只输出 JSON：{"readings":[{"evidenceId":"...","teamText":"...","jerseyText":"...",'
            '"jerseyNameText":"...","targetConfirmed":true,"visibility":"clear","confidence":0.9,"reason":"..."}],'
            '"continuities":[{"targetEvidenceId":"...","referenceEvidenceId":"...","samePerson":true,'
            '"targetVisible":true,"confidence":0.9,"reason":"具体相貌/发型/体型/衣着或连续运动证据"}]}。'
            '每张图最多一个 reading；只用提供的 evidenceId。球队文字若只有颜色/队服样式，没有明确可读文字则填空。'
            '比较图上方为已经有号码证据的参考，下方为待续接目标。只判断是否同人，不因为同一P/T标签、同队颜色或建议号码而回答同人。'
            '没有比较图则continuities为空。看不清或只能靠号码猜测则samePerson=false并说明。'
            '号码不可读仍可独立比较是否同人；targetVisible表示青色框所指身体能明确辨认，合框或身体归属不明必须为false。'
        )}]
        if context:
            content.append({'type': 'text', 'text': json.dumps(context, ensure_ascii=False)})
        for label, path in zip(labels, images):
            encoded = base64.b64encode(_jpeg_request_payload(path)).decode('ascii')
            content.append({'type': 'text', 'text': '证据图 ' + label})
            content.append({'type': 'image_url', 'image_url': {'url': 'data:image/jpeg;base64,' + encoded}})
        payload = json.dumps({'model': self.model,
            'messages': [{'role': 'user', 'content': content}], 'temperature': 0,
            'response_format': {'type': 'json_object'}, **self.request_options}, ensure_ascii=False).encode()
        request = urllib.request.Request(self.base_url + '/chat/completions', data=payload,
            headers={'Authorization': 'Bearer ' + self.key, 'Content-Type': 'application/json'}, method='POST')
        try:
            with self.opener(request, timeout=self.timeout) as response:
                result = json.loads(response.read())
        except Exception as exc:
            # Never expose token, auth header, or request body in the service error.
            raise ValueError(_safe_request_error(exc, self.provider_label)) from None
        try:
            text = result['choices'][0]['message']['content']
            if isinstance(text, list):
                text = ''.join(part.get('text', '') for part in text if isinstance(part, dict))
            output = json.loads(text)
        except (KeyError, IndexError, TypeError, ValueError):
            raise ValueError(self.provider_label+' 未返回可读的结构化号码结果。') from None
        return output

    def generate(self, *, job, directory, schema, result, images, prompt):
        """Match the existing VisionProvider call contract for explicit use."""
        labels = [path.stem for path in images]
        output = self.review(images, labels, {'task': prompt})
        result.write_text(json.dumps(output, ensure_ascii=False), encoding='utf-8')
        return output


class OpenRouterVision(TokenPlanVision):
    """Use Astra for the same evidence reading / continuity contract as the UI."""
    provider_label = 'OpenRouter Astra'
    request_options = {'reasoning': {'effort': 'low'}, 'max_tokens': 8192}

    def __init__(self, config=None, opener=None, timeout=120):
        self.config = _load_server_config() if config is None else config
        self.opener = opener or urllib.request.urlopen
        self.timeout = timeout
        self.key = str(self.config.get('OPEN_ROUTER_KEY') or self.config.get('OPENROUTER_API_KEY') or '').strip()
        self.model = 'openai/gpt-6-astra'
        self.base_url = 'https://openrouter.ai/api/v1'
    def status(self):
        return {'available': bool(self.key), 'provider': 'openrouter', 'model': self.model,
                'message': 'OpenRouter Astra 已配置，供球衣证据读取和姓名续接使用。' if self.key else
                    'OpenRouter 未配置；请在服务端 .env 设置 OPEN_ROUTER_KEY。'}

    def review(self, images, labels, context=None):
        if not self.key:
            raise ValueError(self.status()['message'])
        return super().review(images, labels, context)


def create_openrouter_name_provider(*, opener=None, timeout=120):
    return OpenRouterVision(opener=opener, timeout=timeout)


def create_qwen_token_plan_provider(env_path=None, *, opener=None, timeout=90):
    """Explicit opt-in factory for user-started Token Plan experiments only."""
    config = _load_server_config()
    if env_path is not None:
        path = Path(env_path)
        for line in path.read_text(encoding='utf-8-sig').splitlines():
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                key, value = line.split('=', 1)
                config[key.strip()] = value.strip().strip('"\'')
    return TokenPlanVision(config=config, opener=opener, timeout=timeout)


def _valid_box(row, width, height):
    if (not isinstance(row, (list, tuple)) or len(row) < 5 or type(row[4]) is not int
            or any(type(v) not in (int, float) or not math.isfinite(v) for v in row[:4])):
        return False
    x1, y1, x2, y2 = row[:4]
    return 0 <= x1 < x2 <= width and 0 <= y1 < y2 <= height and y2 - y1 >= 24


def _identity_track(entity, frame, cuts, present):
    """Small Python equivalent of identity-timeline.identityAt for observed frames."""
    visibility = next((r for r in entity.get('visibilityRanges', [])
                       if r['start'] <= frame <= r['end']), None)
    keys = entity.get('identityKeyframes')
    if keys is None:
        keys = []
        for anchor in sorted(entity.get('anchors', []), key=lambda item: item['frame']):
            if anchor.get('trackId') is None or anchor.get('identityConfirmed') is False:
                continue
            if keys and keys[-1].get('trackId') == anchor['trackId']:
                continue
            keys.append({'frame': anchor['frame'], 'kind': 'track', 'trackId': anchor['trackId']})
    active = None

    def consider(event):
        nonlocal active
        if event.get('kind') == 'out_of_view' and visibility and visibility.get('state') != 'out_of_view':
            return
        if event['start'] <= frame <= event['end'] and (active is None or
                event['start'] > active['start'] or (event['start'] == active['start'] and
                event.get('order', 0) >= active.get('order', 0))):
            active = event

    for key in keys:
        consider({**key, 'start': key['frame'], 'end': math.inf, 'identitySource': 'manual_forward'})
    for binding in entity.get('bindings', []):
        if binding.get('scope') != 'track_occurrences' and binding.get('origin') != 'human_range_replacement':
            consider({**binding, 'identitySource': 'manual_unassigned' if binding['kind'] == 'unassigned' else 'manual_range'})
    replacements = [b for b in entity.get('bindings', []) if b.get('origin') == 'human_range_replacement'
                    and b['start'] <= frame <= b['end']]
    if replacements:
        replacement = max(replacements, key=lambda b: b.get('order', 0))
        if active is None or replacement.get('order', 0) >= active.get('order', 0):
            active = {**replacement, 'identitySource': 'manual_range'}
    if active and active['kind'] != 'unassigned' and any(active['start'] < cut <= frame for cut in cuts):
        active = None
    manual = any(anchor['frame'] == frame and (anchor.get('trackId') is None or
        int(anchor.get('trackId')) == int(active.get('trackId', -1) if active else -1))
        for anchor in entity.get('anchors', []))
    forward_gap = active and active.get('identitySource') == 'manual_forward' and active.get('kind') == 'track' \
        and active.get('trackId') not in present and not manual
    if active and not forward_gap:
        return (active.get('trackId'), active['identitySource']) if active['kind'] == 'track' else (None, active['identitySource'])
    occurrences = [b for b in entity.get('bindings', []) if b.get('scope') == 'track_occurrences'
                   and b.get('kind') == 'track' and b['start'] <= frame <= b['end']
                   and b.get('trackId') in present]
    occurrence_ids = {b['trackId'] for b in occurrences}
    if len(occurrence_ids) == 1:
        binding = max(occurrences, key=lambda b: b.get('order', 0))
        return binding['trackId'], 'track_occurrences'
    if len(occurrence_ids) > 1:
        return None, 'identity_conflict'
    if active:
        return None, active['identitySource']
    if entity.get('identitySuggestionsDismissed'):
        return None, 'identity_dismissed'
    models = [b for b in entity.get('modelBindings', []) if b.get('start', math.inf) <= frame <= b.get('end', -1)
              and not any(b['start'] < cut <= frame for cut in cuts)]
    if models:
        model = max(models, key=lambda b: (b['start'], b.get('order', 0)))
        return model.get('trackId'), 'modelBinding'
    return None, 'unassigned'


def _effective_ranges(session, clip):
    """Resolve each observed T using human precedence, then model suggestions."""
    frames = clip['frames']
    cuts = set(clip.get('sourceCuts', [])) | set(session.get('cuts', []))
    rows_by_frame = [rows_at(clip, index) for index in range(len(frames))]
    def role_review(risk):
        role=risk.get('role')
        evidence=risk.get('role_evidence')
        explicit=(risk.get('role_conflict') is True or risk.get('referee') is True or
            risk.get('is_referee') is True or str(role).lower() in ('referee','official'))
        if isinstance(evidence,dict):
            explicit |= str(evidence.get('role','')).lower() in ('referee','official')
        return explicit or risk.get('identity_review_required') is True and bool(evidence)
    color_review_tracks=set()
    for record in frames:
        for track,risk in record.get('track_evidence',{}).items():
            if (isinstance(risk,dict) and risk.get('color_conflict') is True and
                risk.get('identity_review_required') is True and not role_review(risk)):
                try:
                    color_review_tracks.add(int(track))
                except (TypeError,ValueError):
                    pass
    results = []
    for entity in session.get('entities', []):
        if entity.get('role') != 'player':
            continue
        values, current, previous = [], [], None
        def finish():
            nonlocal current
            if current:
                values.append(current)
                current = []
        for frame, record in enumerate(frames):
            if frame in cuts or record.get('missing'):
                finish(); previous = None
                continue
            observed = rows_by_frame[frame]
            track, source = _identity_track(entity, frame, cuts, set(observed))
            row = observed.get(track) if track is not None else None
            risk_records = record.get('track_evidence', {})
            risk = risk_records.get(str(track), risk_records.get(track, {})) if track is not None else {}
            if (row is None or not _valid_box(row, clip['width'], clip['height']) or
                    role_review(risk) or risk.get('identity_review_required') is True and
                    risk.get('color_conflict') is not True and track not in color_review_tracks):
                finish(); previous = None
                continue
            if previous is not None:
                old_frame, old_row, old_track = previous
                scale = max(old_row[2]-old_row[0], old_row[3]-old_row[1], row[2]-row[0], row[3]-row[1], 1)
                jump = math.hypot((old_row[0]+old_row[2]-row[0]-row[2])/2,
                                  (old_row[1]+old_row[3]-row[1]-row[3])/2) > scale
                if (old_track != track or frames[frame]['time']-frames[old_frame]['time'] > 2.5 or jump):
                    finish()
            current.append((frame, row, source))
            previous = (frame, row, track)
        finish()
        for segment in values:
            track_ids = {value[1][4] for value in segment}
            if len(segment) < 1 or len(track_ids) != 1:
                continue
            results.append({'entity': entity, 'trackId': next(iter(track_ids)),
                'start': segment[0][0], 'end': segment[-1][0], 'values': segment})
    owners = {}
    for segment in results:
        for frame, _, _ in segment['values']:
            owners.setdefault((frame, segment['trackId']), set()).add(segment['entity']['id'])
    return [segment for segment in results if all(
        len(owners[(frame, segment['trackId'])]) == 1 for frame, _, _ in segment['values'])]


def _select_evidence(segment, limit):
    values = segment['values']
    # Local source-image quality is measured before this selection. Temporal bins
    # retain varied poses; each bin contributes its clearest target observation.
    count = min(limit, len(values))
    quality = segment.get('quality', {})
    if quality:
        ranked = [value for value in values if value[0] in quality]
        if ranked:
            count = min(limit, len(ranked))
            chosen = []
            for index in range(count):
                group = ranked[index * len(ranked) // count:(index + 1) * len(ranked) // count]
                chosen.append(max(group, key=lambda v: quality[v[0]]['score']))
            return sorted(chosen, key=lambda v: v[0])
    chosen = []
    for i in range(count):
        target = i * (len(values) - 1) / max(1, count - 1)
        candidate = min((v for v in values if v not in chosen), key=lambda v: (abs(values.index(v)-target),
                         -(v[1][2]-v[1][0])*(v[1][3]-v[1][1])))
        chosen.append(candidate)
    return sorted(chosen, key=lambda v: v[0])


def _quality_pool(segments, limit=40):
    """Bound source decoding separately from billed model images."""
    selected = []
    ranked = sorted(segments, key=lambda s: (len(s['values']), s['end']), reverse=True)
    for segment in ranked[:limit]:
        values = _select_evidence(segment, min(3, len(segment['values'])))
        selected.extend((segment, value) for value in values[:max(0, limit-len(selected))])
    remaining = limit-len(selected)
    if remaining:
        existing = {(id(s), v[0]) for s, v in selected}
        for segment in ranked:
            for value in _select_evidence(segment, min(16, len(segment['values']))):
                if (id(segment), value[0]) not in existing:
                    selected.append((segment, value)); remaining -= 1
                if not remaining:
                    return selected
    return selected


def _image_quality(image, row, observations):
    """A pose-neutral sharpness/occlusion ranking; vision assesses jersey facing."""
    x1, y1, x2, y2 = row[:4]
    torso = image.crop((int(x1), int(y1 + .15*(y2-y1)), int(x2), int(y1 + .7*(y2-y1))))
    gray = torso.convert('L')
    sharpness = ImageStat.Stat(gray.filter(ImageFilter.FIND_EDGES)).var[0]
    area = max(1, (x2-x1)*(y2-y1))
    overlap = 0.0
    for other in observations.values():
        if other[4] == row[4]:
            continue
        intersection = max(0, min(x2, other[2])-max(x1, other[0])) * max(0, min(y2, other[3])-max(y1, other[1]))
        overlap = max(overlap, intersection/area)
    score = math.log1p(sharpness) + .45*math.log1p(area) - 5*overlap
    return {'score': round(score, 4), 'sharpness': round(sharpness, 2), 'overlap': round(overlap, 3),
            'boxArea': round(area, 1)}


def _crop_frame(image, row, path):
    x1, y1, x2, y2 = row[:4]
    w, h = x2-x1, y2-y1
    # Crop torso, with modest context for team text and jersey digits.
    crop = image.crop((max(0, math.floor(x1-.12*w)), max(0, math.floor(y1-.04*h)),
                       min(image.width, math.ceil(x2+.12*w)), min(image.height, math.ceil(y2+.03*h))))
    # Full source context identifies which overlapping body owns the digits.
    context = image.copy()
    draw = ImageDraw.Draw(context)
    draw.rectangle(tuple(map(round, row[:4])), outline=(0, 255, 255), width=max(2, image.width//400))
    context.thumbnail((960, 540), Image.Resampling.LANCZOS)
    crop = ImageOps.contain(crop, (340, 530), Image.Resampling.LANCZOS)
    panel = Image.new('RGB', (1320, 580), (18, 22, 28))
    panel.paste(context, (0, 40)); panel.paste(crop, (975+(340-crop.width)//2, 40))
    draw = ImageDraw.Draw(panel)
    draw.text((12, 12), f'TARGET CYAN BOX | {path.stem} | source context', fill='white')
    draw.text((978, 12), 'TARGET BODY (may be occluded)', fill=(0,255,255))
    panel.save(path, 'JPEG', quality=94)


def _comparison_frame(reference_path, target_path, destination):
    reference = Image.open(reference_path).convert('RGB')
    target = Image.open(target_path).convert('RGB')
    panel = Image.new('RGB', (1320, 1200), (18,22,28))
    panel.paste(reference, (0,20)); panel.paste(target, (0,620))
    draw = ImageDraw.Draw(panel)
    draw.text((8,2), 'REFERENCE: ' + reference_path.stem, fill=(255,220,80))
    draw.text((8,602), 'COMPARE TARGET: ' + target_path.stem, fill=(0,255,255))
    panel.save(destination, 'JPEG', quality=94)


def _team_code(text):
    value = re.sub(r'[^A-Z0-9]+', ' ', str(text).upper()).strip()
    value = ' '.join(value.split())
    aliases = {'MAVS': 'DAL', 'DALLAS MAVERICKS': 'DAL', 'H TOWN': 'HOU'}
    if value in aliases:
        return aliases[value]
    values = team_codes(text)
    return values[0] if len(values) == 1 else None


def _mapped_team(entity, team_map, player_data, season):
    if team_map:
        side = entity.get('teamSide') or ('red' if re.fullmatch(r'P(?:[1-5])', entity.get('id', '')) else
                                          'blue' if entity.get('id') in ('P6', 'P7', 'P8', 'P9', 'P10') else None)
        side_alias = {'red': 'A', 'blue': 'B'}.get(side)
        value = team_map.get(entity['id'], team_map.get(side, team_map.get(side_alias)))
        if isinstance(value, str) and value.upper() in {x['abbreviation'] for x in player_data.options(season)['teams']}:
            return value.upper()
    allowed = {x['abbreviation'] for x in player_data.options(season)['teams']}
    # An explicitly saved actual NBA abbreviation is acceptable team context.
    saved = str(entity.get('team') or '').upper()
    if saved in allowed:
        return saved
    ref = entity.get('identityReference')
    ref_team = _team_code(ref.get('team', '')) if isinstance(ref, dict) else None
    return ref_team if ref_team in allowed else None


def _resolve_team(entity, team_text, team_map, player_data, season):
    allowed = {x['abbreviation'] for x in player_data.options(season)['teams']}
    direct = _team_code(team_text)
    mapped = _mapped_team(entity, team_map, player_data, season)
    if str(team_text or '').strip():
        # Visible jersey/wordmark evidence overrides context only when it agrees.
        if direct in allowed and mapped and mapped != direct:
            return None
        return direct if direct in allowed else mapped
    return mapped


def recognize_player_names(session, clip, video, tactics, player_data, *, season=None,
                            team_map=None, provider=None, max_frames_per_entity=MAX_EVIDENCE_PER_PLAYER,
                            max_extra_frames=4, work_dir=None, cancel_event=None, reference_frames=None,
                            correction_targets=None, selected_entities=None):
    """Bounded source-pixel evidence and visual identity proposals; session is unchanged."""
    from player_name_evidence import recognize
    return recognize(session, clip, video, tactics, player_data, season=season, team_map=team_map,
        provider=provider, max_frames_per_entity=max_frames_per_entity, max_extra_frames=max_extra_frames,
        work_dir=work_dir, cancel_event=cancel_event, reference_frames=reference_frames,
        correction_targets=correction_targets, selected_entities=selected_entities)


def apply_reference_slot_identities(result):
    """Apply source-grounded stable slot analysis to a saved result without model calls."""
    from player_name_evidence import apply_reference_slot_identities as apply
    return apply(result)


if __name__ == '__main__':
    try:
        adapter = create_qwen_token_plan_provider()
        print(json.dumps(adapter.status(), ensure_ascii=False))
    except ValueError as error:
        print(json.dumps({'available': False, 'provider': 'qwen-token-plan', 'message': str(error)}, ensure_ascii=False))
