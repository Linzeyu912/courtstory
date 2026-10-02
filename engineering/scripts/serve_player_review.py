"""Serve the local player review UI and an explicit video library on loopback."""

import argparse
import hashlib
import json
import math
import mimetypes
import os
import re
import threading
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from scene_profiles import finite_json, validate_court_candidates, validate_feet_candidates
from review_session import apply_review_edit
from detector_evidence import validate_frame_evidence, detector_evidence_for_clip


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--video")
    parser.add_argument("--tracks")
    parser.add_argument("--library", help="JSON library with explicit sample video / tracks paths")
    parser.add_argument("--alternative-tracks", help="Optional jersey-constrained experiment; separate browser drafts")
    parser.add_argument("--port", type=int, default=8876)
    parser.add_argument("--court-profile", default="engineering/research/vision-player-refinement/clip001-court-expanded.json")
    parser.add_argument("--state-file", default="artifacts/vision-player-refinement/review-server.json")
    parser.add_argument("--trim-root", default="artifacts/player-review-clips")
    parser.add_argument("--player-data-root", default=str(Path(__file__).resolve().parents[2] / '2K Player Data'),
                        help="Local read-only identity data package (default: repository 2K Player Data)")
    parser.add_argument("--court-model", default="tmp/court-models-v2/best.pt", help="Pinned local 48-point weights; loaded on calibration requests only")
    parser.add_argument("--court-imgsz", type=int, choices=(640, 960), default=640)
    args = parser.parse_args()
    if args.library:
        if args.video or args.tracks or args.alternative_tracks:
            parser.error("Use --library or --video/--tracks, not both")
        try:
            library=read_json(Path(args.library), 'Library')
        except ValueError as error:
            parser.error(str(error))
        samples=library.get("samples",[])
        available=[]
        for sample in samples:
            try:
                missing=missing_sample_files(sample)
                if sample.get('optional') is True and missing:
                    print(f"Skipping unavailable optional sample {sample['id']}: {', '.join(map(str,missing))}",flush=True)
                    continue
            except (ValueError,KeyError,TypeError) as error:
                parser.error(f"Sample {sample.get('id','?')}: {error}")
            available.append(sample)
        samples=available
    else:
        if not args.video or not args.tracks:
            parser.error("Provide --library or both --video and --tracks")
        samples=[{"id":"legacy","title":"原样例 · IND–OKC 挡拆外弹","video":args.video,"tracks":args.tracks,
                  "alternativeTracks":args.alternative_tracks,"courtProfile":args.court_profile}]
        library={"defaultSample":"legacy"}
    if not samples or len({s['id'] for s in samples})!=len(samples):
        parser.error("Samples must be nonempty with unique IDs")
    default=library.get("defaultSample",samples[0]['id'])
    if default not in {s['id'] for s in samples}:
        parser.error("Unknown default sample")
    clips={}
    for sample in samples:
        clips[sample['id']]=load_clip(parser,sample)
    cache=Path(args.trim_root).resolve();cache.mkdir(parents=True,exist_ok=True)
    saved_path=cache/'library.json';saved=[]
    if saved_path.is_file():
        for sample in json.loads(saved_path.read_text(encoding='utf-8')):
            if sample.get('parentSample') not in clips:continue
            if sample.get('parentVideoSha256')!=clips[sample['parentSample']]['digest']:continue
            if any(not Path(sample[k]).resolve().is_relative_to(cache) or not Path(sample[k]).is_file() for k in ['video','tracks']):continue
            if any(not Path(v['tracks']).resolve().is_relative_to(cache) or not Path(v['tracks']).is_file() for v in sample.get('trackingVariants',[])):continue
            if any(not Path(sample[k]).resolve().is_relative_to(cache) or not Path(sample[k]).is_file() for k in ['courtCandidates','feetCandidates'] if sample.get(k)):continue
            clips[sample['id']]=load_clip(parser,sample);samples.append(sample);saved.append(sample)
    mutation_lock=threading.Lock()
    court_models={}
    # The data package is opened only when these optional identity APIs are used.
    from player_identity_data import PlayerIdentityData, PlayerIdentityDataUnavailable
    player_data=PlayerIdentityData(args.player_data_root)
    def library_payload():
        return json.dumps({"defaultSample":default,"samples":[{
            **{k:s.get(k) for k in ['id','title','description','sourceUrl']},
            'defaultVariant':clips[s['id']]['defaultVariant']} for s in samples]},ensure_ascii=False).encode('utf-8')
    static = Path(__file__).resolve().parents[1] / "tools/player-review"
    routes = {"/": static / "index.html"}
    for filename in ["style.css","pipeline.css","app.mjs","player-identity.mjs","footage-ui.mjs","manual-path.mjs","trajectory.mjs","identity-timeline.mjs","tracking-display.mjs","tracking-diagnostics.mjs","automatic-annotations.mjs","simple-annotation.mjs","scene-objects.mjs","scene-objects-ui.mjs","calibration-guide.mjs","feet-candidates.mjs","team-overlay.mjs","team-overlay-policy.json","court.mjs","workspace.mjs","court-geometry.mjs","image-edit.mjs","ui.bundle.mjs","ui.bundle.mjs.LEGAL.txt"]:
        routes['/'+filename]=static/filename

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            route=urlsplit(self.path).path
            if route not in {'/api/trim','/api/court-propagate','/api/court-calibrate','/api/review-edit'}:self.send_error(404);return
            origin=self.headers.get('Origin')
            if origin and origin!=f'http://127.0.0.1:{self.server.server_port}':self.send_error(403);return
            if self.headers.get('Content-Type','').split(';')[0]!='application/json':self.send_error(415);return
            try:
                size=int(self.headers.get('Content-Length','0'))
                if not 0<size<=(16*1024*1024 if route=='/api/review-edit' else 65536):raise ValueError('请求大小不正确。')
                request=json.loads(self.rfile.read(size))
                if not isinstance(request,dict):raise ValueError('请求必须是 JSON 对象。')
                finite_json(request,'Request')
                source_id=request.get('sample');variant=request.get('variant',clips.get(source_id,{}).get('defaultVariant','original'))
                if source_id not in clips or variant not in clips[source_id]['payloads']:raise ValueError('找不到源视频或跟踪版本。')
                if route=='/api/review-edit':
                    result=apply_review_edit(request.get('session'),request.get('operation'),json.loads(clips[source_id]['payloads'][variant]))
                    data=json.dumps(result,ensure_ascii=False,allow_nan=False).encode('utf-8')
                    self.send_response(200);self.send_header('Content-Type','application/json; charset=utf-8')
                    self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(data)))
                    self.end_headers();self.wfile.write(data);return
                if route=='/api/court-calibrate':
                    from court_calibration import CourtKeypointModel, CourtModelUnavailable, calibrate_court, object_source_payload
                    try:
                        with mutation_lock:
                            if 'court48' not in court_models:
                                court_models['court48']=CourtKeypointModel(args.court_model,args.court_imgsz)
                            result=calibrate_court(clips[source_id]['video'],json.loads(clips[source_id]['payloads'][variant]),
                                                   request.get('frame'),court_models['court48'],request.get('cuts',[]),
                                                   request.get('propagate',False),object_source_payload(clips[source_id],variant))
                    except CourtModelUnavailable as error:
                        data=json.dumps({'error':str(error)},ensure_ascii=False).encode('utf-8')
                        self.send_response(503);self.send_header('Content-Type','application/json; charset=utf-8')
                        self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data);return
                    data=json.dumps(result,ensure_ascii=False,allow_nan=False).encode('utf-8')
                    self.send_response(200);self.send_header('Content-Type','application/json; charset=utf-8')
                    self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data);return
                if route=='/api/court-propagate':
                    from court_propagation import propagate_court
                    cuts=request.get('cuts',[])
                    if not isinstance(cuts,list):raise ValueError('切镜边界必须是数组。')
                    with mutation_lock:
                        result=propagate_court(clips[source_id]['video'],json.loads(clips[source_id]['payloads'][variant]),
                                               request.get('seed'),cuts)
                    data=json.dumps(result,ensure_ascii=False,allow_nan=False).encode('utf-8')
                    self.send_response(200);self.send_header('Content-Type','application/json; charset=utf-8')
                    self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data);return
                from review_video_trim import trim_review_clip
                with mutation_lock:
                    parent=next(s for s in samples if s['id']==source_id)
                    ident=('qa-cut-' if request.get('qa') is True else 'cut-')+uuid.uuid4().hex[:12]
                    result=trim_review_clip({'video':clips[source_id]['video'],
                        'payload':json.loads(clips[source_id]['payloads'][variant]),
                        'payloads':{key:json.loads(value) for key,value in clips[source_id]['payloads'].items()}},request.get('ranges'),cache/ident)
                    selection={'ranges':result['retainedRanges'],'confirmedAt':datetime.now(timezone.utc).isoformat(),
                        'method':'manual_retained_frame_ranges','parentVideoSha256':clips[source_id]['digest']}
                    sample={**result,'id':ident,'title':parent['title']+' · 人工剪辑',
                        'description':f"保留 {len(result['retainedRanges'])} 个直播区间；区间之间断开轨迹。人工剪辑当前不含音轨；原片音轨保留。",'sourceUrl':parent.get('sourceUrl'),
                        'liveSelection':selection,'parentSample':source_id,'parentVideoSha256':clips[source_id]['digest']}
                    clips[ident]=load_clip(parser,sample);samples.append(sample)
                    if request.get('qa') is not True:
                        saved.append(sample)
                        temporary=cache/('library-'+uuid.uuid4().hex+'.json')
                        temporary.write_text(json.dumps(saved,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');temporary.replace(saved_path)
                data=json.dumps({'sample':ident,'frames':clips[ident]['frames'],'sourceCuts':result['sourceCuts'],
                                 'audioPolicy':result['audioPolicy']}).encode('utf-8')
                self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
            except (ValueError,TypeError,KeyError) as error:
                data=json.dumps({'error':str(error)},ensure_ascii=False).encode('utf-8')
                self.send_response(400);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
            except Exception as error:
                print(f'Review operation failed: {type(error).__name__}: {error}',flush=True);self.send_error(500,'Review operation failed; source preserved')

        def do_HEAD(self):
            self.respond(head_only=True)

        def do_GET(self):
            self.respond(head_only=False)

        def respond(self, head_only=False):
            from urllib.parse import parse_qs
            parsed=urlsplit(self.path);route=parsed.path;query=parse_qs(parsed.query)
            if route in {'/api/player-identity/options','/api/player-identity/lookup'}:
                query=parse_qs(parsed.query,keep_blank_values=True)
                status=200
                try:
                    if len(parsed.query)>1024 or any(len(values)!=1 for values in query.values()):
                        raise ValueError('查询参数重复或过长。')
                    if route.endswith('/options'):
                        result=player_data.options(query['season'][0] if 'season' in query else None)
                    else:
                        if any(key not in query for key in ['season','team','jersey']):
                            raise ValueError('请提供赛季、球队和球衣号码。')
                        result=player_data.lookup(query['season'][0],query['team'][0],query['jersey'][0])
                except ValueError as error:
                    status=400;result={'error':str(error)}
                except PlayerIdentityDataUnavailable as error:
                    status=503;result={'error':str(error)}
                payload=json.dumps(result,ensure_ascii=False,allow_nan=False).encode('utf-8')
                self.send_response(status)
                self.send_header('Content-Type','application/json; charset=utf-8')
                self.send_header('Content-Length',str(len(payload)))
                self.send_header('Cache-Control','no-store')
                self.end_headers()
                if not head_only:self.wfile.write(payload)
                return
            sample_id=query.get('sample',[default])[0]
            if route in {"/api/clip","/video.mp4"} and sample_id not in clips:
                self.send_error(404,"Unknown sample");return
            if route in {"/api/clip","/api/library"}:
                payload=library_payload() if route=="/api/library" else clips[sample_id]['payloads'].get(query.get('variant',[clips[sample_id]['defaultVariant']])[0])
                if payload is None:
                    self.send_error(404,"Unknown tracking variant");return
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(payload)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                if not head_only:self.wfile.write(payload)
                return
            path=clips[sample_id]['video'] if route=="/video.mp4" else routes.get(route)
            if path is None or not path.is_file():
                self.send_error(404);return
            size=path.stat().st_size;start,end,status=0,size-1,200
            requested=self.headers.get('Range')
            if requested:
                match=re.fullmatch(r'bytes=(\d*)-(\d*)',requested)
                if not match or not any(match.groups()):
                    self.send_error(416);return
                if match[1]:
                    start=int(match[1]);end=min(int(match[2]),end) if match[2] else end
                else:start=max(0,size-int(match[2]))
                if start>end or start>=size:
                    self.send_response(416);self.send_header('Content-Range',f'bytes */{size}');self.end_headers();return
                status=206
            self.send_response(status)
            mime='text/javascript' if path.suffix=='.mjs' else mimetypes.guess_type(path.name)[0] or 'application/octet-stream'
            self.send_header('Content-Type',mime);self.send_header('Content-Length',str(end-start+1))
            self.send_header('Accept-Ranges','bytes');self.send_header('Cache-Control','no-cache')
            if status==206:self.send_header('Content-Range',f'bytes {start}-{end}/{size}')
            self.end_headers()
            if head_only:return
            try:
                with path.open('rb') as stream:
                    stream.seek(start);remaining=end-start+1
                    while remaining:
                        data=stream.read(min(remaining,64*1024))
                        if not data:break
                        self.wfile.write(data);remaining-=len(data)
            except (BrokenPipeError,ConnectionResetError,ConnectionAbortedError):pass

        def log_message(self,message,*values):print(message%values,flush=True)

    server=ThreadingHTTPServer(('127.0.0.1',args.port),Handler)
    state_path=Path(args.state_file);state_path.parent.mkdir(parents=True,exist_ok=True)
    state={'url':f'http://127.0.0.1:{server.server_port}/','pid':os.getpid(),'samples':len(samples),
           'video_sha256':clips[default]['digest'],'frames':clips[default]['frames']}
    state_path.write_text(json.dumps(state,indent=2)+'\n',encoding='utf-8');print(json.dumps(state),flush=True)
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:server.server_close()


def read_json(path, context):
    """Reject non-JSON numbers before they can reach the browser's JSON parser."""
    def reject_constant(value):
        raise ValueError(f'nonfinite JSON number {value}')
    try:
        return json.loads(path.read_text(encoding='utf-8'), parse_constant=reject_constant)
    except (OSError,UnicodeError,ValueError) as error:
        raise ValueError(f'{context}: cannot read {path}: {error}') from error


def variant_definitions(sample):
    """The historical original/jersey names stay stable for saved browser drafts."""
    original=sample.get('tracks')
    if not isinstance(original,str) or not original:
        raise ValueError('Original tracks path must be a nonempty string')
    versions=[{'id':'original','label':sample.get('originalLabel',sample.get('originalTrackingLabel','原跟踪 · 保留已有草稿')),
               'tracks':original,'requiresMetadata':False}]
    if sample.get('alternativeTracks'):
        if not isinstance(sample['alternativeTracks'],str):
            raise ValueError('Alternative tracks path must be a string')
        versions.append({'id':'jersey','label':'球衣约束实验 · 独立草稿',
                         'tracks':sample['alternativeTracks'],'requiresMetadata':False})
    configured=sample.get('trackingVariants',[])
    if not isinstance(configured,list):
        raise ValueError('trackingVariants must be a list')
    ids={item['id'] for item in versions}
    for item in configured:
        if not isinstance(item,dict):
            raise ValueError('Each tracking variant must be an object')
        identifier=item.get('id')
        if not isinstance(identifier,str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,63}',identifier):
            raise ValueError('Tracking variant id must be a simple nonempty identifier')
        if identifier in ids or identifier in {'original','jersey'}:
            raise ValueError(f'Tracking variant IDs must be unique; duplicate or reserved id {identifier}')
        if not isinstance(item.get('label'),str) or not item['label'].strip():
            raise ValueError(f'Tracking variant {identifier}: label must be a nonempty string')
        if not isinstance(item.get('tracks'),str) or not item['tracks']:
            raise ValueError(f'Tracking variant {identifier}: tracks path must be a nonempty string')
        if 'optional' in item and type(item['optional']) is not bool:
            raise ValueError(f'Tracking variant {identifier}: optional must be a boolean')
        if 'recommended' in item and type(item['recommended']) is not bool:
            raise ValueError(f'Tracking variant {identifier}: recommended must be a boolean')
        versions.append({**item,'requiresMetadata':True});ids.add(identifier)
    default=sample.get('defaultVariant','original')
    if not isinstance(default,str) or default not in ids:
        raise ValueError(f'Unknown defaultVariant {default}')
    return versions


def missing_sample_files(sample):
    """Optional model files do not hide an otherwise usable original sample."""
    if not isinstance(sample.get('video'),str) or not sample['video']:
        raise ValueError('Video path must be a nonempty string')
    paths=[Path(sample['video'])]
    for variant in variant_definitions(sample):
        if variant.get('optional') is True:
            continue
        path=Path(variant['tracks']);paths.append(path)
        if variant['requiresMetadata']:
            paths.append(path.with_suffix('.meta.json'))
    return [path for path in paths if not path.is_file()]


def finite_number(value):
    return type(value) in (int,float) and math.isfinite(value)


def whole_number(value, minimum=0):
    return finite_number(value) and value>=minimum and int(value)==value


def validate_frame_records(records, times, context):
    if not isinstance(records,list) or not records:
        raise ValueError(f'{context}: frame records must be a nonempty top-level array')
    if len(records)!=len(times):
        raise ValueError(f'{context}: frame count {len(records)} does not match decoded video frame count {len(times)}')
    for index,record in enumerate(records):
        location=f'{context}: frame {index}'
        if not isinstance(record,dict) or type(record.get('frame')) is not int or record['frame']!=index:
            raise ValueError(f'{location}: frame records must have sequential integer frame indices starting at zero')
        if not finite_number(record.get('time')) or abs(record['time']-times[index])>.001:
            raise ValueError(f'{location}: timestamp must match decoded source PTS {times[index]:.9f}')
        seen=set()
        for field,columns,confidence_column,class_column in [('tracks',7,5,6),('pending_detections',6,4,5),('suppressed_detections',6,4,5)]:
            rows=record.get(field,[] if field!='tracks' else None)
            if not isinstance(rows,list):
                raise ValueError(f'{location}: {field} must be an array')
            for row_index,row in enumerate(rows):
                row_location=f'{location}: {field} row {row_index}'
                if not isinstance(row,list) or len(row)!=columns or not all(finite_number(value) for value in row):
                    raise ValueError(f'{row_location} must contain exactly {columns} finite numeric columns')
                if row[2]<=row[0] or row[3]<=row[1]:
                    raise ValueError(f'{row_location}: box must have positive width and height')
                if not 0<=row[confidence_column]<=1 or not whole_number(row[class_column]):
                    raise ValueError(f'{row_location}: confidence must be in [0,1] and class ID must be a nonnegative integer')
                if field=='tracks':
                    if not whole_number(row[4],1):
                        raise ValueError(f'{row_location}: track ID must be a positive integer')
                    identifier=int(row[4])
                    if identifier in seen:
                        raise ValueError(f'{location}: duplicate track ID {identifier}')
                    seen.add(identifier)
        if 'candidate_count' in record and (type(record['candidate_count']) is not int or record['candidate_count']<0):
            raise ValueError(f'{location}: candidate_count must be a nonnegative integer')
        validate_frame_evidence(record, location)


def validate_identity_suggestions(suggestions, frame_count, context):
    if suggestions is None:
        return
    location=f'{context}: identitySuggestions'
    if (not isinstance(suggestions,dict) or type(suggestions.get('version')) is not int or suggestions['version']!=1
            or suggestions.get('verified') is not False or not isinstance(suggestions.get('method'),str)
            or not suggestions['method'].strip() or not isinstance(suggestions.get('entities'),list)):
        raise ValueError(f'{location} must use version 1, a method, verified:false, and an entities array')
    grouping=suggestions.get('teamGrouping')
    if grouping is not None and (not isinstance(grouping,dict) or grouping.get('version')!=1
            or grouping.get('verified') is not False or grouping.get('layout')!='reserved_5_plus_5_v1'):
        raise ValueError(f'{location}: teamGrouping must reserve two five-slot teams and remain verified:false')
    people=set();team_counts={'A':0,'B':0}
    for entity in suggestions['entities']:
        if not isinstance(entity,dict) or entity.get('id') not in {f'P{i}' for i in range(1,11)}:
            raise ValueError(f'{location}: entity ID must be P1 through P10')
        if entity['id'] in people:
            raise ValueError(f'{location}: duplicate entity {entity["id"]}')
        people.add(entity['id'])
        group=entity.get('teamGroup')
        if group is not None:
            if group not in ('A','B') or (group=='A')!=(int(entity['id'][1:])<=5):
                raise ValueError(f'{location}: model team groups use A/P1–P5 and B/P6–P10')
            team_counts[group]+=1
            if team_counts[group]>5:raise ValueError(f'{location}: each model team has at most five members')
        if 'teamHint' in entity and not isinstance(entity['teamHint'],str):
            raise ValueError(f'{location}: teamHint must be a string')
        if not isinstance(entity.get('bindings'),list):
            raise ValueError(f'{location}: bindings must be an array')
        for binding in entity['bindings']:
            if not isinstance(binding,dict):
                raise ValueError(f'{location}: each binding must be an object')
            start,end,track=binding.get('start'),binding.get('end'),binding.get('trackId')
            if (type(start) is not int or type(end) is not int or not 0<=start<=end<frame_count
                    or type(track) is not int or track<1):
                raise ValueError(f'{location}: binding needs an in-range inclusive start/end and positive integer trackId')


def video_source_info(video):
    """Read source PTS from the untouched video; never infer times from frame rate."""
    import av
    try:
        with av.open(str(video)) as container:
            if not container.streams.video:
                raise ValueError('source contains no video stream')
            stream=container.streams.video[0]
            width,height=stream.width,stream.height
            times=[]
            for frame in container.decode(video=0):
                if frame.time is None or not finite_number(float(frame.time)):
                    raise ValueError('decoded frame has no finite source timestamp')
                times.append(float(frame.time))
            if not times or any(b<=a for a,b in zip(times,times[1:])):
                raise ValueError('source timestamps must be nonempty and strictly increasing')
        with video.open('rb') as source:
            digest=hashlib.file_digest(source,'sha256').hexdigest()
        return width,height,times,digest
    except (OSError,ValueError) as error:
        raise ValueError(f'Cannot decode source video {video}: {error}') from error


def load_clip(parser,sample):
    try:
        return validated_clip(sample)
    except (ValueError,KeyError,TypeError) as error:
        parser.error(f'Sample {sample.get("id","?")}: {error}')


def validated_clip(sample):
    definitions=variant_definitions(sample)
    if not isinstance(sample.get('video'),str) or not sample['video']:
        raise ValueError('Video path must be a nonempty string')
    video=Path(sample['video']).resolve()
    if not video.is_file():
        raise ValueError(f'Source video must exist locally: {video}')
    width,height,times,digest=video_source_info(video)
    if sample.get('videoSha256') and sample['videoSha256']!=digest:
        raise ValueError('Library video hash mismatch')
    versions={}
    for definition in definitions:
        identifier=definition['id'];context=f'Tracking variant {identifier}'
        path=Path(definition['tracks']).resolve();metadata_path=path.with_suffix('.meta.json')
        if definition.get('optional') is True and (not path.is_file() or not metadata_path.is_file()):
            print(f'Skipping unavailable optional tracking variant {sample["id"]}/{identifier}',flush=True)
            continue
        if definition['requiresMetadata'] and not metadata_path.is_file():
            raise ValueError(f'{context}: metadata file must exist locally: {metadata_path}')
        records=read_json(path,context)
        validate_frame_records(records,times,context)
        metadata=read_json(metadata_path,context+' metadata') if metadata_path.is_file() else {}
        if metadata_path.is_file() and (not isinstance(metadata,dict) or metadata.get('video_sha256')!=digest
                or type(metadata.get('frames')) is not int or metadata['frames']!=len(times)):
            raise ValueError(f'{context}: metadata does not match source video SHA / decoded frame count')
        suggestions=metadata.get('identitySuggestions')
        validate_identity_suggestions(suggestions,len(times),context)
        track_digest=hashlib.sha256(path.read_bytes()).hexdigest()
        # Historical original/jersey and the published E-BARD v1 drafts use the byte digest.
        # Later identity proposals, presentation layers, and trims include metadata in their identity.
        legacy_ebard=(metadata.get('pipeline_version')=='ebard-yolov8n-bytetrack-v1'
            and metadata.get('detector_id')=='ebard_yolov8n' and not metadata.get('presentation')
            and suggestions is None and metadata.get('method')!='subset_of_source_proposals')
        fingerprint=track_digest if not definition['requiresMetadata'] or legacy_ebard else hashlib.sha256(json.dumps({
            'tracks_sha256':track_digest,'trackingMetadata':metadata},sort_keys=True,ensure_ascii=False,
            separators=(',',':'),allow_nan=False).encode('utf-8')).hexdigest()
        versions[identifier]={'records':records,'metadata':metadata,'suggestions':suggestions,
                              'fingerprint':fingerprint,'rawFingerprint':track_digest,'label':definition['label'],
                              'recommended':definition.get('recommended',False),
                              'detectorEvidence':detector_evidence_for_clip(records,metadata,context)}
    default=sample.get('defaultVariant','original')
    if default not in versions:
        default=next((identifier for identifier,entry in versions.items() if entry['recommended']),'original')
    court_profile=None
    court_path=Path(sample.get('courtProfile','engineering/research/vision-player-refinement/clip001-court-expanded.json'))
    if court_path.is_file():
        candidate=read_json(court_path,'Court profile')
        if candidate.get('videoHash')==digest:
            court_profile=candidate
    court_candidates=None
    if sample.get('courtCandidates'):
        court_candidates=validate_court_candidates(read_json(Path(sample['courtCandidates']),'Court candidates'),
            digest,len(times))
    feet_candidates=None
    if sample.get('feetCandidates'):
        feet_candidates=validate_feet_candidates(read_json(Path(sample['feetCandidates']),'Feet candidates'),digest,
            {entry['rawFingerprint']:entry['records'] for entry in versions.values()},width,height)
    payloads={}
    variants=[{'id':identifier,'label':entry['label'],'recommended':entry['recommended']}
              for identifier,entry in versions.items()]
    for identifier,entry in versions.items():
        # Grouped presentation may omit identities only for uncertain team colors.
        # Donate ungrouped suggestions only from byte-identical, already validated
        # detector records. This API field is regenerated after trims, never saved
        # into tracking metadata or included in historical draft fingerprints.
        identity_supplement=None
        if entry['suggestions'] and entry['suggestions'].get('teamGrouping'):
            origin=next(((name,value) for name,value in versions.items() if name!=identifier
                and value['rawFingerprint']==entry['rawFingerprint'] and value['suggestions']
                and not value['suggestions'].get('teamGrouping')),None)
            if origin:
                name,value=origin
                identity_supplement={'variant':name,'video_sha256':digest,
                    'tracking_raw_fingerprint':value['rawFingerprint'],
                    'sourceCuts':sample.get('sourceCuts',[]),
                    'frameMapping':[[record['frame'],record['time'],record.get('source_frame_pts'),
                        record.get('source_time_base'),record.get('source_frame'),record.get('source_time')]
                        for record in value['records']],
                    'identitySuggestions':value['suggestions']}
        payloads[identifier]=json.dumps({'video_sha256':digest,'width':width,'height':height,
            'courtCalibration':court_profile,'courtCandidates':court_candidates,
            'feetCandidates':feet_candidates if feet_candidates and
                feet_candidates['trackingFingerprint']==entry['rawFingerprint'] else None,
            'frames':entry['records'],'sourceCuts':sample.get('sourceCuts',[]),
            'liveSelection':sample.get('liveSelection'),'source_video_sha256':sample.get('sourceVideoSha256'),
            'supportsCourtCalibration':sample.get('supportsCourtCalibration',True),'tracking_revision':identifier,
            'tracking_fingerprint':entry['fingerprint'],'tracking_raw_fingerprint':entry['rawFingerprint'],
            'trackingMetadata':entry['metadata'],
            'detectorEvidence':entry['detectorEvidence'],
            'identitySuggestions':entry['suggestions'],'identitySupplement':identity_supplement,
            'variant':identifier,'defaultVariant':default,'variants':variants,
            'audioPolicy':entry['metadata'].get('audio_policy')},
            ensure_ascii=False,allow_nan=False).encode('utf-8')
    return {'video':video,'payloads':payloads,'digest':digest,'frames':len(times),'defaultVariant':default}


if __name__ == "__main__":
    main()
