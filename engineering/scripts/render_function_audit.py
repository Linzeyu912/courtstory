"""Render read-only functional audit evidence from audit_workbench_pipeline.mjs."""
import argparse
from fractions import Fraction
import json
from html import escape
import shutil
from pathlib import Path

import av
import cv2
import numpy as np


def project(h, p):
    if h is None:
        return None
    q = np.asarray(h).reshape(3, 3) @ [*p, 1]
    if abs(q[2]) < 1e-9:
        return None
    v = q[:2] / q[2]
    return v if np.isfinite(v).all() else None


def text(image, message, x, y, color=(225, 230, 238), size=.55):
    cv2.putText(image, message, (x, y), cv2.FONT_HERSHEY_SIMPLEX, size, color, 1, cv2.LINE_AA)


def finite(p):
    return p is not None and p.get('x') is not None and p.get('y') is not None


def miniature(image, markings, points, x, y, title):
    text(image, title, x, y-10)
    width, height = 438, 233
    cv2.rectangle(image, (x, y), (x+width, y+height), (40, 49, 57), -1)
    convert = lambda p: (round(x+p[0]/28.6512*width), round(y+p[1]/15.24*height))
    for line in markings:
        cv2.polylines(image, [np.array([convert(p) for p in line['points']], np.int32)], False, (100, 117, 130), 1, cv2.LINE_AA)
    for p, color, label in points:
        if p is None or not (0 <= p[0] <= 28.6512 and 0 <= p[1] <= 15.24):
            continue
        position = convert(p)
        cv2.circle(image, position, 4, color, -1, cv2.LINE_AA)
        if label:
            text(image, label, position[0]+5, position[1]-3, color, .35)


def render(data, row, source, name):
    image = np.full((740, 1440, 3), (24, 29, 35), np.uint8)
    h, w = source.shape[:2]
    scale = min(950/w, 560/h)
    vw, vh = round(w*scale), round(h*scale)
    image[62:62+vh, 16:16+vw] = cv2.resize(source, (vw, vh))
    pos = lambda x, y: (round(16+x*scale), round(62+y*scale))
    text(image, f'{name}  |  frame {row["frame"]}  |  {row["time"]:.2f}s', 18, 30, size=.7)
    for t in row['tracks']:
        cv2.rectangle(image, pos(t[0], t[1]), pos(t[2], t[3]), (90, 140, 100), 1)
        cv2.circle(image, pos((t[0]+t[2])/2, t[3]), 3, (50, 220, 245), -1)
    visible = [p for p in row['players'] if p['visible']]
    for p in visible:
        a = p['image']; xy = pos(a['x'], a['y'])
        cv2.circle(image, xy, 7, (245, 230, 60), 2, cv2.LINE_AA)
        text(image, p['id'], xy[0]+8, xy[1], (245, 230, 60), .42)
    ball = row['ball']
    if finite(ball):
        cv2.circle(image, pos(ball['x'], ball['y']), 9, (25, 120, 255), 2, cv2.LINE_AA)
    # Full-court experiment remains visually separate from the browser mapping.
    overlay_h = row['offlineCourtToImage']
    if overlay_h:
        for line in data['markings']:
            if line['id'] not in ['midline', 'far_sideline', 'left_key', 'right_key']:
                continue
            for a, b in zip(line['points'], line['points'][1:]):
                qa, qb = project(overlay_h, a), project(overlay_h, b)
                if qa is None or qb is None or max(abs(np.concatenate([qa, qb]))) > 1e6:
                    continue
                okay, aa, bb = cv2.clipLine((16, 62, vw, vh), pos(*qa), pos(*qb))
                if okay:
                    cv2.line(image, aa, bb, (240, 185, 80), 1, cv2.LINE_AA)
    native = [([p['court']['x'], p['court']['y']], (245, 230, 60), p['id']) for p in visible if finite(p['court'])]
    miniature(image, data['markings'], native, 984, 82, 'Workbench preview: bound P identities')
    if row['offlineImageToCourt']:
        offline = [(project(row['offlineImageToCourt'], [(t[0]+t[2])/2, t[3]]), (50, 220, 245), '') for t in row['tracks']]
        miniature(image, data['markings'], offline, 984, 390, 'Offline joint map: anonymous detections')
    else:
        raw = [(project(row['nativeImageToCourt'], [(t[0]+t[2])/2, t[3]]), (50, 220, 245), '') for t in row['tracks']]
        miniature(image, data['markings'], raw, 984, 390, 'Same map: all raw person detections')
    text(image, 'Yellow = box-bottom proposal; cyan ring = automatically bound P; orange = observed ball', 18, 646, size=.53)
    text(image, f'Person boxes: {len(row["tracks"])} | Visible P: {len(visible)} | Ball: {"observed" if finite(ball) else "missing (not filled)"}', 18, 676, size=.6)
    text(image, f'Browser matrix: {"available" if row["nativeImageToCourt"] else "MISSING"} | Foot contact / identity / metric accuracy: UNVERIFIED', 18, 707, size=.54)
    return image


