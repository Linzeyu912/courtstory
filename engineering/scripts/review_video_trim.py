"""Materialize manually retained live-camera frame ranges and matching proposals.

No automatic live-shot or player identity classification is performed here.
All output assets stay in the ignored local review cache.
"""
import copy
import hashlib
import json
from fractions import Fraction
from pathlib import Path


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


def trim_review_clip(source, ranges, output_dir):
    import av
    payload=source['payload'];records=payload['frames']
    ranges=retained_ranges(ranges,len(records))
    kept=[i for r in ranges for i in range(r['start'],r['end']+1)]
    output_dir=Path(output_dir);output_dir.mkdir(parents=True,exist_ok=False)
    video=output_dir/'video.mp4';track_path=output_dir/'tracks.json'
    new_records=[];cuts=[];last_source=None;wanted=set(kept)
    root_hash=payload.get('source_video_sha256') or payload['video_sha256']
    try:
        with av.open(str(source['video'])) as container,av.open(str(video),'w') as result:
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
            times=[float(frame.time) for frame in container.decode(video=0)]
        if len(times)!=len(kept):raise ValueError('裁切后帧数不匹配。')
        for record,time in zip(new_records,times):record['time']=time
        digest=hashlib.sha256(video.read_bytes()).hexdigest()
        track_path.write_text(json.dumps(new_records,separators=(',',':'))+'\n',encoding='utf-8')
        track_path.with_suffix('.meta.json').write_text(json.dumps({'video_sha256':digest,'frames':len(times),
            'identity_verified':False,'method':'subset_of_source_proposals','source_video_sha256':root_hash},indent=2)+'\n',encoding='utf-8')
        return {'video':str(video),'tracks':str(track_path),'videoSha256':digest,'sourceCuts':cuts,
                'sourceVideoSha256':root_hash,'retainedRanges':ranges,
                'supportsCourtCalibration':payload.get('supportsCourtCalibration',True)}
    except Exception:
        # Keep incomplete output for diagnosis, but never register it as a usable clip.
        raise
