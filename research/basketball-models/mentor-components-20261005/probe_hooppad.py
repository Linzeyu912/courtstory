"""Read-only checkpoint probe on public author examples; not an independent benchmark."""
import argparse,contextlib,hashlib,io,json,pickle,platform,subprocess,sys,time
from pathlib import Path
import numpy as np
import torch


def main():
    p=argparse.ArgumentParser()
    p.add_argument('--repo',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True)
    args=p.parse_args();repo=args.repo.resolve();server=repo/'server'
    sys.path.insert(0,str(server));torch.set_num_threads(4);torch.manual_seed(42)
    from Model.possession import Possession,Player
    from Model.encoder import Encoder
    from Model.decoder import Decoder_MR
    from Model.qsq import Net,Qsq,cal_Qsq_batch_
    from Data.dataload import create_def
    from numpy._core.multiarray import _reconstruct
    class SafeSample(pickle.Unpickler):
        def find_class(self,module,name):
            allowed={('Model.possession','Possession'):Possession,('Model.possession','Player'):Player,
                     ('numpy.core.multiarray','_reconstruct'):_reconstruct,
                     ('numpy','ndarray'):np.ndarray,('numpy','dtype'):np.dtype}
            if (module,name) not in allowed:raise pickle.UnpicklingError(f'Unexpected {module}.{name}')
            return allowed[module,name]
    report={'source_commit':subprocess.check_output(['git','-C',str(repo),'rev-parse','HEAD'],text=True).strip(),
            'python':platform.python_version(),'torch':torch.__version__,'device':'cpu','seed':42,
            'boundary':'Public author examples may overlap training. Full future offense and ball trajectories are conditioned on. Not causal forecasting or project video validation.',
            'runs':[]}
    # Establish whether the unmodified application's model loader works.
    try:
        from App.defense_generator import load_model
        load_model(str(server/'Checkpoints/V1_predict_def.ckpt'))
        report['upstream_loader']='success'
    except Exception as e:
        report['upstream_loader']={'error':type(e).__name__,'detail':str(e)}
    qpath=server/'App/qsq.ckpt'
    qs=torch.load(qpath,map_location='cpu',weights_only=True)
    qmodel=Qsq(Net(5,128,1)).eval();qmodel.load_state_dict(qs['state_dict'],strict=True)
    report['qsq']={'sha256':hashlib.sha256(qpath.read_bytes()).hexdigest(),'strict_load':True,
                   'probability_calibration_verified':False}
    samples=[]
    for sample in sorted((server/'Data').glob('object_*.pkl')):
        with sample.open('rb') as stream:scene=SafeSample(stream).load()
        samples.append((sample,create_def([scene])))
    report['sample_count']=len(samples)
    for weight in sorted((server/'Checkpoints').glob('*.ckpt')):
        run={'weight':weight.name,'bytes':weight.stat().st_size,'sha256':hashlib.sha256(weight.read_bytes()).hexdigest()}
        try:
            ckpt=torch.load(weight,map_location='cpu',weights_only=True)
            state=ckpt['state_dict']
            enc_state={k.removeprefix('model.encoder.'):v for k,v in state.items() if k.startswith('model.encoder.')}
            dec_state={k.removeprefix('model.decoder.'):v for k,v in state.items() if k.startswith('model.decoder.')}
            channels=dec_state['layer_Z1.0.weight'].shape[0]
            modes=dec_state['layer_T.0.weight'].shape[1]-256
            enc=Encoder(torch.device('cpu'),3,121,256,4,4).eval()
            dec=Decoder_MR(torch.device('cpu'),121,256,4,channels,modes).eval()
            enc.load_state_dict(enc_state,strict=True);dec.load_state_dict(dec_state,strict=True)
            run.update({'status':'completed','strict_core_load':True,'decoder_output_channels':channels,
                        'decoder_modes':modes,'epoch':ckpt.get('epoch'),'global_step':ckpt.get('global_step'),
                        'unused_checkpoint_keys':[k for k in state if not k.startswith(('model.encoder.','model.decoder.'))],
                        'samples':[]})
            for sample,batch in samples:
                states,mask,padding,hidden,_,ids,teams,_,_=batch
                with torch.inference_mode():
                    start=time.perf_counter()
                    out=dec(enc(states,mask,padding,hidden,ids)['out'],mask,padding,hidden).permute(1,2,0,3)
                    ms=(time.perf_counter()-start)*1000
                    # All released motion checkpoints tested with their first mode.
                    xy=out[:,:,0,::2][:,:,:2]
                    valid=hidden & ~padding & (teams==2)[:,None]
                    errors=torch.linalg.vector_norm(xy-states[:,:,:2],dim=-1)[valid]
                    baseline=states[:,4:5,:2].expand(-1,121,-1)
                    base_errors=torch.linalg.vector_norm(baseline-states[:,:,:2],dim=-1)[valid]
                    ghost=xy.clone();ghost[teams!=2]=states[teams!=2,:,:2]
                    qreal=[];qghost=[]
                    with contextlib.redirect_stdout(io.StringIO()):
                        for t in torch.where(~padding[0])[0].tolist():
                            qreal.extend(cal_Qsq_batch_(states[:,t],states[:,t,:2],teams,qmodel).flatten().tolist())
                            qghost.extend(cal_Qsq_batch_(states[:,t],ghost[:,t],teams,qmodel).flatten().tolist())
                    positions=xy[valid]
                    run['samples'].append({'file':sample.name,'sha256':hashlib.sha256(sample.read_bytes()).hexdigest(),
                        'valid_hidden_defender_points':int(valid.sum()),'finite':bool(torch.isfinite(out).all()),
                        'forward_ms':ms,'ade_metres':float(errors.mean()*.3048),
                        'stationary_at_last_observed_ade_metres':float(base_errors.mean()*.3048),
                        'out_of_full_court_fraction':float(((positions[:,0]<0)|(positions[:,0]>94)|(positions[:,1]<0)|(positions[:,1]>50)).float().mean()),
                        'qsq_real_range':[min(qreal),max(qreal)],'qsq_ghost_range':[min(qghost),max(qghost)]})
            run['mean_of_clip_ade_metres']=float(np.mean([s['ade_metres'] for s in run['samples']]))
            run['mean_of_clip_stationary_ade_metres']=float(np.mean([s['stationary_at_last_observed_ade_metres'] for s in run['samples']]))
            run['median_forward_ms']=float(np.median([s['forward_ms'] for s in run['samples']]))
        except Exception as e:run.update({'status':'failed','error':type(e).__name__+': '+str(e)})
        report['runs'].append(run)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({**report,'runs':[{k:v for k,v in r.items() if k!='samples'} for r in report['runs']]},ensure_ascii=True))


if __name__=='__main__':main()
