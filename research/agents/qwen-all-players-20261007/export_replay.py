"""Export actual multi-player candidates into the existing trajectory observer."""
import json, math
from pathlib import Path

ROOT=Path(__file__).resolve().parents[3]
SOURCE=ROOT/'artifacts/qwen-all-players-20261007'
DEST=SOURCE/'replay'
def read(p):return json.loads(p.read_text(encoding='utf-8'))
def save(p,v):p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(v,ensure_ascii=False,allow_nan=False),encoding='utf-8')
def xy(p):
    a=[p.get('x'),p.get('y')]
    return a if all(type(n) in (int,float) and math.isfinite(n) for n in a) else None

def export():
    samples=[];report={}
    for case in ['001','002']:
        folder=SOURCE/('official-training-'+case)
        if not (folder/'session.json').exists():continue
        session=read(folder/'session.json');assignments=read(folder/'assignments.json');players=read(folder/'roster-reviewed.json')
        clip=read(ROOT/f'artifacts/qwen-official-20261005/official-training-{case}/clip.json')
        prep=session['courtPreparation'];proposed={};unknown={};jobs=[]
        for path in sorted(folder.glob('ground-*-*.json')):
            job=read(path);c=job.get('candidate')
            if not c:jobs.append({'range':path.stem,'status':job['status'],'message':job.get('message')});continue
            reviewed={a['entityId'] for a in c['anchors']}
            jobs.append({'range':c['range'],'status':job['status'],'jobId':job['jobId'],'usage':job.get('usage'),
                         'anchorsByPlayer':{p['id']:sum(a['entityId']==p['id'] for a in c['anchors']) for p in players}})
            for pid in reviewed:
                for f in range(c['range']['startFrame'],c['range']['endFrameExclusive']):proposed[pid,f]=c['pointsByPlayer'][pid][f]
            for r in c.get('unknownRanges',[]):
                for f in range(r['startFrame'],r['endFrameExclusive']):unknown[r['entityId'],f]=r['reason']
        rows=[]
        for f,record in enumerate(clip['frames']):
            mapping=prep['maps'][f]
            row={'frame':f,'time':record['time'],'toImage':mapping.get('toImage') if mapping else None,'players':{},'cut':f in session['cuts']}
            for p in players:
                pid=p['id'];raw=prep['rawByPlayer'][pid][f];q=proposed.get((pid,f),{});tid=assignments[f].get(pid)
                bbox=next((t[:4] for t in record['tracks'] if t[4]==tid),None)
                row['players'][pid]={'bbox':bbox,'trackId':tid,'raw':xy(raw),'qwen':xy(q),'rawImage':raw.get('imagePoint'),
                                    'rawState':raw.get('source'),'qwenState':q.get('source'),'unknown':unknown.get((pid,f)),
                                    'reviewRequired':True}
            rows.append(row)
        counts={'total':len(rows)*len(players),**{k:sum(r['players'][p['id']][k] is not None for r in rows for p in players) for k in ['raw','qwen']}}
        summary={'id':'official-training-'+case,'title':'官方训练 '+case+' · 全部球员','player':'白队 5 人 / 深蓝队 5 人',
                 'videoHash':clip['video_sha256'],'side':'left' if case=='001' else 'right','note':'全片多人真实测试；身份与场地仍为 AI 测试参照。缺测、近景切镜及未产生球员锚点的模型结果保留缺口。',
                 'status':'partial' if any(j['status']!='ready' for j in jobs) or counts['qwen']<counts['raw'] else 'ready',
                 'startTime':rows[0]['time'],'endTime':clip['mediaEndTime'],'counts':counts}
        checkpoints=[{'frame':f,'label':f'{clip["frames"][f]["time"]:.1f}s'} for f in [120,600,900,1140]]
        if case=='002':checkpoints.extend([{'frame':1155,'label':'白1号可见性核查'},{'frame':1276,'label':'近景切镜'}])
        data={**summary,'schemaVersion':2,'width':clip['width'],'height':clip['height'],'players':players,'frames':rows,
              'checkpoints':checkpoints,'reviewRequired':True}
        save(DEST/(summary['id']+'.json'),data);samples.append(summary)
        report[case]={'frames':len(rows),'calibrationFrames':sum(r['toImage'] is not None for r in rows),'counts':counts,'jobs':jobs,
                     'players':[{**p,'annotatedFrames':sum(r['players'][p['id']]['bbox'] is not None for r in rows),
                                 'rawFrames':sum(r['players'][p['id']]['raw'] is not None for r in rows),
                                 'qwenFrames':sum(r['players'][p['id']]['qwen'] is not None for r in rows)} for p in players]}
    save(DEST/'index.json',{'samples':samples});save(SOURCE/'summary.json',report)
    return report
if __name__=='__main__':
    for case,r in export().items():print(json.dumps({'case':case,'counts':r['counts'],'jobs':len(r['jobs'])}))
