"""Read-only media probe and review sheets; no inference or input mutation."""
import argparse, hashlib, json
from pathlib import Path
import av
from PIL import Image, ImageDraw

def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--repo', type=Path, required=True); ap.add_argument('--out', type=Path, required=True)
    a=ap.parse_args(); a.out.mkdir(parents=True, exist_ok=True)
    lib=json.loads((a.repo/'data/videos/tactics/acceptance/review-library.json').read_text(encoding='utf-8'))
    selections={'004':[0,35,70,104,139,174,209], '005':[0,23,47,71,94,119,142], '006':[0,77,153,230,307,384,461], 'nba-lal-min-005':[0,53,100,106,159,212,266]}
    audit=[]
    for sample in lib['samples']:
        sid=sample['id']; src=a.repo/sample['video']; variant=next(v for v in sample['trackingVariants'] if v['id']=='team-stable')
        track_path=a.repo/variant['tracks']; stable=json.loads(track_path.read_text(encoding='utf-8'))
        object_rel=f'data/videos/tactics/acceptance/tracks/{sid}-ebard.json'
        object_path=a.repo/object_rel
        frames=json.loads(object_path.read_text(encoding='utf-8')) if object_path.exists() else stable
        chosen=set(selections[sid]); tiles=[]; records=[]
        with av.open(str(src)) as container:
            for index,frame in enumerate(container.decode(video=0)):
                if index not in chosen: continue
                raw=frame.to_image().convert('RGB'); marked=raw.copy(); draw=ImageDraw.Draw(marked)
                row=frames[index]; objects=row.get('objects',[])
                for j, obj in enumerate(objects):
                    x1,y1,x2,y2=obj['box']; col='#ffff00' if obj['kind']=='basketball' else '#ff44ff'
                    draw.rectangle((x1,y1,x2,y2),outline=col,width=3)
                    draw.text((x1,max(0,y1-15)),f"{j} {obj['kind']} {obj['score']:.2f}",fill=col,stroke_width=1,stroke_fill='black')
                for tr in stable[index]['tracks']:
                    x1,y1,x2,y2,tid,score,cl=tr
                    draw.rectangle((x1,y1,x2,y2),outline='#00dfff',width=1)
                    draw.text((x1,y1),f'T{int(tid)}',fill='#00ffff',stroke_width=1,stroke_fill='black')
                raw.save(a.out/f'{sid}-f{index:04d}-raw.jpg',quality=96)
                marked.save(a.out/f'{sid}-f{index:04d}-overlay.jpg',quality=96)
                tile=Image.new('RGB',(960,580),'#111111'); thumb=marked.copy(); thumb.thumbnail((960,540)); tile.paste(thumb,(0,30))
                ImageDraw.Draw(tile).text((8,8),f'{sid} frame {index} | PTS={frame.pts} tb={frame.time_base} | object source={"ebard" if object_path.exists() else "stable"}',fill='white')
                tiles.append(tile)
                records.append({'frame':index,'pts':frame.pts,'time_base':[frame.time_base.numerator,frame.time_base.denominator],'time':row['time'],'objects':objects,'stable_tracks':stable[index]['tracks']})
        sheet=Image.new('RGB',(1920,580*((len(tiles)+1)//2)),'#111111')
        for i,tile in enumerate(tiles): sheet.paste(tile,((i%2)*960,(i//2)*580))
        sheet.save(a.out/f'{sid}-review.jpg',quality=94)
        audit.append({'sample':sid,'video':sample['video'],'video_sha256':sha(src),'stable_path':variant['tracks'],'stable_sha256':sha(track_path),'objects_path':object_rel if object_path.exists() else variant['tracks'],'objects_sha256':sha(object_path if object_path.exists() else track_path),'selected_frames':records})
    (a.out/'review_input.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'samples':len(audit),'frames':sum(len(x['selected_frames']) for x in audit),'out':str(a.out)}))

if __name__=='__main__': main()
