"""Build a local, listenable comparison from saved results (no network calls)."""
import html
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).parent
OUTPUT = ROOT / 'tmp/commentary-personality-20261009'


def player(name, voice, label):
    folder = OUTPUT / f'{name}-{voice}-render'
    source = folder / 'commentary-final.mp4'
    preview = folder / 'preview.webm'
    poster = folder / 'poster.jpg'
    if not preview.exists():
        subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', str(source),
                        '-vf', 'scale=-2:720', '-c:v', 'libvpx-vp9', '-crf', '33', '-b:v', '0',
                        '-deadline', 'realtime', '-cpu-used', '6', '-row-mt', '1',
                        '-c:a', 'libopus', '-b:a', '96k', str(preview)], check=True)
    if not poster.exists():
        subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-ss', '0.2', '-i', str(source),
                        '-frames:v', '1', '-update', '1', str(poster)], check=True)
    relative = folder.name
    return (f'<div><h3>{label}</h3><video controls playsinline preload="auto" '
            f'poster="{relative}/poster.jpg" src="{relative}/preview.webm" aria-label="{name} {label}"></video>'
            f'<p><button type="button" class="play">播放 / 暂停</button> '
            f'<a href="{relative}/commentary-final.mp4" target="_blank">打开原清晰度 MP4</a></p></div>')


def main():
    sections = []
    for name, title in [('third', '湖人 / 森林狼 · 新视频'), ('001', '训练样片 001'), ('002', '训练样片 002')]:
        result = json.loads((HERE / f'{name}-final/result.json').read_text(encoding='utf-8'))
        rows = ''.join(f'<tr><td>{html.escape(a["text"])}</td><td>{html.escape(b["text"])}</td></tr>'
                       for a, b in zip(result['originalPlan']['cues'], result['plan']['cues']))
        videos = player(name, 'natural', '自然有趣口吻')
        if name == '001':
            videos += player(name, 'classic', '相同文字 · 原专业口吻')
        sections.append(f'<section><h2>{title}</h2><div class="videos">{videos}</div><table><thead><tr><th>原稿</th><th>Astra 润色</th></tr></thead><tbody>{rows}</tbody></table></section>')
    artificial = json.loads((HERE / 'synthetic-culture/result.json').read_text(encoding='utf-8'))
    quotes = ''.join(f'<li>{html.escape(c["text"])}</li>' for c in artificial['plan']['cues'])
    page = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>解说润色 · 试听对照</title>
<style>body{font:17px/1.7 system-ui,sans-serif;background:#f5f4f0;color:#18232c;max-width:1180px;margin:40px auto;padding:0 24px}h1{font-size:34px}h2{font-size:25px}h3{font-size:17px}section{background:white;padding:24px;margin:28px 0;border-radius:12px}.videos{display:flex;gap:20px;flex-wrap:wrap}.videos>div{flex:1;min-width:300px}video{width:100%;border-radius:8px}table{width:100%;border-collapse:collapse;margin-top:24px}th,td{text-align:left;vertical-align:top;padding:12px;border-bottom:1px solid #dde1df;width:50%}.note{color:#586570}audio{width:100%}</style>
<h1>让解说更像在看球的人</h1><p>OpenRouter Astra 真实调用 · 2026-10-09</p><p class="note">三段真实视频、四个配音成片。001 两个版本文字相同，只改变配音口吻。请分别播放，避免声音重叠。幽默偏好与口吻效果仍需人工试听判断。</p>'''
    page += ''.join(sections)
    page += f'<section><h2>NBA 梗应用 · 虚构场景测试</h2><p class="note">以下是人为设定的独立场景，不是真实比赛记录，也未混入上方成片。</p><ul>{quotes}</ul></section>'
    page += '''<section><h2>中英混说 · 独立试音</h2><p>Oh my god！这球都能追回来！</p><audio controls src="mixed-voice-audio/cue-01.wav"></audio><p class="note">此句由人工提供，仅验证配音，不属于视频事实或 Astra 输出。</p></section>
<style>video{display:block;aspect-ratio:16/9;background:#101820;max-height:65vh;object-fit:contain}.videos>div{min-width:0;flex-basis:360px}button{padding:8px 16px;border:0;border-radius:6px;background:#194e64;color:white;cursor:pointer}a{color:#194e64}@media(max-width:650px){body{margin:16px auto;padding:0 12px;font-size:15px}section{padding:14px;margin:18px 0}h1{font-size:26px}h2{font-size:21px}}</style>
<script>document.querySelectorAll('.play').forEach(button=>{const video=button.parentElement.previousElementSibling;button.onclick=()=>{if(video.paused){video.play().catch(error=>{button.textContent='播放失败，请打开 MP4：'+error.message})}else video.pause()}});document.querySelectorAll('video,audio').forEach(media=>media.addEventListener('play',()=>document.querySelectorAll('video,audio').forEach(other=>{if(other!==media)other.pause()})));</script></html>'''
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT / 'index.html').write_text(page, encoding='utf-8')
    print(OUTPUT / 'index.html')


if __name__ == '__main__':
    main()
