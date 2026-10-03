"""Prepare immutable team-stable presentation variants from existing observations.

No model inference, association changes, filled occlusions or raw geometry edits.
"""
import argparse
import copy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path

from basketball_presentation import POLICY_PATH, load_policy, proposal_points, regroup_suggestions, stabilize_points

ROOT=Path(__file__).resolve().parents[2]

def sha256(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def implementation_hash():
    files=[Path(__file__),Path(__file__).with_name('basketball_presentation.py'),
        Path(__file__).with_name('basketball_render.py'),POLICY_PATH.with_name('team-overlay.mjs'),
        ROOT/'engineering/tools/player-review/identity-timeline.mjs',ROOT/'engineering/tools/player-review/app.mjs',
        ROOT/'engineering/tools/player-review/identity-ui.jsx',ROOT/'engineering/tools/player-review/workspace.mjs']
    digest=hashlib.sha256()
    for path in files:digest.update(str(path.relative_to(ROOT)).encode());digest.update(b'\0');digest.update(path.read_bytes())
    return digest.hexdigest()

def _statistics(values):
    ordered=sorted(values)
    if not ordered:return {'count':0,'median':None,'p95':None,'maximum':None,'mean':None}
    def percentile(fraction):
        index=(len(ordered)-1)*fraction;low=int(index);high=min(low+1,len(ordered)-1)
        return ordered[low]+(ordered[high]-ordered[low])*(index-low)
    return {'count':len(values),'median':percentile(.5),'p95':percentile(.95),'maximum':ordered[-1],'mean':sum(values)/len(values)}

def compare_geometry(raw,stable,cuts):
    deviation=[];raw_residual=[];stable_residual=[];changed=0
    for entity_id,points in raw.items():
        display=stable[entity_id]
        for point,shown in zip(points,display):
            if point.get('box') and shown.get('box'):
                deviation.extend(abs(a-b) for a,b in zip(point['box'],shown['box']))
                changed+=point['box']!=shown['box']
        for index in range(1,len(points)-1):
            neighborhood=points[index-1:index+2]
            if (any(point.get('source')!='tracked' or point.get('x') is None for point in neighborhood)
                or any(index-1<cut<=index+1 for cut in cuts)
                or len({(point.get('trackId'),point.get('identityStartFrame')) for point in neighborhood})!=1):continue
            left,current,right=neighborhood;span=right['time']-left['time']
            if span<=0:continue
            fraction=(current['time']-left['time'])/span
            raw_residual.append(abs(current['y']-(left['y']+(right['y']-left['y'])*fraction)))
            a,b,c=display[index-1:index+2]
            stable_residual.append(abs(b['y']-(a['y']+(c['y']-a['y'])*fraction)))
    return {'units':'image pixels','metric':'absolute deviation from time-linear neighboring observed foot-bottom positions',
        'interpretation':'presentation motion residual; includes real player/camera motion; not tracking or ground-position accuracy',
        'identity_switches_changed':False,'filled_missing_frames':0,'changed_observed_display_frames':changed,
        'box_coordinate_deviation':_statistics(deviation),'raw_foot_motion_residual':_statistics(raw_residual),
        'stable_foot_motion_residual':_statistics(stable_residual)}

def prepare_variant(parent,output,policy,variant='team-stable'):
    parent=Path(parent).resolve();output=Path(output).resolve();parent_meta=parent.with_suffix('.meta.json');output_meta=output.with_suffix('.meta.json')
    if output in (parent,parent_meta) or output_meta in (parent,parent_meta):raise ValueError('Source records/metadata cannot be overwritten.')
    if output.exists() or output_meta.exists():raise FileExistsError('Choose fresh immutable team-stable outputs; existing files are preserved.')
    original=parent.read_bytes();meta_bytes=parent_meta.read_bytes();records=json.loads(original);meta=json.loads(meta_bytes)
    if not isinstance(records,list) or len(records)!=meta['frames']:raise ValueError('Parent observation count and metadata do not match.')
    if any(record['frame']!=index for index,record in enumerate(records)):raise ValueError('Parent observations need sequential source frames.')
    suggestions=regroup_suggestions(meta.get('identitySuggestions',{'entities':[]}),records,policy)
    cuts=meta.get('source_cuts',[]);raw=proposal_points(suggestions,records,cuts)
    stable={key:stabilize_points(points,cuts,meta['width'],meta['height'],policy) for key,points in raw.items()}
    metrics=compare_geometry(raw,stable,cuts)
    prepared=copy.deepcopy(meta);prepared.update(variant=variant,identitySuggestions=suggestions,identity_verified=False,
        parent_tracking={'variant':meta.get('variant','optimized'),'tracks_sha256':hashlib.sha256(original).hexdigest(),
            'metadata_sha256':hashlib.sha256(meta_bytes).hexdigest(),'source_path':str(parent.relative_to(ROOT)) if parent.is_relative_to(ROOT) else parent.name},
        presentation={'version':1,'policy':copy.deepcopy(policy),'policy_sha256':sha256(POLICY_PATH),
            'implementation_sha256':implementation_hash(),'default_stable':True,'source_records_unchanged':True,
            'geometry_method':policy['filter']['method'],'foot_method':policy['foot']['method'],
            'ground_contact_verified':False,'identity_association_unchanged':True,'grouping_verified':False,
            'manual_geometry_is_exact':True,'reset_at':'missing observations, cuts, track/binding/source changes and manual anchors'},
        presentation_geometry_comparison=metrics,presentation_prepared_at_utc=datetime.now(timezone.utc).isoformat())
    output.parent.mkdir(parents=True,exist_ok=True)
    with output.open('xb') as stream:stream.write(original)
    with output_meta.open('x',encoding='utf-8') as stream:stream.write(json.dumps(prepared,ensure_ascii=False,indent=2,allow_nan=False)+'\n')
    if parent.read_bytes()!=original or parent_meta.read_bytes()!=meta_bytes:raise RuntimeError('Parent changed during preparation.')
    return {'tracks':str(output),'metadata':str(output_meta),'frames':len(records),'groups':{
        group:sum(entity.get('teamGroup')==group for entity in suggestions['entities']) for group in ('A','B')},
        'pending_team_candidates':len(suggestions['unassignedTeamCandidates']),'geometry_comparison':metrics,
        'parent_tracks_sha256':hashlib.sha256(original).hexdigest(),'new_tracks_sha256':sha256(output),'new_metadata_sha256':sha256(output_meta)}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--library',type=Path,default=ROOT/'data/videos/tactics/acceptance/review-library.json')
    parser.add_argument('--output-dir',type=Path,default=ROOT/'artifacts/player-team-overlay-20261002')
    parser.add_argument('--sample',action='append',help='Optional library sample IDs; default all existing optimized variants')
    args=parser.parse_args();library=json.loads(args.library.read_text(encoding='utf-8'));jobs=[]
    comparison=args.output_dir/'geometry-comparison.json'
    if comparison.exists():parser.error('Geometry comparison already exists; choose a fresh output directory.')
    for sample in library['samples']:
        if args.sample and sample['id'] not in args.sample:continue
        parent=next((variant['tracks'] for variant in sample.get('trackingVariants',[]) if variant['id']=='optimized'),None)
        if not parent:continue
        path=ROOT/parent;output=args.output_dir/f"{sample['id']}-team-stable.json"
        if output.exists() or output.with_suffix('.meta.json').exists():parser.error('Immutable variant output already exists.')
        jobs.append((sample['id'],path,output))
    if not jobs:parser.error('No existing optimized variant matches the requested samples.')
    result={'created_at_utc':datetime.now(timezone.utc).isoformat(),'policy_sha256':sha256(POLICY_PATH),'samples':{}}
    for sample_id,parent,output in jobs:result['samples'][sample_id]=prepare_variant(parent,output,load_policy())
    with comparison.open('x',encoding='utf-8') as stream:stream.write(json.dumps(result,ensure_ascii=False,indent=2,allow_nan=False)+'\n')
    print(json.dumps({'prepared':len(jobs),'comparison':str(comparison),'samples':{key:entry['groups'] for key,entry in result['samples'].items()}}))

if __name__=='__main__':main()
