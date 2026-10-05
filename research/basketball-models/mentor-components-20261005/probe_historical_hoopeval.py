"""Load the recovered 2025-11-03 checkpoint with its original model definition.

This is a synthetic-input compatibility probe, not a basketball quality evaluation.
Read and review upstream QTransformer.py and utils.py before running.
"""
import argparse
import hashlib
import json
import sys
import time
from pathlib import Path
from types import SimpleNamespace

import torch
import yaml


def summarize(value):
    if isinstance(value, dict):
        return {k: summarize(v) for k, v in value.items()}
    return {'shape': list(value.shape), 'finite': bool(torch.isfinite(value).all()),
            'min': float(value.min()), 'max': float(value.max())}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--repo', type=Path, required=True)
    parser.add_argument('--checkpoint', type=Path, required=True)
    parser.add_argument('--device', choices=['cpu', 'cuda'], default='cpu')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    sys.path.insert(0, str(args.repo.resolve()))
    from Model.QTransformer import QTransformer
    torch.manual_seed(42)
    torch.set_num_threads(4)
    checkpoint = torch.load(args.checkpoint, map_location='cpu', weights_only=True)
    config = yaml.safe_load((args.repo / 'conf/config.yaml').read_text(encoding='utf-8'))['qtransformer']
    config['device'] = args.device
    n, t = 12, config['time_steps']
    states = torch.randint(0, 504, (n, t, 1), device=args.device).float()
    ids = torch.tensor([0, *range(1, 11), 500], device=args.device)
    padding = torch.zeros(n, t, dtype=torch.bool, device=args.device)
    actions = torch.cat([torch.randint(0, 6, (1, t)),
                         torch.randint(6, 25, (5, t))]).to(args.device)
    edges = torch.tensor([(i, j) for i in range(n) for j in range(n) if i != j],
                         device=args.device).T
    distances = torch.rand(1, t, 132, 1, device=args.device)
    report = {'source_commit': '3a75cad8f024e457be1b76f90ea176cb59037104',
        'checkpoint_sha256': hashlib.sha256(args.checkpoint.read_bytes()).hexdigest(),
        'checkpoint_bytes': args.checkpoint.stat().st_size,
        'checkpoint_epoch': checkpoint.get('epoch'),
        'checkpoint_global_step': checkpoint.get('global_step'),
        'lightning_version': checkpoint.get('pytorch-lightning_version'),
        'ema_initted': bool(checkpoint['state_dict']['ema_model.initted']),
        'ema_step': int(checkpoint['state_dict']['ema_model.step']),
        'torch_version': torch.__version__, 'device': args.device,
        'seed': 42, 'input_kind': 'synthetic tensors with valid token ranges; not real tracking',
        'quality_evaluation': False, 'paper_final_model_identity_confirmed': False,
        'inputs': {'states': list(states.shape), 'actions': list(actions.shape),
                   'edge_attr': list(distances.shape)}, 'models': {}}
    for label, prefix in [('online', 'model.'), ('ema', 'ema_model.ema_model.')]:
        model = QTransformer(SimpleNamespace(**config)).to(args.device).eval()
        state = {k[len(prefix):]: v for k, v in checkpoint['state_dict'].items() if k.startswith(prefix)}
        try:
            result = model.load_state_dict(state, strict=True)
            with torch.inference_mode():
                start = time.perf_counter()
                output = model(states, ids, padding, actions, edges, distances)
                if args.device == 'cuda':
                    torch.cuda.synchronize()
                duration = (time.perf_counter() - start) * 1000
            report['models'][label] = {'strict_load': True, 'state_entries': len(state),
                'is_initialized_ema': bool(checkpoint['state_dict']['ema_model.initted']) if label == 'ema' else None,
                'missing_keys': result.missing_keys, 'unexpected_keys': result.unexpected_keys,
                'parameter_count': sum(p.numel() for p in model.parameters()),
                'outputs': summarize(output), 'first_forward_ms': duration}
        except Exception as exc:
            report['models'][label] = {'error': type(exc).__name__ + ': ' + str(exc)}
    args.output.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report))


if __name__ == '__main__':
    main()
