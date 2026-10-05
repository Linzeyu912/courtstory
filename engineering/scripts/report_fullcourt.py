"""Court-only review video and measurements; no player/ball projection."""
import argparse
from collections import Counter, defaultdict
from pathlib import Path

import av
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from benchmark_court_generalization import CONDITIONS, read, save, sha
from court_fullcourt import CENTER_RADIUS
from court_propagation import court_line_samples, project, LENGTH, WIDTH

LABELS = {'original': '原片', 'resolution-blur': '模糊与压缩', 'zoom-pan': '缩放与平移', 'darkened': '降亮度'}
FONT = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 22)
SMALL = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 17)


def stats(values):
    return {'count': len(values), 'median': float(np.median(values)) if values else None,
            'p95': float(np.quantile(values, .95)) if values else None}


def geometry():
    families = defaultdict(list)
    for family, point in court_line_samples(): families[family].append(point)
    angles = np.linspace(0, 2*np.pi, 101)
    families['center_circle_template'] = np.column_stack([LENGTH/2+CENTER_RADIUS*np.cos(angles), WIDTH/2+CENTER_RADIUS*np.sin(angles)])
    return families


def panel(image, row, title, i, old=False):
    canvas = np.full((640, 960, 3), (26, 21, 17), np.uint8)
    image = cv2.resize(image, (960, 540)); color = (60, 185, 255) if old else (220, 235, 40)
    h = np.asarray(row['courtToImage']).reshape(3, 3) if row and row.get('courtToImage') else None
    if h is not None:
        h = np.diag([960/1552, 540/872, 1.])@h
        for name, points in geometry().items():
            pixels = np.clip(project(h, points), -10000, 10000).astype(np.int32)
            if name == 'center_circle_template':
                for j in range(0, len(pixels)-1, 4):
                    cv2.polylines(image, [pixels[j:j+3]], False, (230, 140, 215), 1, cv2.LINE_AA)
            else:
                cv2.polylines(image, [pixels], False, color, 2, cv2.LINE_AA)
    canvas[70:610] = image
    pil = Image.fromarray(cv2.cvtColor(canvas, cv2.COLOR_BGR2RGB)); d = ImageDraw.Draw(pil)
    d.text((18, 8), title, font=FONT, fill='white')
    d.text((18, 38), f'{i/30:05.2f} 秒  ·  第 {i+1}/1080 帧  ·  '+('投影待复核' if h is not None else '证据不足，留空'), font=SMALL, fill='#d2d9df')
    d.text((18, 614), '实线：球场模板投影   紫色虚线：中圈模板（本片被队徽遮挡，不作观测）', font=SMALL, fill='#d2d9df')
    return cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)


