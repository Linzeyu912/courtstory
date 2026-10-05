"""Reproduce source-only probes. No training, checkpoint loading or production writes.

Run each mode in a fresh process: both upstream repositories name their package Model.
"""
import argparse
import hashlib
import io
import json
import pickle
import platform
import random
import subprocess
import sys
import time
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import torch


def timed(call, device, repeats=5):
    with torch.inference_mode():
        value = call()
        samples = []
        for _ in range(repeats):
            if device == 'cuda':
                torch.cuda.synchronize()
            start = time.perf_counter()
            value = call()
            if device == 'cuda':
                torch.cuda.synchronize()
            samples.append((time.perf_counter() - start) * 1000)
    return value, {'repeats_after_one_warmup': repeats, 'median_ms': float(np.median(samples))}


def tensors(value):
    if isinstance(value, torch.Tensor):
        return {'shape': list(value.shape), 'finite': bool(torch.isfinite(value).all())}
    if isinstance(value, dict):
        return {key: tensors(v) for key, v in value.items()}
    return value


def transformer(repo, device):
    from Model.encoder import Encoder
    from Model.decoder import Decoder
    from DataLoader.collect import create_batch_A, create_batch_B, create_batch_C
    # Synthetic SportVU-like motion at 25 Hz; 5 offense + 5 defense + ball.
    agents = []
    for i in range(11):
        x = 10 + i + np.arange(200) * .02
        agents.append(SimpleNamespace(teamid=-1 if i == 0 else 1 if i <= 5 else 2,
            x=x.tolist(), y=(x * .1 + 4).tolist(), v=np.full(200, .503).tolist()))
    scene = SimpleNamespace(agents=agents, off_teamid=1, def_teamid=2,
                            time_24s=(24-np.arange(200)*.04).tolist())
    collators = {}
    for name, fn in [('A', create_batch_A), ('B', create_batch_B), ('C', create_batch_C)]:
        try:
            result = fn([scene])
            collators[name] = {'status': 'ok', 'states': list(result[0].shape)}
        except Exception as exc:
            collators[name] = {'status': 'error', 'error': type(exc).__name__ + ': ' + str(exc)}
    batch = create_batch_C([scene])
    states, mask, padding, hidden, _, ids = batch
    states, mask, padding, hidden, ids = [v.to(device) for v in [states,mask,padding,hidden,ids]]
    enc = Encoder(torch.device(device), 3, 121, 256, 4, 4).to(device).eval()
    dec = Decoder(torch.device(device),121,256,4,4,6).to(device).eval()
    def run():
        encoded = enc(states,mask,padding,hidden,ids)['out']
        return {'encoding':encoded,'prediction':dec(encoded,mask,padding).permute(1,2,0,3)}
    value, timing = timed(run, device)
    return {'input_kind':'synthetic motion; untrained random initialization',
            'collators':collators,'input':tensors(states),'outputs':tensors(value),
            'parameter_count':sum(p.numel() for m in [enc,dec] for p in m.parameters()),
            'timing':timing,'quality_evaluation':False,'checkpoint_loaded':False}


def evaluation(repo, device):
    import yaml
    from Model.QTransformer import QTransformer
    config = yaml.safe_load((repo/'conf/config.yaml').read_text(encoding='utf-8'))['qtransformer']
    config['device'] = device
    cfg = SimpleNamespace(**config)
    model = QTransformer(cfg).to(device).eval()
    n,t = 12,cfg.time_steps
    states = torch.rand(n,t,4,device=device)
    ids = torch.tensor([0,*range(1,11),500],device=device)
    padding = torch.zeros(n,t,dtype=torch.bool,device=device)
    # The core forward flattens batch and six action agents: [B*6,T].
    actions = torch.zeros(6,t,dtype=torch.long,device=device)
    edge_index = torch.tensor([(i,j) for i in range(n) for j in range(n) if i != j],device=device).T
    edge_attr = torch.rand(1,t,132,2,device=device)
    def run():
        return model(states,ids,padding,actions,edge_index,edge_attr)
    value,timing = timed(run, device)
    return {'input_kind':'synthetic tensors; untrained random initialization',
            'inputs':tensors({'states':states,'actions':actions,'edge_attr':edge_attr}),
            'outputs':tensors(value),'parameter_count':sum(p.numel() for p in model.parameters()),
            'timing':timing,'quality_evaluation':False,'checkpoint_loaded':False}


