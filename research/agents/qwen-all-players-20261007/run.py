"""Full-clip multi-player experiment using the existing ground trajectory agent."""
from pathlib import Path
from collections import defaultdict
from copy import deepcopy
import argparse, base64, io, json, os, sys, time, urllib.request, urllib.error
import av
import numpy as np
from scipy.optimize import linear_sum_assignment
from PIL import Image, ImageDraw, ImageFont
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'engineering/scripts'))
from court_propagation import propagate_court
from tactical_workbench import TacticalWorkbench
from ground_trajectory_agent import GroundTrajectoryAgent, ACTIVE

OUT = ROOT / 'artifacts/qwen-all-players-20261007'
FONT = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 22)

def read(path): return json.loads(path.read_text(encoding='utf-8'))
def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, allow_nan=False, indent=2), encoding='utf-8')
def emit(stage, **kw): print(json.dumps(dict(stage=stage, **kw), ensure_ascii=True), flush=True)
def setup(case):
    os.chdir(ROOT)
    env = dotenv_values(ROOT / '.env', encoding='utf-8-sig')
    os.environ['QWEN_KEY'] = os.environ.get('QWEN_KEY') or env.get('QWEN_KEY') or env.get('QWEN_API_KEY', '')
    os.environ['QWEN_GROUND_TIMEOUT'] = '600'
    os.environ['QWEN_GROUND_MAX_TURNS'] = '24'
    os.environ['QWEN_GROUND_MAX_FRAMES'] = '96'
    folder = OUT / ('official-training-' + case)
    folder.mkdir(parents=True, exist_ok=True)
    clip = read(ROOT / f'artifacts/qwen-official-20261005/official-training-{case}/clip.json')
    lib = read(ROOT / 'data/videos/tactics/acceptance/review-library.json')
    sample = next(s for s in lib['samples'] if s['id'] == 'official-training-' + case)
    return folder, clip, ROOT / sample['video']

def frames(video, indices):
    wanted = set(indices); result = {}
    with av.open(str(video)) as container:
        container.streams.video[0].thread_type = 'AUTO'
        for i, frame in enumerate(container.decode(video=0)):
            if i in wanted: result[i] = frame.to_image()
            if i >= max(wanted): break
    return result

def call(folder, label, prompt, images):
    path = folder / (label + '.json')
    if path.exists(): return read(path)['result']
    content = [{'type':'text', 'text':prompt}]
    for pic in images:
        b = io.BytesIO(); pic.save(b, format='JPEG', quality=91)
        content.append({'type':'image_url','image_url':{'url':'data:image/jpeg;base64,' + base64.b64encode(b.getvalue()).decode()}})
    request = {'model':os.environ.get('QWEN_MODEL','qwen3.8-max'), 'messages':[{'role':'user','content':content}],
               'enable_thinking':False, 'max_tokens':8192, 'temperature':0.1, 'response_format':{'type':'json_object'}}
    url = os.environ.get('QWEN_BASE_URL','https://dashscope.aliyuncs.com/compatible-mode/v1').rstrip('/') + '/chat/completions'
    emit('qwen_request', label=label, images=len(images))
    started = time.monotonic()
    try:
        req = urllib.request.Request(url, data=json.dumps(request).encode(), headers={'Authorization':'Bearer ' + os.environ['QWEN_KEY'],'Content-Type':'application/json'})
        with urllib.request.urlopen(req, timeout=120) as response: response = json.load(response)
        answer = response['choices'][0]['message']['content']
        result = json.loads(answer.removeprefix('```json').removesuffix('```').strip())
        save(path, {'result':result,'usage':response.get('usage'),'elapsedSeconds':time.monotonic()-started})
        emit('qwen_response', label=label, elapsedSeconds=round(time.monotonic()-started,1), usage=response.get('usage'))
        return result
    except Exception as error:
        detail = error.read().decode(errors='replace') if isinstance(error, urllib.error.HTTPError) else str(error)
        detail = detail.replace(os.environ['QWEN_KEY'],'[redacted]')
        save(folder / 'api-failure.json', {'label':label,'error':detail,'time':time.time()})
        emit('API_FAILURE', label=label, error=detail)
        raise RuntimeError(detail) from None

