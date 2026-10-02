"""Build reviewable camera-motion proposals from a specified floor reference.

This does not confirm the reference points or establish metric ground truth.
Weights and model selection are handled by the independent probe scripts.
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
    parser.add_argument('--seed', required=True, help='JSON containing one named-landmark keyframe')
    parser.add_argument('--output', required=True)
    parser.add_argument('--fallback-frames', type=int, default=12, help='Maximum consecutive LK fallback frames (experimental)')
    args = parser.parse_args()
    library = json.loads(Path(args.library).read_text(encoding='utf-8'))
    sample = next(s for s in library['samples'] if s['id'] == args.sample)
    video = Path(sample['video']); seed = json.loads(Path(args.seed).read_text(encoding='utf-8'))
    variant = next((v for v in sample.get('trackingVariants', []) if v['id'] == 'ebard'), sample)
    tracks = Path(variant['tracks']); records = json.loads(tracks.read_text(encoding='utf-8'))
    with av.open(str(video)) as container:
        stream = container.streams.video[0]; width, height = stream.width, stream.height
    digest = hashlib.sha256(video.read_bytes()).hexdigest()
    if seed.get('videoHash') and seed['videoHash'] != digest:
        parser.error('Seed belongs to a different video')
    if 'keyframes' in seed:
        if len(seed['keyframes']) != 1:
            parser.error('Choose exactly one reference keyframe')
        seed = {**{k: v for k, v in seed.items() if k not in ('keyframes', 'invalidFrames')}, **seed['keyframes'][0]}
    payload = dict(width=width, height=height, frames=records, video_sha256=digest, sourceCuts=sample.get('sourceCuts', []))
    if not 0 <= args.fallback_frames <= 120:
        parser.error('Fallback frames must be between 0 and 120')
    result = propagate_court(video, payload, seed, max_fallback_frames=args.fallback_frames)
    result.update(referenceSource=seed.get('source', 'unspecified_reference'),
                  referenceDescription=seed.get('description'),
                  seedFile=Path(args.seed).as_posix(), maxFallbackFrames=args.fallback_frames,
                  trackingFingerprint=hashlib.sha256(tracks.read_bytes()).hexdigest(),
                  createdAt=datetime.now().astimezone().isoformat())
    output = Path(args.output); output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':'), allow_nan=False)+'\n', encoding='utf-8', newline='\n')
    print(json.dumps({'sample': args.sample, 'output': output.as_posix(), **result['summary']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
