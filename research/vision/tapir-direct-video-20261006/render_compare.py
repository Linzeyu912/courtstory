"""Isolated visual comparison; never mutates workbench or source tracking data."""
from __future__ import annotations

import argparse
from functools import lru_cache
import hashlib
import json
from pathlib import Path
import subprocess
import time

import numpy as np

import av
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[3]
VIDEO = ROOT / 'data/videos/uploads/2026-10-03-batch02/clips/05_Pacers_20250106_Q2_0m44_team_motion_720p_silent.mp4'
CLIP = ROOT / 'artifacts/direct-video-vs-court-20261006/bridge-run-01/clip.json'
OUT = ROOT / 'artifacts/tapir-direct-video-20261006'
SOURCE_SHA = '17c36f8d3b3e294f13f7119f23b82ec7f3fbe96d5564db9cbe7d61f49ebbbd7d'
EVIDENCE_FRAMES = [570, 600, 610, 622, 634, 646, 660, 704, 750, 780, 800, 840, 868]


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


@lru_cache(maxsize=12)
def font(size=20):
    return ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', size)


def decode_selected(indices, clip):
    wanted = set(indices)
    images = {}
    clocks = []
    with av.open(str(VIDEO)) as container:
        for index, frame in enumerate(container.decode(video=0)):
            if index > max(wanted):
                break
            if index not in wanted:
                continue
            row = clip['frames'][index]
            if abs(float(frame.time) - row['time']) > 1e-7:
                raise ValueError(f'PTS mismatch at {index}')
            images[index] = frame.to_image()
            clocks.append({'sourceFrame': index, 'pts': frame.pts, 'timeBase': str(frame.time_base), 'sourceTime': float(frame.time)})
    if len(images) != len(wanted):
        raise ValueError('Not all source frames decoded')
    return images, clocks


