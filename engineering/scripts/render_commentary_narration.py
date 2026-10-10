"""Render a commentary plan with supplied WAV narration into a finished MP4."""
from __future__ import annotations

import argparse
from fractions import Fraction
import json
import math
from pathlib import Path
import shutil
import subprocess
import tempfile

import av
from PIL import Image, ImageDraw, ImageFont

from commentary_video import CommentaryVideo
from commentary_fonts import resolve_font

FPS = 30


def build_timeline(duration, cues, audio_rows, frame_times, margin=0.25):
    """Build source-to-output segments and place complete narration clips."""
    audio = {row['cueId']: row for row in audio_rows}
    events = []
    for cue in cues:
        if cue['cueId'] not in audio:
            raise ValueError(f"Missing audio for cue {cue['cueId']}")
        start, end = float(cue['suggestedStartTime']), float(cue['suggestedEndTime'])
        if not 0 <= start <= end <= duration:
            raise ValueError(f"Cue {cue['cueId']} has an invalid source window")
        length = float(audio[cue['cueId']]['durationSeconds'])
        if length <= 0:
            raise ValueError(f"Cue {cue['cueId']} has no audio duration")
        if cue['delivery'] == 'pause':
            midpoint = (start + end) / 2
            anchor = min((t for t in frame_times if start <= t <= end), key=lambda t: abs(t-midpoint), default=midpoint)
            events.append((anchor, cue, length, 'hold', 1.0))
        elif cue['delivery'] == 'during_play':
            window = end-start
            speed = max(1.0, length/window) if window > 0 else float('inf')
            mode = 'play' if speed <= 1.2 else 'hold'
            if mode == 'play':
                events.append((start, cue, window, mode, speed))
            else:
                midpoint = (start+end)/2
                anchor = min((t for t in frame_times if start <= t <= end), key=lambda t: abs(t-midpoint), default=midpoint)
                events.append((anchor, cue, length, mode, 1.0))
        else:
            raise ValueError(f"Unknown delivery for cue {cue['cueId']}")

    # Allocate speech windows in source order. A cue that collides with an earlier
    # reserved interval is moved to a hold at its anchor, preserving all speech.
    events.sort(key=lambda x: (x[0], str(x[1]['cueId'])))
    reserved_end = -1.0
    for i, (anchor, cue, length, mode, speed) in enumerate(events):
        span = length
        if mode == 'play' and anchor < reserved_end:
            mode = 'hold'
            speed = 1.0
        if mode == 'hold':
            speech_length = float(audio[cue['cueId']]['durationSeconds'])
            duration_hold = speech_length + 2*margin
            reserved_end = max(reserved_end, anchor)
            events[i] = (anchor, cue, duration_hold, mode, speed)
        else:
            reserved_end = max(reserved_end, anchor + span)
            events[i] = (anchor, cue, span, mode, speed)

    segments, placements = [], []
    source, output = 0.0, 0.0
    for anchor, cue, span, mode, speed in events:
        anchor = max(source, min(duration, anchor))
        if anchor > source:
            segment = dict(kind='play', sourceStart=source, sourceEnd=anchor,
                            previewStart=output, previewEnd=output+anchor-source)
            segments.append(segment); output = segment['previewEnd']
        if mode == 'hold':
            segment = dict(kind='hold', sourceStart=anchor, sourceEnd=anchor,
                           previewStart=output, previewEnd=output+span, cueId=cue['cueId'],
                           fallback=(cue['delivery'] == 'during_play'))
            placements.append(dict(cueId=cue['cueId'], previewStart=output+margin,
                                   previewEnd=output+margin+float(audio[cue['cueId']]['durationSeconds']),
                                   speed=1.0, fallback=segment['fallback']))
            segments.append(segment); output = segment['previewEnd']
        else:
            source_end = min(duration, anchor+span)
            speech_duration = float(audio[cue['cueId']]['durationSeconds'])/speed
            segment = dict(kind='play', sourceStart=anchor, sourceEnd=source_end,
                           previewStart=output, previewEnd=output+source_end-anchor,
                           cueId=cue['cueId'], speed=speed)
            placements.append(dict(cueId=cue['cueId'], previewStart=output,
                                   previewEnd=output+speech_duration, speed=speed, fallback=False))
            segments.append(segment); output = segment['previewEnd']
            anchor = source_end
        source = max(source, anchor)
    if source < duration:
        segments.append(dict(kind='play', sourceStart=source, sourceEnd=duration,
                             previewStart=output, previewEnd=output+duration-source))
    return segments, placements


