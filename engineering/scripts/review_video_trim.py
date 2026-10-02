"""Materialize manually retained live-camera frame ranges and matching proposals.

No automatic live-shot or player identity classification is performed here.
All output assets stay in the ignored local review cache.
"""
import copy
import hashlib
import json
from bisect import bisect_right
import math
import re
from datetime import datetime, timezone
from fractions import Fraction
from pathlib import Path


def remap_camera_quality(quality, source_index, records, kept, cuts, remap, support_override=None):
    """Keep real-reference provenance separate from the surviving segment's cut guard."""
    if not isinstance(quality, dict):
        return quality
    result = copy.deepcopy(quality)
    reference = quality.get('referenceFrame')
    valid_reference = type(reference) is int and 0 <= reference < len(records)
    support = (support_override if type(support_override) is int and 0 <= support_override < len(records)
               else quality.get('cameraSupportFrame'))
    if 'referenceFrame' not in quality and support is None:
        return result
    if valid_reference:
        result['sourceReferenceFrame'] = (quality['sourceReferenceFrame']
            if type(quality.get('sourceReferenceFrame')) is int else records[reference].get('source_frame', reference))
    result['referenceFrame'] = remap.get(reference) if valid_reference else None
    # A separately reviewed support anchor supersedes the old propagation seed
    # for cut protection, while the real seed remains in reference provenance.
    anchor = support if type(support) is int and 0 <= support < len(records) else reference if valid_reference else None
    boundaries = [0, *cuts, len(kept)]
    segment = bisect_right(cuts, remap[source_index])
    lo, hi = boundaries[segment], boundaries[segment + 1] - 1
    if type(anchor) is int and 0 <= anchor < len(records):
        if anchor <= kept[lo]:
            result['cameraSupportFrame'] = lo
        elif anchor >= kept[hi]:
            result['cameraSupportFrame'] = hi
        else:
            result['cameraSupportFrame'] = remap[anchor]
    elif type(result.get('sourceReferenceFrame')) is int:
        # Older profiles can retain only root provenance. Preserve that reference
        # and choose the nearest surviving frame by its root source index.
        root_reference = result['sourceReferenceFrame']
        result['cameraSupportFrame'] = min(range(lo, hi + 1),
            key=lambda i: abs(records[kept[i]].get('source_frame', kept[i]) - root_reference))
    else:
        result['cameraSupportFrame'] = None
    return result


def retained_ranges(ranges, frame_count):
    if not isinstance(ranges, list) or not ranges or len(ranges) > 64:
        raise ValueError('请保留至少一个区间，最多64个。')
    validated=[]
    for item in ranges:
        if not isinstance(item, dict):raise ValueError('区间格式不正确。')
        start,end=item.get('start'),item.get('end')
        if type(start) is not int or type(end) is not int or not 0<=start<=end<frame_count:
            raise ValueError('起止帧超出视频范围。')
        validated.append({'start':start,'end':end})
    merged=[]
    for item in sorted(validated,key=lambda r:r['start']):
        if merged and item['start']<=merged[-1]['end']+1:
            merged[-1]['end']=max(merged[-1]['end'],item['end'])
        else:merged.append(item.copy())
    return merged


def remap_identity_suggestions(suggestions, kept, records, cuts):
    """Retain model proposals only on visible tracks, splitting every cut or gap."""
    if suggestions is None:return None
    result=copy.deepcopy(suggestions);result['verified']=False;result['entities']=[]
    cuts=set(cuts)
    visible=[{int(row[4]) for row in record['tracks']} for record in records]
    for entity in suggestions['entities']:
        mapped=[]
        for binding in entity['bindings']:
            segment=None;previous_parent=None
            for index,parent_frame in enumerate(kept):
                eligible=binding['start']<=parent_frame<=binding['end'] and binding['trackId'] in visible[index]
                if not eligible:
                    segment=None;previous_parent=None
                    continue
                if (segment is None or index!=segment['end']+1 or index in cuts
                        or parent_frame!=previous_parent+1):
                    segment={**copy.deepcopy(binding),'start':index,'end':index}
                    mapped.append(segment)
                else:segment['end']=index
                previous_parent=parent_frame
        if mapped:result['entities'].append({**copy.deepcopy(entity),'bindings':mapped})
    return result


