"""Evaluate sparse, manually outlined identity references, without modifying tracks."""
import argparse,json
from pathlib import Path

def iou(a,b):
    inter=max(0,min(a[2],b[2])-max(a[0],b[0]))*max(0,min(a[3],b[3])-max(a[1],b[1]))
    return inter/max(1,(a[2]-a[0])*(a[3]-a[1])+(b[2]-b[0])*(b[3]-b[1])-inter)

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--cases',default='engineering/research/vision-player-refinement/identity-cases.json')
    p.add_argument('--directory',default='artifacts/vision-tracking-repair')
    p.add_argument('--output',default='engineering/research/vision-player-refinement/identity-comparison.json')
    args=p.parse_args();spec=json.loads(Path(args.cases).read_text());report={'scope':spec['scope'],'iou_threshold':.4,'runs':{}}
    for path in Path(args.directory).glob('*.tracks.json'):
        frames=json.loads(path.read_text());initial={};matches=[]
        for case in spec['cases']:
            boxes=frames[case['frame']]['tracks'];best=max(boxes,key=lambda b:iou(case['box'],b),default=None)
            overlap=iou(case['box'],best) if best else 0
            track=int(best[4]) if overlap>=.4 else None
            if case['frame']==0:initial[case['person']]=track
            matches.append({**case,'track_id':track,'iou':round(overlap,3),'same_initial_id':track is not None and track==initial[case['person']]})
        report['runs'][path.stem]={'matched_cases':sum(m['track_id'] is not None for m in matches),'same_initial_id_cases':sum(m['same_initial_id'] for m in matches),'total_cases':len(matches),'cases':matches}
    Path(args.output).write_text(json.dumps(report,indent=2)+'\n')
    for name,run in report['runs'].items():print(name,run['matched_cases'],run['same_initial_id_cases'],[(c['frame'],c['person'],c['track_id']) for c in run['cases']])

if __name__=='__main__':main()
