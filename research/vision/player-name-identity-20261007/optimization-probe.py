"""User-started v4 identity experiment with independently inspected frame references."""
import argparse
from collections import Counter
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import sys
import time
import urllib.request

ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'engineering/scripts'))
from local_video_library import atomic_json
from player_name_identity import create_qwen_token_plan_provider,recognize_player_names,ALGORITHM
from player_game_roster import PlayerGameRoster
from tactical_workbench import TacticalWorkbench


def read(path):return json.loads(path.read_text(encoding='utf-8'))
def emit(value):print(json.dumps(value,ensure_ascii=True),flush=True)


class LoggedProvider:
    def __init__(self,provider,folder,retries=0,jpeg_quality=80):
        self.provider,self.folder,self.calls=provider,folder,[]
        self.retries,self.jpeg_quality=retries,jpeg_quality
    def status(self):return self.provider.status()
    def read(self,images,labels):return self.review(images,labels)
    def review(self,images,labels,context=None):
        from PIL import Image
        request_dir=self.folder/'request-images'/f'call-{len(self.calls)+1}'
        request_dir.mkdir(parents=True,exist_ok=True);request_images=[]
        for index,path in enumerate(images):
            target=request_dir/f'{index}-{Path(path).name}'
            with Image.open(path) as picture:
                picture.convert('RGB').save(target,'JPEG',quality=self.jpeg_quality)
            request_images.append(target)
        for attempt in range(self.retries+1):
            started=time.monotonic();entry={'images':len(images),'labels':labels,'context':context,'ok':False,
                'attempt':attempt+1,'jpegQuality':self.jpeg_quality,
                'imageBytes':sum(p.stat().st_size for p in request_images)}
            emit({'event':'model_start','images':len(images),'firstLabel':labels[0] if labels else None,'attempt':attempt+1})
            try:
                value=self.provider.review(request_images,labels,context=context);entry.update(ok=True,response=value)
                return value
            except Exception as error:
                entry['message']=str(error)
                # One opt-in transport retry preserves the same evidence; no
                # quota/auth retry, key fallback or duplicate frame votes.
                retryable=any(category in str(error) for category in
                    ('超时','网络','connection_reset','connection_refused','timeout','tls_error','url_error'))
                if not retryable or attempt==self.retries:raise
                time.sleep(2)
            finally:
                entry['elapsedSeconds']=round(time.monotonic()-started,3);self.calls.append(entry)
                atomic_json(self.folder/'calls.json',self.calls)
                emit({k:v for k,v in entry.items() if k in ('images','ok','elapsedSeconds','message','attempt')})


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--label',default='v4');parser.add_argument('--players',nargs='*')
    parser.add_argument('--automatic',action='store_true',help='Do not provide the AI diagnostic references or correction windows')
    parser.add_argument('--system-proxy',action='store_true',help='Use existing system proxy instead of a direct request in this test process')
    parser.add_argument('--local-http-proxy',help='Optional existing loopback HTTP proxy, for this test process only')
    parser.add_argument('--transport-retries',type=int,choices=(0,1),default=0)
    parser.add_argument('--jpeg-quality',type=int,choices=range(75,96),default=80)
    parser.add_argument('--correction-plan',help='Source-matched diagnostic JSON providing frame IDs and suspect target windows only')
    args=parser.parse_args()
    if not args.label.replace('-','').isalnum():parser.error('Use a simple output label')
    folder=ROOT/'artifacts/player-name-optimization-20261007'/args.label
    folder.mkdir(parents=True,exist_ok=True)
    source=ROOT/'artifacts/player-name-identity-20261007/all-players-v3'
    session,clip=read(source/'input-session.json'),read(source/'input-clip.json')
    original=deepcopy(session)
    diagnostic=read(ROOT/'artifacts/player-name-optimization-20261007/diagnosis/anchor-candidates.json')
    if diagnostic['sourceVideoSha256']!=clip['video_sha256'] or diagnostic['trackingFingerprint']!=clip['tracking_fingerprint']:
        raise ValueError('Diagnostic reference source mismatch')
    selected=set(args.players or [e['id'] for e in session['entities'] if e['role']=='player'])
    references={p['entityId']:[a['frame'] for a in p['anchors']] for p in diagnostic['players'] if p['entityId'] in selected}
    # These are suspect observation windows, not ground-truth assignments. The
    # recognizer must reread the target and compare it with the clear reference.
    correction_targets=[
        {'entityId':'P2','trackId':14,'start':147,'end':175},
        {'entityId':'P5','trackId':6,'start':147,'end':168},
        {'entityId':'P8','trackId':12,'start':24,'end':108},
        {'entityId':'P6','trackId':32,'start':270,'end':272},
        {'entityId':'P9','trackId':5,'start':610,'end':743,'frames':[610,620,650]},
        {'entityId':'P7','trackId':10,'start':600,'end':678,'frames':[600,630,650]},
    ]
    if args.correction_plan:
        plan_path=(ROOT/args.correction_plan).resolve()
        if not plan_path.is_relative_to((ROOT/'artifacts').resolve()):
            raise ValueError('Correction plans must stay in local artifacts')
        plan=read(plan_path)
        if plan.get('sourceVideoSha256')!=clip['video_sha256']:
            raise ValueError('Correction plan source mismatch')
        references={p:frames for p,frames in plan['reference_frames'].items() if p in selected}
        correction_targets=plan['correction_targets']
    targets=[t for t in correction_targets if t['entityId'] in selected]
    atomic_json(folder/'input-session.json',session);atomic_json(folder/'input-clip.json',clip)
    atomic_json(folder/'input-reference-plan.json',{'referenceFrames':{} if args.automatic else references,
        'correctionTargets':[] if args.automatic else targets,'humanVerified':False,
        'basis':'Source-frame AI visual diagnosis; numbers and names are not provided as model answers'})
    library=read(ROOT/'data/videos/tactics/acceptance/review-library.json')
    video=ROOT/next(item['video'] for item in library['samples'] if item['id']=='official-training-001')
    if args.local_http_proxy:
        from urllib.parse import urlsplit
        proxy=urlsplit(args.local_http_proxy)
        if proxy.scheme!='http' or proxy.hostname not in ('127.0.0.1','localhost') or not proxy.port or proxy.username or proxy.password or proxy.query or proxy.fragment:
            raise ValueError('Use an existing loopback HTTP proxy without credentials')
        opener=urllib.request.build_opener(urllib.request.ProxyHandler({'http':args.local_http_proxy,'https':args.local_http_proxy})).open
    else:
        opener=None if args.system_proxy else urllib.request.build_opener(urllib.request.ProxyHandler({})).open
    provider=LoggedProvider(create_qwen_token_plan_provider(timeout=120,opener=opener),folder,
        retries=args.transport_retries,jpeg_quality=args.jpeg_quality)
    started=time.monotonic()
    candidate=recognize_player_names(session,clip,video,TacticalWorkbench(folder/'workbench'),
        PlayerGameRoster(ROOT/'data/player-rosters','0022500701'),season='2025-26',team_map={'A':'HOU','B':'DAL'},
        provider=provider,work_dir=folder/'evidence',reference_frames=None if args.automatic else references,
        correction_targets=None if args.automatic else targets,selected_entities=sorted(selected))
    key=hashlib.sha256(json.dumps([session,ALGORITHM,references,targets],sort_keys=True,separators=(',',':')).encode()).hexdigest()
    job={'jobId':'interactive-'+args.label,'purpose':'player_names','status':'ready','sourceKey':key,
        'base':{'videoHash':clip['video_sha256'],'trackingFingerprint':clip['tracking_fingerprint'],
            'trackingRevision':clip['tracking_revision'],'variant':'team-stable','qa':True,'clientRevision':0},
        'candidate':candidate}
    atomic_json(folder/'job.json',job)
    summary={'algorithm':ALGORITHM,'selectedPlayers':sorted(selected),'automaticFrameSelection':args.automatic,
        'systemProxy':args.system_proxy,'localHttpProxy':args.local_http_proxy,
        'calls':len(provider.calls),'successfulCalls':sum(c['ok'] for c in provider.calls),
        'elapsedSeconds':round(time.monotonic()-started,3),'segments':dict(Counter(c['status'] for c in candidate['candidates'])),
        'usage':candidate.get('usage'),'issues':candidate.get('issues'),
        'players':[{'id':p,'names':sorted({c['nameCandidate']['name'] for c in candidate['candidates']
            if c['entityId']==p and c['status']=='candidate'}),'segments':sum(c['entityId']==p and c['status']=='candidate' for c in candidate['candidates'])}
            for p in sorted(selected)],'sourceFileChanged':original!=read(source/'input-session.json'),'humanAccuracyVerified':False}
    atomic_json(folder/'summary.json',summary);emit(summary)


if __name__=='__main__':main()
