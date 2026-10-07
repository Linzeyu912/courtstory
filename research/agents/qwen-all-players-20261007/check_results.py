"""Check actual exported results against source timestamps and missing observations."""
import json, math
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'artifacts/qwen-all-players-20261007'
def read(p):return json.loads(p.read_text(encoding='utf-8'))
def check():
    results={}
    for case in ['001','002']:
        folder=OUT/('official-training-'+case)
        clip=read(ROOT/f'artifacts/qwen-official-20261005/official-training-{case}/clip.json')
        session=read(folder/'session.json');replay=read(OUT/f'replay/official-training-{case}.json')
        assert replay['videoHash']==clip['video_sha256']==session['videoHash']
        assert len(replay['frames'])==len(clip['frames'])
        assert len(replay['players'])==10
        assert sum(p['team']=='white' for p in replay['players'])==5
        assert len({p['id'] for p in replay['players']})==10
        changes=[];valid=0;bounds=[]
        for row,source in zip(replay['frames'],clip['frames']):
            assert (row['frame'],row['time'])==(source['frame'],source['time'])
            ids=[p['trackId'] for p in row['players'].values() if p['trackId'] is not None]
            assert len(ids)==len(set(ids)),f'{case}/{row["frame"]}: duplicate binding'
            for pid,p in row['players'].items():
                if p['qwen'] is None:continue
                assert p['raw'] is not None,f'{case}/{pid}/{row["frame"]}: invented point at source gap'
                assert row['toImage'] is not None
                assert all(math.isfinite(n) for n in p['qwen'])
                valid+=1
                changes.append(math.dist(p['qwen'],p['raw']))
            if (case=='001' and row['frame']<5) or (case=='002' and row['frame']>=1276):
                assert row['toImage'] is None
                assert all(p['raw'] is None and p['qwen'] is None for p in row['players'].values())
                bounds.append(row['frame'])
        results[case]={'sourceFrames':len(clip['frames']),'players':10,'qwenPoints':valid,
                       'excludedCloseupFrames':len(bounds),'changedPoints':sum(d>.001 for d in changes),
                       'maxChangeMetres':round(max(changes,default=0),3)}
        if case=='002':
            p=replay['frames'][1155]['players']['P1']
            results[case]['frame1155White1']={'detected':p['bbox'] is not None,'raw':p['raw'],'qwen':p['qwen'],'unknown':p['unknown']}
    (OUT/'checks.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
    return results
if __name__=='__main__':print(json.dumps(check(),ensure_ascii=True))
