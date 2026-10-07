"""Show the retained failed rectangular run and the square-input control together."""
import json
from pathlib import Path
import time

import av
import numpy as np
from PIL import Image, ImageDraw

from render_compare import ROOT, VIDEO, CLIP, OUT, SOURCE_SHA, ROI, read, write, sha, font, draw_points, decode_selected, encode


def panel_frame(source, frame_number, groups, baseline_id):
    result = Image.new('RGB', (1440, 696), '#12252b')
    draw = ImageDraw.Draw(result)
    titles = ['A 现有框内锚点 · 候选关联 T2→T39', 'B 首轮 512×288 · 原始输出', 'C 方形控制 256×256 · 原始输出']
    subtitles = ['同一球员的 4 个参考位置', '这版实现的宽屏兼容问题已查明', '同一视频、同一自动种子；未平滑']
    for i, points in enumerate(groups):
        x = i * 480
        draw.text((x + 9, 5), titles[i], font=font(19), fill='white')
        draw.text((x + 9, 30), subtitles[i], font=font(15), fill='#c8d9df')
        overlay = draw_points(source, points)
        result.paste(overlay.resize((480, 270), Image.Resampling.LANCZOS), (x, 54))
        result.paste(overlay.crop(ROI), (x, 352))
        status = f'T{baseline_id}' if i == 0 and baseline_id is not None else ('检测／关联缺口' if i == 0 else f'可见候选 {sum(p is not None for p in points)}/4')
        draw.text((x + 9, 327), f'固定区域放大  |  {status}', font=font(16), fill='#ffda66')
        if i:
            draw.line((x, 0, x, 696), fill='#5e7180', width=2)
    draw.text((10, 675), f'源帧 {frame_number}  /  {frame_number / 60:.3f}s  ·  半速  ·  1–4 是同一目标的候选点，非球员编号  ·  模型判可见 ≠ 跟踪正确；并非地面坐标', font=font(16), fill='white')
    return result


def main():
    begun = time.monotonic()
    folder = OUT / 'comparison-threeway'
    folder.mkdir(parents=True, exist_ok=True)
    output = folder / 'comparison-half-speed.mp4'
    if output.exists():
        raise ValueError('Existing output preserved')
    directories = [OUT / 'inference', OUT / 'inference-256-control']
    runs = [read(d / 'result.json') for d in directories]
    clip = read(CLIP)
    frames = list(range(570, 870, 2))
    assert sha(VIDEO) == SOURCE_SHA
    assert all(r['source_frames'] == frames for r in runs)
    assert all(len(r['queries']) == 4 for r in runs)
    for a, b in zip(runs[0]['queries'], runs[1]['queries']):
        assert a['seed_source_frame'] == b['seed_source_frame'] == 604
        assert a['query_id'] == b['query_id']
        assert a['seed_xy_source'] == b['seed_xy_source']
        assert a['bbox_relative_xy'] == b['bbox_relative_xy']
    images, clocks = decode_selected(frames, clip)
    displays, log = [], []
    screenshot_frames = {570, 604, 610, 622, 634, 646, 660, 704, 750, 780, 800, 830, 840, 868}
    for ti, sf in enumerate(frames):
        tracks = [t for t in clip['frames'][sf]['tracks'] if int(t[4]) in (2, 39)]
        assert len(tracks) <= 1
        box = tracks[0] if tracks else None
        baseline = [(box[0] + (box[2] - box[0]) * q['bbox_relative_xy'][0], box[1] + (box[3] - box[1]) * q['bbox_relative_xy'][1]) for q in runs[0]['queries']] if box else [None] * 4
        groups, records = [baseline], []
        for run in runs:
            points, items = [], []
            for query in run['queries']:
                item = query['frames'][ti]
                assert item['source_frame'] == sf
                assert abs(run['frame_mapping'][ti]['source_time_seconds'] - clocks[ti]['sourceTime']) < 1e-7
                xy = item['xy_source']
                valid = bool(item['visible']) and 0 <= xy[0] < 1280 and 0 <= xy[1] < 720
                points.append(xy if valid else None)
                items.append({'query_id': query['query_id'], 'xy_source': xy, 'visible_score': item['visible_score'], 'displayed': valid})
            groups.append(points)
            records.append(items)
        rendered = panel_frame(images[sf], sf, groups, int(box[4]) if box else None)
        displays.append(rendered)
        log.append({'outputFrame': ti, 'outputTime': ti / 15, **clocks[ti], 'baselineTrack': int(box[4]) if box else None, 'baselinePoints': baseline, 'rectangularRun': records[0], 'squareControl': records[1]})
        if sf in screenshot_frames:
            rendered.save(folder / f'comparison-source-f{sf:04d}.jpg', quality=95)
    encoder, commands = encode(displays, output)
    with av.open(str(output)) as container:
        video_stream = container.streams.video[0]
        decoded = list(container.decode(video=0))
        assert len(decoded) == 150
        assert (video_stream.width, video_stream.height) == (1440, 696)
        assert all(abs(float(f.time) - i / 15) < 1e-6 for i, f in enumerate(decoded))
    statistics = []
    for label, run, directory in zip(['rectangular_first_run', 'square_control'], runs, directories):
        count = [sum(f['visible'] and 0 <= f['xy_source'][0] < 1280 and 0 <= f['xy_source'][1] < 720 for f in q['frames']) for q in run['queries']]
        manifest = read(directory / 'manifest.json')
        statistics.append({'label': label, 'resultSha256': sha(directory / 'result.json'), 'timings': manifest['timings'], 'visibleCandidateCounts': count, 'accuracyScore': None})
    metrics = {'status': 'succeeded', 'sourceSha256': SOURCE_SHA, 'trackingSnapshotSha256': sha(CLIP), 'videoSha256': sha(output), 'videoBytes': output.stat().st_size, 'width': 1440, 'height': 696, 'frames': 150, 'fps': 15, 'durationSeconds': 10, 'sourceDurationSeconds': 5, 'sourceFrames': frames, 'sameFramesSameSeeds': True, 'baselineVisibleFrames': sum(r['baselineTrack'] is not None for r in log), 'runs': statistics, 'encoder': encoder, 'renderSeconds': time.monotonic() - begun, 'authoringScriptSha256': sha(Path(__file__)), 'sharedRendererSha256': sha(Path(__file__).with_name('render_compare.py')), 'limits': ['display-only raw tracking diagnostic; no tactical editor integration', 'rectangle first run failed seed localization; square control is a separately retained input-shape diagnostic, not a hidden best-run selection', 'existing bbox-relative anchors and point tracks have different semantics; coverage is not identity or pixel accuracy', 'same threshold and colors across both models; invisible predictions are omitted, no smoothing/interpolation', 'fixed ROI may exclude wrong off-target points; full frame remains visible above', 'offline model used the entire 5-second clip; runtime is not online end-to-end latency']}
    write(folder / 'frame-log.json', log)
    write(folder / 'commands.json', commands)
    write(folder / 'metrics.json', metrics)
    print(json.dumps({k: v for k, v in metrics.items() if k not in ('sourceFrames', 'limits')}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
