"""Generate a complete local workbench sample with an explicitly selected preset."""
import argparse
import json
from pathlib import Path
import shutil
import subprocess
import sys
import uuid

from local_video_library import PRESETS, atomic_json, file_hash, ROOT
from workbench_models import processing_recipe


def inference_plan(variant, models):
    from prepare_tracking_variants import MODELS
    recipe = processing_recipe(variant)
    return {**recipe, 'weights': Path(models) / MODELS[recipe['detector']][0],
            'imgsz': 640 if recipe['detector'] == 'yolo' else 704,
            'rawVariant': recipe.get('rawVariant', variant)}


def prepare_video(source, destination):
    """Keep compatible MP4 bytes; transcode other inputs into a browser-readable copy."""
    import av
    if destination.exists():
        return
    with av.open(str(source)) as container:
        video = container.streams.video[0]
        compatible = (source.suffix.lower() == '.mp4' and video.codec_context.name == 'h264'
            and video.codec_context.format.name == 'yuv420p'
            and all(stream.codec_context.name == 'aac' for stream in container.streams.audio))
    temporary = destination.with_name(f'.video-{uuid.uuid4().hex}.mp4')
    try:
        if compatible:
            shutil.copyfile(source, temporary)
        else:
            ffmpeg = shutil.which('ffmpeg') or str(ROOT / 'tmp/tactics-ffmpeg.exe')
            if not Path(ffmpeg).is_file():
                raise ValueError('此视频需要转为 H.264 MP4，请先配置 FFmpeg。')
            subprocess.run([ffmpeg, '-nostdin', '-v', 'error', '-i', str(source), '-map', '0:v:0', '-map', '0:a?',
                '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart',
                str(temporary)], check=True)
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)


def prepare_object_variant(video, weights, output_dir):
    """Reuse the original all-class E-BARD pipeline without altering person IDs.

    The optimized person tracker deliberately filters to the player class. Its
    companion provides ball/hoop observations and role-isolated referee tracks.
    Both variants are validated against the same decoded video before publish.
    """
    directory = output_dir / 'scene-reference'
    directory.mkdir(parents=True, exist_ok=True)
    library = directory / 'library.json'
    atomic_json(library, {'samples': [{'id': 'scene', 'video': str(video),
                                    'videoSha256': file_hash(video)}]})
    subprocess.run([sys.executable, str(Path(__file__).with_name('build_ebard_review_tracks.py')),
        '--library', str(library), '--model', str(weights), '--output-dir', str(directory),
        '--suffix', 'ebard', '--report', str(directory / 'report.json'),
        '--previews', str(directory / 'previews')], check=True, cwd=ROOT)
    return {'id': 'ebard', 'label': '篮球 / 篮筐与裁判参照 · E-BARD',
            'tracks': str(directory / 'scene-ebard.json')}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['source', 'video', 'output-dir', 'models']:
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--source-sha256', required=True)
    parser.add_argument('--id', required=True)
    parser.add_argument('--variant', choices=[p['id'] for p in PRESETS], required=True)
    args = parser.parse_args()
    from prepare_tracking_variants import inspect_runtime
    plan = inference_plan(args.variant, args.models)
    inspect_runtime(args.models.resolve(), detector_keys=[plan['detector']])
    if file_hash(args.source) != args.source_sha256:
        raise ValueError('Source video changed after it was selected.')
    prepare_video(args.source, args.video)
    if file_hash(args.source) != args.source_sha256:
        raise ValueError('Source video changed while preparing the review copy; refresh and retry.')
    variant = plan['rawVariant']
    output = args.output_dir / f'{variant}.json'
    subprocess.run([sys.executable, str(Path(__file__).with_name('basketball_run.py')),
        '--video', str(args.video), '--weights', str(plan['weights']),
        '--variant', plan['profile'], '--detector', plan['detector'], '--result-variant', variant,
        '--output', str(output), '--imgsz', str(plan['imgsz']),
        '--evidence-frames'], check=True, cwd=ROOT)
    variants = [{'id': variant, 'label': plan['label'] + (' · 原始结果' if plan.get('stable') else ''), 'tracks': str(output)}]
    if plan.get('stable'):
        from prepare_basketball_team_overlay import prepare_variant, load_policy
        stable = args.output_dir / f'{args.variant}.json'
        prepare_variant(output, stable, load_policy(), variant=args.variant)
        variants.insert(0, {'id': args.variant, 'label': plan['label'], 'recommended': bool(plan.get('recommended')), 'tracks': str(stable)})
    if plan['detector'] == 'ebard':
        variants.append(prepare_object_variant(args.video, plan['weights'], args.output_dir))
    sample = {'id': args.id, 'title': args.source.stem, 'description': '本地视频库 · ' + args.source.name,
        'video': str(args.video), 'videoSha256': file_hash(args.video), 'tracks': str(output),
        'originalLabel': next(item['label'] for item in variants if item['id'] == variant),
        'defaultVariant': args.variant, 'trackingVariants': variants,
        'importSourceSha256': args.source_sha256, 'importSourceName': args.source.name}
    from serve_player_review import validated_clip
    validated_clip(sample)  # Reject partial output or mismatched PTS before publishing.
    atomic_json(args.output_dir / 'sample.json', sample)


if __name__ == '__main__':
    main()