def trim_tracking_metadata(payload, video, records, times, time_base, fps, kept, cuts, source_has_audio):
    """Keep model provenance while distinguishing this subset from its parent run."""
    parent_metadata=copy.deepcopy(payload.get('trackingMetadata') or {})
    metadata=copy.deepcopy(parent_metadata)
    # These describe the complete parent inference run and are preserved only under its explicit source metadata.
    for field in ['statistics','duplicate_events','timing_seconds','presentation_geometry_comparison']:
        metadata.pop(field,None)
    if metadata.get('presentation'):
        metadata['presentation'].update(source_records_unchanged=False,source_geometry_unchanged=True,
            subset_reindexed=True,presentation_metrics_scope='parent_only_not_recomputed_for_child')
        metadata['parent_tracking']={'variant':payload.get('tracking_revision','original'),
            'fingerprint':payload.get('tracking_fingerprint'),'relationship':'manually_retained_source_frames'}
    root_hash=payload.get('source_video_sha256') or payload['video_sha256']
    suggestions=remap_identity_suggestions(payload.get('identitySuggestions'),kept,records,cuts)
    mapping_status=('source_unavailable' if suggestions is None else
                    'remapped_visible_segments' if suggestions['entities'] else 'none_in_retained_visible_frames')
    audio_policy={'mode':'video_only_trim','source_has_audio':source_has_audio,'output_has_audio':False,
                  'note':'人工剪辑当前只编码视频，不包含音轨；原片及未裁切版本的音轨保持。'}
    metadata.update(video=str(video),frames=len(times),frame_count=len(times),
        width=payload.get('width',metadata.get('width')),height=payload.get('height',metadata.get('height')),
        fps=fps,frame_time_basis='decoded_container_pts',decoded_pts_seconds=times,
        video_start_seconds=times[0],source_video_start_seconds=times[0],
        source_video_last_frame_seconds=times[-1],source_time_base=[time_base.numerator,time_base.denominator],
        source_audio=[],audio_policy=audio_policy,identity_verified=False,method='subset_of_source_proposals',
        source_video_sha256=root_hash,tracking_revision=payload.get('tracking_revision','original'),
        source_tracking_revision=payload.get('tracking_revision','original'),
        source_tracking_fingerprint=payload.get('tracking_fingerprint'),
        origin_tracking_revision=parent_metadata.get('origin_tracking_revision',payload.get('tracking_revision','original')),
        origin_tracking_fingerprint=parent_metadata.get('origin_tracking_fingerprint',payload.get('tracking_fingerprint')),
        source_tracking_metadata=parent_metadata,source_cuts=cuts,
        source_timing={'frame_count':len(times),'first_seconds':times[0],'last_seconds':times[-1],
                       'time_base':[time_base.numerator,time_base.denominator]},
        retained_frame_mapping=[{'frame':index,'parent_frame':parent_frame,'source_frame':record['source_frame'],
                                 'source_time':record['source_time']} for index,(parent_frame,record) in enumerate(zip(kept,records))],
        identitySuggestions=suggestions,identity_suggestions_mapping={'status':mapping_status,
            'method':'visible_retained_source_frames','split_at_cuts':True,'only_visible_tracked_frames':True},
        created_at_utc=datetime.now(timezone.utc).isoformat())
    return metadata


