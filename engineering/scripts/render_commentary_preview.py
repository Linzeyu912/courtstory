"""Export commentary-only MP4s and a local synchronized review page."""
from __future__ import annotations

import argparse
from fractions import Fraction
import json
import math
from pathlib import Path
import re

import av
from PIL import Image, ImageDraw, ImageFont

from commentary_video import CommentaryVideo

ROOT = Path(__file__).resolve().parents[2]
FPS = 30
WIDTH, VIDEO_HEIGHT, HEIGHT = 1280, 720, 880


def make_timeline(duration, cues, frame_times):
    pauses = []
    for cue in cues:
        if cue['delivery'] != 'pause':
            continue
        midpoint = (cue['suggestedStartTime'] + cue['suggestedEndTime']) / 2
        candidates = [t for t in frame_times if cue['suggestedStartTime'] <= t <= cue['suggestedEndTime']]
        anchor = min(candidates or frame_times, key=lambda t: abs(t-midpoint))
        reading = max(4, math.ceil(len(re.sub(r'\s', '', cue['text'])) / 4 + 1))
        pauses.append((anchor, reading, cue['cueId']))
    segments, cursor, presentation = [], 0.0, 0.0
    for anchor, reading, cue_id in sorted(pauses):
        if anchor > cursor:
            segments.append(dict(kind='play',sourceStart=cursor,sourceEnd=anchor,previewStart=presentation,previewEnd=presentation+anchor-cursor))
            presentation += anchor-cursor
        segments.append(dict(kind='hold',sourceStart=anchor,sourceEnd=anchor,previewStart=presentation,previewEnd=presentation+reading,cueId=cue_id))
        presentation += reading
        cursor = anchor
    if cursor < duration:
        segments.append(dict(kind='play',sourceStart=cursor,sourceEnd=duration,previewStart=presentation,previewEnd=presentation+duration-cursor))
    return segments


def source_at(segments, time):
    segment = next((s for s in segments if s['previewStart'] <= time < s['previewEnd']), segments[-1])
    source = segment['sourceStart'] if segment['kind'] == 'hold' else min(segment['sourceEnd'], segment['sourceStart']+time-segment['previewStart'])
    return source, segment


def active_cue(cues, source, segment):
    if segment['kind'] == 'hold':
        return next(c for c in cues if c['cueId'] == segment['cueId'])
    return next((c for c in cues if c['delivery'] == 'during_play' and c['suggestedStartTime'] <= source < c['suggestedEndTime']), None)


def wrap_text(text, font, width):
    lines, line = [], ''
    for char in text:
        if line and font.getlength(line+char) > width:
            lines.append(line)
            line = char
        else:
            line += char
    return lines + ([line] if line else [])


