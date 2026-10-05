"""Build timestamped contact sheets and batches for an AI material review."""
import concurrent.futures
import json
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'artifacts/material-review-20261003'


def prepare(row):
    folder = OUT / 'frames' / row['clip_id']
    folder.mkdir(parents=True, exist_ok=True)
    result = subprocess.run([
        'ffmpeg', '-hide_banner', '-loglevel', 'error', '-xerror', '-i', str(ROOT / row['path']),
        '-vf', 'fps=2,scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2',
        '-q:v', '3', '-y', str(folder / 'frame-%04d.jpg'),
    ], capture_output=True, text=True)
    if result.returncode:
        row['sampling_error'] = result.stderr[-2000:]
    frames = sorted(folder.glob('frame-*.jpg'))
    row['sample_count'] = len(frames)
    sheets = []
    font_path = Path('C:/Windows/Fonts/arial.ttf')
    font = ImageFont.truetype(str(font_path), 20) if font_path.exists() else ImageFont.load_default()
    # First output frame of fps=2 is centred near t=.25s; labels state approximate source time.
    for page, start in enumerate(range(0, len(frames), 16), 1):
        chunk = frames[start:start+16]
        sheet = Image.new('RGB', (2560, 44 + ((len(chunk)+3)//4)*388), '#141414')
        draw = ImageDraw.Draw(sheet)
        draw.text((12, 10), f"{row['clip_id']} | 2fps samples | page {page} | times approx.", fill='white', font=font)
        for i, path in enumerate(chunk):
            x, y = (i % 4)*640, 44+(i//4)*388
            with Image.open(path) as frame:
                sheet.paste(frame, (x, y))
            draw.text((x+10, y+363), f"~{(start+i)*.5+.25:.2f}s", fill='white', font=font)
        target = folder / f'contact-{page:02d}.jpg'
        sheet.save(target, quality=92)
        sheets.append(target.relative_to(ROOT).as_posix())
    row['contact_sheets'] = sheets
    return row


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    rows = []
    for dataset in json.loads((ROOT/'data/videos/catalog.json').read_text(encoding='utf-8'))['datasets']:
        manifest = json.loads((ROOT/dataset['manifest']).read_text(encoding='utf-8'))
        for entry in manifest['entries']:
            rows.append({
                'clip_id': entry['clip_id'], 'dataset_id': dataset['dataset_id'],
                'local_id': entry['local_id'], 'path': dataset['root']+'/'+entry['asset']['path'],
                'label_path': dataset['root']+'/'+entry['annotation_path'],
                'manifest_path': dataset['manifest'], 'sha256': entry['asset']['sha256'],
                'video': entry['video'], 'existing_tactic': entry['tactic'],
                'existing_review': entry['review'], 'existing_dedup': entry['dedup'],
            })
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        rows = list(pool.map(prepare, rows))
    (OUT/'inventory.json').write_text(json.dumps(rows, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')
    batches = [rows[i:i+15] for i in range(0,len(rows),15)]
    for i, batch in enumerate(batches,1):
        (OUT/f'batch-{i:02d}.json').write_text(json.dumps(batch, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')
    print(json.dumps({'clips':len(rows),'batches':len(batches),'sheets':sum(len(r['contact_sheets']) for r in rows),'sampling_errors':[r['clip_id'] for r in rows if r.get('sampling_error')]}))


if __name__ == '__main__':
    main()
