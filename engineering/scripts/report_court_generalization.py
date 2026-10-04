"""Summarise and render the local generalization benchmark without smoothing."""
import argparse
from collections import Counter
import html
import json
from pathlib import Path

import av
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from benchmark_court_generalization import CONDITIONS, ROOT, read, save, sha
from court_propagation import court_line_samples, LANDMARKS, LENGTH, WIDTH, project

LABELS = {'original': '原片', 'resolution-blur': '降清晰度 + 模糊 + 压缩',
          'zoom-pan': '额外数字缩放与平移', 'darkened': '降低亮度'}
FONTS = {s: ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', s) for s in (18, 22, 26)}


def keys(result):
    return {row['frame']: row for row in result.get('keyframes', []) if row.get('courtToImage') and row.get('points')}


def runs(indices):
    groups = []
    for i in indices:
        if groups and groups[-1][-1]+1 == i: groups[-1].append(i)
        else: groups.append([i])
    return [[g[0], g[-1]] for g in groups]


def stats(values):
    return {'n': len(values), 'median': float(np.median(values)) if len(values) else None,
            'p95': float(np.quantile(values, .95)) if len(values) else None}


def inside(points):
    return np.isfinite(points).all(axis=1) & (points[:, 0] >= 0) & (points[:, 0] <= LENGTH) & (points[:, 1] >= 0) & (points[:, 1] <= WIDTH)


def summarize(directory):
    manifest = read(directory/'manifest.json'); total = len(manifest['frames'])
    mappings = {name: keys(read(directory/(name+'-windows.json'))) for name in CONDITIONS}
    tracks = {name: read(directory/(name+'-tracks.json')) for name in CONDITIONS}
    report = {'sourceHash': manifest['sourceHash'], 'independentSourceVideos': 1, 'trainingPerformed': False,
              'groundTruthAvailable': False, 'conditions': {}, 'segmentsSeconds': [[0, 6], [6, 10], [10, 21], [21, 27], [27, 36]],
              'meaning': 'Coverage, observed candidates and augmentation consistency; not accuracy, recall, or persistent-player identity.'}
    for name in CONDITIONS:
        mapped = mappings[name]; scene = read(directory/(name+'-scene.json'))
        raw_mapping = read(directory/(name+'-windows.json'))
        single960 = keys(read(directory/(name+'-mapping960.json')))
        original_mapping = read(directory/(name+'-mapping.json'))
        scan960 = read(directory/(name+'-scan960.json'))['scan']
        attempted = {r['frame'] for r in raw_mapping.get('keyframes', [])}
        missing = sorted(set(range(total))-set(mapped)); gaps = runs(missing)
        valid_marker_frames = 0; point_count = 0; outside_count = 0; edges = []; marker_frames = set()
        for i, row in mapped.items():
            h = np.asarray(row['courtToImage']).reshape(3, 3)
            anchors = [[(t[0]+t[2])/2, t[3]] for t in tracks[name][i]['tracks']]
            if anchors:
                projected = project(np.linalg.inv(h), anchors); mask = inside(projected)
                valid_marker_frames += int(mask.any()); point_count += int(mask.sum()); outside_count += int((~mask).sum())
                if mask.any(): marker_frames.add(i)
            q = row.get('quality', {}).get('projectedLines') or {}
            if q.get('medianResidualPixels') is not None: edges.append(q['medianResidualPixels'])
        info = {'totalFrames': total, 'mappingFrames': len(mapped), 'mappingCoverage': len(mapped)/total,
                'framesWithCourtPlayerMarker': valid_marker_frames, 'markerCoverage': valid_marker_frames/total,
                'insidePlayerObservations': point_count, 'outsidePlayerObservations': outside_count,
                'missingIntervalsZeroBased': gaps, 'longestMissingSeconds': max((b-a+1)/30 for a, b in gaps) if gaps else 0,
                'attemptedMappingFrames': len(attempted), 'failedWithinWindow': len(attempted)-len(mapped),
                'outsideSingleOperationWindow': total-len(attempted),
                'courtInputSize': 960, 'baseline640': {'mappingFrames': len(keys(original_mapping)),
                    'attemptedFrames': len(original_mapping.get('keyframes', [])),
                    'outsideSingleOperationWindow': total-len(original_mapping.get('keyframes', [])),
                    'seedFrame': original_mapping.get('experiment', {}).get('seedFrame')},
                'single960MappingFrames': len(single960),
                'initializationScanAccepted': sum(r['proposal']['status'] == 'needs_review' for r in scene['scan']),
                'initializationScanFrames': len(scene['scan']),
                'initialization960ScanAccepted': sum(r['proposal']['status'] == 'needs_review' for r in scan960),
                'initializationReasons': dict(Counter(r['proposal']['reason'] for r in scene['scan'])),
                'trackedPlayersPerFrame': stats([len(r['tracks']) for r in tracks[name]]),
                'temporaryTrackIds': len({int(t[4]) for r in tracks[name] for t in r['tracks']}),
                'ballCandidateFrames': sum(any(o['kind'] == 'basketball' and o['score'] >= .25 for o in r['objects']) for r in scene['frames']),
                'edgeProximityPixelsNotAccuracy': stats(edges), 'segments': [], 'poses': {}}
        for start, end in report['segmentsSeconds']:
            selected = [r['frame'] for r in manifest['frames'] if start <= r['time'] < end]
            info['segments'].append({'seconds': [start, end], 'frames': len(selected),
                                     'mapped': sum(i in mapped for i in selected)})
        for model in ('yolov8s-pose', 'rtmw-l'):
            data = read(directory/(name+'-'+model+'.json'))
            people = [p for r in data['frames'] for p in r['people']]
            valid = sum(p.get('anchor') is not None for p in people)
            info['poses'][model] = {'sampledFrames': len(data['frames']), 'stride': 10,
                                   'trackedPersonObservations': len(people), 'twoFootCandidates': valid,
                                   'candidateCoverage': valid/max(1, len(people))}
        model_disagreements = []; single_disagreements = []
        for scan in scan960:
            if scan['proposal']['status'] != 'needs_review' or scan['frame'] not in mapped: continue
            proposal = scan['proposal']; floor = []
            for point in proposal['points']:
                x, y = LANDMARKS[point['id']]; floor.append((LENGTH-x if proposal['side']=='right' else x, y))
            measured = np.array([p['image'] for p in proposal['points']])
            estimate = project(np.asarray(mapped[scan['frame']]['courtToImage']).reshape(3,3), floor)
            model_disagreements.extend(np.linalg.norm(estimate-measured,axis=1).tolist())
            if scan['frame'] in single960:
                single_estimate = project(np.asarray(single960[scan['frame']]['courtToImage']).reshape(3,3),floor)
                single_disagreements.extend(np.linalg.norm(single_estimate-measured,axis=1).tolist())
        info['independentCourtModelPointDifferencePixelsNotGT'] = stats(model_disagreements)
        info['single960CourtModelPointDifferencePixelsNotGT'] = stats(single_disagreements)
        handoffs = []
        windows = raw_mapping['experiment']['windows']
        for index in range(len(windows)-1):
            left = keys(read(directory/f'{name}-window-{index}.json'))
            right = keys(read(directory/f'{name}-window-{index+1}.json'))
            differences = []; per_frame = []
            for i in sorted(set(left)&set(right)):
                anchors = [[(t[0]+t[2])/2,t[3]] for t in tracks[name][i]['tracks']]
                if not anchors: continue
                a = project(np.linalg.inv(np.array(left[i]['courtToImage']).reshape(3,3)),anchors)
                b = project(np.linalg.inv(np.array(right[i]['courtToImage']).reshape(3,3)),anchors)
                valid = inside(a)&inside(b)
                if not valid.any(): continue
                error = np.linalg.norm(a[valid]-b[valid],axis=1)
                differences.extend(error.tolist());per_frame.append(i)
            metric = stats(differences)
            handoffs.append({'boundaryFrame':windows[index]['coreFrames'][1], 'overlapFrames':len(per_frame),
                             'differenceMetersNotGT':metric,
                             'consistencyCheckPassed': bool(len(per_frame)>=3 and metric['median']<=.75 and metric['p95']<=1.5),
                             'checkThresholds':{'minimumOverlapFrames':3,'medianMeters':.75,'p95Meters':1.5},
                             'status':'experimental_review_required'})
        info['referenceHandoffs'] = handoffs
        uncertain = set()
        for handoff in handoffs:
            if not handoff['consistencyCheckPassed']:
                boundary = handoff['boundaryFrame']
                uncertain.update(range(max(0,boundary-30),min(total,boundary+30)))
        info['handoffConflictIntervalsZeroBased'] = runs(sorted(uncertain))
        info['framesAfterHandoffCheck'] = len(set(mapped)-uncertain)
        info['coverageAfterHandoffCheck'] = info['framesAfterHandoffCheck']/total
        info['markerFramesAfterHandoffCheck'] = len(marker_frames-uncertain)
        info['markerCoverageAfterHandoffCheck'] = len(marker_frames-uncertain)/total
        if name != 'original':
            deviations = []; frames = 0
            for i in sorted(set(mapped) & set(mappings['original'])):
                base = np.array([[(t[0]+t[2])/2, t[3]] for t in tracks['original'][i]['tracks']]).reshape(-1, 2)
                if not len(base): continue
                transform = np.asarray(manifest['conditions'][name]['sourceToVariant'][i]).reshape(3, 3)
                moved = project(transform, base)
                a = project(np.linalg.inv(np.asarray(mappings['original'][i]['courtToImage']).reshape(3, 3)), base)
                b = project(np.linalg.inv(np.asarray(mapped[i]['courtToImage']).reshape(3, 3)), moved)
                width, height = manifest['dimensions']
                mask = inside(a) & np.isfinite(b).all(axis=1) & (moved[:, 0]>=0) & (moved[:, 0]<width) & (moved[:, 1]>=0) & (moved[:, 1]<height)
                if mask.any():
                    frames += 1; deviations.extend(np.linalg.norm(a[mask]-b[mask], axis=1).tolist())
            info['mappingEquivarianceMetersNotAccuracy'] = {**stats(deviations), 'pairedFrames': frames,
                'reference': 'original inferred mapping at same source pixel, transformed by known augmentation; no GT'}
        report['conditions'][name] = info
    save(directory/'summary.json', report)
    # Preserve all raw candidates on disk. The video explicitly withholds
    # coordinates at a failed handoff rather than drawing a misleading jump.
    display = {name: dict(value) for name,value in mappings.items()}
    for name, info in report['conditions'].items():
        for start,end in info['handoffConflictIntervalsZeroBased']:
            for i in range(start,end+1): display[name].pop(i,None)
    save(directory/'display-mappings.json', {'sourceHash':manifest['sourceHash'], 'smoothingApplied':False,
        'conditions':{name:[{'frame':i,'courtToImage':value[i]['courtToImage'] if i in value else None,
                            'status':'candidate_needs_review' if i in value else 'unavailable_or_handoff_conflict'}
                           for i in range(total)] for name,value in display.items()}})
    return report, manifest, display, tracks


def text(image, lines, size=18):
    canvas = Image.fromarray(cv2.cvtColor(image, cv2.COLOR_BGR2RGB)); draw = ImageDraw.Draw(canvas)
    for xy, value, color in lines: draw.text(xy, value, font=FONTS[size], fill=color)
    return cv2.cvtColor(np.asarray(canvas), cv2.COLOR_RGB2BGR)


def panel(image, name, i, row, people, handoff_conflict=False):
    output = np.full((660, 960, 3), (32, 28, 24), np.uint8)
    annotated = image.copy(); matrix = np.asarray(row['courtToImage']).reshape(3, 3) if row else None
    if matrix is not None:
        families = {}
        for family, point in court_line_samples(.2): families.setdefault(family, []).append(point)
        for points in families.values():
            projected = project(matrix, points)
            if np.isfinite(projected).all():
                cv2.polylines(annotated, [np.clip(projected, -100000, 100000).astype(np.int32)], False, (240, 225, 20), 2, cv2.LINE_AA)
    for t in people:
        x, y = round((t[0]+t[2])/2), round(t[3])
        cv2.drawMarker(annotated, (x, y), (40, 220, 255), cv2.MARKER_CROSS, 13, 2)
    output[32:572] = cv2.resize(annotated, (960, 540))
    x, y, scale = 656, 583, 4.5
    # Compact full court; display coordinates remain unsmoothed.
    cw, ch = round(LENGTH*scale), round(WIDTH*scale)
    cv2.rectangle(output, (x, y), (x+cw, y+ch), (180, 204, 219), -1)
    families = {}
    for family, point in court_line_samples(.3): families.setdefault(family, []).append(point)
    for points in families.values():
        cv2.polylines(output, [np.rint(np.asarray(points)*scale+[x, y]).astype(np.int32)], False, (90, 90, 90), 1, cv2.LINE_AA)
    count = 0
    if matrix is not None and people:
        ground = project(np.linalg.inv(matrix), [[(t[0]+t[2])/2, t[3]] for t in people])
        for p in ground[inside(ground)]:
            q = tuple(np.rint(p*scale+[x, y]).astype(int)); count += 1
            cv2.circle(output, q, 4, (25, 30, 35), -1, cv2.LINE_AA)
            cv2.circle(output, q, 3, (40, 220, 255), -1, cv2.LINE_AA)
    return text(output, [((12, 3), LABELS[name], (255, 255, 255)),
                        ((12, 580), f'源帧 {i+1} / 1080  ·  {i/30:.2f} 秒  ·  原速', (245, 245, 245)),
                        ((12, 607), f'映射：{"接续冲突，2D 留空" if handoff_conflict else "有候选，需核验" if row else "缺失"}  ·  场内黄点 {count}', (255, 219, 93)),
                        ((12, 634), '青线：球场反投影；黄点：框底边；无平滑', (230, 235, 237))])


def render(args, manifest, mappings, tracks):
    destination = args.directory/'generalization-comparison.mp4'
    if destination.exists() and not args.rerender: return
    streams = {name: av.open(str(args.video if name == 'original' else args.directory/(name+'.mp4'))) for name in CONDITIONS}
    iterators = {name: source.decode(video=0) for name, source in streams.items()}
    report=read(args.directory/'summary.json')
    with av.open(str(destination), 'w', options={'movflags': '+faststart'}) as output:
        stream = output.add_stream('libx264', rate=30); stream.width=1920; stream.height=1320; stream.pix_fmt='yuv420p'
        stream.options={'crf':'20', 'preset':'fast'}
        for i in range(len(manifest['frames'])):
            panels = [panel(next(iterators[name]).to_ndarray(format='bgr24'), name, i, mappings[name].get(i), tracks[name][i]['tracks'],
                            any(a<=i<=b for a,b in report['conditions'][name]['handoffConflictIntervalsZeroBased'])) for name in CONDITIONS]
            joined = np.vstack([np.hstack(panels[:2]), np.hstack(panels[2:])])
            if i in (0, 210, 540, 720, 1079):
                cv2.imwrite(str(args.directory/f'comparison-frame-{i+1}.jpg'), joined)
            if i == 0: cv2.imwrite(str(args.directory/'comparison-poster.jpg'), joined)
            frame=av.VideoFrame.from_ndarray(joined, format='bgr24')
            for packet in stream.encode(frame): output.mux(packet)
            if i % 300 == 0: print('render', i, flush=True)
        for packet in stream.encode(): output.mux(packet)
    for source in streams.values(): source.close()
    with av.open(str(destination)) as source: decoded=sum(1 for _ in source.decode(video=0))
    assert decoded == len(manifest['frames'])
    raw = destination.read_bytes(); assert 0 <= raw.find(b'moov') < raw.find(b'mdat')
    save(args.directory/'video-verification.json', {'frames': decoded, 'sha256': sha(destination), 'faststart': True})


def webpage(directory, report):
    rows = []; pose_rows = []
    for name, value in report['conditions'].items():
        paired = value.get('mappingEquivarianceMetersNotAccuracy')
        consistency = f"{paired['median']:.2f} / {paired['p95']:.2f} m" if paired and paired['n'] else '—'
        rows.append(f"<tr><td>{LABELS[name]}</td><td>{value['baseline640']['mappingFrames']}/1080</td><td>{value['single960MappingFrames']}/1080</td><td>{value['mappingFrames']}/1080（{value['mappingCoverage']:.1%}）</td><td>{value['framesAfterHandoffCheck']}/1080（{value['coverageAfterHandoffCheck']:.1%}）</td><td>{consistency}</td></tr>")
        for model, item in value['poses'].items():
            pose_rows.append(f"<tr><td>{LABELS[name]}</td><td>{model}</td><td>{item['sampledFrames']}</td><td>{item['twoFootCandidates']}/{item['trackedPersonObservations']}（{item['candidateCoverage']:.1%}）</td></tr>")
    document = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>全场镜头泛化压力测试</title>
<style>body{max-width:1180px;margin:30px auto;padding:0 24px;background:#f3f5f6;color:#1d2c32;font:17px/1.65 system-ui}h1{font-size:29px}section{background:white;padding:20px;margin:20px 0;border-radius:12px}video,img{max-width:100%;background:#172027}video{width:100%;max-height:80vh}table{width:100%;border-collapse:collapse;font-size:15px}td,th{padding:10px;text-align:left;border-bottom:1px solid #dce3e5}th{background:#e9f0f2}a{color:#086579}button{padding:9px 20px;margin-right:10px}small{color:#596970}</style>
<h1>36 秒全场移动：原片与三种增强压力测试</h1><p>2026-10-04 · 本地实验 · E-BARD YOLOv8n + BoT-SORT / ReID + Court48 + 地面特征跟随</p>
<section><b>独立来源只有 1 段，增强版本与原片属于同一个样本组。</b><p>逐帧处理 1080 帧 × 4 条件，模型权重与原视频保持不变，没有训练。跨左右半场的连续移动保留，没有把困难的过场裁掉。原片第 854 帧附近有单帧亮度闪变，已保留。</p><p>球员位置与场线均未做显示平滑；缺矩阵留空。脚部模型按预先固定的 3 Hz 抽样比较，不冒充逐帧脚点。篮球只统计原模型图像候选，不将空中球直接投影为地面位置。</p></section>
<section><video id="player" controls preload="metadata" poster="comparison-poster.jpg"><source src="generalization-comparison.mp4?v=1" type="video/mp4"></video><p><button id="play">播放 / 暂停</button><button id="reload">重新加载</button><span id="status">点击播放；四格同步、原速。</span></p><a href="generalization-comparison.mp4">打开 / 保存对比视频</a></section>
<section><h2>映射覆盖与增强一致性</h2><table><tr><th>条件</th><th>640 单参照</th><th>960 单参照</th><th>960 分段原始候选</th><th>排除接续冲突后</th><th>增强差异 中位 / P95</th></tr>ROWS</table><p><b>这段新视频暴露了尚未解决的中场接续问题，不能凭接近 100% 的候选覆盖宣称泛化验收通过。</b>视频显示 960 输入 + 分段参照实验，使用同一球场模型权重，不改变原人物检测器；重叠坐标不一致的区间，2D 保持留空。</p><p>640 的可用参照偏早，单次 ±20 秒范围还会留下未处理片尾；完整指标单独记录窗口外帧数，不能都归为视觉跟踪失败。960 单参照虽然覆盖高，跨至另一侧球篮后仍有明显漂移。</p><p>分段参照根据至少两个独立时刻的同侧球场证据建立左 / 右 / 左三组参照，参照之间保留约 2 秒重叠区核对坐标。检查要求至少 3 个共同帧，球员同一图像点的两次投影差异中位数 ≤0.75m、P95 ≤1.5m；失败则在边界前后各 1 秒暂不显示 2D。阈值是本轮探索性的接续一致性检查，不是定位精度真值。</p><p>这些是标定处理窗口，不是切镜，不切断原球员跟踪。接续没有插值或平滑，原始各窗口候选均保留。此实验为离线处理，正式工作台默认流程尚未替换。</p><p>增强一致性是在同一原图位置施加已知变换后，比较两次推算的球场坐标；上表差异统计使用原始分段候选，包含后来标为接续冲突的配对帧，避免删除坏结果后美化数字。它不能代替独立地面真值，数字缩放也不等同真实相机的三维运动。</p><p>640 / 960 单参照都按相同规则从每秒扫描结果选择最接近中点的可用帧；分段方案在各窗口内采用相同选择规则。960 与分段方案是本轮看到失败后增加的探索性对照，不作为未见数据上的无偏最终评分。</p><p><a href="reference-handoff-before-after.jpg">查看单参照与分段参照反投影对照</a></p></section>
<section><h2>脚部候选：固定 3 Hz 抽样</h2><table><tr><th>条件</th><th>模型</th><th>抽样帧</th><th>双侧脚部候选 / 已跟踪人物观测</th></tr>POSES</table><p>RTMW 使用脚趾 / 脚跟，YOLOv8s 使用双踝；两者点位定义和输入方式不同。分母包含原检测可能的误检；置信分数没有跨模型校准。此表衡量候选是否输出，不是接地或定位准确率。</p></section>
<section><h2>核验文件</h2><p><a href="summary.json">完整分段指标与失败区间</a> · <a href="manifest.json">增强参数、逐帧变换和来源哈希</a> · <a href="video-verification.json">视频完整解码与哈希</a></p><p>建议复核原片 6–10 秒、21–27 秒的全场移动，检查过中场时坐标是否跳变或漂移。这里的 T 编号不等于已确认的 P 球员身份。</p></section>
<script>const v=document.querySelector('#player'),s=document.querySelector('#status');document.querySelector('#play').onclick=()=>v.paused?v.play().catch(e=>s.textContent=e.message):v.pause();document.querySelector('#reload').onclick=()=>v.load();v.onplaying=()=>s.textContent='正在播放';v.onended=()=>s.textContent='播放结束';v.onerror=()=>s.textContent='加载失败，可重新加载或打开视频文件';</script></html>'''
    (directory/'index.html').write_text(document.replace('ROWS',''.join(rows)).replace('POSES',''.join(pose_rows)), 'utf-8')


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--directory',type=Path,required=True)
    parser.add_argument('--video',type=Path,required=True);parser.add_argument('--rerender',action='store_true');args=parser.parse_args()
    cv2.setNumThreads(4)
    report,manifest,mappings,tracks=summarize(args.directory)
    render(args,manifest,mappings,tracks);webpage(args.directory,report)
    print(json.dumps({k:{a:v[a] for a in ('mappingCoverage','markerCoverage','longestMissingSeconds')} for k,v in report['conditions'].items()}),flush=True)


if __name__=='__main__': main()
