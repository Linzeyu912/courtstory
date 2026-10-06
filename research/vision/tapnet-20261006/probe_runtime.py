"""Probe the official TAPNext++ wrapper with RANDOM weights, never accuracy.

No downloads, dependency installation, video reads, or production writes.
Run from the repository root; see README.md for interpretation and commands.
"""

from __future__ import annotations

import argparse
from datetime import datetime
import gc
import json
from pathlib import Path
import statistics
import subprocess
import sys
import time
from zoneinfo import ZoneInfo


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--frames", type=int, default=3)
    args = parser.parse_args()
    if args.frames < 2:
        parser.error("--frames must be at least 2")
    sys.path.insert(0, str(args.source.resolve()))
    import numpy as np
    import torch
    import torchvision
    from tapnet.tapnext.tapnext_torch import TAPNext
    from tapnet.tapnextpp.votsp2026.model import TAPNextPP
    from tapnet.tapnextpp.votsp2026 import utils

    commit = subprocess.check_output(
        ["git", "-C", str(args.source), "rev-parse", "HEAD"], text=True
    ).strip()
    torch.manual_seed(20261006)
    rng = np.random.default_rng(20261006)
    frame = rng.integers(0, 256, (1080, 1920, 3), dtype=np.uint8)
    query_xy = np.array(
        [[100, 100], [300, 700], [700, 300], [960, 540], [1500, 900], [1800, 400]],
        dtype=np.float32,
    )
    restored = utils.model_to_display(
        utils.display_to_model(query_xy, 1080, 1920), 1080, 1920
    )
    result = {
        "collected_at": datetime.now(ZoneInfo("Asia/Shanghai")).isoformat(),
        "source_commit": commit,
        "scope": "RANDOM weights; repeated synthetic frame; API/runtime only; NOT tracking quality or trained-model throughput",
        "checkpoint_loaded": False,
        "synthetic_initialization": "ALL parameters explicitly normal_(mean=0, std=0.02); upstream custom layers contain torch.empty until checkpoint loading",
        "python": sys.version.split()[0],
        "torch": torch.__version__,
        "torchvision": torchvision.__version__,
        "cuda_available": torch.cuda.is_available(),
        "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
        "gpu_total_bytes": torch.cuda.get_device_properties(0).total_memory if torch.cuda.is_available() else None,
        "cpu_threads": torch.get_num_threads(),
        "coordinate_roundtrip_max_error_px": float(np.abs(restored - query_xy).max()),
        "runs": [],
    }
    configs = [("cpu", 256)]
    if torch.cuda.is_available():
        configs += [("cuda", 256), ("cuda", 512)]
    for device_name, resolution in configs:
        model = inner = state = None
        device = torch.device(device_name)
        row = {"device": device_name, "input_resolution": resolution,
               "coordinate_space": 256, "query_points": len(query_xy),
               "frames": args.frames, "compiled": False,
               "cuda_autocast_float16": device_name == "cuda"}
        try:
            if device_name == "cuda":
                torch.cuda.empty_cache()
                torch.cuda.reset_peak_memory_stats()
            started = time.perf_counter()
            inner = TAPNext(image_size=(256, 256))
            # Upstream custom layers use torch.empty and rely on checkpoint load.
            # Fully initialise them for a reproducible, finite interface probe.
            with torch.no_grad():
                for parameter in inner.parameters():
                    parameter.normal_(mean=0.0, std=0.02)
            inner = inner.to(device).eval()
            model = TAPNextPP(inner, device, input_resolution=resolution)
            row["parameters"] = sum(p.numel() for p in inner.parameters())
            if device_name == "cuda":
                torch.cuda.synchronize()
            row["initialization_seconds"] = time.perf_counter() - started
            times = []
            states = []
            for i in range(args.frames):
                started = time.perf_counter()
                positions, visible, state = model.track_frame(
                    frame, query_points_xy=query_xy if i == 0 else None, state=state
                )
                if device_name == "cuda":
                    torch.cuda.synchronize()
                times.append(time.perf_counter() - started)
                assert positions.shape == (len(query_xy), 2), f"positions shape: {positions.shape}"
                assert visible.shape == (len(query_xy),), f"visibility shape: {visible.shape}"
                assert np.isfinite(positions).all(), f"nonfinite positions at frame {i}"
                assert state.step == i + 1, f"state step: {state.step} at frame {i}"
                states.append(state.step)
            row.update(status="passed", frame_seconds=times,
                       followup_median_seconds=statistics.median(times[1:]),
                       output_shape=list(positions.shape), state_steps=states)
            if device_name == "cuda":
                row["peak_allocated_bytes"] = torch.cuda.max_memory_allocated()
                row["peak_reserved_bytes"] = torch.cuda.max_memory_reserved()
        except Exception as exc:
            row.update(status="failed", error=f"{type(exc).__name__}: {exc}")
        finally:
            result["runs"].append(row)
            print(json.dumps(row, ensure_ascii=False), flush=True)
            del model, inner, state
            gc.collect()
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
