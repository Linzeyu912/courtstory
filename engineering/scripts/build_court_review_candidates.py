"""Build reviewable court proposals from a floor seed or hoop-constrained model.

This does not confirm the reference points or establish metric ground truth.
Without --seed, initialise a named floor reference from local court keypoints
and registered E-BARD hoops, then propagate it inside the current shot.
"""
import argparse
import hashlib
import json
from datetime import datetime
from pathlib import Path

from court_propagation import propagate_court


def main():
    import av
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--library', default='data/videos/tactics/acceptance/review-library.json')
    parser.add_argument('--sample', required=True)
    parser.add_argument('--seed', help='Existing named-landmark reference; omit to initialise from hoop/court models')
    parser.add_argument('--frame', type=int, default=0, help='Zero-based reference frame for automatic initialisation')
    parser.add_argument('--court-model', default='tmp/court-models-v2/best.pt')
    parser.add_argument('--court-imgsz', type=int, choices=(640,960), default=640)
    parser.add_argument('--initial-only', action='store_true', help='Return the proposed reference without camera propagation')
    parser.add_argument('--output', required=True)
    parser.add_argument('--fallback-frames', type=int, default=12, help='Maximum consecutive LK fallback frames (experimental)')
    args = parser.parse_args()
    library = json.loads(Path(args.library).read_text(encoding='utf-8'))
    sample = next((s for s in library['samples'] if s['id'] == args.sample), None)
    if sample is None: parser.error('Unknown sample')
    output = Path(args.output)
    if output.exists(): parser.error('Output already exists; choose a new path to preserve prior results')
    video = Path(sample['video'])
    variant = next((v for v in sample.get('trackingVariants', []) if v['id'] == 'ebard'), sample)
    tracks = Path(variant['tracks']); records = json.loads(tracks.read_text(encoding='utf-8'))
    with av.open(str(video)) as container:
        stream = container.streams.video[0]; width, height = stream.width, stream.height
    digest = hashlib.sha256(video.read_bytes()).hexdigest()
    if not 0 <= args.fallback_frames <= 120:
        parser.error('Fallback frames must be between 0 and 120')
    if args.seed:
        if args.initial_only: parser.error('--initial-only is used without --seed')
        seed = json.loads(Path(args.seed).read_text(encoding='utf-8'))
        if seed.get('videoHash') and seed['videoHash'] != digest:
            parser.error('Seed belongs to a different video')
        if 'keyframes' in seed:
            if len(seed['keyframes']) != 1:
                parser.error('Choose exactly one reference keyframe')
            seed = {**{k: v for k, v in seed.items() if k not in ('keyframes', 'invalidFrames')}, **seed['keyframes'][0]}
        payload = dict(width=width, height=height, frames=records, video_sha256=digest, sourceCuts=sample.get('sourceCuts', []))
        result = propagate_court(video, payload, seed, max_fallback_frames=args.fallback_frames)
        result.update(referenceSource=seed.get('source', 'unspecified_reference'),
                      referenceDescription=seed.get('description'), seedFile=Path(args.seed).as_posix(),
                      trackingFingerprint=hashlib.sha256(tracks.read_bytes()).hexdigest())
    else:
        from court_calibration import CourtKeypointModel, calibrate_court
        from serve_player_review import load_clip
        clip = load_clip(parser,sample)
        # This also validates detection metadata and decoded frame times.
        chosen = 'ebard' if 'ebard' in clip['payloads'] else clip['defaultVariant']
        payload = json.loads(clip['payloads'][chosen])
        result = calibrate_court(video,payload,args.frame,CourtKeypointModel(args.court_model,args.court_imgsz),
                                 propagate=not args.initial_only,max_fallback_frames=args.fallback_frames)
    result.update(maxFallbackFrames=args.fallback_frames,
                  createdAt=datetime.now().astimezone().isoformat())
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open('x',encoding='utf-8',newline='\n') as stream:
        stream.write(json.dumps(result, ensure_ascii=False, separators=(',', ':'), allow_nan=False)+'\n')
    print(json.dumps({'sample': args.sample, 'output': output.as_posix(), **result['summary']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
