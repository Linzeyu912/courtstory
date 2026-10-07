"""Explicit authorized ten-player Qwen experiment; reuse frozen identity and geometry."""
import argparse,json,os,sys,threading,re,uuid
from copy import deepcopy
from pathlib import Path
from urllib.parse import urlsplit
from dotenv import dotenv_values
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'engineering/scripts'))
from tactical_workbench import TacticalWorkbench
from ground_trajectory_parallel import ParallelGroundMapping
from local_video_library import atomic_json

def read(p):return json.loads(p.read_text(encoding='utf-8'))
PRINT_LOCK=threading.Lock()
TOKEN_PLAN_BASE_URL='https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'
def emit(v):
    with PRINT_LOCK:print(json.dumps(v,ensure_ascii=True),flush=True)

def archive_review_ranges(out,specs):
    if (out/'run.json').exists() and read(out/'run.json').get('status')=='running':
        raise ValueError('Do not change cached ranges while this case is running')
    paths=[];players=[]
    for spec in dict.fromkeys(specs):
        if not re.fullmatch(r'P(?:[1-9]|10):\d+:\d+',spec):raise ValueError('Use P3:300:600 for a cached review range')
        pid,start,end=spec.split(':');path=out/'players'/pid/f'{start}-{end}.json'
        if not path.is_file():raise ValueError(f'No cached range: {spec}')
        paths.append(path);players.append(pid)
    for path in paths:path.rename(path.with_name(path.stem+'-review-before-'+uuid.uuid4().hex[:8]+'.json'))
    return list(dict.fromkeys(players))

def freeze(case,out):
    old=ROOT/f'artifacts/qwen-all-players-20261007/official-training-{case}'
    source=read(old/'session.json');clip=read(ROOT/f'artifacts/qwen-official-20261005/official-training-{case}/clip.json')
    lib=read(ROOT/'data/videos/tactics/acceptance/review-library.json')
    video=ROOT/next(s for s in lib['samples'] if s['id']=='official-training-'+case)['video']
    session=deepcopy(source);tactics=TacticalWorkbench(out/'workbench')
    # Update the current preparation contract, while checking that input positions stay identical.
    current=tactics.run('court-preparation-build',session=session,clip=clip)['preparation']
    changed=sum((p['x'],p['y'])!=(q['x'],q['y']) for pid,rows in current['rawByPlayer'].items()
        for p,q in zip(rows,source['courtPreparation']['rawByPlayer'][pid]))
    if changed:raise ValueError(f'Input role/mapping contract changed {changed} positions; do not silently replace frozen material')
    session['courtPreparation']=current
    atomic_json(out/'input-session.json',session);atomic_json(out/'input-clip.json',clip)
    atomic_json(out/'input-info.json',{'video':str(video.relative_to(ROOT)),'oldCase':'qwen-all-players-20261007',
        'identitiesChanged':False,'calibrationChanged':False,'rawPositionChanges':changed})
    emit({'stage':'frozen_input','case':case,'rawPositionChanges':changed})
    return session,clip,video,tactics

def main():
    p=argparse.ArgumentParser();p.add_argument('case',choices=['001','002']);p.add_argument('--label',default='single-player-v1')
    p.add_argument('--prepare-only',action='store_true');p.add_argument('--players',nargs='*')
    p.add_argument('--base-url',help='Official regional/workspace compatible endpoint; never an API key')
    p.add_argument('--workers',type=int,choices=range(1,11),default=2,help='Independent player tasks running at once; current test default is two')
    p.add_argument('--local-http-proxy',help='Loopback HTTP service only, e.g. http://127.0.0.1:7897; child process environment only')
    p.add_argument('--token-plan',action='store_true',help='Use QWEN_TOKEN_PLAN_KEY with the official Token Plan endpoint; no fallback to the old key')
    p.add_argument('--redo',nargs='*',default=[],help='Recheck cached ranges, e.g. P3:300:600; preserves prior files')
    p.add_argument('--review-notes',type=Path,help='JSON notes keyed by player, to recheck against source images')
    a=p.parse_args()
    os.chdir(ROOT);env=dotenv_values(ROOT/'.env',encoding='utf-8-sig')
    if a.token_plan:
        key=(os.environ.get('QWEN_TOKEN_PLAN_KEY') or env.get('QWEN_TOKEN_PLAN_KEY') or '').strip()
        if not key:raise ValueError('QWEN_TOKEN_PLAN_KEY is not configured')
        if a.base_url and a.base_url.rstrip('/')!=TOKEN_PLAN_BASE_URL:raise ValueError('Token Plan key must use its dedicated endpoint')
        os.environ['QWEN_KEY']=key;os.environ['QWEN_BASE_URL']=TOKEN_PLAN_BASE_URL
    else:
        os.environ['QWEN_KEY']=os.environ.get('QWEN_KEY') or env.get('QWEN_KEY') or env.get('QWEN_API_KEY','')
        if a.base_url:os.environ['QWEN_BASE_URL']=a.base_url
    os.environ['QWEN_MODEL']='qwen3.8-max'
    if a.local_http_proxy:
        proxy=urlsplit(a.local_http_proxy)
        if proxy.scheme!='http' or proxy.hostname not in ('127.0.0.1','localhost','::1') or not proxy.port or proxy.username or proxy.password or proxy.query or proxy.fragment:
            raise ValueError('Use a credential-free loopback HTTP service')
        os.environ['NODE_USE_ENV_PROXY']='1';os.environ['HTTPS_PROXY']=a.local_http_proxy
        os.environ['NO_PROXY']='localhost,127.0.0.1,::1'
    emit({'stage':'provider_configuration','model':'qwen3.8-max','baseUrl':os.environ.get('QWEN_BASE_URL'),
        'keySource':'QWEN_TOKEN_PLAN_KEY' if a.token_plan else 'QWEN_KEY/QWEN_API_KEY',
        'localHttpProxy':a.local_http_proxy,'workers':a.workers})
    os.environ['QWEN_GROUND_MAX_TURNS']='24';os.environ['QWEN_GROUND_MAX_FRAMES']='96';os.environ['QWEN_GROUND_TIMEOUT']='600'
    os.environ['QWEN_REQUEST_TIMEOUT_MS']='180000';os.environ['QWEN_REQUEST_RETRIES']='3'
    os.environ['QWEN_BURST_WAIT_SECONDS']='30'
    os.environ['QWEN_DEBUG_NETWORK']='1'
    out=ROOT/f'artifacts/qwen-parallel-20261007/{a.label}/official-training-{a.case}';out.mkdir(parents=True,exist_ok=True)
    session,clip,video,tactics=freeze(a.case,out)
    if a.prepare_only:return
    notes=read(a.review_notes) if a.review_notes else None
    archived=archive_review_ranges(out,a.redo) if a.redo else []
    selected=list(dict.fromkeys((a.players or [])+archived)) or None
    workflow=ParallelGroundMapping(out,tactics,max_workers=a.workers,chunk_frames=300,notify=emit)
    workflow.run(session,clip,video,selected_ids=selected,review_notes=notes)

if __name__=='__main__':main()