def trim_review_clip(source, ranges, output_dir):
    import av
    payload=source['payload'];records=payload['frames']
    ranges=retained_ranges(ranges,len(records))
    payloads=source.get('payloads')
    if payloads is not None:
        if not isinstance(payloads,dict) or 'original' not in payloads:
            raise ValueError('剪辑需要保留原始检测版本。')
        selected=payload.get('variant',payload.get('tracking_revision','original'))
        if selected not in payloads:raise ValueError('所选检测版本不存在。')
        for variant,entry in payloads.items():
            if not isinstance(variant,str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,63}',variant):
                raise ValueError('检测版本编号无效。')
            if (not isinstance(entry,dict) or entry.get('video_sha256')!=payload['video_sha256']
                    or not isinstance(entry.get('frames'),list) or len(entry['frames'])!=len(records)):
                raise ValueError('检测版本必须对应同一段视频。')
            if entry.get('sourceCuts',[])!=payload.get('sourceCuts',[]):
                raise ValueError('检测版本的来源断点不一致。')
            for index,(original,alternative) in enumerate(zip(records,entry['frames'])):
                if (not isinstance(alternative,dict) or type(original.get('frame')) is not int
                        or type(alternative.get('frame')) is not int or original['frame']!=index
                        or alternative['frame']!=index or type(original.get('time')) not in (int,float)
                        or type(alternative.get('time')) not in (int,float)
                        or not math.isfinite(original['time']) or not math.isfinite(alternative['time'])
                        or abs(original['time']-alternative['time'])>.001):
                    raise ValueError('检测版本的来源帧不一致。')
    kept=[i for r in ranges for i in range(r['start'],r['end']+1)]
    output_dir=Path(output_dir);output_dir.mkdir(parents=True,exist_ok=False)
    video=output_dir/'video.mp4';track_path=output_dir/'tracks.json'
    new_records=[];cuts=[];last_source=None;wanted=set(kept)
    root_hash=payload.get('source_video_sha256') or payload['video_sha256']
    try:
        with av.open(str(source['video'])) as container,av.open(str(video),'w') as result:
            source_has_audio=bool(container.streams.audio)
            src=container.streams.video[0];rate=src.average_rate
            dst=result.add_stream('libx264',rate=rate,options={'crf':'18','preset':'fast'})
            dst.width=src.width;dst.height=src.height;dst.pix_fmt='yuv420p'
            time_base=src.time_base or Fraction(rate.denominator,rate.numerator)
            dst.time_base=time_base;dst.codec_context.time_base=time_base
            output_times={};offset=0.0;nominal=float(1/rate)
            for interval in ranges:
                start,end=interval['start'],interval['end'];begin=records[start]['time']
                for i in range(start,end+1):output_times[i]=offset+records[i]['time']-begin
                tail=records[end+1]['time']-records[end]['time'] if end+1<len(records) else nominal
                offset+=records[end]['time']-begin+(tail if tail>0 else nominal)
            for index,frame in enumerate(container.decode(video=0)):
                if index not in wanted:continue
                out_index=len(new_records)
                if last_source is not None and (index!=last_source+1 or index in payload.get('sourceCuts',[])):
                    cuts.append(out_index)
                record=copy.deepcopy(records[index])
                record.update(frame=out_index,source_frame=record.get('source_frame',index),
                              source_time=record.get('source_time',record['time']))
                new_records.append(record);last_source=index
                frame.pts=round(output_times[index]/float(time_base));frame.time_base=time_base
                for packet in dst.encode(frame):result.mux(packet)
            for packet in dst.encode():result.mux(packet)
        with av.open(str(video)) as container:
            out_stream=container.streams.video[0];out_time_base=out_stream.time_base;out_fps=float(out_stream.average_rate)
            out_width,out_height=out_stream.width,out_stream.height
            times=[float(frame.time) for frame in container.decode(video=0)]
        if len(times)!=len(kept):raise ValueError('裁切后帧数不匹配。')
        for record,time in zip(new_records,times):record['time']=time
        digest=hashlib.sha256(video.read_bytes()).hexdigest()
        metadata=trim_tracking_metadata(payload,video,new_records,times,out_time_base,out_fps,kept,cuts,source_has_audio)
        metadata.update(video_sha256=digest,width=out_width,height=out_height)
        track_path.write_text(json.dumps(new_records,separators=(',',':'))+'\n',encoding='utf-8')
        track_path.with_suffix('.meta.json').write_text(json.dumps(metadata,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf-8')
        label=next((item['label'] for item in payload.get('variants',[]) if item['id']==payload.get('tracking_revision')),None)
        label=label or metadata.get('model') or '跟踪候选'
        if not label.endswith(' · 人工剪辑候选'):label+=' · 人工剪辑候选'
        result={'video':str(video),'tracks':str(track_path),'videoSha256':digest,'sourceCuts':cuts,
                'sourceVideoSha256':root_hash,'retainedRanges':ranges,
                'originalTrackingLabel':label,'originalLabel':label,'audioPolicy':metadata['audio_policy'],
                'supportsCourtCalibration':payload.get('supportsCourtCalibration',True)}
        if payloads is not None:
            variants=[]
            configs={item['id']:item for item in payload.get('variants',[])}
            for variant,entry in payloads.items():
                path=output_dir/f'tracks-{variant}.json'
                subset=[]
                for index,(parent_frame,time) in enumerate(zip(kept,times)):
                    record=copy.deepcopy(entry['frames'][parent_frame])
                    record.update(frame=index,time=time,source_frame=record.get('source_frame',parent_frame),
                                  source_time=record.get('source_time',record['time']))
                    subset.append(record)
                variant_metadata=trim_tracking_metadata(entry,video,subset,times,out_time_base,out_fps,
                    kept,cuts,source_has_audio)
                variant_metadata.update(video_sha256=digest,width=out_width,height=out_height)
                path.write_text(json.dumps(subset,separators=(',',':'),allow_nan=False)+'\n',encoding='utf-8')
                path.with_suffix('.meta.json').write_text(json.dumps(variant_metadata,ensure_ascii=False,
                    indent=2,allow_nan=False)+'\n',encoding='utf-8')
                config=configs.get(variant,{'label':variant})
                variant_label=config['label']
                if not variant_label.endswith(' · 人工剪辑候选'):variant_label+=' · 人工剪辑候选'
                if variant=='original':
                    result.update(tracks=str(path),originalLabel=variant_label,originalTrackingLabel=variant_label)
                elif variant=='jersey':
                    result['alternativeTracks']=str(path)
                else:
                    variants.append({'id':variant,'tracks':str(path),'label':variant_label,
                                     'recommended':config.get('recommended',False)})
            result['trackingVariants']=variants
            result['defaultVariant']=selected
        remap={source_index:i for i,source_index in enumerate(kept)}
        if payload.get('courtCandidates'):
            profile=copy.deepcopy(payload['courtCandidates']);profile['videoHash']=digest
            profile['sourceVideoHash']=root_hash
            mapped_keys=[]
            for key in profile.get('keyframes',[]):
                old_frame=key['frame']
                if old_frame not in remap:continue
                mapped={**key,'frame':remap[old_frame],
                        'sourceFrame':key.get('sourceFrame',records[old_frame].get('source_frame',old_frame))}
                if 'quality' in key or 'cameraSupportFrame' in key:
                    mapped['quality']=remap_camera_quality(key.get('quality',{}),old_frame,records,kept,cuts,remap,key.get('cameraSupportFrame'))
                    if 'cameraSupportFrame' in key:mapped['cameraSupportFrame']=mapped['quality'].get('cameraSupportFrame')
                if 'time' in key:
                    mapped.update(time=times[remap[old_frame]],sourceTime=key.get('sourceTime',records[old_frame].get('source_time',key['time'])))
                mapped_keys.append(mapped)
            profile['keyframes']=mapped_keys
            profile['invalidFrames']=[remap[i] for i in profile.get('invalidFrames',[]) if i in remap]
            if 'unresolvedFrames' in profile:
                profile['unresolvedFrames']=[remap[i] for i in profile['unresolvedFrames'] if i in remap]
            initial=profile.get('initialization')
            if isinstance(initial,dict):
                initial_frame=initial.get('frame')
                if type(initial_frame) is int and 0 <= initial_frame < len(records):
                    record=records[initial_frame]
                    initial.setdefault('sourceFrame',record.get('source_frame',initial_frame))
                    initial.setdefault('sourceTime',record.get('source_time',record['time']))
                initial['frame']=remap.get(initial_frame) if type(initial_frame) is int else None
                if initial['frame'] is None:
                    # Keep the original inference as provenance, without presenting
                    # a deleted reference as an initialization of this new clip.
                    if initial.get('status')!='source_removed':
                        initial['previousStatus']=initial.get('status')
                        initial['previousReason']=initial.get('reason')
                    initial.update(status='source_removed',sourceRemoved=True,
                                   reason='初始化参考帧已从当前剪辑移除；保留原始来源记录。')
            if profile.get('referenceFrame') is not None:
                reference=profile['referenceFrame']
                profile['sourceReferenceFrame']=(profile['sourceReferenceFrame'] if type(profile.get('sourceReferenceFrame')) is int
                    else records[reference].get('source_frame',reference))
                profile['referenceFrame']=remap.get(reference)
            if isinstance(profile.get('summary'),dict):
                rows=profile['keyframes']
                attempted={k['frame'] for k in rows}|set(profile.get('unresolvedFrames',[]))
                profile['summary']={**profile['summary'],'startFrame':min(attempted,default=None),
                    'endFrame':max(attempted,default=None),'totalFrames':len(attempted),
                    'validFrames':sum(k.get('status')!='invalid' and bool(k.get('points')) for k in rows)}
            path=output_dir/'court-candidates.json';path.write_text(json.dumps(profile,ensure_ascii=False,allow_nan=False)+'\n',encoding='utf-8',newline='\n')
            result['courtCandidates']=str(path)
        # A pose proposal belongs to one detector byte fingerprint, not to the selected P identity.
        output_tracks={'original':Path(result['tracks']),
                       **{variant['id']:Path(variant['tracks']) for variant in result.get('trackingVariants',[])}}
        if result.get('alternativeTracks'):output_tracks['jersey']=Path(result['alternativeTracks'])
        seen_feet=set()
        for variant,entry in (payloads or {payload.get('variant',payload.get('tracking_revision','original')):payload}).items():
            if not entry.get('feetCandidates'):continue
            profile=copy.deepcopy(entry['feetCandidates']);profile['videoHash']=digest
            profile['sourceVideoHash']=root_hash;profile['sourceTrackingFingerprint']=profile['trackingFingerprint']
            if profile['trackingFingerprint'] in seen_feet:continue
            seen_feet.add(profile['trackingFingerprint'])
            if payloads is None:new_track_path=Path(result['tracks'])
            elif variant in output_tracks:new_track_path=output_tracks[variant]
            else:raise ValueError('脚点候选没有对应的裁切检测版本。')
            profile['trackingFingerprint']=hashlib.sha256(new_track_path.read_bytes()).hexdigest()
            profile['frames']=[{**profile['frames'][i],'frame':j,'time':times[j],
                'sourceFrame':profile['frames'][i].get('sourceFrame',records[i].get('source_frame',i)),
                'sourceTime':profile['frames'][i].get('sourceTime',records[i].get('source_time',records[i]['time']))} for j,i in enumerate(kept)]
            path=output_dir/'feet-candidates.json';path.write_text(json.dumps(profile,ensure_ascii=False,allow_nan=False)+'\n',encoding='utf-8',newline='\n')
            result['feetCandidates']=str(path)
        return result
    except Exception:
        # Keep incomplete output for diagnosis, but never register it as a usable clip.
        raise