def summary(directory, previous):
    manifest = read(previous/'manifest.json'); answer = {'sourceHash': manifest['sourceHash'],
        'independentSourceVideos': 1, 'trainingPerformed': False, 'metricAccuracyValidated': False,
        'purpose': 'Court registration only; no player/ball projection or smoothing', 'conditions': {}}
    runs = {name: read(directory/(name+'-joint.json')) for name in CONDITIONS}
    for name, run in runs.items():
        rows = run['frames']; graph = read(directory/(name+'-graph.json'))
        indices = [r['frame'] for r in rows if r.get('courtToImage')]
        missing = [r['frame'] for r in rows if not r.get('courtToImage')]
        gaps = []
        for i in missing:
            if gaps and gaps[-1][-1]+1 == i: gaps[-1].append(i)
            else: gaps.append([i])
        differences = [r['quality']['twoAnchorDifferenceMeters']['median'] for r in rows
                       if r.get('courtToImage') and 'twoAnchorDifferenceMeters' in r.get('quality', {})]
        absolute = []
        for obs in graph['absolute']:
            h = np.array(run['cameras'][str(obs['frame'])]).reshape(3, 3)
            absolute.append(float(np.linalg.norm(project(h, [obs['world']])[0]-obs['image'])))
        answer['conditions'][name] = {'frames': len(rows), 'validFrames': len(indices), 'coverage': len(indices)/len(rows),
            'missingIntervalsZeroBased': [[g[0], g[-1]] for g in gaps], 'longestMissingSeconds': max([len(g)/30 for g in gaps], default=0),
            'invalidReasons': dict(Counter(r['reason'] for r in rows if not r.get('courtToImage'))),
            'keyframes': len(run['cameras']), 'floorGraphEdges': len(graph['edges']),
            'absolutePointObservations': len(graph['absolute']),
            'lineConstraints': dict(Counter(r.get('family', 'center_line') for r in run['fit']['lines'])),
            'visibleCircleObservations': 0,
            'independentMotionRepairFrames': run.get('motionAudit', {}).get('repairedFrames', []),
            'modelPointFitPixelsNotAccuracy': stats(absolute), 'nearbyCameraConsistencyMetersNotAccuracy': stats(differences),
            'optimizer': {'floor': run['fit']['floorFit'], 'lines': run['fit']['centerFit']}}
    # Fixed image grid, filtered only to points in the clean run's floor polygon.
    grid = np.array([[x, y] for x in np.linspace(90, 1460, 12) for y in np.linspace(340, 720, 6)])
    for name in CONDITIONS[1:]:
        differences = []
        for i, (orig, variant) in enumerate(zip(runs['original']['frames'], runs[name]['frames'])):
            if not orig.get('courtToImage') or not variant.get('courtToImage'): continue
            h0 = np.array(orig['courtToImage']).reshape(3, 3); h1 = np.array(variant['courtToImage']).reshape(3, 3)
            a = np.array(manifest['conditions'][name]['sourceToVariant'][i]).reshape(3, 3)
            p = project(np.linalg.inv(h0), grid); pixels = project(a, grid)
            keep = (p[:, 0]>=0)&(p[:, 0]<=LENGTH)&(p[:, 1]>=0)&(p[:, 1]<=WIDTH)&(pixels[:, 0]>=0)&(pixels[:, 0]<1552)&(pixels[:, 1]>=0)&(pixels[:, 1]<872)
            differences.extend(np.linalg.norm(p[keep]-project(np.linalg.inv(h1), pixels[keep]), axis=1).tolist())
        answer['conditions'][name]['augmentationConsistencyMetersNotAccuracy'] = stats(differences)
    checks = read(Path(__file__).resolve().parents[2]/'research/vision/court-fullcourt-20261004-line-checks.json')
    if checks['sourceHash'] != manifest['sourceHash']: raise ValueError('Visual checks belong to another source')
    old = {r['frame']: r for r in read(previous/'original-windows.json')['keyframes']}
    audit = []; before_all = []; after_all = []
    for check in checks['checks']:
        i = check['frame']; entry = {'frame': i, 'pixels': check['pixels']}
        for label, row, output in [('before', old.get(i), before_all), ('after', runs['original']['frames'][i], after_all)]:
            if not row or not row.get('courtToImage'): entry[label] = None; continue
            h = np.asarray(row['courtToImage']).reshape(3, 3)
            line = np.linalg.inv(h).T@np.array([1., 0., -LENGTH/2]); line /= np.linalg.norm(line[:2])
            error = np.abs(np.array(check['pixels'])@line[:2]+line[2]).tolist()
            entry[label] = error; output.extend(error)
        audit.append(entry)
    answer['visualMidlineCheck'] = {'annotationSource': checks['annotationSource'],
        'readingUncertaintyPixels': 5, 'humanValidated': False, 'usedForFitting': False,
        'beforePixels': stats(before_all), 'afterPixels': stats(after_all), 'frames': audit}
    for name in CONDITIONS:
        errors = []
        for check in checks['checks']:
            i = check['frame']; row = runs[name]['frames'][i]
            if not row.get('courtToImage'): continue
            line = np.linalg.inv(np.asarray(row['courtToImage']).reshape(3,3)).T@np.array([1.,0.,-LENGTH/2])
            line /= np.linalg.norm(line[:2])
            transform = np.asarray(manifest['conditions'][name]['sourceToVariant'][i]).reshape(3,3)
            pixels = project(transform, check['pixels'])
            errors.extend(np.abs(pixels@line[:2]+line[2]).tolist())
        answer['conditions'][name]['approximateVisualMidlineErrorPixels'] = stats(errors)
    save(directory/'summary.json', answer)
    return answer, runs


def encode(container, stream, array):
    frame = av.VideoFrame.from_ndarray(array, format='bgr24')
    for packet in stream.encode(frame): container.mux(packet)


def render(args, runs):
    old = {r['frame']: r for r in read(args.previous/'original-windows.json')['keyframes']}
    videos = {name: av.open(str(args.video if name == 'original' else args.previous/(name+'.mp4'))) for name in CONDITIONS}
    readers = {name: iter(v.decode(video=0)) for name, v in videos.items()}
    outputs = {}
    for name, height in [('court-before-after', 640), ('court-augmentations', 1280)]:
        c = av.open(str(args.output/(name+'.mp4')), 'w', options={'movflags': '+faststart'})
        s = c.add_stream('libx264', rate=30); s.width = 1920; s.height = height; s.pix_fmt = 'yuv420p'
        s.options = {'crf': '20', 'preset': 'fast'}; outputs[name] = (c, s)
    for i in range(1080):
        images = {name: next(reader).to_ndarray(format='bgr24') for name, reader in readers.items()}
        panels = {name: panel(images[name], runs[name]['frames'][i], LABELS[name]+' · 全场联合标定', i) for name in CONDITIONS}
        comparison = np.hstack([panel(images['original'], old.get(i), '之前 · 独立半场参照', i, old=True), panels['original']])
        augmented = np.vstack([np.hstack([panels[n] for n in CONDITIONS[:2]]), np.hstack([panels[n] for n in CONDITIONS[2:]])])
        encode(*outputs['court-before-after'], comparison); encode(*outputs['court-augmentations'], augmented)
        if i in (90, 210, 540, 720, 900, 1079):
            cv2.imwrite(str(args.output/f'comparison-{i}.jpg'), comparison)
        if i == 210: cv2.imwrite(str(args.output/'poster.jpg'), comparison)
        if i % 300 == 0: print('render', i, flush=True)
    for c, s in outputs.values():
        for packet in s.encode(): c.mux(packet)
        c.close()
    for v in videos.values(): v.close()


