"""Explicit live Qwen benchmark on the two authorized official training clips."""
from pathlib import Path
import argparse, json, os, sys, time
from copy import deepcopy
from dotenv import dotenv_values

ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'engineering/scripts'))
from serve_player_review import validated_clip
from court_propagation import propagate_court
from tactical_workbench import TacticalWorkbench
from ground_trajectory_agent import GroundTrajectoryAgent, ACTIVE

p=argparse.ArgumentParser();p.add_argument('case',choices=['001','002']);p.add_argument('--label',default='baseline');p.add_argument('--prepare-only',action='store_true');args=p.parse_args()
os.chdir(ROOT)
OUT=ROOT/'artifacts/qwen-official-20261005'/f'official-training-{args.case}'
OUT.mkdir(parents=True,exist_ok=True)
def save(path,value):path.write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf-8')
def emit(stage,**kw):print(json.dumps({'stage':stage,**kw},ensure_ascii=True),flush=True)
env=dotenv_values(ROOT/'.env',encoding='utf-8-sig')
os.environ['QWEN_KEY']=os.environ.get('QWEN_KEY') or env.get('QWEN_KEY') or env.get('QWEN_API_KEY','')
os.environ['QWEN_GROUND_TIMEOUT']='600'
specs={
 '001':dict(seed=900,side='left',corners=[[441,573],[1139,621],[987,801],[198,743]],start=780,end=1080,track=10,seconds=3.1,description='深蓝球衣、白色头带的 T10，篮下横向移动与防守；按原画面判断脚底地面位置，起跳保留水平位移。'),
 '002':dict(seed=1139,side='right',corners=[[1240,628],[399,697],[583,898],[1515,814]],start=900,end=1200,track=72,seconds=4.1,description='白色 1 号 T72，从左侧往右篮筐突破、起跳；不要把空中脚部当地面点，不确定或遮挡请标为未知。'),
}
spec=specs[args.case]
cached=OUT/'clip.json'
if cached.exists():clip=json.loads(cached.read_text(encoding='utf-8'))
else:
 emit('validating_source')
 lib=json.loads((ROOT/'data/videos/tactics/acceptance/review-library.json').read_text(encoding='utf-8'))
 sample=next(s for s in lib['samples'] if s['id']==f'official-training-{args.case}')
 info=validated_clip(sample)
 clip=json.loads(info['payloads']['team-stable']);save(cached,clip)
lib=json.loads((ROOT/'data/videos/tactics/acceptance/review-library.json').read_text(encoding='utf-8'))
sample=next(s for s in lib['samples'] if s['id']==f'official-training-{args.case}')
video=ROOT/sample['video']
emit('source_ready',frames=len(clip['frames']),cuts=clip.get('sourceCuts'))
calpath=OUT/'calibration.json'
if calpath.exists():cal=json.loads(calpath.read_text(encoding='utf-8'))
else:
 seed={'frame':spec['seed'],'side':spec['side'],'source':'ai_visual_reference','reviewRequired':True,
       'points':[{'id':i,'image':xy,'source':'ai_visual_reference','reviewRequired':True} for i,xy in zip('ABCD',spec['corners'])]}
 save(OUT/'seed.json',seed)
 emit('propagating_calibration',seed=spec['seed'])
 cal=propagate_court(video,clip,seed,max_seconds=spec['seconds'])
 save(OUT/'calibration-pending.json',cal)
 # These are explicitly AI-reviewed test references, never human truth.
 for key in cal['keyframes']:
  if key.get('points'):key['status']='test_reference';key['reviewSource']='ai_visual_reference'
 cal['notes'].append('仅本地 Qwen 实测用 AI 视觉参照；未人工确认，不能作为米制真值。')
 save(calpath,cal)
emit('calibration_ready',valid=cal['summary']['validFrames'],invalid=len(cal['invalidFrames']))
session={'version':1,'videoHash':clip['video_sha256'],'identityBindingMode':'forward_only_v1','maxGapSeconds':0,'cuts':[],
 'entities':[{'id':f'P{i+1}','name':f'球员 {i+1}','role':'player','teamSide':'red' if i<5 else 'blue','anchors':[]} for i in range(10)],'courtCalibration':cal}
session['entities'][0].update(name=f'AI 测试参照 T{spec["track"]}',bindings=[{'kind':'track','trackId':spec['track'],'start':spec['start'],'end':spec['end']-1,'origin':'ai_visual_reference'}])
tactics=TacticalWorkbench(OUT/'workbench')
session['courtPreparation']=tactics.run('court-preparation-build',session=session,clip=clip)['preparation']
save(OUT/'session.json',session)
raw=session['courtPreparation']['rawByPlayer']['P1'][spec['start']:spec['end']]
emit('preparation_ready',finite=sum(p.get('x') is not None for p in raw),total=len(raw))
if args.prepare_only:sys.exit(0)
agent=GroundTrajectoryAgent(OUT/'jobs',tactics,timeout=600)
request={'session':session,'clientRevision':0,'entityIds':['P1'],'range':{'startFrame':spec['start'],'endFrameExclusive':spec['end']},
 'goal':spec['description']+' 本次场地与身份是 AI 实测参照，尚未人工确认。请实际读取全帧与人物图核对，拟合后阅读 2D 图和原帧回投图，再决定修正或完成。'}
emit('agent_start',model=agent.status()['model'])
job=agent.create(request,clip,video,'team-stable',True);last=None
try:
 while True:
  value=agent.get(job['jobId'],clip,'team-stable',True)
  signature=json.dumps({k:v for k,v in value.items() if k in ('status','message','progress','usage')},sort_keys=True)
  if signature!=last:emit('progress',jobId=job['jobId'],**json.loads(signature));last=signature
  if value['status'] not in ACTIVE:break
  time.sleep(2)
 save(OUT/f'result-{args.label}.json',value)
 emit('done',jobId=job['jobId'],status=value['status'],candidateRevision=(value.get('candidate') or {}).get('revision'))
finally:agent.close()