def write_report(metrics, output):
    summary = json.loads((metrics/'summary.json').read_text(encoding='utf8'))
    selected = [c for c in summary['cases'] if c['id'] in ['004-team-stable', '005-team-stable', '006-team-stable', 'fullcourt-optimized']]
    rows, cards = [], []
    for case in selected:
        pct = lambda value: f'{value["percent"]:.2f}%'
        name = case['id']; person = case['person']
        rows.append(f'<tr><td>{escape(name)}</td><td>{case["frames"]}</td><td>{pct(case["ball"]["observations"])}</td><td>{person["visiblePerFrame"]["median"]} / {person["rawPerFrame"]["median"]}</td><td>{pct(case["court"]["usableMatrices"])}</td><td>{pct(case["mapping"]["framesWithAnyInBoundsPlayer"])}</td></tr>')
        gap = case['mapping']['longestNoInBoundsPlayer']
        gap_text = '无整帧全部丢点' if not gap else f'最长全部丢点：第 {gap[0]["start"]+1}–{gap[0]["end"]+1} 帧，{gap[0]["frames"]} 帧。'
        cards.append(f'''<article><h2>{escape(name)}</h2><p>{gap_text} 右上为自动 P 身份映射；右下为全部检测框脚点。
        全场视频右下使用独立的联合标定，尚未接入默认工作台。</p>
        <div class="report-player" data-report-player data-poster="media/{name}.poster.jpg">
          <canvas data-part="canvas" width="1440" height="740" role="img" aria-label="{name} 视频画面"></canvas>
          <video class="decoder" data-part="video" data-report-decoder playsinline preload="auto" src="media/{name}.mp4"></video>
          <div class="player-controls"><button data-part="toggle" aria-label="播放或暂停 {name}">播放</button>
          <input data-part="seek" type="range" min="0" max="1" step="0.01" value="0" aria-label="{name} 播放进度">
          <output data-part="clock"></output><select data-part="rate" aria-label="{name} 播放速度"><option value="0.25">0.25 倍</option><option value="0.5">0.5 倍</option><option selected value="1">原速</option><option value="1.5">1.5 倍</option><option value="2">2 倍</option></select>
          <button data-part="fullscreen">全屏</button><button data-part="restart">重新加载</button></div>
          <p data-part="status" role="status">正在载入视频画面…</p>
          <a href="media/{name}.mp4" target="_blank" rel="noopener">单独打开 MP4</a> · <a href="media/{name}.mp4" download>保存到本机</a>
        </div>
        <p class="legend">黄点：框底候选位置 · 青环：自动绑定的 P · 橙环：篮球观测。没有球或没有身份时保持空缺。</p>
        <details><summary>查看 8 个均匀采样画面</summary><img loading="lazy" src="media/{name}-contact.jpg" alt="{name} 抽帧检查"></details></article>''')
    html = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <title>篮球工作台 · 逐项功能复检</title><style>
    *{box-sizing:border-box}body{margin:0;background:#f3f5f6;color:#17282d;font:16px/1.7 system-ui,"Microsoft YaHei",sans-serif}
    main{max-width:1280px;margin:40px auto;padding:0 28px}header{padding:34px;border-radius:20px;background:#153b41;color:#f6f8f5}
    h1{font-size:32px;margin:8px 0}h2{font-size:23px;margin:0 0 14px}header p{max-width:900px;margin:12px 0}
    .tag{font-size:13px;letter-spacing:2px;color:#a9d9d2}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:15px;margin:22px 0}
    .grid section,article,.table{background:white;border:1px solid #dae3e2;border-radius:14px;padding:22px}.grid b{display:block;color:#975318}
    article{margin:22px 0}p{margin:8px 0 16px}.legend,small{font-size:14px;color:#546a6b}table{border-collapse:collapse;width:100%;font-size:15px}
    td,th{padding:12px;text-align:left;border-bottom:1px solid #dce4e3}th{background:#edf3f2}video,img{width:100%;border-radius:9px;background:#1d2428}
    .report-player{position:relative;background:#111e24;color:#edf4f5;border-radius:10px;padding:12px}.report-player canvas{display:block;width:100%;max-height:65vh;object-fit:contain;aspect-ratio:1440/740;background:#152127;cursor:pointer}
    .report-player .decoder{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}.player-controls{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding-top:12px}
    .player-controls input{flex:1;min-width:160px;accent-color:#53ccb7}.player-controls button,.player-controls select{padding:9px 14px;border:0;border-radius:6px;cursor:pointer}.player-controls output{font-variant-numeric:tabular-nums;font-size:14px}.report-player a{color:#8fe2d8}.report-player p{margin:8px 0;font-size:14px}
    .report-player:fullscreen{display:flex;flex-direction:column;justify-content:center}.report-player:fullscreen canvas{max-height:82vh}.report-player:fullscreen .player-controls{flex:none}
    summary{cursor:pointer;margin:12px 0}a{color:#006b72}.notice{padding:18px 22px;border-left:5px solid #ad7536;background:#fff3df;border-radius:5px;margin:22px 0}
    @media(max-width:800px){.grid{grid-template-columns:1fr 1fr}.table{overflow-x:auto}main{padding:0 14px}h1{font-size:26px}}
    </style><main><header><div class="tag">FUNCTION AUDIT / 2026-10-04 / 本机验收</div><h1>四项已逐一复检，联合功能尚未通过验收</h1>
    <p>3 段半场样例 + 1 段全场移动视频，共 1,895 帧。保留原 YOLOv8n，分别核查篮球观测、人物身份、脚下候选、球场矩阵及 2D 派生数据。</p></header>
    <div class="grid"><section><h2>01 篮球</h2><b>数据通路已修复</b><p>默认导入原先仅输出人物。现在另存同视频篮球与篮筐参照；人物数据不变。检出率与真实可见球召回率仍需区分。</p></section>
    <section><h2>02 人物 / 脚点</h2><b>连续身份未通过</b><p>006 与全场视频越到后段，绑定的 P 越少。六种脚部模型接口通过，但仅对匹配的跟踪版本有效，接地精度未验收。</p></section>
    <section><h2>03 球场标定</h2><b>半场可用，全场待接入</b><p>半场矩阵覆盖 99.78%–100%。全场联合实验 99.17%，尚未接入默认后端；矩阵存在不等于位置准确。</p></section>
    <section><h2>04 映射到 2D</h2><b>全场未达到 90%</b><p>采用现有候选并初始化自动身份后，全场有场内 P 点仅 72.78%。缺身份与错误映射需分别解决。</p></section></div>
    <div class="notice">这里的“有点帧比例”只表示至少一个有效点，不代表十名球员完整，更不代表坐标准确。所有统计均保留缺失帧，没有用插值凑覆盖率。</div>
    <div class="table"><h2>相同验收口径</h2><p>使用真实工作台算法，在内存中采用已有机器标定候选；未更改用户草稿。P 身份仍未人工确认。</p>
    <table><thead><tr><th>视频 / 版本</th><th>帧数</th><th>篮球有观测帧</th><th>P 数 / 检测人数中位数</th><th>矩阵可用帧</th><th>2D 至少一个场内 P</th></tr></thead><tbody>'''+''.join(rows)+'''</tbody></table>
    <p class="legend">篮球遮挡、出画与漏检都可能形成无观测帧。检测人数可能含误检；无独立逐帧真值，不能把这些数值称作准确率。</p></div>
    <article><h2>已修复及仍待解决</h2><p>修复了默认人物版本漏接篮球 / 篮筐，以及换帧、撤销后持球下拉框残留旧选择。005 新导入前后人物原始文件完全一致，篮球观测从 0 恢复到 76 / 143 帧。</p>
    <p>全场缺口分为：150 帧无可显示 P 身份、29 帧有 P 但无矩阵、115 帧已有 P 全在场外。仅换用离线联合矩阵，保留现有 P 身份时也只有 85.28% 帧有场内点。</p>
    <p>接下来按顺序处理：全场标定接入与独立精度复核 → T 到 P 的连续身份 → 同一身份下的脚点验证 → 2D 联合验收。空中篮球的真实地面投影仍未知；持球圆环只表示关联。</p>
    <p><a href="metrics/summary.json">逐帧统计摘要 JSON</a> · <a href="reproduction.json">修复前后实测与来源指纹</a> · <a href="media/render-validation.json">视频解码验证</a></p></article>'''+''.join(cards)+'''<p class="legend">视频为独立核验渲染，未修改原片、原轨迹或人工标注。黄点与青环不是同一口径；全场右下保留匿名检测，不冒充已连续认回的球员身份。</p></main></html>'''
    html=html.replace('</html>','<script type="module" src="report-player.mjs?v=canvas-1"></script></html>')
    shutil.copyfile(Path(__file__).parents[1]/'tools/report-player/player.mjs',output.parent/'report-player.mjs')
    (output.parent/'index.html').write_text(html, encoding='utf8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--metrics', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    evidence = []
    for name in ['004-team-stable', '005-team-stable', '006-team-stable', 'fullcourt-optimized']:
        data = json.loads((args.metrics / f'{name}-frames.json').read_text(encoding='utf8'))
        rows = data['frames']; snapshots = set(round(i*(len(rows)-1)/7) for i in range(8)); images = []
        destination = args.output / f'{name}.mp4'
        with av.open(data['video']) as source, av.open(str(destination), 'w', options={'movflags': '+faststart'}) as output:
            stream = output.add_stream('libx264', rate=source.streams.video[0].average_rate)
            stream.width, stream.height, stream.pix_fmt = 1440, 740, 'yuv420p'
            stream.options = {'crf': '22', 'preset': 'fast'}
            stream.time_base = Fraction(1, 90000)
            count = 0
            for i, frame in enumerate(source.decode(video=0)):
                image = render(data, rows[i], frame.to_ndarray(format='bgr24'), name)
                if i == 0:
                    cv2.imwrite(str(destination.with_suffix('.poster.jpg')), image)
                if i in snapshots:
                    images.append(cv2.resize(image, (720, 370)))
                    if name == 'fullcourt-optimized':
                        cv2.imwrite(str(args.output/f'fullcourt-frame-{i}.jpg'), image)
                encoded = av.VideoFrame.from_ndarray(image, format='bgr24')
                encoded.pts = round(rows[i]['time']*90000); encoded.time_base = Fraction(1, 90000)
                for packet in stream.encode(encoded):
                    output.mux(packet)
                count += 1
            for packet in stream.encode():
                output.mux(packet)
        assert count == len(rows)
        cv2.imwrite(str(args.output/f'{name}-contact.jpg'), np.vstack([np.hstack(images[i:i+2]) for i in range(0, 8, 2)]))
        with av.open(str(destination)) as check:
            actual = sum(1 for _ in check.decode(video=0))
        assert actual == count
        evidence.append({'name': name, 'frames': count, 'decodedFrames': actual, 'video': str(destination), 'rawVideoChanged': False})
        print(json.dumps(evidence[-1]), flush=True)
    (args.output/'render-validation.json').write_text(json.dumps(evidence, indent=2), encoding='utf8')
    write_report(args.metrics, args.output)


if __name__ == '__main__':
    main()
