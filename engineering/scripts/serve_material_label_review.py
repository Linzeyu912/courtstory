"""Local human video-label review page, with atomic JSON feedback persistence."""
import argparse
import hashlib
import json
import mimetypes
import os
import re
import threading
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[2]
UI = ROOT / 'engineering/tools/material-label-review'
DEFAULT_OUTPUT = ROOT / 'artifacts/material-label-human-review'
SAMPLE_PATH = ROOT / 'data/videos/classification/review-sample-40.json'
UPDATES_PATH = ROOT / 'data/videos/classification/human-review-updates.json'
SHARED_REVIEWS = ROOT / 'data/videos/reviews/human-2026-10-04'
SCENARIOS = {
    'camera_zoom': ('镜头推拉', '画面整体推近或拉远；普通横向追拍不算。'),
    'full_court_movement': ('跨半场移动', '镜头跟随动作跨中线，或在两半场间连续移动。'),
    'image_blur': ('画面模糊', '画面发虚、压缩模糊或运动拖影。'),
    'closeup_insertion': ('特写打断', '人物、教练或替补席特写插入，打断比赛宽景。'),
    'view_switch': ('视角切换', '切换到另一机位或视角；平移、推拉不算。'),
    'half_court_only': ('只有半场', '有效比赛动作仅覆盖一个进攻半场，不等于回合不完整。'),
    'motion_blur': ('运动拖影', '快速动作或追拍中，球员、球或背景出现拖影。'),
    'occlusion': ('局部遮挡', '球或球员身体被其他人、裁判等暂时挡住。'),
    'players_out_of_frame': ('球员出画', '相关球员在画面边缘或完全离开画幅。'),
    'replay_or_teaching': ('回放／教学加工', '回放、人工定格、讲解图形或教学拼接。'),
}
CLARITY = {'clear': '清晰', 'soft': '偏软，但主要动作可辨', 'poor': '明显模糊', 'uncertain': '无法确定'}
SCOPE = {'full_possession': '完整球权', 'frontcourt_sequence': '前场配合片段',
         'partial_action': '局部／短动作', 'uncertain': '范围无法确定'}
STATUS = {'clear': '清晰可用', 'challenge': '困难场景，保留', 'excluded': '机器建议排除', 'needs_review': '机器待确认'}
RELATIONS = {'full_containment': '完整包含', 'partial_overlap': '局部重叠', 'different': '不同内容', 'uncertain': '关系待确认'}
VERDICTS = {'pending', 'correct', 'incorrect', 'unsure'}
RETENTION = {'pending', 'keep', 'discard', 'unsure'}


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def now():
    return datetime.now(ZoneInfo('America/New_York')).isoformat(timespec='seconds')


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix('.tmp')
    with temp.open('w', encoding='utf-8', newline='\n') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temp, path)


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                     separators=(',', ':')).encode('utf-8')).hexdigest()


def presence(value):
    return '有' if value is True else '未见' if value is False else '待确认'


