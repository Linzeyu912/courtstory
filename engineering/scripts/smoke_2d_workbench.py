"""Synthetic browser + production acceptance, isolated from all user videos/drafts.

Requires PyAV, numpy, Pillow, Playwright, Chromium, Node.js, Sharp and FFmpeg.
Uses the real HTTP service and a clearly labelled generated fixture, never a model.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False), encoding='utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path)
    parser.add_argument('--chromium', default=shutil.which('chromium') or shutil.which('google-chrome'))
    args = parser.parse_args()
    folder = args.output_dir or Path(tempfile.mkdtemp(prefix='workbench-v2-smoke-'))
    folder = folder.resolve(); folder.mkdir(parents=True, exist_ok=True)
    if (folder / 'server-state.json').exists():
        raise ValueError('Use a fresh output directory so previous test snapshots cannot mask failures.')
    import av
    import numpy as np
    from playwright.sync_api import sync_playwright
    node = shutil.which('node')
    fixture = json.loads(subprocess.check_output([node, '--input-type=module', '-e',
        "import {makeV2Fixture} from './engineering/tools/player-review/tactics-v2-fixture.mjs';process.stdout.write(JSON.stringify(await makeV2Fixture()));"], cwd=ROOT, text=True))
    clip = fixture['clip']; video = folder / 'source.mp4'
    with av.open(str(video), 'w') as container:
        stream = container.add_stream('libx264', rate=10)
        stream.width, stream.height, stream.pix_fmt = clip['width'], clip['height'], 'yuv420p'
        for record in clip['frames']:
            pixels = np.zeros((clip['height'], clip['width'], 3), np.uint8); pixels[:] = [22, 58, 49]
            for x1, y1, x2, y2, *_ in record['tracks']:
                pixels[max(0,int(y1)):min(clip['height'],int(y2)),max(0,int(x1)):min(clip['width'],int(x2))] = [239, 230, 163]
            frame = av.VideoFrame.from_ndarray(pixels, format='rgb24')
            for packet in stream.encode(frame): container.mux(packet)
        for packet in stream.encode(): container.mux(packet)
    digest = hashlib.sha256(video.read_bytes()).hexdigest()
    write_json(folder / 'tracks.json', clip['frames'])
    write_json(folder / 'court.json', {**fixture['session']['courtCalibration'], 'videoHash': digest})
    write_json(folder / 'library.json', {'defaultSample':'synthetic-v2', 'samples':[{'id':'synthetic-v2',
        'title':'合成 V2 验收（非比赛视频）', 'video':str(video), 'tracks':str(folder/'tracks.json'), 'courtProfile':str(folder/'court.json')}]})
    state = folder / 'server-state.json'
    command = [sys.executable, str(ROOT/'engineering/scripts/serve_player_review.py'), '--library',str(folder/'library.json'),
        '--port','0','--state-file',str(state),'--tactics-folder',str(folder/'tactics'), '--trim-root',str(folder/'trims'),
        '--import-cache',str(folder/'imports'),'--video-folder',str(folder/'inbox'),'--inference-python',sys.executable]
    errors, bad_modules = [], []
    with (folder/'server.log').open('w', encoding='utf-8') as log:
        server = subprocess.Popen(command, cwd=ROOT, stdout=log, stderr=log)
        try:
            deadline=time.monotonic()+15
            while not state.is_file() and server.poll() is None and time.monotonic()<deadline: time.sleep(.05)
            if not state.is_file(): raise RuntimeError('Server did not start; see server.log')
            url=json.loads(state.read_text())['url']
            def request(path, body=None):
                req = Request(url.rstrip('/')+path, json.dumps(body).encode() if body else None,
                              headers={'Content-Type':'application/json'})
                with urlopen(req, timeout=30) as response: return json.load(response)
            with sync_playwright() as browser_runtime:
                launch={'headless':True, 'args':['--no-sandbox']}
                if args.chromium: launch['executable_path']=args.chromium
                browser=browser_runtime.chromium.launch(**launch)
                page=browser.new_page(viewport={'width':1440,'height':1000})
                page.on('pageerror',lambda error: errors.append(str(error)))
                page.on('response',lambda response: bad_modules.append([response.url,response.status]) if response.status>=400 and '.mjs' in response.url else None)
                page.goto(url+'?sample=synthetic-v2&qa=1'); page.wait_for_timeout(300)
                page.evaluate('''async()=>{const {blankSession,draftStorageKey}=await import('/trajectory.mjs');
                    const clip=await(await fetch('/api/clip?sample=synthetic-v2&variant=original')).json(),s=blankSession(clip.video_sha256);
                    s.maxGapSeconds=0;s.courtCalibration=clip.courtCalibration;s.liveSelection={ranges:[{start:0,end:60}],method:'synthetic_test'};
                    for(let i=0;i<6;i++)s.entities[i].bindings=[{kind:'track',trackId:i+1,start:0,end:60}];
                    localStorage.setItem(draftStorageKey(clip,'original',true),JSON.stringify(s));}''')
                page.reload();page.wait_for_function("document.getElementById('areaTitle').textContent.includes('①')");page.locator('[data-area-target="data"]').click()
                page.locator('.court-preparation-panel [data-build]').click()
                prep=page.locator('.court-preparation-panel')
                prep.locator('[data-start]').fill('3');prep.locator('[data-end]').fill('5')
                prep.locator('[data-preview]').click();prep.locator('[data-adopt]').click()
                page.wait_for_timeout(300);prep.locator('[data-save]').click()
                page.wait_for_function("document.querySelector('.court-preparation-panel [data-status]').textContent.includes('已保存 2D 版本')")
                prep.locator('[data-next]').click()
                page.wait_for_function("document.body.dataset.area==='tactics' && (!document.getElementById('tacticsEditor').hidden || !document.getElementById('tacticsEmpty').hidden)")
                if page.locator('#tacticsCreateCanvas').is_visible(): page.locator('#tacticsCreateCanvas').click()
                page.wait_for_function("!document.getElementById('tacticsEditor').hidden")
                timeline=page.locator('.tactics-source-timeline')
                timeline.locator('[data-start]').fill('3');timeline.locator('[data-end]').fill('5')
                timeline.locator('[data-end]').evaluate('(element)=>element.onchange()')
                timeline.locator('[data-seek-start]').click()
                page.wait_for_function("document.getElementById('tacticsFrame').textContent.includes('3.00 秒') && document.getElementById('tacticsFrame').textContent.includes('已暂停')")
                page.locator('#tacticsToolRoute').click()
                assert page.locator('#tacticsCanvas').get_attribute('data-tool')=='route'
                svg=page.locator('#tacticsCanvas svg');svg.scroll_into_view_if_needed();box=svg.bounding_box()
                svg.click(position={'x':box['width']*.3,'y':box['height']*.55})
                svg.click(position={'x':box['width']*.7,'y':box['height']*.35})
                page.wait_for_function("document.querySelectorAll('#tacticsObjectList button').length===1")
                timeline.locator('[data-add]').click()
                page.wait_for_function("document.querySelectorAll('.tactics-keyframe-cards article').length===1")
                page.locator('#tacticsUndo').click();page.wait_for_timeout(200)
                assert page.locator('.tactics-keyframe-cards article').count()==0
                page.locator('#tacticsRedo').click();page.wait_for_timeout(200)
                assert page.locator('.tactics-keyframe-cards article').count()==1
                playback_started=time.monotonic();timeline.locator('[data-play]').click()
                page.wait_for_timeout(1000)
                assert 3<=float(page.locator('#tacticsFrame').inner_text().split(' ')[0])<3.2
                page.wait_for_function("parseFloat(document.getElementById('tacticsFrame').textContent)>=5",timeout=12000)
                assert time.monotonic()-playback_started>=4
                page.locator('#tacticsSave').click()
                page.wait_for_function("document.getElementById('tacticsStatus').textContent.includes('已保存到本机')")
                page.screenshot(path=str(folder/'court.png'),full_page=True)
                page.reload();page.wait_for_function("document.getElementById('areaTitle').textContent.includes('①')");page.locator('[data-area-target="tactics"]').click();page.wait_for_function("document.querySelectorAll('#tacticsObjectList button').length===1")
                assert page.locator('.tactics-keyframe-cards article').count()==1
                saved=request('/api/tactics?sample=synthetic-v2&variant=original&qa=1&kind=workspace')
                document=saved['document'];annotation=document['annotations']['items'][0]
                assert [annotation['startFrame'],annotation['endFrameExclusive']]==[30,50]
                assert not errors and not bad_modules, (errors,bad_modules)
                write_json(folder/'saved.json',saved)
                browser.close()
            binding=json.loads(subprocess.check_output([node,str(ROOT/'engineering/tools/tactical-overlay/workbench-cli.mjs')],
                input=json.dumps({'operation':'agent-digest','document':document}),text=True,cwd=ROOT))['digest']
            base={'sample':'synthetic-v2','variant':'original','qa':True,'kind':'workspace'}
            job=request('/api/tactics-render/jobs',{**base,'document':document,'expectedVersion':saved['version'],
                'documentDigest':binding,'options':{'fps':30}})
            deadline=time.monotonic()+90
            while job['status'] in ('queued','running') and time.monotonic()<deadline:
                time.sleep(.2);job=request('/api/tactics-render/jobs/'+job['id']+'?sample=synthetic-v2&variant=original&qa=1&kind=workspace')
            assert job['status']=='succeeded', job
            result=folder/'result.mp4';result.write_bytes(urlopen(url.rstrip('/')+job['videoUrl'],timeout=30).read())
            assert hashlib.sha256(result.read_bytes()).hexdigest()==job['sha256']
            with av.open(str(result)) as container:
                decoded=list(container.decode(video=0));assert len(decoded)==258
                assert abs(container.duration/av.time_base-8.6)<.01
                decoded[105].to_image().save(folder/'cue.png')
            write_json(folder/'report.json',{'synthetic':True,'sourceSha256':digest,'errors':errors,'badModules':bad_modules,
                'range':[30,50],'keyframes':1,'selectedRangePlayback':True,'decodedFrames':258,'duration':8.6,'render':job})
            print(json.dumps({'passed':True,'synthetic':True,'output':str(folder)},ensure_ascii=False))
        finally:
            server.terminate()
            try:server.wait(timeout=5)
            except subprocess.TimeoutExpired:server.kill();server.wait()


if __name__ == '__main__': main()
