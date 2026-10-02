"""Adapt an existing basketball probe to the review server without changing media.

Only raw detections become visible proposals. Kalman tracker_results are never
added as a second box or used to invent an occluded person's position.
"""
import argparse
import json
from pathlib import Path

from serve_player_review import finite_number, read_json, validate_frame_records, video_source_info


def adapt_probe_records(probe, decoded_times):
    frames=probe.get('frames') if isinstance(probe,dict) else None
    if not isinstance(frames,list) or not frames or len(frames)!=len(decoded_times):
        raise ValueError('Probe frames must match every decoded source frame')
    records=[]
    for index,frame in enumerate(frames):
        if not isinstance(frame,dict) or type(frame.get('frame_index')) is not int or frame['frame_index']!=index:
            raise ValueError(f'Probe frame {index}: frame index must be sequential and start at zero')
        timestamp=frame.get('global_source_video_timestamp_seconds')
        if not finite_number(timestamp) or abs(timestamp-decoded_times[index])>.001:
            raise ValueError(f'Probe frame {index}: source timestamp must match decoded container PTS')
        detections=frame.get('detections')
        if not isinstance(detections,list):
            raise ValueError(f'Probe frame {index}: raw detections array is required')
        tracks,pending=[],[]
        for detection in detections:
            if not isinstance(detection,dict) or not isinstance(detection.get('xyxy'),list) or len(detection['xyxy'])!=4:
                raise ValueError(f'Probe frame {index}: detection needs four xyxy columns')
            box=detection['xyxy'][:]
            confidence,class_id=detection.get('confidence'),detection.get('class_id')
            if detection.get('track_id') is None:
                pending.append(box+[confidence,class_id])
            else:
                tracks.append(box+[detection['track_id'],confidence,class_id])
        records.append({'frame':index,'time':decoded_times[index],'tracks':tracks,
                        'pending_detections':pending,'candidate_count':len(detections)})
    validate_frame_records(records,decoded_times,'Adapted probe')
    return records


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--video',required=True)
    parser.add_argument('--probe',required=True,help='Object-wrapped probe frames.json with source container timestamps')
    parser.add_argument('--report',help='Optional matching probe report.json for model provenance')
    parser.add_argument('--output',required=True,help='Fresh canonical tracking array path; no existing output is overwritten')
    args=parser.parse_args()
    output=Path(args.output);metadata_path=output.with_suffix('.meta.json')
    if output.exists() or metadata_path.exists():
        parser.error('Choose fresh output and metadata paths; existing candidates are preserved')
    try:
        width,height,times,digest=video_source_info(Path(args.video))
        records=adapt_probe_records(read_json(Path(args.probe),'Probe'),times)
        report=read_json(Path(args.report),'Probe report') if args.report else {}
        if not isinstance(report,dict):
            raise ValueError('Probe report must be an object')
        if report.get('video_sha256') and report['video_sha256']!=digest:
            raise ValueError('Probe report video SHA does not match the source video')
        metadata={'video_sha256':digest,'frames':len(times),'width':width,'height':height,
                  'identity_verified':False,'adapter':'raw_probe_detections_v1',
                  'frame_time_basis':'decoded_container_pts','source_video_start_seconds':times[0],
                  'source_video_last_frame_seconds':times[-1],
                  'candidate_source':'raw detections only; tracker_results excluded to avoid duplicate/predicted positions'}
        for field in ['weights_sha256','model_names','player_class_id','config','device','tracker']:
            if field in report:
                metadata[field]=report[field]
        if report.get('weights'):
            metadata['model']=Path(report['weights']).name
        output.parent.mkdir(parents=True,exist_ok=True)
        with output.open('x',encoding='utf-8') as stream:
            stream.write(json.dumps(records,separators=(',',':'),allow_nan=False)+'\n')
        with metadata_path.open('x',encoding='utf-8') as stream:
            stream.write(json.dumps(metadata,ensure_ascii=False,indent=2,allow_nan=False)+'\n')
        print(json.dumps({'tracks':str(output),'metadata':str(metadata_path),'frames':len(times),
                          'video_sha256':digest},ensure_ascii=False))
    except (ValueError,OSError,KeyError,TypeError) as error:
        parser.error(str(error))


if __name__=='__main__':
    main()