def make_fields(label, entry):
    fields = []
    def add(key, title, group, display, detail='', spans=None, value=None):
        fields.append({'key': key, 'title': title, 'group': group, 'display': display,
                       'detail': detail, 'intervals': spans or [], 'value': value})
    q = label['quality']
    add('quality.clarity', '清晰度', '画质与范围', CLARITY[q['clarity']], q['reason'], value=q['clarity'])
    add('quality.core_actions_visible', '主要动作能否看清', '画质与范围',
        '能看清' if q['core_actions_visible'] is True else '看不清' if q['core_actions_visible'] is False else '无法确定',
        value=q['core_actions_visible'])
    content = label['content']
    add('content.scope', '片段范围', '画质与范围', SCOPE[content['scope']], value=content['scope'])
    for name, (title, definition) in SCENARIOS.items():
        d = label['scenarios'][name]
        add('scenarios.' + name, title, '场景标签', presence(d['value']), d['note'], d['intervals'], d)
        fields[-1]['definition'] = definition
    for i, tag in enumerate(content['action_tags']):
        add(f'content.action_tags.{i}', f'动作标签 {i+1}', '动作与描述', tag, value=tag)
    # A separate empty-list item permits reporting missing action labels.
    if not content['action_tags']:
        add('content.action_tags', '动作标签', '动作与描述', '未标动作', value=[])
    add('content.description', '画面动作描述', '动作与描述', content['description'], value=content['description'])
    add('content.usable_intervals', '可用比赛区间', '动作与描述',
        '普通比赛动作可用的时间段' if content['usable_intervals'] else '未发现有效普通比赛区间',
        '这些区间与特写、模糊等场景区间分别记录。', content['usable_intervals'], content['usable_intervals'])
    src = label['source']
    game = entry.get('game') or {}
    source_text = [f"赛季：{src.get('season') or '待核实'}",
                   f"对阵：{game.get('matchup') or '待核实'}",
                   f"来源：{src.get('uploaded_filename') or src.get('publisher') or '网页采集'}"]
    if src.get('source_start_seconds') is not None:
        source_text.append(f"原片区间：{src['source_start_seconds']}–{src['source_end_seconds']}秒")
    else:
        source_text.append('原片起止时间：未知')
    add('source', '来源与赛季信息', '来源与使用建议', '；'.join(source_text),
        src.get('unknown_reason') or src.get('source_time_note', ''), value=src)
    selection = label['selection']
    add('selection', '机器使用建议', '来源与使用建议', STATUS[selection['status']] +
        (' · 重复备选' if not selection['recommended'] and selection['status'] in ('clear', 'challenge') else ''),
        selection['reason'], value=selection)
    if label['content_relations']:
        add('content_relations', '已登记的内容关系', '来源与使用建议',
            '\n'.join(RELATIONS[p['relation']] + '：' + ' ↔ '.join(p['clip_ids']) + '\n' + p['visual_basis']
                      for p in label['content_relations']), value=label['content_relations'])
    return fields