def render_clip(video_path, result, output, title, font_path):
    reader = CommentaryVideo(video_path, output.parent / 'frame-cache')
    context = reader.context()
    cues = result['plan']['cues']
    segments = make_timeline(context['duration'], cues, [f['time'] for f in context['frames']])
    duration = segments[-1]['previewEnd']
    fonts = {size: ImageFont.truetype(str(font_path), size) for size in (18, 28, 30)}
    bars = {}
    for cue in [None, *cues]:
        key = cue['cueId'] if cue else None
        bar = Image.new('RGB', (WIDTH, HEIGHT-VIDEO_HEIGHT), '#111820')
        draw = ImageDraw.Draw(bar)
        color = '#ffcb75' if cue and cue['delivery'] == 'pause' else '#d4ef83'
        draw.rectangle((0,0,WIDTH,3), fill=color if cue else '#33404b')
        label = ('暂停讲解 · 定格阅读' if cue['delivery'] == 'pause' else '同步解说') if cue else '观察画面'
        number = f"{cues.index(cue)+1:02d} / {len(cues):02d}" if cue else '--'
        draw.text((32,14),f'{title}   /   {label}   /   {number}',font=fonts[18],fill=color)
        text_value = cue['text'] if cue else '跟随画面，等待下一句解说。'
        lines = wrap_text(text_value, fonts[30], WIDTH-64)
        chosen = fonts[30]
        if len(lines)>2:
            chosen=fonts[28];lines=wrap_text(text_value,chosen,WIDTH-64)
        if len(lines)>2:
            raise ValueError('Commentary is too long for two preview lines')
        for i,line in enumerate(lines):
            draw.text((32,49+i*41),line,font=chosen,fill='#f3f4f1' if cue else '#8e9aa6')
        bars[key]=bar
    count = math.ceil(duration*FPS)
    with av.open(str(video_path)) as src, av.open(str(output),'w',options={'movflags':'+faststart'}) as dst:
        stream = src.streams.video[0]
        stream.thread_type = 'AUTO'
        frames = iter(src.decode(stream))
        following = next(frames, None)
        current_image = None
        codec = dst.add_stream('libx264',rate=FPS)
        codec.width,codec.height,codec.pix_fmt = WIDTH,HEIGHT,'yuv420p'
        codec.options={'preset':'veryfast','crf':'21'}
        origin=context['sourceStartTime']
        for i in range(count):
            time=i/FPS
            source, segment=source_at(segments,time)
            selected=None
            while following is not None and float(following.time)-origin <= source+1e-7:
                selected=following
                following=next(frames,None)
            if selected is not None:
                current_image=selected.to_image().convert('RGB')
                current_image.thumbnail((WIDTH,VIDEO_HEIGHT),Image.Resampling.LANCZOS)
            if current_image is None:
                raise ValueError('Source has no frame at requested start')
            canvas=Image.new('RGB',(WIDTH,HEIGHT),'black')
            canvas.paste(current_image,((WIDTH-current_image.width)//2,(VIDEO_HEIGHT-current_image.height)//2))
            cue=active_cue(cues,source,segment)
            canvas.paste(bars[cue['cueId'] if cue else None],(0,VIDEO_HEIGHT))
            draw=ImageDraw.Draw(canvas)
            label=f'原片 {source:05.2f}s'
            draw.text((WIDTH-32-fonts[18].getlength(label),VIDEO_HEIGHT+14),label,font=fonts[18],fill='#aab7c5')
            if segment['kind']=='hold':
                progress=(time-segment['previewStart'])/(segment['previewEnd']-segment['previewStart'])
                draw.rectangle((32,HEIGHT-9,32+(WIDTH-64)*max(0,min(1,progress)),HEIGHT-6),fill='#ffcb75')
            frame=av.VideoFrame.from_image(canvas)
            frame.pts=i;frame.time_base=Fraction(1,FPS)
            for packet in codec.encode(frame):dst.mux(packet)
        for packet in codec.encode():dst.mux(packet)
    display_cues=[]
    for cue in cues:
        row=dict(cue)
        if cue['delivery']=='pause':
            hold=next(s for s in segments if s.get('cueId')==cue['cueId'])
            row['previewStart'],row['previewEnd']=hold['previewStart'],hold['previewEnd']
            row['holdSourceTime']=hold['sourceStart']
        else:
            def convert(t):
                return t+sum(s['previewEnd']-s['previewStart'] for s in segments if s['kind']=='hold' and s['sourceStart']<=t)
            row['previewStart'],row['previewEnd']=convert(cue['suggestedStartTime']),convert(cue['suggestedEndTime'])
        display_cues.append(row)
    return dict(title=title,video=output.name,poster=output.with_suffix('.jpg').name,sourceDuration=context['duration'],duration=count/FPS,segments=segments,cues=display_cues,summary=result['plan']['summary'],audio='silent_text_preview')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--font',type=Path,default=Path('C:/Windows/Fonts/msyh.ttc'))
    args=parser.parse_args()
    if args.output.exists():parser.error('Choose a new output directory')
    args.output.mkdir(parents=True)
    library=json.loads((ROOT/'data/videos/tactics/acceptance/review-library.json').read_text(encoding='utf-8'))
    clips=[]
    for sample,label in [('001','001 · 右侧突破'),('002','002 · 转移与终结')]:
        entry=next(s for s in library['samples'] if s['id']==f'official-training-{sample}')
        result=json.loads((ROOT/f'research/agents/video-commentary-20261007/astra-official-training-{sample}.json').read_text(encoding='utf-8'))
        target=args.output/f'{sample}-commentary-preview.mp4'
        clip=render_clip(ROOT/entry['video'],result,target,label,args.font)
        clip['id']=sample
        with av.open(str(target)) as video:
            # Poster at the first actual commentary, using the presentation timeline.
            desired=clip['cues'][0]['previewStart']+.4
            for frame in video.decode(video=0):
                if float(frame.time)>=desired:
                    frame.to_image().save(target.with_suffix('.jpg'),quality=92)
                    break
        clips.append(clip)
        print(f"Rendered {sample}: source {clip['sourceDuration']:.2f}s / preview {clip['duration']:.2f}s",flush=True)
    data=json.dumps({'clips':clips},ensure_ascii=False)
    (args.output/'preview.json').write_text(data,encoding='utf-8')
    template=(ROOT/'engineering/tools/commentary-preview/index.html').read_text(encoding='utf-8')
    (args.output/'index.html').write_text(template.replace('/*PREVIEW_DATA*/',data.replace('<','\\u003c')),encoding='utf-8')
    print(args.output.resolve(),flush=True)


if __name__=='__main__':main()
