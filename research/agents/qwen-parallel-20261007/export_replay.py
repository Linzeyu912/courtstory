"""Read-only observer export: raw, independent Qwen lanes, and denoised results."""
import argparse,json,math,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'engineering/scripts'))
from ground_trajectory_denoise import denoise_player
from ground_trajectory_parallel import with_binding_boundaries
def read(p):return json.loads(p.read_text(encoding='utf-8'))
def save(p,v):p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(v,ensure_ascii=False,allow_nan=False),encoding='utf-8')
def xy(p):
    v=[p.get('x'),p.get('y')]
    return v if all(type(n) in (int,float) and math.isfinite(n) for n in v) else None

def export(source,destination,profile='balanced',config=None):
    samples=[];reports={}
    for case in ['001','002']:
        folder=source/('official-training-'+case)
        if not (folder/'result.json').exists():continue
        merged=read(folder/'result.json');session=read(folder/'input-session.json');clip=read(folder/'input-clip.json')
        assignments=read(ROOT/f'artifacts/qwen-all-players-20261007/official-training-{case}/assignments.json')
        source_players=read(ROOT/f'artifacts/qwen-all-players-20261007/official-training-{case}/roster-reviewed.json')
        players=[];rows=[];diagnostics={};final_by_player={}
        for p in source_players:
            pid=p['id'];result=merged['players'].get(pid)
            if result is None:
                final_by_player[pid]=session['courtPreparation']['rawByPlayer'][pid]
                players.append({**p,'status':'missing_result'});continue
            entity=next(e for e in session['entities'] if e['id']==pid)
            refined=with_binding_boundaries(result['refined'],entity)
            filtered=denoise_player(refined,anchors=result['anchors'],cuts=sorted(set(session.get('cuts',[])+clip.get('sourceCuts',[]))),config={'profile':profile,**(config or {})})
            final_by_player[pid]=filtered['points'];diagnostics[pid]=filtered['diagnostics']
            players.append({**p,'status':result['status']})
        for f,record in enumerate(clip['frames']):
            mapping=session['courtPreparation']['maps'][f]
            row={'frame':f,'time':record['time'],'toImage':mapping.get('toImage') if mapping else None,
                'cut':f in session.get('cuts',[]),'players':{}}
            for p in players:
                pid=p['id'];result=merged['players'].get(pid);raw=session['courtPreparation']['rawByPlayer'][pid][f]
                refined=result['refined'][f] if result else raw;final=final_by_player[pid][f]
                tid=assignments[f].get(pid);bbox=next((t[:4] for t in record['tracks'] if t[4]==tid),None)
                job=next((j for j in (result or {}).get('jobs',[]) if j['start']<=f<j['end']),{})
                unknown=next((r['reason'] for r in (result or {}).get('unknownRanges',[]) if r['startFrame']<=f<r['endFrameExclusive']),None)
                row['players'][pid]={'bbox':bbox,'trackId':tid,'raw':xy(raw),'refined':xy(refined),'qwen':xy(final),
                    'rawState':raw.get('source'),'qwenState':refined.get('source'),'processedState':final.get('processedState','unprocessed'),
                    'denoiseDisplacement':final.get('displacement',0),'jobStatus':job.get('status','no_job'),
                    'unknown':unknown,'reviewRequired':True}
                row['players'][pid].update(breakBefore=final.get('breakBefore',False),qualityFlags=final.get('qualityFlags',[]))
            rows.append(row)
        counts={'total':len(rows)*10,**{k:sum(r['players'][p['id']][k] is not None for r in rows for p in players) for k in ['raw','refined','qwen']}}
        status='partial' if any(p['status']!='ready' for p in players) else 'ready'
        summary={'id':'official-training-'+case,'title':'官方训练 '+case+' · 单人独立映射','player':'10 个单人任务 / '+profile+' 去噪',
            'videoHash':clip['video_sha256'],'side':'left' if case=='001' else 'right','status':status,
            'startTime':rows[0]['time'],'endTime':clip['mediaEndTime'],'counts':counts,
            'note':'固定原球员/球场输入。每个 Qwen 任务只处理一个人；最终坐标含显式去噪。去噪前与原始点可切换对照；AI 参考尚未替代人工真值。'}
        checkpoints=[{'frame':f,'label':f'{clip["frames"][f]["time"]:.1f}s'} for f in [120,600,900,1140]]
        if case=='002':checkpoints.append({'frame':1155,'label':'白1号可见性'})
        payload={**summary,'schemaVersion':3,'width':clip['width'],'height':clip['height'],'players':players,
            'frames':rows,'checkpoints':checkpoints,'denoiseProfile':profile,'denoiseOverrides':config or {}}
        save(destination/(summary['id']+'.json'),payload);samples.append(summary)
        reports[case]={'counts':counts,'profile':profile,'players':players,'denoise':diagnostics,
            'sourceDigest':merged['sourceDigest'],'status':status}
    save(destination/'index.json',{'samples':samples});save(destination/'report.json',reports)
    return reports
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--source',type=Path,default=ROOT/'artifacts/qwen-parallel-20261007/single-player-v1')
    p.add_argument('--output',type=Path,default=ROOT/'artifacts/qwen-parallel-20261007/replay');p.add_argument('--profile',default='balanced')
    p.add_argument('--window-seconds',type=float);p.add_argument('--max-displacement',type=float)
    p.add_argument('--turn-cosine-threshold',type=float)
    a=p.parse_args();config={k:v for k,v in {'window_seconds':a.window_seconds,'max_displacement':a.max_displacement,
        'turn_cosine_threshold':a.turn_cosine_threshold}.items() if v is not None}
    print(json.dumps({k:v['counts'] for k,v in export(a.source,a.output,a.profile,config).items()}))