class ReviewStore:
    def __init__(self, output, shared_reviews=True):
        self.output = Path(output).resolve()
        self.shared_reviews = shared_reviews
        self.lock = threading.RLock()
        self.clips = {}
        catalog = read(ROOT / 'data/videos/catalog.json')
        names = {'nba-2024-25-library100': '2024–25 主库', 'nba-2025-26-batch030': '2025–26 三十段',
                 'nba-2025-26-batch-008': '历史补充八段', 'nba-2025-26-sample-001': '历史单段',
                 'tactics-acceptance': '验收样例', 'user-uploads-20261003': '10月3日上传',
                 'user-uploads-20261003-batch02': '10月3日第二批', 'user-uploads-20261004': '10月4日上传'}
        for ds in catalog['datasets']:
            for entry in read(ROOT / ds['manifest'])['entries']:
                cid = entry['clip_id']
                annotation = ROOT / ds['root'] / entry['annotation_path']
                label = read(annotation)['material_labels']
                video = ROOT / ds['root'] / entry['asset']['path']
                if label['asset']['sha256'] != entry['asset']['sha256']:
                    raise ValueError('Stale labels: ' + cid)
                game = entry.get('game') or {}
                sheets = label['provenance'].get('evidence_sheets', [])
                poster = ROOT / Path(sheets[0]).parent / 'frame-0001.jpg' if sheets else None
                self.clips[cid] = {'clip_id': cid, 'dataset_id': ds['dataset_id'], 'dataset_name': names.get(ds['dataset_id'], ds['dataset_id']),
                    'number': entry['local_id'], 'matchup': game.get('matchup') or '对阵待核实',
                    'filename': video.name, 'video': video, 'annotation': annotation, 'poster': poster,
                    'video_path': video.relative_to(ROOT).as_posix(), 'annotation_path': annotation.relative_to(ROOT).as_posix(),
                    'video_sha256': entry['asset']['sha256'], 'video_spec': entry['video'],
                    'source_url': label['source'].get('url'), 'label_fingerprint': fingerprint(label), 'label': label,
                    'fields': make_fields(label, entry), 'machine_selection': label['selection'],
                    'human_reviewed': label['provenance']['human_reviewed'],
                    'timestamp_note': label['provenance']['timestamp_precision']}

    def path(self, cid):
        if cid not in self.clips:
            raise KeyError(cid)
        return self.output / 'records' / (cid + '.json')

    def load(self, cid):
        path = self.path(cid)
        if not path.exists() and self.shared_reviews:
            path = SHARED_REVIEWS / 'records' / (cid + '.json')
        return read(path) if path.exists() else None

    def summary(self):
        result = {}
        for cid in self.clips:
            record = self.load(cid)
            if record:
                result[cid] = {k: record[k] for k in ('status', 'revision', 'updated_at', 'retention', 'label_fingerprint')}
                applied = self.applied(cid, record)
                result[cid]['applied'] = applied
                resolved = set(applied.get('resolved_keys', [])) if applied else set()
                result[cid]['issues'] = sum(v['verdict'] in ('incorrect', 'unsure') and k not in resolved for k, v in record['evaluations'].items())
                result[cid]['stale'] = record['label_fingerprint'] != fingerprint(read(self.clips[cid]['annotation'])['material_labels']) and not applied
        return result

    def applied(self, cid, record):
        if not record or not UPDATES_PATH.is_file():
            return None
        current = fingerprint(read(self.clips[cid]['annotation'])['material_labels'])
        for receipt in read(UPDATES_PATH).get('reviews', []):
            if (receipt.get('clip_id') == cid and receipt.get('review_revision') == record['revision']
                and receipt.get('review_updated_at') == record['updated_at']
                and receipt.get('original_label_fingerprint') == record['label_fingerprint']
                and receipt.get('result_label_fingerprint') == current):
                return receipt
        return None

    def catalog(self):
        allowed = ('clip_id', 'dataset_id', 'dataset_name', 'number', 'matchup', 'filename', 'video_path',
                   'annotation_path', 'video_sha256', 'video_spec', 'source_url', 'label_fingerprint',
                   'fields', 'machine_selection', 'timestamp_note', 'human_reviewed')
        clips = [{**{k: c[k] for k in allowed}, 'has_poster': bool(c['poster'] and c['poster'].is_file())}
                 for c in self.clips.values()]
        sample = read(SAMPLE_PATH) if SAMPLE_PATH.is_file() else None
        return {'schema_version': '1.0.0', 'clips': clips, 'reviews': self.summary(), 'sample': sample,
                'last_clip_id': self.session().get('last_clip_id'),
                'output_path': self.output.relative_to(ROOT).as_posix() if self.output.is_relative_to(ROOT) else str(self.output)}

    def session(self):
        path = self.output / 'session.json'
        return read(path) if path.exists() else {}

    def save(self, cid, payload):
        with self.lock:
            if not isinstance(payload, dict):
                raise ValueError('审核评价必须是JSON对象。')
            path, clip = self.path(cid), self.clips[cid]
            current_label = read(clip['annotation'])['material_labels']
            digest = fingerprint(current_label)
            if payload.get('label_fingerprint') != digest or payload.get('video_sha256') != current_label['asset']['sha256']:
                raise Conflict('视频或标签已更新，请刷新页面重新核对；已有评价不会丢失。')
            previous = self.load(cid)
            revision = previous['revision'] if previous else 0
            if payload.get('expected_revision') != revision:
                raise Conflict('另一页面已保存这段评价，请刷新后继续，避免覆盖。')
            fields = {f['key'] for f in clip['fields']}
            evaluations = payload.get('evaluations')
            if not isinstance(evaluations, dict) or set(evaluations) != fields:
                raise ValueError('评价项不完整，请刷新页面。')
            clean = {}
            for key, value in evaluations.items():
                if not isinstance(value, dict) or value.get('verdict') not in VERDICTS:
                    raise ValueError('未知标签评价。')
                comment = value.get('comment', '')
                if not isinstance(comment, str) or len(comment) > 5000:
                    raise ValueError('单项意见不能超过5000字。')
                issue = value.get('issue_type', 'label')
                if issue not in ('label', 'timing', 'description', 'missing', 'other'):
                    raise ValueError('未知问题类型。')
                at = value.get('observed_at_seconds')
                if at is not None and (isinstance(at, bool) or not isinstance(at, (int, float)) or
                    not 0 <= at <= clip['video_spec']['duration_seconds'] + 1):
                    raise ValueError('视频定位时间无效。')
                clean[key] = {'verdict': value['verdict'], 'comment': comment, 'issue_type': issue,
                              'observed_at_seconds': at}
            retention = payload.get('retention', {})
            if not isinstance(retention, dict) or retention.get('decision') not in RETENTION or not isinstance(retention.get('reason', ''), str):
                raise ValueError('请选择去留评价。')
            if len(retention.get('reason', '')) > 5000:
                raise ValueError('去留说明太长。')
            comments = payload.get('comments', '')
            if not isinstance(comments, str) or len(comments) > 10000:
                raise ValueError('整段意见不能超过10000字。')
            status = payload.get('status')
            if status not in ('draft', 'completed'):
                raise ValueError('未知审核状态。')
            if status == 'completed' and (retention['decision'] == 'pending' or any(v['verdict'] == 'pending' for v in clean.values())):
                raise ValueError('仍有未核对项或未选择去留，不能标为已审。')
            stamp = now()
            record = {'schema_version': '1.0.0', 'clip_id': cid, 'video_path': clip['video_path'],
                'annotation_path': clip['annotation_path'], 'video_sha256': current_label['asset']['sha256'],
                'label_fingerprint': digest, 'annotation_snapshot': current_label,
                'revision': revision + 1, 'origin': 'human_review_ui', 'status': status,
                'evaluations': clean, 'retention': {'decision': retention['decision'], 'reason': retention.get('reason', '')},
                'comments': comments, 'created_at': previous['created_at'] if previous else stamp,
                'updated_at': stamp, 'completed_at': stamp if status == 'completed' else None}
            if previous and (previous['label_fingerprint'] != digest or self.applied(cid, previous)):
                atomic_json(self.output / 'history' / cid / (previous['label_fingerprint'] + '.json'), previous)
            atomic_json(path, record)
            self.set_last(cid)
            return record

    def set_last(self, cid):
        self.path(cid)
        with self.lock:
            atomic_json(self.output / 'session.json', {'schema_version': '1.0.0', 'last_clip_id': cid, 'updated_at': now()})

    def export(self):
        with self.lock:
            records = [record for cid in self.clips if (record := self.load(cid))]
            archived = []
            if self.shared_reviews and (SHARED_REVIEWS / 'index.json').is_file():
                for item in read(SHARED_REVIEWS / 'index.json')['clips']:
                    cid = item['clip_id']
                    if cid not in self.clips and item['retention'] == 'discard':
                        archived.append(read(SHARED_REVIEWS / 'records' / (cid + '.json')))
            return {'schema_version': '1.0.0', 'exported_at': now(), 'total_videos': len(self.clips),
                    'reviewed_count': sum(v['status'] == 'completed' and not v['stale'] for v in self.summary().values()) + len(archived),
                    'archived_discard_count': len(archived), 'reviews': records + archived}

    def backup(self):
        with self.lock:
            data = self.export()
            path = self.output / 'exports' / ('human-review-' + datetime.now().strftime('%Y%m%d-%H%M%S') + '.json')
            atomic_json(path, data)
            display = path.relative_to(ROOT).as_posix() if path.is_relative_to(ROOT) else str(path)
            return {'path': display, 'reviewed_count': data['reviewed_count']}


