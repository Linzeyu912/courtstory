import av,json,argparse
from pathlib import Path
from PIL import Image,ImageDraw

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--repo',type=Path,required=True);ap.add_argument('--out',type=Path,required=True);a=ap.parse_args();a.out.mkdir(exist_ok=True,parents=True)
    jobs=[('006','006_SAS_drive_kick.mp4',[242,330]),('005','005_SAS_pick_roll.mp4',[4,117])];tiles=[]
    for sid,video,indices in jobs:
        data=json.loads((a.repo/f'data/videos/tactics/acceptance/tracks/{sid}-ebard.json').read_text())
        with av.open(str(a.repo/f'data/videos/tactics/acceptance/clips/{video}')) as container:
            for i,f in enumerate(container.decode(video=0)):
                if i not in indices:continue
                im=f.to_image();im.save(a.out/f'{sid}-f{i:04d}-raw.jpg',quality=97);dr=ImageDraw.Draw(im)
                for j,o in enumerate(data[i].get('objects',[])):
                    if o['kind']=='basketball':
                        dr.rectangle(o['box'],outline='yellow',width=3);dr.text((o['box'][0],o['box'][1]-18),f'{j} {o["score"]:.3f}',fill='yellow',stroke_width=1,stroke_fill='black')
                im.save(a.out/f'{sid}-f{i:04d}-ball-overlay.jpg',quality=97);tile=Image.new('RGB',(960,580),'#111');tile.paste(im.resize((960,540)),(0,30));ImageDraw.Draw(tile).text((5,8),f'{sid} frame {i}',fill='white');tiles.append(tile)
    sheet=Image.new('RGB',(1920,1160))
    for i,t in enumerate(tiles):sheet.paste(t,((i%2)*960,(i//2)*580))
    sheet.save(a.out/'multiple-ball.jpg',quality=97)
if __name__=='__main__':main()
