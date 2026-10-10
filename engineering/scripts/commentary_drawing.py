"""Independent Pi drawing and visual review over saved commentary node windows."""
from __future__ import annotations

import argparse
from copy import deepcopy
import json
import math
from pathlib import Path
import queue
import re
import shutil
import subprocess
import threading
import time

from commentary_agent import ROOT, provider_environment, redact
from commentary_video import CommentaryVideo

WORKER = ROOT / 'engineering/tools/player-review/agents/drawing-worker.mjs'


def drawing_config(plan, override=None):
    inherited = deepcopy(plan.get('producerConfigSnapshot') or {})
    if override is None or override == '':
        config, mode = inherited, 'inherited'
    else:
        if isinstance(override, str): override = {'model': override}
        if not isinstance(override, dict) or set(override) - {'provider','model','reasoning'}:
            raise ValueError('绘图模型覆盖格式无效，不接受凭据。')
        config = {'provider': inherited.get('provider', 'openrouter'), **deepcopy(override)}
        if 'reasoning' not in config: config['reasoning'] = inherited.get('reasoning', 'medium')
        mode = 'override'
    if config.get('provider') != 'openrouter' or not isinstance(config.get('model'), str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}', config['model']):
        raise ValueError('需要明确、可验证的 OpenRouter 绘图模型；旧计划不能继承当前全局值。')
    return config, mode


class DrawingEvidence:
    """Host-side node fence. Only returned image assets enter the evidence ledger."""
    def __init__(self, video, nodes, review=None):
        self.video, self.review = video, review or {}
        self.nodes = {n['nodeId']:deepcopy(n) for n in nodes}
        self.seen = {key:set() for key in self.nodes}
        self.assets = {}
        self.node_assets = {key:[] for key in self.nodes}
        self.calls = 0

    def _indices(self, params):
        node = self.nodes.get(params.get('nodeId'))
        if not node: raise ValueError('未知绘图节点。')
        indices = self.video._resolve_frames({'frames':params.get('frames')},12)
        window = node['evidenceWindow']
        if any(not window['startFrame'] <= i <= window['endFrame'] for i in indices):
            raise ValueError('请求超出节点窗口；请明确申请扩展，不允许全片分析。')
        if len(self.seen[node['nodeId']] | set(indices)) > 12:
            raise ValueError('每节点本轮最多12个实际证据帧，需保留独立原图审核预算。')
        settings = self.review.get('settings',{})
        cuts = settings.get('cuts',[]) + settings.get('sourceCuts',[])
        cut_frames = [c if type(c) is int else c.get('frame') for c in cuts if isinstance(c,(int,dict))]
        anchor = node['anchorAssetFrame']
        if any(type(c) is int and any(min(anchor,i) < c <= max(anchor,i) for i in indices) for c in cut_frames):
            raise ValueError('请求跨越切镜边界；不能默认延续人物和路线。')
        return node['nodeId'], indices

    def _register(self, node_id, result):
        images = [c for c in result.get('content',[]) if c.get('type')=='image']
        assets = result.get('details',{}).get('assets',[])
        if len(images)!=len(assets): raise ValueError('实际图像与资产记录不匹配。')
        if self.calls >= 40: raise ValueError('绘图取证预算已用尽。')
        for asset in assets:
            self.assets[asset['assetId']] = deepcopy(asset)
            self.node_assets[node_id].append(deepcopy(asset))
            self.seen[node_id].add(asset['frame'])
        self.calls += 1
        return result

    def read_frames(self, params):
        node_id, indices = self._indices(params)
        return self._register(node_id,self.video.read_video_window({'frames':indices,'mode':'raw'}))

    def inspect_region(self, params):
        node_id, indices = self._indices(params)
        return self._register(node_id,self.video.inspect_region({k:v for k,v in params.items() if k!='nodeId'} | {'frames':indices}))

    def positions(self, params):
        _,indices = self._indices(params)
        wanted=set(indices)
        return {'entities':[{'id':e['id'],'trajectory':[deepcopy(p) for p in e.get('trajectory',[]) if p.get('frame') in wanted]}
                            for e in self.review.get('entities',[])]}