class Conflict(ValueError):
    pass


def handler(store):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def json(self, value, status=200):
            data = json.dumps(value, ensure_ascii=False).encode('utf-8')
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(data)

        def do_HEAD(self):
            self.do_GET(head_only=True)

        def do_GET(self, head_only=False):
            route = unquote(urlsplit(self.path).path)
            try:
                if route == '/api/catalog':
                    self.json(store.catalog()); return
                if route.startswith('/api/review/'):
                    cid = route.removeprefix('/api/review/')
                    record = store.load(cid)
                    self.json({'review': record, 'applied': store.applied(cid, record)}); return
                if route == '/api/export':
                    self.json(store.export()); return
                if route.startswith('/video/'):
                    cid = route.removeprefix('/video/')
                    clip = store.clips[cid]
                    path = clip['video']
                elif route.startswith('/poster/'):
                    path = store.clips[route.removeprefix('/poster/')]['poster']
                else:
                    path = {'/': UI / 'index.html', '/index.html': UI / 'index.html',
                            '/review.mjs': UI / 'review.mjs', '/review.css': UI / 'review.css',
                            '/review-model.mjs': UI / 'review-model.mjs'}.get(route)
                if path is None or not path.is_file():
                    self.send_error(404); return
                self.stream(path, head_only)
            except KeyError:
                self.json({'error': '未知视频。'}, 404)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                pass

        def do_POST(self):
            try:
                origin = self.headers.get('Origin')
                if origin and origin not in (f'http://127.0.0.1:{self.server.server_port}', f'http://localhost:{self.server.server_port}'):
                    self.json({'error': '只接受本机审核页面的保存请求。'}, 403); return
                size = int(self.headers.get('Content-Length', '0'))
                if not 0 < size <= 200000:
                    raise ValueError('保存内容大小无效。')
                payload = json.loads(self.rfile.read(size))
                if not isinstance(payload, dict):
                    raise ValueError('审核评价必须是JSON对象。')
                route = unquote(urlsplit(self.path).path)
                if route.startswith('/api/review/'):
                    record = store.save(route.removeprefix('/api/review/'), payload)
                    self.json({'review': record}); return
                if route == '/api/session':
                    store.set_last(payload['clip_id']); self.json({'ok': True}); return
                if route == '/api/export':
                    self.json(store.backup()); return
                self.json({'error': '未知保存入口。'}, 404)
            except Conflict as exc:
                self.json({'error': str(exc)}, 409)
            except KeyError:
                self.json({'error': '未知视频。'}, 404)
            except (ValueError, TypeError) as exc:
                self.json({'error': str(exc)}, 400)
            except OSError:
                self.json({'error': '文件保存失败，请检查磁盘空间或文件权限后重试。'}, 500)

        def stream(self, path, head_only):
            size = path.stat().st_size
            start, end, status = 0, size - 1, 200
            if requested := self.headers.get('Range'):
                match = re.fullmatch(r'bytes=(\d*)-(\d*)', requested)
                if not match or not any(match.groups()):
                    self.send_error(416); return
                if match[1]:
                    start = int(match[1]); end = min(int(match[2]), end) if match[2] else end
                else:
                    start = max(0, size - int(match[2]))
                if start > end or start >= size:
                    self.send_response(416); self.send_header('Content-Range', f'bytes */{size}')
                    self.end_headers(); return
                status = 206
            mime = 'text/javascript' if path.suffix == '.mjs' else mimetypes.guess_type(path.name)[0] or 'application/octet-stream'
            self.send_response(status)
            self.send_header('Content-Type', mime)
            self.send_header('Content-Length', str(end - start + 1))
            self.send_header('Accept-Ranges', 'bytes')
            self.send_header('Cache-Control', 'no-store' if path.suffix != '.mp4' else 'private, max-age=0')
            if status == 206:
                self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
            self.end_headers()
            if not head_only:
                with path.open('rb') as stream:
                    stream.seek(start)
                    remaining = end - start + 1
                    while remaining:
                        block = stream.read(min(remaining, 128 * 1024))
                        if not block: break
                        self.wfile.write(block)
                        remaining -= len(block)
    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8901)
    parser.add_argument('--output-dir', type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    store = ReviewStore(args.output_dir)
    server = ThreadingHTTPServer(('127.0.0.1', args.port), handler(store))
    atomic_json(store.output / 'server.json', {'url': f'http://127.0.0.1:{server.server_port}/', 'pid': os.getpid(),
                'total_videos': len(store.clips), 'output_path': str(store.output), 'started_at': now()})
    print(f'Human review: http://127.0.0.1:{server.server_port}/ | {len(store.clips)} videos | {store.output}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
