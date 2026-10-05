"""Read-only audit of existing player-recovery results. No repository imports/API calls.

Writes only to --output (default: this script's directory). Source files are allowlisted.
"""
from __future__ import annotations
import argparse
from collections import Counter, defaultdict
import csv
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--repo', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parent)
    args = parser.parse_args()
    repo, output = args.repo.resolve(), args.output.resolve()
    if output == repo or repo in output.parents:
        raise ValueError('Output must be outside source repository')
    output.mkdir(parents=True, exist_ok=True)
    manifest = []

    def read(relative):
        path = repo / relative
        before = path.stat()
        content = path.read_bytes()
        after = path.stat()
        if before.st_mtime_ns != after.st_mtime_ns or before.st_size != after.st_size:
            raise RuntimeError(f'Input changed while reading: {relative}')
        manifest.append({'path': str(relative).replace('\\', '/'), 'bytes': len(content),
                         'sha256': hashlib.sha256(content).hexdigest(),
                         'mtime_ns': after.st_mtime_ns})
        return json.loads(content.decode('utf-8-sig'))

    def points(doc):
        return {(f['frame'], t['track_id']): t for f in doc['frames'] for t in f.get('tracks', [])}

    def count(points_map):
        return dict(Counter(t.get('source', '<missing>') for t in points_map.values()))

    def quantile(values, q):
        values = sorted(values)
        if not values:
            return None
        return values[round((len(values)-1)*q)]

    shared = read('engineering/experiments/player_recovery/batch-results.json')
    annotations = read('engineering/experiments/player_recovery/annotations.json')
    result = {'audit_time_utc': datetime.now(timezone.utc).isoformat(),
              'scope': 'Existing JSON audit only; no inference or human truth validation',
              'cases': [], 'totals': {}, 'examples': {}, 'annotation_audit': {}}
    totals = Counter()
    all_sources = Counter()
    source_observed = Counter()
    fields_by_source = defaultdict(Counter)
    event_statuses = Counter()
    added_rows = []
    removed_rows = []
    revision_differences = []
    all_known_lookahead = []
    all_center_shifts = []
    qwen_detail = []
    mismatches = []
    raw_unmatched_examples = []
    adapter_examples = {}

    for case in shared['cases']:
        cid = case['id']
        tmp = f'tmp/player-recovery/batch-v3/{cid}'
        art = f'artifacts/player-recovery/batch-v3/{cid}'
        baseline = read(f'{tmp}/baseline.json')
        short = read(f'{tmp}/short.json')
        cdoc = read(f'{tmp}/players-short.json')
        ddoc = read(f'{art}/recovered.json')
        events = read(f'{art}/qwen-events.json')
        working_events = read(f'{tmp}/qwen-events.json')
        roles = read(f'{art}/roles.json')
        exclusions = read(f'{art}/excluded-role-points.json')
        bm = {f['frame']: f.get('detections', []) for f in baseline['frames']}
        sm, cm, dm = points(short), points(cdoc), points(ddoc)
        add, removed = set(dm)-set(cm), set(cm)-set(dm)
        event_map = {(e['frame'], e['track_id']): e for e in events}
        roles_map = {(e['frame'], e['track_id']): e for e in roles['reviews']}
        working_event_map = {(e['frame'], e['track_id']): e for e in working_events}
        for key, event in event_map.items():
            earlier = working_event_map.get(key, {})
            if earlier.get('status') != event.get('status') or earlier.get('reason') != event.get('reason'):
                revision_differences.append({'id':cid, 'frame':key[0], 'track_id':key[1],
                    'working_status':earlier.get('status'), 'final_status':event.get('status'),
                    'working_reason':earlier.get('reason'), 'final_reason':event.get('reason')})
        for key in removed:
            point = cm[key]
            removed_rows.append({'case':cid,'frame':key[0],'track_id':key[1],
                'source':point.get('source'),'observed':point.get('observed'),
                'anchors':point.get('anchors'),'role_reference_frame':point.get('role_reference_frame'),
                'person_role':point.get('person_role'),
                'source_file':f'{tmp}/players-short.json',
                'matching_C_gaps':[g for g in cdoc.get('gaps',[]) if g['track_id']==key[1] and g['start_frame']<=key[0]<=g['end_frame']]})
        fps = ddoc['fps']
        frame_times = {f['frame']:f.get('time') for f in ddoc['frames']}
        if [f['frame'] for f in ddoc['frames']] != list(range(len(ddoc['frames']))):
            raise ValueError(f'Unexpected sparse or offset frame list: {cid}')
        if any(not isinstance(t,(int,float)) or not math.isfinite(t) for t in frame_times.values()):
            raise ValueError(f'Missing source frame times: {cid}')
        case_stats = {'id': cid, 'video': case['video'], 'fps': fps,
                      'baseline_detections': sum(map(len, bm.values())),
                      'short_counts': count(sm), 'player_counts': count(cm), 'final_counts': count(dm),
                      'added_counts': count({k:dm[k] for k in add}), 'added_points': len(add),
                      'removed_from_C': len(removed), 'excluded_points': len(exclusions),
                      'excluded_roles': dict(Counter(x['role'] for x in exclusions)),
                      'events': len(events), 'event_statuses': dict(Counter(e['status'] for e in events)),
                      'frame_count': len(ddoc['frames'])}
        if count(dm) != case['final_counts'] or count(cm) != case['player_counts']:
            mismatches.append({'id': cid, 'kind': 'published_counts_mismatch'})
        for label, doc, mapped in [('short',short,sm),('C',cdoc,cm),('D',ddoc,dm)]:
            nrows = sum(len(f.get('tracks',[])) for f in doc['frames'])
            if nrows != len(mapped):
                mismatches.append({'id':cid,'kind':'duplicate_frame_track_id','stage':label,'count':nrows-len(mapped)})
        if len(sm)-len(cm) != len(exclusions):
            mismatches.append({'id':cid,'kind':'exclusion_count_mismatch'})

        # A known source-frame dependency floor, not an actual availability timestamp.
        memo = {}
        def dep_floor(key, active=None):
            if key in memo:
                return memo[key]
            active = set() if active is None else active
            if key in active or key not in dm:
                return key[0]
            active = active | {key}
            frame, tid = key
            point = dm[key]
            dep = [frame]
            if isinstance(point.get('role_reference_frame'), int):
                dep.append(point['role_reference_frame'])
            for anchor in point.get('anchors', []):
                if isinstance(anchor, int):
                    dep.append(dep_floor((anchor, tid), active))
            if point.get('source') == 'qwen' and key in event_map:
                gap = event_map[key].get('gap', {})
                for name in ('left_anchor', 'right_anchor'):
                    if isinstance(gap.get(name, {}).get('frame'), int):
                        af = gap[name]['frame']
                        dep.append(dep_floor((af, tid), active))
            memo[key] = max(dep)
            return memo[key]

        future_role = 0
        detector_changed = 0
        detector_unmatched = 0
        per_source_lookahead = defaultdict(list)
        for key, point in dm.items():
            frame, tid = key
            src = point.get('source', '<missing>')
            all_sources[src] += 1
            source_observed[f'{src}|observed={point.get("observed", "<missing>")}'] += 1
            fields_by_source[src].update(point.keys())
            delta = frame_times[dep_floor(key)]-frame_times[frame]
            all_known_lookahead.append(delta)
            per_source_lookahead[src].append(delta)
            if point.get('role_reference_frame', frame) > frame:
                future_role += 1
                rf = point['role_reference_frame']
                rd = frame_times[rf]-frame_times[frame]
                if rd > result['examples'].get('largest_future_role_reference',{}).get('direct_reference_lookahead_seconds',-1):
                    result['examples']['largest_future_role_reference']={
                        'id':cid,'frame':frame,'track_id':tid,'event_time_seconds':frame_times[frame],
                        'role_reference_frame':rf,'role_reference_time_seconds':frame_times[rf],
                        'direct_reference_lookahead_seconds':rd,
                        'person_role':point.get('person_role'),'available_at':None,
                        'evidence_available_at':None,
                        'reason_availability_unknown':'Whole-track sample selection, role page batching and request completion times are not timestamped'}
            if src == 'detector':
                raw = point.get('raw_bbox', point['bbox'])
                shift = max(abs(a-b) for a,b in zip(raw, point['bbox']))
                if shift > 1e-8:
                    detector_changed += 1
                if 'raw_center' in point and 'center' in point:
                    center_shift = math.dist(point['raw_center'], point['center'])
                    all_center_shifts.append(center_shift)
                    if center_shift > result['examples'].get('largest_detector_center_shift',{}).get('shift_pixels',-1):
                        result['examples']['largest_detector_center_shift'] = {
                            'id':cid,'frame':frame,'track_id':tid,'shift_pixels':center_shift,
                            'source':src,'observed':point.get('observed'), 'smoothed':point.get('smoothed'),
                            'bbox':point['bbox'],'raw_bbox':point.get('raw_bbox'),
                            'center':point['center'],'raw_center':point.get('raw_center')}
                matches = [d for d in bm.get(frame,[]) if max(abs(a-b) for a,b in zip(d['bbox'],raw)) < 1e-7]
                if len(matches) != 1:
                    detector_unmatched += 1
                    if len(raw_unmatched_examples)<8:
                        raw_unmatched_examples.append({'id':cid,'frame':frame,'track_id':tid,'matching_raw_detections':len(matches),'raw_bbox':raw})
                elif cid=='s25-03' and frame==435 and tid==5:
                    di=next(i for i,d in enumerate(bm[frame]) if d is matches[0])
                    adapter_examples['detector_geometry_and_display']={
                        'kind':'detector_observation','track_association_id':tid,
                        'verified_player_identity':None,'event_time_seconds':frame_times[frame],
                        'available_at':None,'geometry':{'coordinate_system':'image_pixels','bbox':raw},
                        'source_ref':{'file':f'{tmp}/baseline.json','pointer':f'/frames/{frame}/detections/{di}'},
                        'display_geometry':{'bbox':point['bbox'],'transform':'offline_bidirectional_smoothing_then_optional_image_clipping',
                                            'available_at':None,'dependency_window':'Requires short.json first-pass continuous run; final filtered run is insufficient'},
                        'original_tags':{'source':point['source'],'observed':point.get('observed'),'smoothed':point.get('smoothed')},
                        'geometry_status':'model_candidate_not_ground_truth'}
            if src == 'qwen':
                event = event_map.get(key,{})
                response = event.get('response',{})
                qwen_detail.append({'id':cid,'frame':frame,'track_id':tid,'source':src,
                                   'observed':point.get('observed'),'confidence':point.get('confidence'),
                                   'bbox':point['bbox'],'raw_bbox':point.get('raw_bbox'),
                                   'point_keys':sorted(k for k in point if k!='appearance'),
                                   'event_status':event.get('status'),
                                   'gap_left':event.get('gap',{}).get('left_anchor'),
                                   'gap_right':event.get('gap',{}).get('right_anchor'),
                                   'role_reference_frame':point.get('role_reference_frame'),
                                   'cached':response.get('cached'), 'elapsed_seconds':event.get('elapsed_seconds'),
                                   'source_frame_floor':dep_floor(key),'lookahead_floor_seconds':delta,
                                   'position_human_validated':False})
                if not adapter_examples.get('qwen_inference'):
                    ei=next(i for i,e in enumerate(events) if e is event)
                    adapter_examples['qwen_inference']={
                        'kind':'model_inferred_location','track_association_id':tid,'verified_player_identity':None,
                        'event_time_seconds':frame_times[frame],'available_at':None,'evidence_available_at':None,
                        'geometry':{'coordinate_system':'image_pixels','bbox':point['raw_bbox']},
                        'display_geometry':{'bbox':point['bbox'],'smoothed':point.get('smoothed')},
                        'confidence':{'value':point['confidence'],'kind':'model_self_reported_uncalibrated'},
                        'original_tags':{'source':point['source'],'observed':point.get('observed'),'qwen_anchor':point.get('qwen_anchor')},
                        'decision':{'status':event.get('status'),'meaning':'passed_experiment_gates_not_human_validation'},
                        'source_ref':{'file':f'{art}/qwen-events.json','pointer':f'/{ei}'},
                        'known_source_frame_floor':dep_floor(key),'known_source_time_floor_seconds':frame_times[dep_floor(key)],
                        'selection_horizon':'full_clip','dependency_completeness':'partial',
                        'reason_availability_unknown':'Full-clip selection, role batches, original request completion and output publication times are unavailable'}
            if key in add:
                added_rows.append({'case':cid,'frame':frame,'track_id':tid,'event_time_seconds':point.get('time'),
                                   'source':src,'observed':point.get('observed'),'confidence':point.get('confidence'),
                                   'anchors':json.dumps(point.get('anchors')),
                                   'role_reference_frame':point.get('role_reference_frame'),
                                   'role_reference_time_seconds':frame_times.get(point.get('role_reference_frame')),
                                   'source_frame_floor':dep_floor(key),'lookahead_floor_seconds':delta,
                                   'available_at':None,'actual_latency_seconds':None,
                                   'source_file':f'{art}/recovered.json',
                                   'pointer':f'/frames/{frame}/tracks/'+str(next(i for i,p in enumerate(ddoc['frames'][frame]['tracks']) if p['track_id']==tid))})
        case_stats.update({'future_role_reference_points':future_role,
                           'detector_bbox_differs_from_raw':detector_changed,
                           'detector_raw_not_uniquely_matched':detector_unmatched,
                           'known_dependency_lookahead_by_source':{k:{'count':len(v),'positive':sum(x>0 for x in v),'max_seconds':max(v),'median_seconds':quantile(v,.5)} for k,v in per_source_lookahead.items()}})
        result['cases'].append(case_stats)
        totals.update({'source_videos':1,'frames':len(ddoc['frames']), 'baseline_detections':sum(map(len,bm.values())),
                       'short_points':len(sm),'C_points':len(cm),'D_points':len(dm),
                       'added_points':len(add),'removed_from_C':len(removed),'excluded_points':len(exclusions),
                       'events':len(events),'future_role_reference_points':future_role,
                       'detector_bbox_differs_from_raw':detector_changed,
                       'detector_raw_not_uniquely_matched':detector_unmatched})
        event_statuses.update(e['status'] for e in events)
        if cid in ('s24-049','s25-03'):
            target = 199 if cid=='s24-049' else 421
            matching=[e for e in events if e['frame']==target]
            result['examples'][cid+'_known_rejection']=[{
                'frame':e['frame'],'track_id':e['track_id'],'status':e.get('status'),'reason':e.get('reason'),
                'reference_color_differences':e.get('reference_color_differences'),
                'response_claim':{k:e.get('response',{}).get(k) for k in ('reference_role','current_role','after_reference_role','endpoints_consistent','reason')},
                'present_in_final':(e['frame'],e['track_id']) in dm,
                'has_qwen_final_point':dm.get((e['frame'],e['track_id']),{}).get('source')=='qwen'} for e in matching]

    result['totals'] = dict(totals)
    result['totals']['final_source_counts'] = dict(all_sources)
    result['totals']['net_added_points'] = totals['added_points'] - totals['removed_from_C']
    result['totals']['added_source_counts'] = dict(Counter(x['source'] for x in added_rows))
    result['totals']['removed_source_counts'] = dict(Counter(x['source'] for x in removed_rows))
    result['totals']['source_observed_combinations'] = dict(source_observed)
    result['totals']['event_status_counts'] = dict(event_statuses)
    result['totals']['known_dependency_lookahead_positive'] = sum(x>0 for x in all_known_lookahead)
    result['totals']['known_dependency_lookahead_median_seconds'] = quantile(all_known_lookahead,.5)
    result['totals']['known_dependency_lookahead_max_seconds'] = max(all_known_lookahead)
    result['totals']['detector_center_shift_median_pixels'] = quantile(all_center_shifts,.5)
    result['totals']['detector_center_shift_p95_pixels'] = quantile(all_center_shifts,.95)
    result['field_presence_by_source']={k:dict(v) for k,v in fields_by_source.items()}
    result['qwen_anchors']=qwen_detail
    result['removed_points']=removed_rows
    result['working_to_final_event_revisions']=revision_differences
    result['mismatches']=mismatches
    result['raw_unmatched_examples']=raw_unmatched_examples
    avideos={x['video'] for x in annotations['annotations']}
    bvideos={x['video'] for x in shared['cases']}
    result['annotation_audit']={'schema_review_method':annotations['review_method'],
                              'frames':len(annotations['annotations']),
                              'boxes':sum(len(x['players']) for x in annotations['annotations']),
                              'distinct_videos':len(avideos),'batch_overlap_videos':sorted(avideos & bvideos),
                              'rows':[{'video':x['video'],'frame':x['frame'],'boxes':len(x['players']),
                                       'label_fields':sorted(set().union(*(set(p) for p in x['players'])))} for x in annotations['annotations']]}
    adapter_examples['propagated_role']=dict(result['examples']['largest_future_role_reference'],
        kind='model_inferred_role_propagation',selection_horizon='full_track',dependency_completeness='partial',
        note='A later role-reference image creates a known source-time lookahead; no exact processing availability can be recovered')
    result['limitations']=[
        'Known dependency floor omits complete bidirectional smoothing dependency and request execution; it is only a lower bound in source video time.',
        'Event elapsed_seconds can describe a cache hit and does not provide original request latency or availability time.',
        'observed=True includes Qwen anchors; source and transformation flags must be considered together.',
        'Raw bbox exact matching locates source detections but does not establish true person identity or correct geometry.',
        'The 56 visual reference boxes are not human-validated and share zero videos with batch-v3.',
        'No new video visual review, detector run, paid model call, or accuracy experiment is performed by this script.'
    ]
    # Detect concurrent changes to any read file before publishing derived evidence.
    changed=[m['path'] for m in manifest if (repo/m['path']).stat().st_mtime_ns != m['mtime_ns']]
    result['input_files_changed_during_audit']=changed
    if changed:
        raise RuntimeError('Inputs changed during audit: '+', '.join(changed))
    (output/'audit.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    (output/'input-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    (output/'removed-points.json').write_text(json.dumps(removed_rows,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    (output/'adapter-examples.json').write_text(json.dumps(adapter_examples,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    with (output/'added-points.csv').open('w',encoding='utf-8-sig',newline='') as f:
        writer=csv.DictWriter(f,fieldnames=list(added_rows[0])); writer.writeheader(); writer.writerows(sorted(added_rows,key=lambda x:(x['case'],x['frame'],x['track_id'])))
    print(json.dumps({'totals':result['totals'],'annotation_audit':result['annotation_audit'],
                      'qwen_anchors':qwen_detail,'examples':result['examples'],
                      'mismatches':mismatches,'input_files_read':len(manifest)},ensure_ascii=False,indent=2))


if __name__=='__main__':
    main()