def map_candidate(candidate,evidence,node_id):
    result=deepcopy(candidate)
    for phase in result.get('phases',[]):
        for annotation in phase.get('annotations',[]):
            asset_id=annotation.pop('assetId',None)
            asset=next((a for a in evidence.node_assets[node_id] if a['assetId']==asset_id and a['frame']==annotation.get('anchorFrame')),None)
            if not asset: raise ValueError('图形坐标没有本轮实际发送且同锚帧的图片资产。')
            transform=asset['transform']; width,height=asset['sourceSize']
            for point in annotation.get('points',[]):
                x,y=point.get('x'),point.get('y')
                if any(isinstance(v,bool) or not isinstance(v,(int,float)) or not math.isfinite(v) for v in (x,y)):
                    raise ValueError('图形坐标必须是有限数值。')
                if not 0<=x<=asset['width'] or not 0<=y<=asset['height']: raise ValueError('图形坐标超出返回图片。')
                point['x']=(x-transform['offsetX'])/transform['scaleX']
                point['y']=(y-transform['offsetY'])/transform['scaleY']
                if not 0<=point['x']<=width or not 0<=point['y']<=height: raise ValueError('图形坐标超出原视频。')
    return result


def run_pi(start,evidence,output,config,cancel=None,process_callback=None):
    output=Path(output);output.mkdir(parents=True,exist_ok=True)
    node=shutil.which('node')
    if not node: raise ValueError('独立绘图需要 Node.js。')
    child_env,secret=provider_environment(ROOT/'.env',config['provider'],config['model'])
    child_env['COMMENTARY_MODEL_CONFIG']=json.dumps(config,ensure_ascii=False)
    process=subprocess.Popen([node,str(WORKER)],cwd=ROOT,env=child_env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,text=True,encoding='utf-8',bufsize=1,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    if process_callback: process_callback(process)
    messages=queue.Queue(); errors=[];trace=[]
    def read():
        for line in process.stdout: messages.put(line)
        messages.put(None)
    def read_errors():
        for line in process.stderr:
            errors.append(redact(line,secret)[-1500:]); del errors[:-20]
            (output/'worker-stderr.log').write_text(''.join(errors),encoding='utf-8')
    readers=[threading.Thread(target=read,daemon=True),threading.Thread(target=read_errors,daemon=True)]
    for reader in readers: reader.start()
    def send(value):
        process.stdin.write(json.dumps(value,ensure_ascii=False)+'\n');process.stdin.flush()
    deadline=time.monotonic()+start.get('config',{}).get('timeoutSeconds',240)+10
    methods={'read_node_frames':evidence.read_frames,'inspect_node_region':evidence.inspect_region,'get_node_positions':evidence.positions}
    result=None
    try:
        send({'type':'start',**start})
        while time.monotonic()<deadline:
            if cancel and cancel.is_set(): raise ValueError('绘图任务已取消。')
            try: line=messages.get(timeout=.2)
            except queue.Empty: continue
            if line is None: break
            try: message=json.loads(line)
            except ValueError: continue
            if message.get('type')=='rpc':
                method=message.get('method');entry={'method':method,'params':message.get('params')}
                try:
                    if start.get('mode')=='audit' or method not in methods: raise ValueError('本阶段不允许该工具。')
                    response=methods[method](message.get('params') or {})
                    entry['assets']=response.get('details',{}).get('assets',[])
                    send({'type':'rpc_result','id':message['id'],'result':response})
                except Exception as exc:
                    entry['error']=redact(str(exc),secret)
                    send({'type':'rpc_result','id':message['id'],'error':entry['error']})
                trace.append(entry)
            elif message.get('type')=='progress':
                trace.append(json.loads(redact(json.dumps(message,ensure_ascii=False),secret)))
                output.mkdir(parents=True,exist_ok=True)
                (output/'tool-calls.json').write_text(json.dumps(trace,ensure_ascii=False,indent=2),encoding='utf-8')
            elif message.get('type')=='result': result=message.get('result');break
    finally:
        if process.poll() is None:
            process.terminate()
            try: process.wait(timeout=3)
            except subprocess.TimeoutExpired: process.kill();process.wait(timeout=3)
        for reader in readers: reader.join(timeout=1)
        for stream in (process.stdin,process.stdout,process.stderr): stream.close()
        output.mkdir(parents=True,exist_ok=True)
        (output/'tool-calls.json').write_text(json.dumps(trace,ensure_ascii=False,indent=2),encoding='utf-8')
        if process_callback: process_callback(None)
    if not result: raise ValueError('独立 Pi worker 未返回完整结果。'+''.join(errors))
    result=json.loads(redact(json.dumps(result,ensure_ascii=False),secret))
    (output/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--video',type=Path,required=True);parser.add_argument('--input',type=Path,required=True);parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();payload=json.loads(args.input.read_text(encoding='utf-8'))
    video=CommentaryVideo(args.video,args.output/'images');evidence=DrawingEvidence(video,payload['nodes'],payload.get('review'))
    config,_=drawing_config(payload['plan'],payload.get('drawingModelOverride'))
    result=run_pi(payload,evidence,args.output,config)
    (args.output/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    return 0 if result.get('status')=='completed' else 2


if __name__=='__main__': raise SystemExit(main())