def embeddings(repo, device):
    # Upstream .npy contains NumPy object arrays of Torch tensors. Do not enable
    # unrestricted pickle. Restrict globals; nested Torch storages use weights_only.
    from collections import OrderedDict
    from numpy._core.multiarray import _reconstruct
    def storage_from_bytes(value):
        return torch.load(io.BytesIO(value),map_location='cpu',weights_only=True)
    allowed={('numpy.core.multiarray','_reconstruct'):_reconstruct,
             ('numpy','ndarray'):np.ndarray,('numpy','dtype'):np.dtype,
             ('torch._utils','_rebuild_tensor_v2'):torch._utils._rebuild_tensor_v2,
             ('torch.storage','_load_from_bytes'):storage_from_bytes,
             ('collections','OrderedDict'):OrderedDict}
    class RestrictedArrayReader(pickle.Unpickler):
        def find_class(self,module,name):
            if (module,name) not in allowed:
                raise pickle.UnpicklingError(f'Disallowed global: {module}.{name}')
            return allowed[module,name]
    files = sorted((repo/'Embedding_List').glob('*.npy'),key=lambda p:int(p.stem.split('_')[-1]))
    arrays=[]
    manifest=[]
    for p in files:
        with p.open('rb') as stream:
            version=np.lib.format.read_magic(stream)
            if version!=(1,0):raise ValueError('Unexpected NPY version')
            shape,fortran,dtype=np.lib.format.read_array_header_1_0(stream)
            if not dtype.hasobject:raise ValueError('Expected upstream object format')
            objects=RestrictedArrayReader(stream).load()
        a=np.stack([v.detach().cpu().numpy() if isinstance(v,torch.Tensor) else np.asarray(v,dtype=np.float32) for v in objects])
        manifest.append({'file':p.name,'shape':list(a.shape),'dtype':str(a.dtype),
                         'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
        arrays.append(a)
    shapes={tuple(a.shape[1:]) for a in arrays}
    if len(shapes)!=1:
        return {'manifest':manifest,'error':'incompatible trailing shapes'}
    matrix=np.concatenate(arrays,axis=0)
    flat=matrix.reshape(matrix.shape[0],-1)
    finite=bool(np.isfinite(flat).all())
    norms=np.linalg.norm(flat,axis=1)
    unit=flat/np.maximum(norms[:,None],1e-12)
    start=time.perf_counter()
    scores=unit@unit[0]
    nearest=np.argsort(scores)[-6:][::-1]
    elapsed=(time.perf_counter()-start)*1000
    metadata=(repo/'embedding_detail.csv').read_text(encoding='utf-8-sig').splitlines()
    return {'input_kind':'published precomputed embeddings; no checkpoint',
            'files':manifest,'matrix_shape':list(matrix.shape),'all_finite':finite,
            'zero_norm_rows':int((norms==0).sum()),'metadata_rows':len(metadata)-1,
            'row_count_matches_metadata':len(metadata)-1==len(matrix),
            'query_row':0,'nearest_rows_including_self':nearest.tolist(),
            'cosine_scores':scores[nearest].tolist(),'single_query_ms':elapsed,
            'semantic_accuracy_evaluated':False,
            'row_alignment_note':'Numeric filename order and row counts checked; semantic mapping not verified.'}


def mssl(repo, device):
    from Backbone.hoop_mssl_model import HoopMssl_V1
    model=HoopMssl_V1().to(device).eval()
    with torch.inference_mode():
        result=model(torch.rand(1,121,11,3,device=device))
    return {'outputs':[tensors(v) for v in result],'checkpoint_loaded':False,
            'implementation':'third-party reproduction, not author release'}


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('mode',choices=['transformer','evaluation','embeddings','mssl'])
    parser.add_argument('--repo',type=Path,required=True)
    parser.add_argument('--device',choices=['cpu','cuda'],default='cpu')
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    args.repo=args.repo.resolve()
    sys.path.insert(0,str(args.repo))
    torch.manual_seed(42);np.random.seed(42);random.seed(42)
    torch.set_num_threads(4)
    report={'mode':args.mode,'seed':42,'device':args.device,'python':platform.python_version(),
            'torch':torch.__version__,'numpy':np.__version__,
            'source_commit':subprocess.check_output(['git','-C',str(args.repo),'rev-parse','HEAD'],text=True).strip()}
    if args.device=='cuda':
        torch.cuda.reset_peak_memory_stats()
        report['gpu']=torch.cuda.get_device_name()
    try:
        report['result']=globals()[args.mode](args.repo,args.device)
        report['status']='completed'
    except Exception as exc:
        import traceback
        report['status']='failed';report['error']=str(exc)
        report['traceback']=traceback.format_exc().replace(str(Path.cwd()),'<workspace>').replace(str(Path.home()),'<user>')
    if args.device=='cuda':
        report['peak_allocated_mib']=torch.cuda.max_memory_allocated()/2**20
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({k:v for k,v in report.items() if k!='result'},ensure_ascii=False))
    if report['status']=='completed':print(json.dumps({k:v for k,v in report['result'].items() if k!='files'},ensure_ascii=False))


if __name__=='__main__':
    main()