def bootstrap(case):
    folder, clip, video = setup(case)
    indices = [120,360,600,780,900,1080,1200]
    source = frames(video, indices)
    pictures=[]
    for index in indices:
        p=source[index].copy();d=ImageDraw.Draw(p)
        for t in clip['frames'][index]['tracks']:
            d.rectangle(t[:4],outline='#ffcc00',width=3)
            d.rectangle([t[0],max(0,t[1]-28),t[0]+65,t[1]],fill='black')
            d.text((t[0]+3,max(0,t[1]-27)),f'T{t[4]}',font=FONT,fill='yellow')
        p.thumbnail((1280,720));b=Image.new('RGB',(1280,750),'#101010');b.paste(p,(0,30))
        ImageDraw.Draw(b).text((10,3),f'frame={index}, time={clip["frames"][index]["time"]:.3f}s',font=FONT,fill='white')
        b.save(folder / f'identity-frame-{index}.jpg');pictures.append(b)
    prompt='''核对同一个连续篮球镜头的全部场上球员身份。黄色 T 编号是临时检测轨迹，可能换号或串人；不要相信其队伍标签。只按球衣、号码、外观和连续运动判断。两队各五人；白色队分配 P1-P5，深蓝色队分配 P6-P10。同一真实球员跨所有图保持同一个 P。号码不清楚用 null，不能猜姓名。裁判/观众排除。返回 JSON {"roster":[{"id":"P1","team":"white","jersey":"1","description":"可见外观特征"},...],"frames":[{"frame":120,"players":[{"trackId":8,"entityId":"P1","confidence":"high|medium|low"},...]}],"notes":[...]}。每张图尽可能标全部可见场上球员；未确定的人不随便配对。'''
    call(folder,'roster',prompt,pictures)

def calibrate(case):
    folder, clip, video=setup(case)
    path=folder/'calibration.json'
    if path.exists():emit('calibration_cached',case=case);return
    old=ROOT/f'artifacts/qwen-official-20261005/official-training-{case}'
    seed=read(old/'seed.json')
    emit('calibration_start',case=case,seed=seed['frame'],frames=len(clip['frames']))
    cal=propagate_court(video,clip,seed,max_seconds=20)
    for key in cal['keyframes']:
        if key.get('points'):key.update(status='test_reference',reviewSource='ai_visual_reference')
    save(path,cal);emit('calibration_done',case=case,valid=cal['summary']['validFrames'],total=len(clip['frames']))

