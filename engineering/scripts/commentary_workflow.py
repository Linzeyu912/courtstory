"""Run video understanding, Amazon Polly narration, and subtitled MP4 rendering."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess
import sys

from commentary_tts import ROOT, STYLE, credentials, synthesize_plan, voice_settings
from commentary_fonts import resolve_font


def write_preview(output, render, plan, title):
    import av
    timeline = json.loads((render/'timeline.json').read_text(encoding='utf-8'))
    result = json.loads(Path(plan).read_text(encoding='utf-8'))
    timeline.update(id=title, title=title, audio='amazon_polly',
                    summary=result.get('plan', result).get('summary', ''),
                    video=(render/'commentary-final.mp4').relative_to(output).as_posix(),
                    poster='poster.jpg')
    for cue in timeline['cues']:
        hold = next((s for s in timeline['segments'] if s['kind']=='hold' and (s.get('cueId')==cue['cueId'] or cue['cueId'] in s.get('cueIds',[]))), None)
        if hold:
            cue['holdDuration'] = hold['previewEnd']-hold['previewStart']
    with av.open(str(render/'commentary-final.mp4')) as video:
        stream = video.streams.video[0]
        timeline['aspectRatio'] = f'{stream.width}/{stream.height}'
        desired = timeline['cues'][0]['previewStart']+.4 if timeline['cues'] else 0
        for frame in video.decode(video=0):
            if float(frame.time) >= desired:
                frame.to_image().save(output/'poster.jpg', quality=90)
                break
    data = json.dumps({'clips': [timeline]}, ensure_ascii=False)
    (output/'preview.json').write_text(data, encoding='utf-8')
    template = (ROOT/'engineering/tools/commentary-preview/index.html').read_text(encoding='utf-8')
    (output/'index.html').write_text(template.replace('/*PREVIEW_DATA*/', data.replace('<', '\\u003c')), encoding='utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--video', type=Path)
    source.add_argument('--sample')
    parser.add_argument('--plan', type=Path, help='Reuse an existing commentary result instead of calling the agent again')
    parser.add_argument('--document', type=Path, help='Saved native tactical document with optional name overlay; render a joint composition')
    parser.add_argument('--observations', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--env-file', type=Path, default=ROOT / '.env')
    parser.add_argument('--speaker', help='Polly voice ID; default POLLY_VOICE_ID or Zhiyu')
    parser.add_argument('--engine', help='Polly engine; default POLLY_ENGINE or neural')
    parser.add_argument('--style', default=STYLE)
    parser.add_argument('--font', type=Path, help='CJK font; automatically selects the installed system font')
    parser.add_argument('--provider', choices=['openrouter', 'token-plan', 'qwen'], default='openrouter')
    parser.add_argument('--model', help='Understanding model; default is the selected provider default')
    parser.add_argument('--resume', action='store_true', help='Continue an interrupted run using already synthesized cues')
    parser.add_argument('--audio-cache',type=Path,help='Clip-scoped shared verified narration WAV cache')
    args = parser.parse_args()
    video = args.video
    if args.sample:
        library = json.loads((ROOT/'data/videos/tactics/acceptance/review-library.json').read_text(encoding='utf-8'))
        sample = next((s for s in library['samples'] if s['id'] == args.sample), None)
        if sample is None:
            parser.error(f'Unknown sample: {args.sample}')
        video = ROOT / sample['video']
    output = args.output.resolve()
    if output.exists() and not args.resume:
        parser.error('Output already exists; use a new directory or --resume for this run')
    if not video.is_file():
        parser.error(f'Video not found: {video}')
    # Fail before expensive model work if the speech credential is missing.
    credentials(args.env_file)
    output.mkdir(parents=True, exist_ok=True)
    state_path = output/'workflow.json'
    config = {'video': str(video.resolve()), 'plan': str(args.plan.resolve()) if args.plan else None,
              'provider': args.provider, 'model': args.model,
              'speech': voice_settings(args.env_file, args.speaker, args.engine),
              'style': args.style, 'observations': str(args.observations.resolve()) if args.observations else None}
    if args.document:
        if not args.document.is_file():parser.error('Joint document file does not exist')
        from local_video_library import file_hash
        config.update(document=str(args.document.resolve()),documentDigest=file_hash(args.document))
    if args.audio_cache:config['audioCache']=str(args.audio_cache.resolve())
    if state_path.exists():
        previous = json.loads(state_path.read_text(encoding='utf-8'))
        if previous['config'] != config:
            parser.error('Resume settings differ from the original run; use a new output directory')
    state = {'config': config, 'status': 'running', 'stage': 'understanding'}

    def save():
        state_path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding='utf-8')

    save()
    try:
        # Check the rendering dependency before any paid understanding or speech calls.
        args.font = resolve_font(args.font)
        plan = args.plan or output/'understanding/result.json'
        if not args.plan:
            cached = json.loads(plan.read_text(encoding='utf-8')) if plan.is_file() else {}
            if cached.get('status') != 'completed':
                command = [sys.executable, str(ROOT/'engineering/scripts/commentary_agent.py'),
                           '--video', str(video), '--output', str(output/'understanding'),
                           '--provider', args.provider, '--env-file', str(args.env_file)]
                if args.model:
                    command += ['--model', args.model]
                if args.observations:
                    command += ['--observations', str(args.observations)]
                subprocess.run(command, check=True)
        saved_plan=json.loads(Path(plan).read_text(encoding='utf-8'))
        saved_plan=saved_plan.get('plan',saved_plan)
        has_shots=any(n.get('kind')=='shot_release' for n in saved_plan.get('nodes',[])) or any(
            e.get('kind')=='shot' and e.get('shotStatus')=='confirmed' for e in saved_plan.get('events',[]))
        if has_shots and not args.document:
            raise ValueError('shot_release requires --document with the adopted shooter spotlight and feedback before speech synthesis')
        if has_shots:
            snapshot = json.loads(args.document.read_text(encoding='utf-8'))
            document = snapshot.get('document', snapshot)
            feedback = document.get('shotFeedback', {}).get('items', [])
            shot_nodes = [node for node in saved_plan.get('nodes', []) if node.get('kind') == 'shot_release']
            if not feedback or any(sum(item.get('nodeId') == node['nodeId'] for item in feedback) != 1 for node in shot_nodes):
                raise ValueError('投篮解说尚未关联已采纳的投篮标记和评价；请先生成并采纳对应的战术绘制，再生成成片。已有配音会复用。')
        state['stage'] = 'speech'; save()
        manifest = synthesize_plan(plan, output/'audio', args.env_file, args.speaker, args.style, args.engine,audio_cache=args.audio_cache)
        state['stage'] = 'render'; save()
        render = output/'render'
        if not (render/'timeline.json').is_file():
            # Preserve any interrupted render instead of overwriting its files.
            if render.exists():
                suffix = 2
                while (output/f'render-{suffix}').exists():
                    suffix += 1
                render = output/f'render-{suffix}'
            command=[sys.executable, str(ROOT/'engineering/scripts/render_commentary_narration.py'),
                            '--video', str(video), '--plan', str(plan), '--audio-manifest', str(manifest),
                            '--output', str(render), '--font', str(args.font)]
            if args.document:command+=['--document',str(args.document)]
            subprocess.run(command, check=True)
        state.update(status='completed', stage='complete', video=str((render/'commentary-final.mp4').relative_to(output)),
                     timeline=str((render/'timeline.json').relative_to(output)))
        write_preview(output, render, plan, args.sample or video.stem)
        save()
        print(f"Completed: {output/state['video']}", flush=True)
    except (RuntimeError, ValueError, subprocess.CalledProcessError) as exc:
        state['status'] = 'failed'
        state['error'] = str(exc)
        save()
        parser.exit(1, f'{exc}\n')


if __name__ == '__main__':
    main()
