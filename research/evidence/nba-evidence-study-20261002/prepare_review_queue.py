"""Prepare blank human review tasks; never create human labels automatically."""
import argparse,hashlib,json
from pathlib import Path

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--repo',type=Path,required=True);ap.add_argument('--out',type=Path,default=Path('human-review-queue.json'));a=ap.parse_args()
    lib=json.loads((a.repo/'data/videos/tactics/acceptance/review-library.json').read_text(encoding='utf-8'));samples={s['id']:s for s in lib['samples']}
    definitions=[('ball_visible_and_localization','005',[0,4,71,117]),('ball_visible_and_localization','006',[242,330]),('identity_continuity','nba-lal-min-005',[53,159,212,266]),('ball_hand_contact_or_flight','004',[98,100,102,104,106,108]),('foot_visibility_and_contact','005',[94]),('foot_visibility_and_contact','006',[153,307]),('court_orientation_given_declared_reference','004',[0,70,139])]
    tasks=[]
    for i,(kind,sid,frames) in enumerate(definitions):
        s=samples[sid];vp=a.repo/s['video'];tasks.append({'id':f'review-{i+1:02}','sample':sid,'task':kind,'source_video':s['video'],'video_sha256':hashlib.sha256(vp.read_bytes()).hexdigest(),'frames_zero_based':frames,'rendered_raw_images':[f'visual/{sid}-f{f:04d}-raw.jpg' for f in frames if Path(f'visual/{sid}-f{f:04d}-raw.jpg').exists()],'source_sequence_image':'visual/004-flight-sequence.jpg' if sid=='004' and kind=='ball_hand_contact_or_flight' else None,'review_status':'unreviewed','reviewer_type':None,'reviewer_id':None,'reviewed_at':None,'annotation':None,'orientation_reference_id':None if kind.startswith('court_orientation') else 'not_applicable','adjudication':None})
    doc={'status':'pending_human_review_not_labels','rules':['Review raw frames or original sequence before seeing detector scores and provisional AI labels.','Draw an independent visible-ball box or mark occluded/out_of_view/uncertain; do not merely choose detector candidates.','For identity, mark same/different/uncertain between explicit frame observations; jersey number may remain unknown and is not a name.','Do not extrapolate sparse identity labels over unviewed intervals.','Foot visibility does not prove ground contact; allow uncertain.','Court left/right requires an explicit template/world coordinate convention; if missing, leave orientation unknown.','Source video PTS and frame index must be retained; do not replace PTS with frame/fps.','A real human supplies reviewer identity and annotation; these tasks are not completed by their generation.'],'tasks':tasks}
    a.out.write_text(json.dumps(doc,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps({'blank_review_tasks':len(tasks),'output':str(a.out)}))
if __name__=='__main__':main()