def prepare():
    started = time.monotonic()
    if sha(VIDEO) != SOURCE_SHA:
        raise ValueError('Wrong source video bytes')
    clip = read(CLIP)
    if clip['video_sha256'] != SOURCE_SHA:
        raise ValueError('Tracking snapshot belongs to another video')
    images, clocks = decode_selected(EVIDENCE_FRAMES, clip)
    output = OUT / 'evidence'
    output.mkdir(parents=True, exist_ok=True)
    panels = []
    for index, image in images.items():
        image.save(output / f'source-f{index:04d}.jpg', quality=95)
        overlay = image.copy()
        draw = ImageDraw.Draw(overlay)
        for row in clip['frames'][index]['tracks']:
            x1, y1, x2, y2, track_id = row[:5]
            draw.rectangle((x1, y1, x2, y2), outline='#ffee22', width=2)
            draw.text((x1, max(0, y1 - 25)), f'T{int(track_id)}', font=font(), fill='#ffee22', stroke_width=2, stroke_fill='black')
        overlay.save(output / f'tracks-f{index:04d}.jpg', quality=95)
        panel = Image.new('RGB', (640, 400), '#12252b')
        panel.paste(overlay.resize((640, 360)), (0, 40))
        ImageDraw.Draw(panel).text((10, 6), f'源帧 {index}  |  {index / 60:.3f}s', font=font(22), fill='white')
        panels.append(panel)
    sheet = Image.new('RGB', (1280, 400 * ((len(panels) + 1) // 2)), '#12252b')
    for i, panel in enumerate(panels):
        sheet.paste(panel, ((i % 2) * 640, (i // 2) * 400))
    sheet.save(output / 'source-contact.jpg', quality=94)
    targets = []
    for index in range(570, 870):
        frame = clip['frames'][index]
        rows = [t for t in frame['tracks'] if int(t[4]) in (2, 39)]
        targets.append({'sourceFrame': index, 'sourceTime': frame['time'], 'tracks': rows})
    write(output / 'source-manifest.json', {'source': str(VIDEO), 'sha256': SOURCE_SHA, 'snapshot': str(CLIP), 'snapshotSha256': sha(CLIP), 'clock': clocks, 'baselineKnownLinks': [2, 39], 'baselineNote': 'Earlier candidate identity link; not identity or physical foot truth', 'targetRows': targets, 'elapsedSeconds': time.monotonic() - started})
    print(json.dumps({'stage': 'prepared', 'sourceFrames': len(images), 'contactSheet': str(output / 'source-contact.jpg'), 'seconds': time.monotonic() - started}), flush=True)


COLORS = ['#fd6384', '#f9d44e', '#54d4ff', '#9bf46c', '#ce98ff']
ROI = (220, 310, 700, 630)
FFMPEG = Path('D:/ffmbeg/ffmpeg-n8.1-latest-win64-gpl-shared-8.1/bin/ffmpeg.exe')


def draw_points(image, points):
    canvas = image.copy()
    draw = ImageDraw.Draw(canvas)
    for index, xy in enumerate(points):
        if xy is None:
            continue
        x, y = map(float, xy)
        color = COLORS[index % len(COLORS)]
        draw.ellipse((x - 7, y - 7, x + 7, y + 7), fill=color, outline='black', width=2)
        draw.text((x + 9, y - 10), str(index + 1), font=font(18), fill=color, stroke_width=2, stroke_fill='black')
    return canvas


def composite(image, frame_index, left_points, right_points, baseline_id):
    result = Image.new('RGB', (1280, 832), '#12252b')
    draw = ImageDraw.Draw(result)
    draw.text((14, 10), 'A 现有框内锚点 · T2→T39 候选关联', font=font(23), fill='white')
    draw.text((654, 10), 'B TAPIR · 同一球员身上 4 个跟踪点', font=font(23), fill='white')
    for side, points in enumerate([left_points, right_points]):
        panel = draw_points(image, points)
        result.paste(panel.resize((640, 360), Image.Resampling.LANCZOS), (side * 640, 44))
        result.paste(panel.crop(ROI).resize((540, 360), Image.Resampling.LANCZOS), (side * 640 + 50, 428))
    draw.text((12, 405), f'固定区域放大   源帧 {frame_index}  /  {frame_index / 60:.3f}s', font=font(16), fill='#c5dae4')
    draw.text((652, 405), f'同一源帧  ·  半速播放  ·  可见点 {sum(p is not None for p in right_points)}/{len(right_points)}', font=font(16), fill='#c5dae4')
    left_status = f'检测框 T{baseline_id}' if baseline_id is not None else '原检测／关联缺口：保留空白'
    draw.text((12, 790), left_status, font=font(17), fill='#ffda66')
    draw.text((652, 790), '只画可见候选；不平滑、不补点；并非地面坐标', font=font(17), fill='#ffda66')
    draw.line((640, 0, 640, 832), fill='#62737e', width=2)
    return result


def encode(images, output):
    attempts = []
    width, height = images[0].size
    for encoder, options in [('h264_nvenc', ['-preset', 'p5', '-cq', '19', '-b:v', '0']), ('libx264', ['-preset', 'veryfast', '-crf', '18'])]:
        command = [str(FFMPEG), '-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pixel_format', 'rgb24', '-video_size', f'{width}x{height}', '-framerate', '15', '-i', 'pipe:0', '-an', '-c:v', encoder, *options, '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(output)]
        error_path = output.with_suffix(f'.{encoder}.stderr.txt')
        with error_path.open('wb') as errors:
            process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=errors, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            try:
                for item in images:
                    process.stdin.write(item.tobytes())
            except BrokenPipeError:
                pass
            finally:
                try:
                    process.stdin.close()
                except BrokenPipeError:
                    pass
            code = process.wait(timeout=90)
        attempts.append({'command': command, 'commandLine': subprocess.list2cmdline(command), 'exitCode': code, 'stderr': error_path.read_text(encoding='utf-8', errors='replace')})
        if code == 0:
            return encoder, attempts
    raise RuntimeError('Comparison encode failed: ' + json.dumps(attempts))


def render():
    started = time.monotonic()
    folder = OUT / 'comparison'
    folder.mkdir(parents=True, exist_ok=True)
    output = folder / 'comparison-half-speed.mp4'
    if output.exists():
        raise ValueError('Retain existing result; use another directory for a new run')
    prediction = read(OUT / 'inference/result.json')
    # This adapter follows the experiment's explicit JSON schema, not a service API.
    source_frames = prediction['source_frames']
    queries = prediction['queries']
    clip = read(CLIP)
    if sha(VIDEO) != SOURCE_SHA or source_frames != list(range(570, 870, 2)):
        raise ValueError('Source or inference clock mismatch')
    images, clocks = decode_selected(source_frames, clip)
    ratios = [query['bbox_relative_xy'] for query in queries]
    displays, frame_log = [], []
    audit_frames = {570, 588, 610, 622, 634, 646, 660, 704, 750, 780, 800, 830, 840, 868}
    for i, source_frame in enumerate(source_frames):
        candidates = [t for t in clip['frames'][source_frame]['tracks'] if int(t[4]) in (2, 39)]
        if len(candidates) > 1:
            raise ValueError('Ambiguous known target tracks; do not silently choose one')
        box = candidates[0] if candidates else None
        baseline = [(box[0] + (box[2] - box[0]) * u, box[1] + (box[3] - box[1]) * v) for u, v in ratios] if box else [None] * len(queries)
        tapir, raw = [], []
        for query in queries:
            item = query['frames'][i]
            if item['source_frame'] != source_frame:
                raise ValueError('Per-query time mismatch')
            xy = item['xy_source']
            in_bounds = 0 <= xy[0] < clip['width'] and 0 <= xy[1] < clip['height']
            visible = bool(item['visible']) and in_bounds
            tapir.append(xy if visible else None)
            raw.append({'xy': xy, 'modelVisible': bool(item['visible']), 'inBounds': in_bounds, 'displayed': visible, 'score': item['visible_score']})
        rendered = composite(images[source_frame], source_frame, baseline, tapir, int(box[4]) if box else None)
        displays.append(rendered)
        frame_log.append({'outputFrame': i, 'outputTime': i / 15, **clocks[i], 'baselineTrack': int(box[4]) if box else None, 'baselinePoints': baseline, 'tapir': raw})
        if source_frame in audit_frames:
            rendered.save(folder / f'comparison-source-f{source_frame:04d}.jpg', quality=95)
    encoder, commands = encode(displays, output)
    with av.open(str(output)) as video:
        stream = video.streams.video[0]
        decoded = list(video.decode(video=0))
        if len(decoded) != 150 or (stream.width, stream.height) != (1280, 832):
            raise ValueError('Encoded output frame count/dimensions mismatch')
        times = [float(frame.time) for frame in decoded]
        if any(abs(t - i / 15) > 1e-6 for i, t in enumerate(times)):
            raise ValueError('Encoded output PTS mismatch')
    coverage = []
    missing_indices = [i for i, f in enumerate(frame_log) if f['baselineTrack'] is None]
    for q in range(len(queries)):
        shown = [f['tapir'][q]['displayed'] for f in frame_log]
        pts = np.asarray([f['tapir'][q]['xy'] for f in frame_log], dtype=float)
        deltas = np.linalg.norm(np.diff(pts, axis=0), axis=1)
        valid_delta = [float(deltas[i]) for i in range(len(deltas)) if shown[i] and shown[i + 1]]
        coverage.append({'query': q + 1, 'visibleFrames': sum(shown), 'totalFrames': len(shown), 'visibleInBaselineGaps': sum(shown[i] for i in missing_indices), 'baselineGapFrames': len(missing_indices), 'visibleStepMedianPixels': float(np.median(valid_delta)) if valid_delta else None, 'visibleStepMaxPixels': max(valid_delta) if valid_delta else None, 'accuracyScore': None})
    report = {'status': 'succeeded', 'sourceSha256': SOURCE_SHA, 'inferenceResultSha256': sha(OUT / 'inference/result.json'), 'seedSha256': sha(OUT / 'inference/seeds.json'), 'snapshotSha256': sha(CLIP), 'rendererSha256': sha(Path(__file__)), 'sameSourceClock': True, 'sourceRangeHalfOpen': [570, 870], 'sourceSeconds': 5.0, 'sampleRate': 30, 'outputRate': 15, 'outputSeconds': 10.0, 'outputFrames': 150, 'video': str(output), 'bytes': output.stat().st_size, 'sha256': sha(output), 'encoder': encoder, 'elapsedSeconds': time.monotonic() - started, 'baselineFrameCoverage': len(frame_log) - len(missing_indices), 'queryCoverage': coverage, 'displayPolicy': 'same colors/radius; raw positions; no smoothing/interpolation; TAPIR visible>0.5 and image bounds; absent linked detector frames stay empty', 'comparisonScope': 'bbox-relative anchors versus physical feature-point predictions; baseline uses prior candidate T2->T39 only; coverage/smoothness is not accuracy; no ground-truth annotation, court coordinates, or production integration'}
    write(folder / 'frame-log.json', frame_log)
    write(folder / 'commands.json', commands)
    write(folder / 'metrics.json', report)
    print(json.dumps(report, ensure_ascii=False), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['prepare', 'render'])
    args = parser.parse_args()
    if args.command == 'prepare':
        prepare()
    else:
        render()


if __name__ == '__main__':
    main()