def source_at(segments, time):
    seg = next((s for s in segments if s['previewStart'] <= time < s['previewEnd']), segments[-1])
    if seg['kind'] == 'hold':
        return seg['sourceStart'], seg
    return min(seg['sourceEnd'], seg['sourceStart'] + time-seg['previewStart']), seg


def wav_duration(path):
    with av.open(str(path)) as audio:
        if not audio.streams.audio:
            raise ValueError(f'No audio stream in {path}')
        stream = audio.streams.audio[0]
        if stream.duration is not None and stream.time_base is not None:
            return float(stream.duration * stream.time_base)
        if audio.duration is not None:
            return float(audio.duration / av.time_base)
        raise ValueError(f'Could not determine WAV duration: {path}')


def convert_cues(cues, segments, placements):
    by_id = {p['cueId']: p for p in placements}
    rows = []
    for cue in cues:
        row = dict(cue)
        p = by_id[cue['cueId']]
        row.update(previewStart=p['previewStart'], previewEnd=p['previewEnd'],
                   narrationSpeed=p['speed'], convertedToHold=p['fallback'])
        hold = next((s for s in segments if s['kind'] == 'hold' and (s.get('cueId') == cue['cueId'] or cue['cueId'] in s.get('cueIds',[]))), None)
        if hold:
            row['holdSourceTime'] = hold['sourceStart']
        else:
            row.pop('holdSourceTime', None)
        rows.append(row)
    return rows