def classify(case):
    folder, clip, video=setup(case)
    roster=read(folder/'roster.json')['result']
    occurrences=defaultdict(list)
    for f in clip['frames']:
        for t in f['tracks']:occurrences[t[4]].append((f['frame'],t))
    groups=[]
    for tid,rows in occurrences.items():
        segments=[];segment=[]
        for row in rows:
            if segment and (row[0]-segment[-1][0]>60 or row[0]-segment[0][0]>=360):
                segments.append(segment);segment=[]
            segment.append(row)
        if segment:segments.append(segment)
        for segment in segments:
            candidates=[]
            for part in range(3):
                chunk=segment[part*len(segment)//3:(part+1)*len(segment)//3]
                if chunk:candidates.append(max(chunk,key=lambda r:(r[1][5],(r[1][2]-r[1][0])*(r[1][3]-r[1][1]))))
            groups.append({'group':len(groups),'trackId':tid,'start':segment[0][0],'end':segment[-1][0],'count':len(segment),
                           'samples':[r[0] for r in candidates],'boxes':[r[1][:4] for r in candidates]})
    save(folder/'groups.json',groups)
    needed=sorted({f for g in groups for f in g['samples']})
    emit('decode_identity_crops',case=case,frames=len(needed),groups=len(groups))
    source=frames(video,needed)
    for start in range(0,len(groups),12):
        batch=groups[start:start+12];pic=Image.new('RGB',(1440,360*((len(batch)+3)//4)),'#181818');draw=ImageDraw.Draw(pic)
        for j,g in enumerate(batch):
            x=(j%4)*360;y=(j//4)*360
            draw.text((x+4,y+3),f'G{g["group"]} T{g["trackId"]} [{g["start"]},{g["end"]}]',font=FONT,fill='white')
            for k,(f,box) in enumerate(zip(g['samples'],g['boxes'])):
                p=source[f].crop((max(0,box[0]-10),max(0,box[1]-8),min(1920,box[2]+10),min(1080,box[3]+8)))
                p.thumbnail((116,294));pic.paste(p,(x+k*120,y+50))
                draw.text((x+k*120,y+28),str(f),font=FONT,fill='yellow')
        pic.save(folder/f'groups-{start}.jpg')
        prompt='''将每个 G 组中的三张球员裁图匹配到已有 roster。同组是同一个临时 T 在指定范围的观测，但可能串人。严格读球衣号码与外观，白/深蓝两队各五人；裁判或观众标 null；遮挡无法确定也标 null。不要为凑人数猜。若同组不同图明显不同人，返回 sampleAssignments 各样本身份并说明 drift。返回 JSON {"groups":[{"group":0,"entityId":"P1"或null,"jersey":"1"或null,"confidence":"high|medium|low","sampleAssignments":[{"frame":120,"entityId":"P1"或null}],"reason":"视觉依据"}]}。已有 roster 和原帧核对：''' + json.dumps(roster,ensure_ascii=False)
        call(folder,f'identities-{start}',prompt,[pic])
    emit('identity_done',case=case,groups=len(groups))

# Corrections made by visually reviewing the saved crops, not human identity truth.
# Missing/fragment-only detections stay unassigned; detected ID switches retain
# different sample labels and are resolved using adjacent observed positions.
OVERRIDES = {
 '001': {0:'P4',1:None,2:None,3:'P3',4:'P7',5:'P7',6:'P2',7:[(31,'P10'),(227,'P5')],8:'P5',
  9:'P9',10:[(532,'P9'),(679,'P7')],11:'P7',12:'P7',13:'P6',14:'P4',15:'P4',16:'P4',
  17:[(1128,'P4'),(1217,'P9')],18:'P3',19:'P3',20:'P6',21:None,22:[(67,'P5'),(196,'P2')],23:'P2',24:'P2',25:'P2',
  26:None,27:None,28:'P1',29:None,30:'P8',31:'P8',32:'P8',33:'P6',34:'P1',35:'P10',36:'P9',
  37:'P1',38:'P1',39:'P1',40:None,41:'P6',42:'P6',43:'P6',44:None,45:None,46:None,47:None,
  48:'P8',49:'P10',50:None,51:'P3',52:'P3',53:'P3',54:None,55:None,56:None,57:'P9',58:'P5',59:'P5',
  60:'P10',61:None,62:'P10',63:None,64:'P9',65:'P9',66:'P10',67:'P9',68:None,69:None,70:None,71:None,
  72:None,73:'P4',74:None},
 '002': {0:'P3',1:'P7',2:'P7',3:'P7',4:'P1',5:'P1',6:'P2',7:'P2',8:'P2',9:'P2',10:'P4',11:'P6',
  12:'P6',13:'P6',14:'P6',15:'P8',16:'P8',17:'P8',18:None,19:'P5',20:'P5',21:[(0,'P10'),(22,'P5')],22:'P9',23:None,
  24:None,25:'P10',26:None,27:None,28:[(127,'P9'),(149,'P3')],29:None,30:'P3',31:'P10',32:'P3',33:'P3',34:'P3',35:None,
  36:'P4',37:None,38:'P10',39:'P10',40:'P3',41:'P8',42:'P9',43:None,44:None,45:'P9',46:'P4',47:'P4',48:'P4',
  49:'P3',50:'P3',51:'P3',52:'P5',53:'P3',54:[(783,'P3'),(821,'P8')],55:'P1',56:'P1',
  57:[(945,'P10'),(1111,'P8')],58:'P8',59:'P9',60:[(958,'P8'),(1177,'P10')],61:'P10',62:None,63:None,
  64:'P8',65:None,66:None,67:'P8',68:None,69:'P9',70:'P3',71:'P5'}
}

def prepare(case):
    folder, clip, video=setup(case)
    groups=read(folder/'groups.json'); classified={}
    for path in folder.glob('identities-*.json'):
        for g in read(path)['result']['groups']:classified[g['group']]=g
    corrections=OVERRIDES[case]
    labels={};drift_labels={};explicit={}
    for g in groups:
        answer=classified.get(g['group'],{})
        hint=corrections.get(g['group'],answer.get('entityId'))
        samples=hint if isinstance(hint,list) else [(f,hint) for f in g['samples']]
        for frame in range(g['start'],g['end']+1):
            labels[frame,g['trackId']]=min(samples,key=lambda s:abs(s[0]-frame))[1] if samples else None
            if isinstance(hint,list):drift_labels[frame,g['trackId']]={s[1] for s in samples}
        if isinstance(hint,list):
            for frame,pid in samples:explicit[frame,g['trackId']]=pid
    jerseys = ['1','10','17','28','7','00','21','31','32','13'] if case=='001' else ['1','10','30','17','7','13','3','32','21','00']
    roster=[{'id':f'P{i+1}','team':'white' if i<5 else 'dark_blue','jersey':n,
             'name':('白' if i<5 else '蓝')+f'{n}号','reviewRequired':True} for i,n in enumerate(jerseys)]
    save(folder/'roster-reviewed.json',roster)
    save(folder/'identity-corrections.json',{'source':'ai_visual_crop_review','groups':corrections,'reviewRequired':True})
    cuts=[5] if case=='001' else [1276]
    assignments=[]; previous={}; ambiguous=[]
    for row in clip['frames']:
        frame=row['frame']
        if frame in cuts:previous={}
        tracks=[t for t in row['tracks'] if labels.get((frame,t[4])) is not None]
        cost=np.full((10,len(tracks)+10),2.8)
        for i,player in enumerate(roster):
            old=previous.get(player['id'])
            for j,t in enumerate(tracks):
                hint=labels[frame,t[4]]
                center=np.array([(t[0]+t[2])/2,(t[1]+t[3])/2])
                possible=drift_labels.get((frame,t[4]),{hint})
                if (frame,t[4]) in explicit:possible={explicit[frame,t[4]]}
                if player['id'] not in possible:continue
                c=0.25 if hint==player['id'] else 3.5
                if old and frame-old['frame']<=24:
                    distance=float(np.linalg.norm(center-old['center']))
                    c=min(1.8,distance/(65+3*(frame-old['frame']))) + (0.25 if hint==player['id'] else 1.1)
                    if t[4]==old['trackId']:c-=.15
                evidence=row.get('track_evidence',{}).get(str(t[4]),{}).get('torso',{})
                if evidence.get('reliable'):
                    team=evidence.get('label')
                    if (team=='white' and player['team']!='white') or (team=='dark' and player['team']=='white'):c+=5
                cost[i,j]=c
        indices,columns=linear_sum_assignment(cost)
        assigned={}
        for i,j in zip(indices,columns):
            if j>=len(tracks) or cost[i,j]>=2.8:continue
            t=tracks[j];pid=roster[i]['id'];assigned[pid]=t[4]
            if labels[frame,t[4]]!=pid:ambiguous.append({'frame':frame,'entityId':pid,'trackId':t[4],'sampleHint':labels[frame,t[4]],'source':'adjacent_continuity'})
            previous[pid]={'frame':frame,'center':np.array([(t[0]+t[2])/2,(t[1]+t[3])/2]),'trackId':t[4]}
        assignments.append(assigned)
    cal=read(folder/'calibration.json')
    # Full propagation diagnostics are preserved in calibration.json. The agent
    # only needs source/quality flags here; otherwise the same nested report is
    # copied into every observation of all ten players and every journal update.
    for k in cal['keyframes']:
        quality=k.get('quality',{})
        k['quality']={name:quality[name] for name in ('method','referenceFrame','cameraSupportFrame',
                      'calibrationBasisFrame','calibrationBasisSourceFrame','independentAccuracyValidated') if name in quality}
        k['quality']['independentAccuracyValidated']=False
    # Closeups have no usable court plane, regardless of a homography fit.
    for k in cal['keyframes']:
        if (case=='001' and k['frame']<5) or (case=='002' and k['frame']>=1276):
            k.update(points=[],status='invalid',reason='近景切镜，没有可核对的球场平面');k.pop('courtToImage',None)
    cal['invalidFrames']=[k['frame'] for k in cal['keyframes'] if not k.get('points')]
    cal['summary']['validFrames']=sum(bool(k.get('points')) for k in cal['keyframes'])
    session={'version':1,'videoHash':clip['video_sha256'],'identityBindingMode':'forward_only_v1','maxGapSeconds':0,'cuts':cuts,
             'entities':[],'courtCalibration':cal}
    for player in roster:
        spans=[]
        for f,a in enumerate(assignments):
            tid=a.get(player['id'])
            if tid is None:continue
            if spans and spans[-1]['trackId']==tid and spans[-1]['end']==f-1 and f not in cuts:spans[-1]['end']=f
            else:spans.append({'kind':'track','trackId':tid,'start':f,'end':f,'origin':'ai_visual_reference'})
        session['entities'].append({**player,'role':'player','teamSide':'red' if player['team']=='white' else 'blue','anchors':[],'bindings':spans})
    tactics=TacticalWorkbench(folder/'workbench')
    session['courtPreparation']=tactics.run('court-preparation-build',session=session,clip=clip)['preparation']
    save(folder/'session.json',session);save(folder/'assignments.json',assignments);save(folder/'continuity-disagreements.json',ambiguous)
    emit('preparation_done',case=case,calibrationFrames=cal['summary']['validFrames'],
         players={p['id']:sum(a.get(p['id']) is not None for a in assignments) for p in roster},continuityDisagreements=len(ambiguous))

def ground(case):
    folder,clip,video=setup(case);session=read(folder/'session.json')
    tactics=TacticalWorkbench(folder/'workbench');agent=GroundTrajectoryAgent(folder/'jobs',tactics,timeout=600)
    ranges=[(s,min(s+600,len(clip['frames']))) for s in range(0,len(clip['frames']),600)]
    try:
        for start,end in ranges:
            path=folder/f'ground-{start}-{end}.json'
            if path.exists():continue
            ids=[e['id'] for e in session['entities'] if any(p.get('x') is not None for p in session['courtPreparation']['rawByPlayer'][e['id']][start:end])]
            if not ids:save(path,{'status':'no_ground_observations','candidate':None});continue
            request={'session':session,'clientRevision':0,'entityIds':ids,'range':{'startFrame':start,'endFrameExclusive':end},
             'goal':'测试本段全部球员，白队 P1-P5、深蓝队 P6-P10。逐个核对每个球员的原始脚点，全部球员都要读取证据并至少提出一个清楚地面锚点。不要混人；身份是经 AI 裁图核对及相邻位置续接的测试参照。请先看全段拼图和原始轨迹，再分组看清晰脚部，按图片 assetId 像素提出锚点，拟合后读取回投确认。原始已经合理可保留，不能只修主角。每次 player/feet 帧数乘人数最多8，分组取证。首版给每人2个锚点，立即拟合并回看，必要时再补。选段首尾锚点与外部轨迹衔接可能锁定，不要修改 startFrame 或 endFrameExclusive-1 的位置，请选内部清楚帧。近景、无标定、缺检测保持缺口。最多24轮，请留轮数用于拟合、回看和结束。'}
            if case=='002' and start<=1155<end:
                request['goal']+=' 请额外查看源帧1155：上次单人测试把仍然可见的白色1号误删，本次按原图核查，不能沿用上次未知判断。'
            emit('ground_start',case=case,start=start,end=end,players=ids)
            job=agent.create(request,clip,video,'team-stable',True);last=None
            while True:
                value=agent.get(job['jobId'],clip,'team-stable',True)
                signature=(value['status'],value.get('message'))
                if signature!=last:emit('ground_progress',case=case,start=start,status=value['status'],message=value.get('message'),usage=value.get('usage'));last=signature
                if value['status'] not in ACTIVE:break
                time.sleep(2)
            save(path,value)
            emit('ground_done',case=case,start=start,status=value['status'],anchors=len((value.get('candidate') or {}).get('anchors',[])))
            # An API failure is not a reason to repeatedly consume the rest of the queue.
            if value['status'] in ('failed','error'):
                emit('RUN_FAILURE',case=case,start=start,error=value.get('message'));break
    finally:agent.close()

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('case',choices=['001','002']);p.add_argument('stage',choices=['bootstrap','calibrate','classify','prepare','ground']);a=p.parse_args()
    {'bootstrap':bootstrap,'calibrate':calibrate,'classify':classify,'prepare':prepare,'ground':ground}[a.stage](a.case)
