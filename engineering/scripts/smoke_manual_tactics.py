"""006 acceptance: real browser input from upload to MP4 download; no tactical data injection.

Only the source video/library are prepared. All objects, times, cues, correction,
undo, save and rendering requests originate from the actual workbench UI.
Requires PyAV, numpy, Playwright, Chromium, Sharp and FFmpeg.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import time
from fractions import Fraction
from urllib.request import urlopen

ROOT=Path(__file__).resolve().parents[2]


def write_json(path,value):
    path.write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf-8')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir',type=Path,required=True)
    parser.add_argument('--chromium',default=shutil.which('chromium') or shutil.which('google-chrome'))
    parser.add_argument('--mapped',action='store_true',help='Prepare only an existing moving court calibration, then draw everything through UI')
    parser.add_argument('--vfr',action='store_true',help='Encode actual alternating .05/.10 second PTS')
    parser.add_argument('--extra',action='store_true',help='Also exercise cancellation, keyboard isolation, interval drag/undo and source playback')
    args=parser.parse_args();folder=args.output_dir.resolve()
    if folder.exists() and any(folder.iterdir()):raise ValueError('Use a fresh directory; old drafts must not seed this acceptance.')
    folder.mkdir(parents=True,exist_ok=True)
    import av
    import numpy as np
    from playwright.sync_api import sync_playwright
    source=folder/'source.mp4'
    with av.open(str(source),'w') as container:
        stream=container.add_stream('libx264',rate=10);stream.width=960;stream.height=540;stream.pix_fmt='yuv420p'
        times=sorted([i/10 for i in range(81)]+([i/10+.05 for i in range(80) if i%2==0] if args.vfr else []))
        if args.vfr:stream.time_base=Fraction(1,1000);stream.codec_context.time_base=Fraction(1,1000)
        for seconds in times:
            i=int(seconds*10)
            pixels=np.zeros((540,960,3),np.uint8);pixels[:]=[38,67,57]
            pixels[250:320,80+i*6:110+i*6]=[240,215,140]
            pixels[220:290,620-i*3:650-i*3]=[128,196,245]
            frame=av.VideoFrame.from_ndarray(pixels,format='rgb24')
            if args.vfr:frame.pts=round(seconds*1000);frame.time_base=Fraction(1,1000)
            for packet in stream.encode(frame):container.mux(packet)
        for packet in stream.encode():container.mux(packet)
    with av.open(str(source)) as container:
        times=[float(frame.time) for frame in container.decode(video=0)];source_duration=container.duration/av.time_base
    write_json(folder/'tracks.json',[{'frame':i,'time':seconds,'tracks':[]} for i,seconds in enumerate(times)])
    sample={'id':'entry','title':'人工验收合成素材（非比赛视频）','video':str(source),'tracks':str(folder/'tracks.json')}
    if args.mapped:
        landmarks=[('A',0,5.1816),('B',5.7912,5.1816),('C',5.7912,10.0584),('D',0,10.0584)]
        write_json(folder/'court.json',{'videoHash':hashlib.sha256(source.read_bytes()).hexdigest(),'maxKeyframeGapSeconds':.2,'keyframes':[{'frame':i,'side':'left','source':'human','status':'accepted_reference','points':[{'id':id,'image':[30+x*30+seconds*8,35+y*30],'source':'human'} for id,x,y in landmarks]} for i,seconds in enumerate(times)]})
        sample['courtProfile']=str(folder/'court.json')
    write_json(folder/'library.json',{'defaultSample':'entry','samples':[sample]})
    state=folder/'server-state.json';errors=[];bad_modules=[];steps=[]
    command=[sys.executable,str(ROOT/'engineering/scripts/serve_player_review.py'),'--library',str(folder/'library.json'),
        '--port','0','--state-file',str(state),'--tactics-folder',str(folder/'tactics'),'--trim-root',str(folder/'trims'),
        '--import-cache',str(folder/'imports'),'--video-folder',str(folder/'inbox'),'--inference-python',sys.executable]
    with (folder/'server.log').open('w',encoding='utf-8') as log:
        server=subprocess.Popen(command,cwd=ROOT,stdout=log,stderr=log)
        try:
            deadline=time.monotonic()+20
            while not state.exists() and server.poll() is None and time.monotonic()<deadline:time.sleep(.05)
            if not state.exists():raise RuntimeError('Server startup failed; see server.log')
            url=json.loads(state.read_text())['url']
            with sync_playwright() as pw:
                browser=pw.chromium.launch(headless=True,executable_path=args.chromium,args=['--no-sandbox'])
                context=browser.new_context(viewport={'width':1440,'height':1100},accept_downloads=True,record_video_dir=str(folder/'operation-video'))
                context.tracing.start(screenshots=True,snapshots=True,sources=True)
                page=context.new_page();page.set_default_timeout(15000)
                page.on('pageerror',lambda e:errors.append(str(e)))
                page.on('response',lambda r:bad_modules.append([r.url,r.status]) if r.status>=400 and '.mjs' in r.url else None)
                def note(text):steps.append(text);print(text,flush=True)
                def ready():page.wait_for_function("!document.getElementById('tacticsToolRoute').disabled && !document.getElementById('tacticsEditor').hidden")
                def seek(seconds):
                    page.locator('#tacticsSourceTime').fill(str(seconds));page.locator('#tacticsSourceSeek').click()
                    page.wait_for_function('(seconds)=>document.getElementById("tacticsFrame").textContent.startsWith(Number(seconds).toFixed(2)+" 秒") && document.getElementById("tacticsFrame").textContent.includes("已暂停")',arg=seconds)
                    ready()
                def interval(start,end):
                    timeline=page.locator('.tactics-source-timeline');timeline.locator('[data-start]').fill(str(start));timeline.locator('[data-end]').fill(str(end));timeline.locator('[data-end]').press('Tab');ready()
                    page.wait_for_function('(value)=>document.querySelector("[data-range-label]").textContent.includes(value)',arg=f'{start:.3f}—{end:.3f}')
                def click_picture(x,y):
                    svg=page.locator('#tacticsCanvas svg');svg.scroll_into_view_if_needed();box=svg.bounding_box();page.mouse.click(box['x']+box['width']*x,box['y']+box['height']*y)
                def draw(tool,name,start,end,p,q=None):
                    interval(start,end);page.locator(tool).click();click_picture(*p)
                    if q:click_picture(*q)
                    ready();page.locator('#tacticsAnnotationName').fill(name);page.locator('#tacticsAnnotationName').press('Tab');ready()
                    page.wait_for_function('(name)=>document.getElementById("tacticsSelectionName").textContent.includes(name)',arg=name)
                def save():
                    page.locator('#tacticsSave').click();page.wait_for_function("document.getElementById('tacticsSaveState').textContent.startsWith('已保存 · 版本')")
                try:
                    page.goto(url+'?sample=entry&qa=1'+('&area=tactics' if args.mapped else ''));page.wait_for_selector('#startManualImport')
                    if not args.mapped:
                        with page.expect_file_chooser() as chooser:page.locator('#startManualImport').click()
                        chooser.value.set_files(str(source));page.wait_for_url('**variant=manual**',timeout=45000)
                    page.wait_for_selector('#tacticsCreateCanvas:visible');page.locator('#tacticsCreateCanvas').click();ready()
                    assert page.locator('#tacticsCanvas svg').get_attribute('viewBox')=='0 0 960 540'
                    assert ('有映射' if args.mapped else '固定画面') in page.locator('#tacticsPresentationStatus').inner_text()
                    note('1. '+('打开已有移动映射素材' if args.mapped else '从打开视频按钮上传视频')+'，直接进入空白人工画布；未运行模型或 2D 准备。')
                    page.locator('#tacticsToolRoute').click();assert page.locator('#tacticsCanvas').get_attribute('data-tool')=='select'
                    assert '先设置' in page.locator('[data-range-label]').inner_text()
                    seek(1);page.locator('[data-add]').click();ready();assert page.locator('[data-cue-marker]').count()==1
                    assert page.locator('[data-cue-hold]').input_value()=='2.5'
                    note('2. 原片 1 秒添加空白讲解暂停点，额外停留 2.5 秒。')
                    draw('#tacticsToolRoute','跑位 A',1,5,(.2,.65),(.75,.38))
                    bend=page.locator('[data-annotation-bend]');box=bend.bounding_box();page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2);page.mouse.down();page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2-35,steps=12);page.mouse.up();ready()
                    note('3. 绘制跑位 A（1–5 秒），拖主弯曲柄修成弧线。')
                    draw('#tacticsToolRoute','跑位 B',1,3.5,(.78,.72),(.4,.45));note('4. 绘制独立跑位 B（1–3.5 秒）。')
                    draw('#tacticsToolScreen','挡拆',1.5,3,(.6,.55));page.locator('#tacticsRotateRight').click();ready();page.locator('#tacticsAnnotationSize').select_option('1.5');ready()
                    draw('#tacticsToolDashed','传球',3,4.2,(.3,.4),(.65,.25));note('5. 添加挡拆（1.5–3 秒，旋转/放大）及方向虚线传球（3–4.2 秒）；四对象自动关联第一个暂停点。')
                    if args.extra:
                        page.locator('[data-add]').click();ready();assert page.locator('[data-cue-marker]').count()==1
                        interval(1,5);page.locator('#tacticsToolRoute').click();click_picture(.1,.2);page.keyboard.press('Escape');assert page.locator('[data-time-select]').count()==4
                        page.locator('[data-time-select]').filter(has_text='跑位 B').click();page.locator('#tacticsAnnotationName').focus();page.keyboard.press('Delete');assert page.locator('[data-time-select]').count()==4
                        page.locator('[data-object-end]').fill('.5');page.locator('[data-apply]').click();assert '晚于' in page.locator('[data-object-error]').inner_text()
                        page.locator('[data-object-end]').fill('3.5');page.locator('[data-apply]').click();ready()
                        row=page.locator('[data-time-select]').filter(has_text='跑位 B').locator('..');track=row.locator('[data-time-track]').bounding_box();bar=row.locator('[data-timebar]');bar.scroll_into_view_if_needed();box=bar.bounding_box()
                        page.mouse.move(box['x']+box['width']/2,box['y']+12);page.mouse.down();page.mouse.move(box['x']+box['width']/2+track['width']*.2/source_duration,box['y']+12,steps=8);page.mouse.up();ready()
                        page.wait_for_function("Number(document.querySelector('[data-object-start]').value)>1")
                        page.locator('#tacticsUndo').click();ready();assert page.locator('[data-object-start]').input_value()=='1.000' and page.locator('[data-object-end]').input_value()=='3.500'
                        page.locator('#tacticsCanvas').focus();page.keyboard.press('Control+d');ready();assert page.locator('[data-time-select]').count()==5
                        page.keyboard.press('Control+z');ready();assert page.locator('[data-time-select]').count()==4
                        seek(.9);page.locator('#tacticsContinue').click();page.wait_for_function("document.getElementById('tacticsFrame').textContent.includes('播放中') && Number(document.getElementById('tacticsSourceTime').value)>1.3");page.locator('#tacticsPause').click();ready();seek(1)
                        page.set_viewport_size({'width':1100,'height':900});ready();page.set_viewport_size({'width':1440,'height':1100});ready()
                        note('附加：同帧暂停去重、半成品 Esc 取消、输入框 Delete 隔离、倒置区间拒绝、时间条整体平移一次撤销、Ctrl+D / Ctrl+Z、原片播放越过暂停、画布缩放。')
                    page.locator('[data-time-select]').filter(has_text='跑位 A').click();seek(3)
                    page.locator('#tacticsRhythm > summary').click();page.locator('#tacticsCorrectHere').click()
                    reference=page.locator('[data-progress-reference]');points=reference.get_attribute('points').split();coords=[tuple(map(float,p.split(','))) for p in points]
                    lengths=[np.hypot(b[0]-a[0],b[1]-a[1]) for a,b in zip(coords,coords[1:])];target=sum(lengths)*.65;walked=0
                    for i,length in enumerate(lengths):
                        if walked+length>=target:
                            t=(target-walked)/length;x=coords[i][0]+t*(coords[i+1][0]-coords[i][0]);y=coords[i][1]+t*(coords[i+1][1]-coords[i][1]);break
                        walked+=length
                    click_picture(x/960,y/540);ready();assert '65%' in page.locator('#tacticsCorrectionList').inner_text()
                    note('6. 原片 3 秒，点击完整参考路线约 65% 位置校正 A；没有填写进度 JSON/百分比。')
                    seek(5.5);page.locator('[data-add]').click();ready();draw('#tacticsToolRoute','跑位 C',5.5,7.5,(.3,.7),(.65,.4));note('7. 5.5 秒添加第二个暂停点及跑位 C（5.5–7.5 秒）。')
                    # One drag is one undo; copy and cancellation preserve other marks.
                    page.locator('#tacticsDuplicate').click();ready();assert page.locator('[data-time-select]').count()==6
                    page.locator('#tacticsQuickDelete').click();ready();assert page.locator('[data-time-select]').count()==5
                    page.locator('#tacticsUndo').click();ready();assert page.locator('[data-time-select]').count()==6
                    page.locator('#tacticsQuickDelete').click();ready()
                    page.locator('[data-time-select]').filter(has_text='跑位 B').click();page.locator('[data-object-end]').fill('3.6');page.locator('[data-apply]').click();ready()
                    page.locator('[data-time-select]').filter(has_text='挡拆').click();page.locator('#tacticsQuickDelete').click();ready();page.locator('#tacticsUndo').click();ready();assert page.locator('[data-time-select]').count()==5
                    page.locator('#tacticsPreviewCurrent').click();page.wait_for_selector('#tacticsRenderDownload:visible',timeout=120000)
                    page.locator('#tacticsRenderVideo').evaluate('(video)=>video.play()');page.wait_for_timeout(500);page.locator('#tacticsRenderVideo').evaluate('(video)=>video.pause()')
                    note('8. 从成片效果预览按钮保存并生成真实 MP4；在工作台播放器播放。')
                    save();saved_url=page.url;page.reload();page.wait_for_selector('[data-time-select]',timeout=20000);ready();assert page.locator('[data-time-select]').count()==5
                    assert page.locator('[data-cue-marker]').count()==2
                    page.locator('[data-time-select]').filter(has_text='跑位 A').click();page.locator('#tacticsRhythm > summary').click();assert '65%' in page.locator('#tacticsCorrectionList').inner_text()
                    note('9. 复制/删除、删除挡拆并撤销、修改 B 区间至 3.6 秒；保存刷新恢复 5 对象、2 暂停及 A 校正。')
                    # Simulate a failed render request after a real edit, then retry via UI.
                    page.locator('#tacticsAnnotationName').fill('跑位 A 已复核');page.locator('#tacticsAnnotationName').press('Tab');ready()
                    page.route('**/api/tactics-render/jobs',lambda route:route.fulfill(status=503,json={'error':'验收模拟：编码服务暂不可用'}))
                    page.locator('#tacticsPreviewCurrent').click();page.wait_for_function("document.getElementById('tacticsRenderStatus').textContent.includes('验收模拟')");assert page.locator('[data-time-select]').count()==5
                    page.unroute('**/api/tactics-render/jobs');page.locator('#tacticsExportCurrent').click();page.wait_for_function("document.body.dataset.area==='production'")
                    page.locator('#deliveryRenderStart').click();page.wait_for_selector('#deliveryRenderDownload:visible',timeout=120000)
                    with page.expect_download() as download:page.locator('#deliveryRenderDownload').click()
                    download.value.save_as(str(folder/'result.mp4'))
                    metadata=page.locator('#deliveryRenderMetadata').inner_text();note('10. 导出失败草稿保留；通过正式成片页面重试并下载 MP4。')
                    page.screenshot(path=str(folder/'delivery.png'),full_page=True)
                    page.locator('#deliveryTactics').click();page.locator('[data-time-select]').filter(has_text='跑位 A 已复核').click();seek(3);page.screenshot(path=str(folder/'editing.png'),full_page=True)
                    # GET is evidence only, never used to create or render annotations.
                    from urllib.parse import urlsplit,parse_qs,urlencode
                    query=parse_qs(urlsplit(saved_url).query);params={k:query[k][0] for k in ['sample','variant','qa'] if k in query};params['kind']='workspace'
                    saved=json.load(urlopen(url+'api/tactics?'+urlencode(params)));write_json(folder/'saved.json',saved)
                    d=saved['document'];assert len(d['annotations']['items'])==5;assert len(d['tacticKeyframes']['items'])==2
                    assert all(a['space']=='court' if args.mapped else a['space']=='video' and a['videoMode']=='fixed' for a in d['annotations']['items'])
                    assert sorted(len(k['annotationIds']) for k in d['tacticKeyframes']['items'])==[1,4]
                    a=next(a for a in d['annotations']['items'] if a['name']=='跑位 A 已复核');assert abs(a['progressFrames'][1]['t']-.65)<.01
                    with av.open(str(folder/'result.mp4')) as container:
                        decoded=list(container.decode(video=0));duration=container.duration/av.time_base
                    assert abs(duration-source_duration-5)<1/30+.001,(len(decoded),duration,source_duration)
                    pts_steps=sorted(set(round(b-a,5) for a,b in zip(times,times[1:])))
                    if args.vfr:assert len(pts_steps)>1
                    # From the encoded file: freeze/draw/hold/recovery, middle/fade, second cue.
                    for index in [30,40,60,104,105,165,213,225,240,250,285,330,375]:decoded[index].to_image().save(folder/f'output-{index:03}.png')
                    assert not errors and not bad_modules,(errors,bad_modules)
                    write_json(folder/'report.json',{'passed':True,'synthetic':True,'mapped':args.mapped,'noTacticalInjection':True,'sourceFrameCount':len(times),'sourcePtsSteps':pts_steps,'sourceDuration':source_duration,'outputDuration':duration,'decodedFrames':len(decoded),'savedVersion':saved['version'],'metadata':metadata,'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'resultSha256':hashlib.sha256((folder/'result.mp4').read_bytes()).hexdigest(),'steps':steps,'pageErrors':errors,'badModules':bad_modules})
                    print(json.dumps({'passed':True,'output':str(folder),'frames':len(decoded),'duration':duration},ensure_ascii=False),flush=True)
                except Exception:
                    page.screenshot(path=str(folder/'failure.png'),full_page=True);write_json(folder/'failure.json',{'steps':steps,'pageErrors':errors,'badModules':bad_modules,'url':page.url,'status':page.locator('#tacticsStatus').inner_text() if page.locator('#tacticsStatus').count() else ''});raise
                finally:
                    context.tracing.stop(path=str(folder/'trace.zip'));context.close();browser.close()
        finally:
            server.terminate()
            try:server.wait(timeout=5)
            except subprocess.TimeoutExpired:server.kill();server.wait()


if __name__=='__main__':main()