def page(directory, report):
    table = ''.join(f'<tr><td>{LABELS[n]}</td><td>{r["validFrames"]}/{r["frames"]} ({r["coverage"]:.2%})</td><td>{r["longestMissingSeconds"]:.2f} 秒</td><td>{r["lineConstraints"].get("center_line",0)}</td><td>{r["approximateVisualMidlineErrorPixels"]["median"]:.1f} px</td></tr>' for n,r in report['conditions'].items())
    audit = report['visualMidlineCheck']
    text = f'''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>全场联合标定复验</title>
<style>body{{font:17px/1.7 system-ui;background:#101a25;color:#e7edf5;max-width:1280px;margin:36px auto;padding:0 24px}}h1{{font-size:30px}}h2{{font-size:22px}}p{{color:#bbc9d8}}video{{width:100%;background:#000;border-radius:10px}}table{{border-collapse:collapse;width:100%;margin:24px 0}}td,th{{padding:10px;text-align:left;border-bottom:1px solid #344657}}a{{color:#75d8ed}}button{{background:#27445b;color:white;border:0;border-radius:6px;padding:10px 18px;cursor:pointer}}</style>
<h1>全场联合标定 · 球场专用复验</h1><p>仅检查球场几何；人物、脚下点和篮球仍保持原流程。36 秒，1080 帧，原片与三种增强均独立求解。</p>
<h2>先看跨中场的前后对比</h2><p>左：之前的独立半场参照；右：两端禁区、可见中线与地板运动联合求解。实线是投影；紫色虚线是中圈模板。本片的中圈被队徽遮挡，没有把队徽边缘当作中圈观测。</p>
<video id="main" controls preload="metadata" poster="poster.jpg"><source src="court-before-after.mp4" type="video/mp4"></video>
<p><button onclick="seek(6)">第一次经过中场 · 6秒</button> <button onclick="seek(22)">返回中场 · 22秒</button> <a href="court-before-after.mp4" download>下载对比视频</a></p>
<h2>全片覆盖检查</h2><table><tr><th>版本</th><th>通过内部质量检查的标定帧</th><th>最长缺失</th><th>中线观测关键帧</th><th>中线目视偏差中位数</th></tr>{table}</table>
<p>覆盖率不是准确率。双参照一致性和增强一致性也不是独立真值；全部结果仍待复核。本片用于算法开发与复验，不是独立测试集；增强版本不能算新比赛。未训练模型。</p>
<p>另取 6 个未参与关键帧求解的跨中场画面，按原图可见中线做目视参考：12 个点到投影中线的偏差中位数为 {audit['beforePixels']['median']:.1f} → {audit['afterPixels']['median']:.1f} 像素。这些参考由本次图像目视读取，约 ±5 像素，尚未人工复核，也不代表全场米制精度。</p>
<p>降亮度版本没有检出满足门槛的中线，主要依靠两端禁区和地板运动；中场仍有约 15 像素偏差。部分优化达到预设迭代上限，当前版本用于复核，尚未替换工作台默认标定。</p>
<h2>同一算法的增强复验</h2><video controls preload="metadata"><source src="court-augmentations.mp4" type="video/mp4"></video>
<p><a href="summary.json">查看完整统计</a> · <a href="court-augmentations.mp4" download>下载增强复验视频</a></p>
<script>function seek(t){{const v=document.querySelector('#main');v.currentTime=t;v.play();}}</script></html>'''
    (directory/'index.html').write_text(text, 'utf-8')


def main():
    p = argparse.ArgumentParser(description=__doc__); p.add_argument('--previous', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True); p.add_argument('--video', type=Path, required=True)
    p.add_argument('--render', action='store_true'); args = p.parse_args()
    report, runs = summary(args.output, args.previous)
    if args.render: render(args, runs)
    page(args.output, report)
    print({n: r['coverage'] for n,r in report['conditions'].items()})


if __name__ == '__main__': main()
