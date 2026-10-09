"""Local audio/video comparisons using reviewed Astra results; run from repository root."""
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'engineering/scripts'))
from commentary_tts import synthesize_plan, NATURAL_STYLE, STYLE


def main():
    library = json.loads((ROOT / 'data/videos/tactics/acceptance/review-library.json').read_text(encoding='utf-8'))
    videos = {s['id']: ROOT / s['video'] for s in library['samples']}
    cases = [('001', 'official-training-001', 'natural'), ('001', 'official-training-001', 'classic'),
             ('002', 'official-training-002', 'natural'), ('third', 'nba-lal-min-005', 'natural')]
    output_root = ROOT / 'tmp/commentary-personality-20261009'
    report = []
    for name, sample, voice in cases:
        plan = Path(__file__).parent / f'{name}-final/result.json'
        audio = synthesize_plan(plan, output_root / f'{name}-{voice}-audio', ROOT / '.env',
                                style=NATURAL_STYLE if voice == 'natural' else STYLE)
        render = output_root / f'{name}-{voice}-render'
        if not (render / 'timeline.json').exists():
            subprocess.run([sys.executable, str(ROOT / 'engineering/scripts/render_commentary_narration.py'),
                            '--video', str(videos[sample]), '--plan', str(plan), '--audio-manifest', str(audio),
                            '--output', str(render)], check=True)
        timeline = json.loads((render / 'timeline.json').read_text(encoding='utf-8'))
        manifest = json.loads(audio.read_text(encoding='utf-8'))
        report.append({'sample': sample, 'voice': voice, 'audio': manifest,
                       'segments': timeline['segments'], 'cues': timeline['cues'],
                       'video': (render / 'commentary-final.mp4').relative_to(ROOT).as_posix()})
        print(f'{name} {voice}: rendered', flush=True)
    (Path(__file__).parent / 'audio-render-results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