def subtitle_overlays(cues, placements, width, height, font_path, *, layout='top'):
    """Same saved cue text and safe subtitle layout for both render paths."""
    if layout not in ('top','bottom'): raise ValueError('Unknown subtitle layout')
    bottom = layout == 'bottom'
    font_size = max(16, round(width*.0145)) if bottom else max(24, width//48)
    subtitle_images = {}
    cue_by_id = {c['cueId']: c for c in cues}
    for placement in placements:
        cue_id = placement['cueId']
        if cue_id in subtitle_images:
            continue
        cue = cue_by_id[cue_id]
        band_h = max(100, height//8)
        max_text_width = width*.78-32 if bottom else width-80
        text = cue['text']
        chosen = None
        for size in range(font_size, 15, -2):
            candidate = ImageFont.truetype(str(font_path), size)
            measure = ImageDraw.Draw(Image.new('RGB', (1, 1)))
            lines, line = [], ''
            for ch in text:
                if line and measure.textlength(line+ch, font=candidate) > max_text_width:
                    lines.append(line); line = ch
                else:
                    line += ch
            if line: lines.append(line)
            if len(lines) <= 2 and len(lines)*(size+8)+28 <= band_h:
                chosen = (candidate, lines)
                break
        if chosen is None:
            raise ValueError(f"Cue {cue_id} text does not fit the safe subtitle band")
        font, lines = chosen
        if bottom: band_h = min(height, round(len(lines)*(font.size*1.65)+16))
        overlay = Image.new('RGBA', (width, band_h), (0, 0, 0, 0 if bottom else 170))
        draw = ImageDraw.Draw(overlay)
        if bottom:
            draw.rounded_rectangle((round(width*.11),0,round(width*.89),band_h-1),radius=6,fill=(0,0,0,75))
        for n, value in enumerate(lines):
            if bottom:
                x=(width-draw.textlength(value,font=font))/2
                draw.text((x,8+n*font.size*1.65),value,font=font,fill='white',stroke_width=1,stroke_fill=(0,0,0,180))
            else:
                draw.text((40, 14+n*(font.size+8)), value, font=font, fill='white')
        subtitle_images[cue_id] = overlay
    return subtitle_images


def render_video(video_path, output, cues, segments, placements, duration, font_path, cache_dir):
    helper = CommentaryVideo(video_path, cache_dir)
    context = helper.context()
    width, height = context['width'], context['height']
    subtitle_images = subtitle_overlays(cues, placements, width, height, font_path)
    frame_count = math.ceil(duration*FPS)
    with av.open(str(video_path)) as src, av.open(str(output), 'w', options={'movflags': '+faststart'}) as dst:
        stream = src.streams.video[0]; stream.thread_type = 'AUTO'
        frames = iter(src.decode(stream)); following = next(frames, None); current = None
        codec = dst.add_stream('libx264', rate=FPS)
        codec.width, codec.height, codec.pix_fmt = width, height, 'yuv420p'
        codec.options = {'preset': 'veryfast', 'crf': '18'}
        origin = context['sourceStartTime']
        for i in range(frame_count):
            t = i/FPS
            source_time, segment = source_at(segments, t)
            selected = None
            while following is not None and float(following.time)-origin <= source_time+1e-7:
                selected = following; following = next(frames, None)
            if selected is not None:
                current = selected.to_image().convert('RGB')
            if current is None: raise ValueError('Video has no frame at requested time')
            canvas = current.copy()
            active = next((p for p in placements if p['previewStart'] <= t < p['previewEnd']), None)
            if active:
                overlay = subtitle_images[active['cueId']]
                canvas.paste(overlay, (0, 0), overlay)
            frame = av.VideoFrame.from_image(canvas)
            frame.pts = i; frame.time_base = Fraction(1, FPS)
            for packet in codec.encode(frame): dst.mux(packet)
        for packet in codec.encode(): dst.mux(packet)


def mux_audio(video, output, source, manifest_rows, placements, segments, duration, source_start_time, ffmpeg):
    with av.open(str(source)) as src_info:
        has_source_audio = bool(src_info.streams.audio)
    filters, inputs = [], []
    for i, seg in enumerate(segments):
        if seg['kind'] == 'hold':
            filters.append(f"anullsrc=r=48000:cl=stereo:d={seg['previewEnd']-seg['previewStart']:.6f}[base{i}]")
        else:
            ss = source_start_time+seg['sourceStart']; se = source_start_time+seg['sourceEnd']
            if has_source_audio:
                span=seg['previewEnd']-seg['previewStart']
                filters.append(f"[0:a:0]atrim=start={ss:.6f}:end={se:.6f},asetpts=PTS-STARTPTS,apad,atrim=duration={span:.6f},volume=0.12,aresample=48000,aformat=channel_layouts=stereo[base{i}]")
            else:
                filters.append(f"anullsrc=r=48000:cl=stereo:d={seg['previewEnd']-seg['previewStart']:.6f}[base{i}]")
    if segments:
        labels=''.join(f'[base{i}]' for i in range(len(segments)))
        filters.append(f"{labels}concat=n={len(segments)}:v=0:a=1[base]")
    else: filters.append(f"anullsrc=r=48000:cl=stereo:d={duration}[base]")
    rows={r['cueId']:r for r in manifest_rows}; voice_labels=[]
    for i, place in enumerate(placements):
        row=rows[place['cueId']]; path=Path(row['_absolute'])
        inputs += ['-i', str(path)]
        speed=place['speed']; filt=f'[{i+1}:a:0]aresample=48000,aformat=channel_layouts=stereo'
        if speed>1.0001: filt+=f',atempo={speed:.6f}'
        delay=round(place['previewStart']*1000)
        filt+=f',adelay={delay}|{delay}[voice{i}]'
        filters.append(filt); voice_labels.append(f'[voice{i}]')
    mix='[base]'+''.join(voice_labels)+f'amix=inputs={1+len(voice_labels)}:duration=first:normalize=0,alimiter=limit=0.95[aout]'
    filters.append(mix)
    video_index=len(inputs)//2+1
    cmd=[ffmpeg,'-hide_banner','-loglevel','error','-y','-copyts','-i',str(source),*inputs,'-i',str(video),
         '-filter_complex',';'.join(filters),'-map',f'{video_index}:v:0','-map','[aout]',
         '-c:v','copy','-c:a','aac','-b:a','192k','-t',f'{duration:.6f}','-movflags','+faststart',str(output)]
    subprocess.run(cmd, check=True)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--video',type=Path,required=True)
    parser.add_argument('--plan',type=Path,required=True)
    parser.add_argument('--audio-manifest',type=Path,required=True)
    parser.add_argument('--document',type=Path,help='Saved native tactical document and optional name overlay for joint rendering')
    parser.add_argument('--output',type=Path,required=True,help='New output directory')
    parser.add_argument('--font',type=Path,help='CJK font; automatically selects the installed system font')
    args=parser.parse_args()
    if args.output.exists(): parser.error('Choose a new output directory')
    plan=json.loads(args.plan.read_text(encoding='utf-8'))
    plan=plan.get('plan',plan); cues=plan['cues']
    has_shots=any(n.get('kind')=='shot_release' for n in plan.get('nodes',[])) or any(
        e.get('kind')=='shot' and e.get('shotStatus')=='confirmed' for e in plan.get('events',[]))
    if has_shots and not args.document:
        parser.error('shot_release requires --document with the adopted shooter spotlight and feedback')
    try: args.font = resolve_font(args.font)
    except ValueError as exc: parser.error(str(exc))
    from tactics_render import discover_ffmpeg
    ffmpeg=discover_ffmpeg()
    if not ffmpeg: parser.error('ffmpeg is required')
    args.output.mkdir(parents=True)
    manifest=json.loads(args.audio_manifest.read_text(encoding='utf-8'))
    rows=manifest['cues']; root=args.audio_manifest.resolve().parent
    for row in rows:
        row['_absolute']=str((root/row['path']).resolve())
        if not Path(row['_absolute']).is_file(): raise ValueError(f"Missing WAV: {row['path']}")
        row['durationSeconds'] = wav_duration(row['_absolute'])
    with tempfile.TemporaryDirectory(dir=args.output) as tmp:
        helper=CommentaryVideo(args.video,Path(tmp)/'index-cache')
        ctx=helper.context()
        silent=Path(tmp)/'silent.mp4'
        if args.document:
            from commentary_joint_render import render_joint
            composition=render_joint(args.video,silent,args.document,plan,rows,ctx,cues,args.font,Path(tmp)/'joint')
            segments,placements,duration=composition['segments'],composition['placements'],composition['duration']
            (args.output/'composition.json').write_text(json.dumps(composition,ensure_ascii=False,indent=2),encoding='utf-8')
        else:
            segments,placements=build_timeline(ctx['duration'],cues,rows,[f['time'] for f in ctx['frames']])
            duration=segments[-1]['previewEnd'] if segments else ctx['duration']
            render_video(args.video,silent,cues,segments,placements,duration,args.font,Path(tmp)/'frames')
        mux_audio(silent,args.output/'commentary-final.mp4',args.video,rows,placements,segments,duration,ctx['sourceStartTime'],ffmpeg)
    rows_out=convert_cues(cues,segments,placements)
    with (args.output/'commentary.srt').open('w',encoding='utf-8-sig') as f:
        for i,c in enumerate(rows_out,1):
            start=max(0,c['previewStart']); end=max(start,c['previewEnd'])
            stamp=lambda t:f"{int(t//3600):02d}:{int(t%3600//60):02d}:{int(t%60):02d},{int((t%1)*1000):03d}"
            f.write(f"{i}\n{stamp(start)} --> {stamp(end)}\n{c['text']}\n\n")
    data=dict(sourceVideo=str(args.video),sourceDuration=ctx['duration'],duration=duration,
              video='commentary-final.mp4',subtitles='commentary.srt',segments=segments,cues=rows_out)
    if args.document:
        data.update(composition='composition.json',timing='measured_audio',commentaryPlanRef=composition['commentaryPlanRef'],sourceRef=composition['sourceRef'])
    (args.output/'timeline.json').write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')
    print(args.output.resolve())


if __name__=='__main__': main()
