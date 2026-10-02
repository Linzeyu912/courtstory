"""Serve the local player review UI and an explicit video library on loopback."""

import argparse
import hashlib
import json
import mimetypes
import os
import re
import threading
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from scene_profiles import validate_court_candidates, validate_feet_candidates


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
    args = parser.parse_args()
    if args.library:
        if args.video or args.tracks or args.alternative_tracks:
            parser.error("Use --library or --video/--tracks, not both")
        library=json.loads(Path(args.library).read_text(encoding="utf-8"))
        samples=library.get("samples",[])
        available=[]
        for sample in samples:
            if sample.get('optional') and any(not Path(sample[k]).is_file() for k in ['video','tracks']):
                print(f"Skipping unavailable optional sample: {sample['id']}",flush=True)
                continue
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
    def library_payload():
        return json.dumps({"defaultSample":default,"samples":[{**{k:s.get(k) for k in ['id','title','description','sourceUrl']},'defaultVariant':clips[s['id']]['defaultVariant']} for s in samples]},ensure_ascii=False).encode('utf-8')
    static = Path(__file__).resolve().parents[1] / "tools/player-review"
    routes = {"/": static / "index.html"}
    for filename in ["style.css","pipeline.css","app.mjs","footage-ui.mjs","manual-path.mjs","trajectory.mjs","identity-timeline.mjs","tracking-display.mjs","court.mjs","workspace.mjs","court-geometry.mjs","image-edit.mjs","scene-objects.mjs","scene-objects-ui.mjs","calibration-guide.mjs","feet-candidates.mjs","ui.bundle.mjs","ui.bundle.mjs.LEGAL.txt"]:
        routes['/'+filename]=static/filename

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            route=urlsplit(self.path).path
            if route not in {'/api/trim','/api/court-propagate'}:self.send_error(404);return
            origin=self.headers.get('Origin')
            if origin and origin!=f'http://127.0.0.1:{self.server.server_port}':self.send_error(403);return
            if self.headers.get('Content-Type','').split(';')[0]!='application/json':self.send_error(415);return
            try:
                size=int(self.headers.get('Content-Length','0'))
                if not 0<size<=65536:raise ValueError('请求大小不正确。')
                request=json.loads(self.rfile.read(size))
                if not isinstance(request,dict):raise ValueError('请求必须是 JSON 对象。')
                source_id=request.get('sample');variant=request.get('variant',clips.get(source_id,{}).get('defaultVariant','original'))
                if source_id not in clips or variant not in clips[source_id]['payloads']:raise ValueError('找不到源视频或跟踪版本。')
                if route=='/api/court-propagate':
                    from court_propagation import propagate_court
                    with mutation_lock:
                        result=propagate_court(clips[source_id]['video'],json.loads(clips[source_id]['payloads'][variant]),
                                               request.get('seed'),request.get('cuts') or [])
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
                        'description':f"保留 {len(result['retainedRanges'])} 个直播区间；区间之间断开轨迹。",'sourceUrl':parent.get('sourceUrl'),
                        'liveSelection':selection,'parentSample':source_id,'parentVideoSha256':clips[source_id]['digest']}
                    clips[ident]=load_clip(parser,sample);samples.append(sample)
                    if request.get('qa') is not True:
                        saved.append(sample)
                        temporary=cache/('library-'+uuid.uuid4().hex+'.json')
                        temporary.write_text(json.dumps(saved,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');temporary.replace(saved_path)
                data=json.dumps({'sample':ident,'frames':clips[ident]['frames'],'sourceCuts':result['sourceCuts']}).encode('utf-8')
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


def load_clip(parser,sample):
    video, records_path = Path(sample['video']).resolve(), Path(sample['tracks']).resolve()
    if not video.is_file() or not records_path.is_file():
        parser.error("Video and frame records must already exist locally")
    records = json.loads(records_path.read_text(encoding="utf-8"))
    if not records or any(record["frame"] != index for index, record in enumerate(records)):
        parser.error("Frame records must be nonempty and sequential")
    import av
    with av.open(str(video)) as container:
        stream = container.streams.video[0]
        width, height = stream.width, stream.height
    with video.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    metadata_path=records_path.with_suffix('.meta.json')
    if metadata_path.is_file():
        metadata=json.loads(metadata_path.read_text(encoding='utf-8'))
        if metadata.get('video_sha256')!=digest or metadata.get('frames')!=len(records):
            parser.error('Tracks metadata does not match the video')
    if sample.get('videoSha256') and sample['videoSha256']!=digest:
        parser.error('Library video hash mismatch')
    with av.open(str(video)) as container:
        times=[float(f.time) for f in container.decode(video=0)]
    if len(times)!=len(records) or any(abs(t-r['time'])>.001 for t,r in zip(times,records)):
        parser.error('Tracks must match every decoded video frame timestamp')
    versions={"original":(records,records_path,sample.get('originalLabel','原跟踪 · 保留已有草稿'),False)}
    extra_variants=list(sample.get('trackingVariants',[]))
    if sample.get('alternativeTracks'):
        extra_variants.append({'id':'jersey','tracks':sample['alternativeTracks'],'label':'球衣约束实验 · 独立草稿'})
    for config in extra_variants:
        ident=config.get('id')
        if not isinstance(ident,str) or not re.fullmatch(r'[a-z][a-z0-9_-]{0,39}',ident) or ident in versions:
            parser.error('Tracking variants must have unique safe identifiers')
        alternative_path=Path(config['tracks']).resolve()
        alternative=json.loads(alternative_path.read_text(encoding="utf-8"))
        if len(alternative)!=len(records) or any(a['frame']!=b['frame'] or abs(a['time']-b['time'])>.001 for a,b in zip(records,alternative)):
            parser.error("Alternative tracks must match the original frame sequence")
        meta_path=alternative_path.with_suffix('.meta.json')
        if meta_path.is_file():
            meta=json.loads(meta_path.read_text(encoding='utf-8'))
            if meta.get('video_sha256')!=digest or meta.get('frames')!=len(records):
                parser.error('Alternative tracks metadata does not match the video')
        versions[ident]=(alternative,alternative_path,config.get('label',ident),bool(config.get('recommended',False)))
    default_variant=sample.get('defaultVariant','original')
    if default_variant not in versions:
        parser.error('Default tracking variant is unavailable')
    court_profile = None
    if Path(sample.get('courtProfile','engineering/research/vision-player-refinement/clip001-court-expanded.json')).is_file():
        candidate = json.loads(Path(sample.get('courtProfile','engineering/research/vision-player-refinement/clip001-court-expanded.json')).read_text(encoding="utf-8"))
        if candidate.get("videoHash") == digest:
            court_profile = candidate
    court_candidates = None
    if sample.get('courtCandidates'):
        candidate=json.loads(Path(sample['courtCandidates']).read_text(encoding='utf-8'))
        court_candidates=validate_court_candidates(candidate,digest,len(records))
    fingerprints={key:hashlib.sha256(entry[1].read_bytes()).hexdigest() for key,entry in versions.items()}
    feet_candidates = None
    if sample.get('feetCandidates'):
        candidate=json.loads(Path(sample['feetCandidates']).read_text(encoding='utf-8'))
        feet_candidates=validate_feet_candidates(candidate,digest,
            {fingerprints[key]:entry[0] for key,entry in versions.items()},width,height)
    payloads={key:json.dumps({"video_sha256":digest,"width":width,"height":height,"courtCalibration":court_profile,
        "courtCandidates":court_candidates,
        "feetCandidates":feet_candidates if feet_candidates and feet_candidates['trackingFingerprint']==fingerprints[key] else None,
        "frames":data,"sourceCuts":sample.get('sourceCuts',[]),"liveSelection":sample.get('liveSelection'),"source_video_sha256":sample.get('sourceVideoSha256'),"supportsCourtCalibration":sample.get('supportsCourtCalibration',True),"tracking_revision":key,"tracking_fingerprint":fingerprints[key],
        "variant":key,"defaultVariant":default_variant,
        "variants":[{"id":identifier,"label":entry[2],"recommended":entry[3]} for identifier,entry in versions.items()]},ensure_ascii=False,allow_nan=False).encode("utf-8") for key,(data,path,label,recommended) in versions.items()}
    return {'video':video,'payloads':payloads,'digest':digest,'frames':len(records),'defaultVariant':default_variant}


if __name__ == "__main__":
    main()
