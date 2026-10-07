"""Bounded, offline official PyTorch TAPIR experiment; no production imports/writes.

Run with an existing CUDA PyTorch Python. Small missing dependencies are extracted
into --cache/deps, never installed into that Python's environment. All downloads
are version/hash pinned. Existing completed outputs are never overwritten.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import sys
import time
import traceback
import urllib.request
import zipfile


COMMIT = "730cda1c730877cfedbe01bf87fb1cadb78a565d"
SOURCE_HASHES = {
    "LICENSE": "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30",
    "README.md": "c0cda10a66a91513fd78e1638ff6db7789d4320dc24e5897ce6bc1bd567c15c3",
    "colabs/torch_tapir_demo.ipynb": "1eae7b199b4c9800e1e1d97295ed9b7b058a53d938e8417bd3c14caf0fe355d3",
    "configs/tapir_config.py": "642cbd46ad1ac6fbd75bc8f4c964d974b33692aff87567a0d0224deb8720e021",
    "tapnet/__init__.py": "35b29d7968272465e0f9cbb0d2c1035003ef96b140f4de7516eb85a047ec9ab3",
    "tapnet/torch/__init__.py": "f7c8d8c66e2f93ac350ce82c03f02152ffc82524cd120ebc944c931b6ea879e1",
    "tapnet/torch/nets.py": "4961a8e4882e8c9ac219c4714f6f2c811cc1ab665a439d4d2e79942002a9517c",
    "tapnet/torch/tapir_model.py": "87c05fb17d48d0f4353a00b67c9d40d3a264e13e43d88e3f7b5829119845e3ba",
    "tapnet/torch/utils.py": "a4267b3a6bd8ecf2dfe5effacab9f7a43664dc5d08966c98f6a0cc68f5ccedd3",
}
WHEELS = [
    ("einshape", "1.0", "einshape-1.0-py3-none-any.whl", "42da4c2dea3a27f87ee45a7cee5072a636b97cb184bb07bf5d6412ba0ff7b965"),
    ("dm-tree", "0.1.10", "dm_tree-0.1.10-cp313-cp313-win_amd64.whl", "b42e04482880b017d931511d7b5997be372fff26a1ee9b9be55eef03ef1c2918"),
    ("attrs", "26.1.0", "attrs-26.1.0-py3-none-any.whl", "c647aa4a12dfbad9333ca4e71fe62ddc36f4e63b2d260a37a8b83d2f043ac309"),
    ("wrapt", "2.5.0", "wrapt-2.5.0-cp313-cp313-win_amd64.whl", "77f0a74ff6f6cf89f5b673a732d5afe1911a6e6b1c017260836fdfdf85518dc1"),
    ("absl-py", "2.5.0", "absl_py-2.5.0-py3-none-any.whl", "0f17b89f2a4eaaedc4f28c622998aa690564b3012a396a4ffad0821007fe03ba"),
]
WEIGHT_URL = "https://storage.googleapis.com/dm-tapnet/tapir_checkpoint_panning.pt"
WEIGHT_SHA256 = "628611c656b3bd65d4a70fbf5526b62afe82d1b085ce6044685287fb78509daa"
VIDEO_SHA256 = "17c36f8d3b3e294f13f7119f23b82ec7f3fbe96d5564db9cbe7d61f49ebbbd7d"
VIDEO_REL = "data/videos/uploads/2026-10-03-batch02/clips/05_Pacers_20250106_Q2_0m44_team_motion_720p_silent.mp4"
CLIP_REL = "artifacts/direct-video-vs-court-20261006/bridge-run-01/clip.json"
SEED_RULE = (
    "Before inference: first even source frame in [570,620] whose T2 detector "
    "confidence is >=0.65 and torso.reliable=true and torso.reason=clear-torso; "
    "fixed bbox-relative candidate offsets; no output-based seed selection."
)
SEED_CANDIDATES = [
    ("torso_upper", 0.55, 0.30),
    ("torso_lower", 0.55, 0.43),
    ("hip_candidate", 0.58, 0.58),
    ("ankle_candidate", 0.72, 0.88),
]


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def write_json(path: Path, value) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")


def download(url: str, path: Path, expected: str) -> dict:
    started = time.perf_counter()
    if path.exists() and sha256(path) == expected:
        return {"url": url, "sha256": expected, "bytes": path.stat().st_size, "cached": True, "seconds": time.perf_counter() - started}
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".partial")
    with urllib.request.urlopen(url, timeout=60) as response, temporary.open("wb") as f:
        while block := response.read(1024 * 1024):
            f.write(block)
    actual = sha256(temporary)
    if actual != expected:
        raise ValueError(f"Download hash mismatch for {url}: {actual}")
    temporary.replace(path)
    return {"url": url, "sha256": actual, "bytes": path.stat().st_size, "cached": False, "seconds": time.perf_counter() - started}


def prepare(cache: Path) -> dict:
    started = time.perf_counter()
    if sys.version_info[:2] != (3, 13) or platform.system() != "Windows":
        raise RuntimeError("This recorded dependency lock is CPython 3.13 Windows x64; do not silently choose another wheel.")
    source = []
    for name, expected in SOURCE_HASHES.items():
        url = f"https://raw.githubusercontent.com/google-deepmind/tapnet/{COMMIT}/{name}"
        source.append({"path": name, **download(url, cache / "upstream" / name, expected)})
    dependencies = []
    target = cache / "deps"
    target.mkdir(parents=True, exist_ok=True)
    for name, version, filename, expected in WHEELS:
        wheel_path = cache / "wheels" / filename
        if wheel_path.exists() and sha256(wheel_path) == expected:
            record = {"cached": True, "sha256": expected, "bytes": wheel_path.stat().st_size}
        else:
            with urllib.request.urlopen(f"https://pypi.org/pypi/{name}/{version}/json", timeout=60) as response:
                metadata = json.load(response)
            wheel = next(x for x in metadata["urls"] if x["filename"] == filename)
            if wheel["digests"]["sha256"] != expected:
                raise ValueError(f"Pinned PyPI digest mismatch: {filename}")
            record = download(wheel["url"], wheel_path, expected)
        # Each member must remain in this isolated dependency directory.
        with zipfile.ZipFile(wheel_path) as archive:
            for member in archive.infolist():
                if not (target / member.filename).resolve().is_relative_to(target.resolve()):
                    raise ValueError(f"Unsafe wheel member: {member.filename}")
            archive.extractall(target)
        dependencies.append({"name": name, "version": version, "filename": filename, **record})
    checkpoint = download(WEIGHT_URL, cache / "tapir_checkpoint_panning.pt", WEIGHT_SHA256)
    return {"source_commit": COMMIT, "source": source, "dependencies": dependencies, "checkpoint": checkpoint, "seconds": time.perf_counter() - started}


def pick_seed(clip: dict) -> tuple[dict, list, dict]:
    for frame in clip["frames"]:
        if not (570 <= frame["frame"] <= 620 and frame["frame"] % 2 == 0):
            continue
        track = next((t for t in frame["tracks"] if t[4] == 2), None)
        evidence = frame.get("track_evidence", {}).get("2", {})
        torso = evidence.get("torso", {})
        if track and track[5] >= 0.65 and torso.get("reliable") is True and torso.get("reason") == "clear-torso":
            return frame, track, evidence
    raise RuntimeError("No seed meets the predeclared selection rule; do not hand-pick a replacement.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[3])
    parser.add_argument("--cache", type=Path, default=Path("tmp/tapir-probe-20261006"))
    parser.add_argument("--output", type=Path, default=Path("artifacts/tapir-direct-video-20261006/inference"))
    parser.add_argument("--prepare-only", action="store_true")
    parser.add_argument("--width", type=int, default=512, choices=[512, 384, 256])
    parser.add_argument("--square", action="store_true", help="Explicit diagnostic: resize to width x width; source x/y scales recorded separately.")
    args = parser.parse_args()
    root = args.root.resolve()
    cache = (root / args.cache).resolve()
    output = (root / args.output).resolve()
    if not cache.is_relative_to(root) or not output.is_relative_to(root):
        raise ValueError("Cache and output must remain inside the supplied repository root.")
    if output.exists() and any((output / name).exists() for name in ("result.json", "manifest.json", "failure.json")):
        raise FileExistsError("Existing experimental output is preserved; supply a fresh --output path.")
    overall = time.perf_counter()
    preparation = prepare(cache)
    if args.prepare_only:
        write_json(cache / "reproduction-setup.json", preparation)
        print(json.dumps({"prepared": True, "seconds": preparation["seconds"]}), flush=True)
        return 0
    output.mkdir(parents=True, exist_ok=True)
    timings = {"cache_preparation_seconds": preparation["seconds"], "warm_inference_seconds": None}
    manifest = {"status": "starting", "schema_version": "tapir-probe-manifest-v1", "setup": preparation, "timings": timings}
    try:
        started = time.perf_counter()
        sys.path[:0] = [str(cache / "deps"), str(cache / "upstream")]
        import av
        import cv2
        import numpy as np
        import torch
        from tapnet.torch import tapir_model
        from tapnet.torch import utils
        timings["imports_seconds"] = time.perf_counter() - started
        if not torch.cuda.is_available():
            raise RuntimeError("CUDA unavailable; CPU is not a silently substituted result.")
        torch.set_num_threads(min(8, os.cpu_count() or 1))
        torch.manual_seed(20261006)
        np.random.seed(20261006)
        video = root / VIDEO_REL
        clip_path = root / CLIP_REL
        if sha256(video) != VIDEO_SHA256:
            raise ValueError("Video bytes differ from the shared comparison source.")
        clip = json.loads(clip_path.read_text(encoding="utf-8"))
        seed_frame, seed_track, seed_evidence = pick_seed(clip)
        width = args.width
        height = width if args.square else round(width * 720 / 1280 / 8) * 8
        sx, sy = width / 1280, height / 720
        selected = list(range(570, 870, 2))
        mapping, resized = [], []
        raw_seed = None
        started = time.perf_counter()
        with av.open(str(video)) as container:
            stream = container.streams.video[0]
            video_meta = {"width": stream.width, "height": stream.height, "reported_frames": stream.frames, "average_rate": str(stream.average_rate), "time_base": [stream.time_base.numerator, stream.time_base.denominator]}
            for source_index, frame in enumerate(container.decode(stream)):
                if source_index >= 870:
                    break
                if source_index < 570 or source_index % 2:
                    continue
                rgb = frame.to_ndarray(format="rgb24")
                if source_index == seed_frame["frame"]:
                    raw_seed = rgb.copy()
                resized.append(cv2.resize(rgb, (width, height), interpolation=cv2.INTER_AREA))
                mapping.append({"model_frame": len(mapping), "source_frame": source_index, "source_pts": frame.pts, "time_base": [frame.time_base.numerator, frame.time_base.denominator], "source_time_seconds": float(frame.pts * frame.time_base)})
        if [m["source_frame"] for m in mapping] != selected:
            raise ValueError("Video decode did not produce the exact predeclared source-frame mapping.")
        timings["decode_resize_seconds"] = time.perf_counter() - started
        frames_u8 = np.stack(resized)
        queries, tyx = [], []
        t_seed = selected.index(seed_frame["frame"])
        seed_visual = cv2.cvtColor(raw_seed, cv2.COLOR_RGB2BGR)
        for qi, (name, rx, ry) in enumerate(SEED_CANDIDATES):
            x = seed_track[0] + (seed_track[2] - seed_track[0]) * rx
            y = seed_track[1] + (seed_track[3] - seed_track[1]) * ry
            q = {"query_id": name, "semantic": "bbox-relative visible-body candidate; anatomical label is approximate, not pose or ground-contact truth", "bbox_relative_xy": [rx, ry], "seed_source_frame": seed_frame["frame"], "seed_xy_source": [x, y], "seed_tyx_model": [t_seed, y * sy, x * sx]}
            queries.append(q)
            tyx.append(q["seed_tyx_model"])
            cv2.circle(seed_visual, (round(x), round(y)), 3, (0, 0, 255), 1)
            cv2.putText(seed_visual, str(qi + 1), (round(x) + 5, round(y)), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (0, 255, 255), 1)
        seeds = {"selection_rule": SEED_RULE, "source_frame": seed_frame["frame"], "detector_track_id": 2, "detector_bbox_xyxy": seed_track[:4], "detector_confidence": seed_track[5], "detector_evidence": seed_evidence, "queries": queries, "human_clicks": False, "ground_truth": False, "visual_audit": "Before any inference: frame 604 inspected; offsets kept unchanged. Four candidates lie on/near body boundaries; torso names can cover upper arm or jersey edge. Detector clear-torso is not a guarantee against referee/limb overlap."}
        write_json(output / "seeds.json", seeds)
        write_json(output / "frame_mapping.json", mapping)
        cv2.imwrite(str(output / "seed-frame.png"), seed_visual)
        np.savez_compressed(output / "input.npz", video_uint8=frames_u8, query_points_tyx=np.asarray(tyx, dtype=np.float32), source_frames=np.asarray(selected, dtype=np.int64))
        config = {"pyramid_level": 0, "extra_convs": False, "feature_extractor_chunk_size": 5, "use_casual_conv": False}
        started = time.perf_counter()
        model = tapir_model.TAPIR(**config)
        state = torch.load(cache / "tapir_checkpoint_panning.pt", map_location="cpu", weights_only=True)
        strict_load = model.load_state_dict(state, strict=True)
        model = model.eval().to("cuda")
        del state
        torch.cuda.synchronize()
        timings["model_load_to_gpu_seconds"] = time.perf_counter() - started
        started = time.perf_counter()
        video_tensor = torch.from_numpy(frames_u8).to("cuda", dtype=torch.float32).unsqueeze(0) / 255 * 2 - 1
        query_tensor = torch.tensor(tyx, dtype=torch.float32, device="cuda").unsqueeze(0)
        torch.cuda.synchronize()
        timings["gpu_input_upload_normalize_seconds"] = time.perf_counter() - started
        resolutions = utils.generate_default_resolutions((height, width), (256, 256))
        manifest.update({"source": {"video": VIDEO_REL, "video_sha256": sha256(video), "clip": CLIP_REL, "clip_sha256": sha256(clip_path), "metadata": video_meta}, "model": {"name": "official PyTorch standard TAPIR", "offline_noncausal": True, "config": config, "refinement_resolutions_hw": resolutions, "query_chunk_size": 4, "precision": "float32", "strict_checkpoint_load": str(strict_load)}, "runtime": {"python": sys.version, "platform": platform.platform(), "torch": torch.__version__, "cuda_runtime": torch.version.cuda, "gpu": torch.cuda.get_device_name(0), "gpu_total_bytes": torch.cuda.get_device_properties(0).total_memory, "numpy": np.__version__, "opencv": cv2.__version__, "pyav": av.__version__}, "transform": {"source_wh": [1280, 720], "model_wh": [width, height], "xy_source_to_model_scale": [sx, sy], "xy_model_to_source_scale": [1 / sx, 1 / sy], "resize": "OpenCV INTER_AREA; no crop, no letterbox", "coordinates": "TAPIR raster convention: upper-left boundary (0,0), lower-right boundary (width,height); query order t,y,x, output order x,y"}, "seed_rule": SEED_RULE, "sample_count": len(selected), "source_frame_interval_half_open": [570, 870], "source_frame_stride": 2, "source_query_frame": seed_frame["frame"], "probe_script_sha256": sha256(Path(__file__)), "warm_run_performed": False})
        manifest["transform"]["square_input"] = bool(args.square)
        manifest["transform"]["aspect_ratio_preserved"] = width * 720 == height * 1280
        manifest["experiment_role"] = "explicit_square_diagnostic_control" if args.square else "primary_aspect_preserving_probe"
        timings["setup_before_inference_seconds"] = time.perf_counter() - overall
        manifest["status"] = "inference_running"
        write_json(output / "running.json", manifest)
        print(json.dumps({"status": "GPU inference starting", "shape": list(video_tensor.shape), "query_tyx": tyx, "resolutions": resolutions}), flush=True)
        torch.cuda.reset_peak_memory_stats()
        allocated_before = torch.cuda.memory_allocated()
        started = time.perf_counter()
        with torch.inference_mode():
            predictions = model(video_tensor, query_tensor, query_chunk_size=4, refinement_resolutions=resolutions)
        torch.cuda.synchronize()
        timings["first_inference_seconds"] = time.perf_counter() - started
        manifest["gpu_memory"] = {"allocated_before_inference_bytes": allocated_before, "peak_allocated_bytes": torch.cuda.max_memory_allocated(), "peak_reserved_bytes": torch.cuda.max_memory_reserved(), "scope": "PyTorch allocator after loading model and inputs; excludes other processes/driver; peak reset immediately before first inference"}
        started = time.perf_counter()
        raw = {}
        for name, value in predictions.items():
            if isinstance(value, list):
                raw[f"raw_{name}"] = torch.stack(value).detach().cpu().numpy()
            else:
                raw[f"raw_{name}"] = value.detach().cpu().numpy()
        tracks = raw["raw_tracks"][0]
        occlusion = raw["raw_occlusion"][0]
        uncertainty = raw["raw_expected_dist"][0]
        visible_score = ((1 - torch.sigmoid(predictions["occlusion"])) * (1 - torch.sigmoid(predictions["expected_dist"]))).cpu().numpy()[0]
        visible = visible_score > 0.5
        tracks_source = tracks / np.asarray([sx, sy], dtype=np.float32)
        if not all(np.isfinite(a).all() for a in raw.values()):
            raise ValueError("Nonfinite model outputs; preserve failure instead of claiming completion.")
        np.savez_compressed(output / "predictions.npz", **raw, tracks_source=tracks_source, visibility_score=visible_score, visible=visible, source_frames=np.asarray(selected, dtype=np.int64), query_points_tyx=np.asarray(tyx, dtype=np.float32))
        result_queries = []
        for qi, q in enumerate(queries):
            records = []
            for ti, sf in enumerate(selected):
                records.append({"model_frame": ti, "source_frame": sf, "xy_source": tracks_source[qi, ti].tolist(), "xy_model": tracks[qi, ti].tolist(), "occlusion_logit": float(occlusion[qi, ti]), "expected_dist_logit": float(uncertainty[qi, ti]), "visible_score": float(visible_score[qi, ti]), "visible": bool(visible[qi, ti])})
            result_queries.append({**q, "frames": records})
        result = {"schema_version": "tapir-direct-video-probe-v1", "source_frames": selected, "frame_mapping": mapping, "source": manifest["source"], "transform": manifest["transform"], "visibility_rule": "(1-sigmoid(occlusion_logit))*(1-sigmoid(expected_dist_logit)) > 0.5 (official demo); score is not externally calibrated accuracy", "queries": result_queries, "limits": ["point tracks are not player identity, physical ground contact, court coordinates, or metric accuracy", "offline model sees the entire sampled clip including frames after each prediction", "No interpolation or confidence filling; invisible raw positions are retained as uncertain outputs", "No manual keypoint ground truth; automatic bbox-relative candidate semantics are approximate"]}
        write_json(output / "result.json", result)
        timings["transfer_and_serialize_seconds"] = time.perf_counter() - started
        timings["total_run_seconds"] = time.perf_counter() - overall
        historical = {}
        for name in ["source_manifest.json", "checkpoint_manifest.json", "dependencies_manifest.json"]:
            path = cache / name
            if path.exists():
                historical[name] = json.loads(path.read_text(encoding="utf-8"))
        manifest["historical_acquisition_measurements"] = historical
        manifest["visibility_counts"] = {q["query_id"]: {"visible": int(visible[i].sum()), "total": len(selected), "in_detection_gap_622_646": int(visible[i, [622 <= f <= 646 for f in selected]].sum())} for i, q in enumerate(queries)}
        manifest["artifacts"] = {p.name: {"sha256": sha256(p), "bytes": p.stat().st_size} for p in output.iterdir() if p.is_file() and p.name != "running.json"}
        manifest["status"] = "complete"
        write_json(output / "manifest.json", manifest)
        print(json.dumps({"status": "complete", "timings": timings, "gpu_memory": manifest["gpu_memory"], "visibility_counts": manifest["visibility_counts"]}), flush=True)
        return 0
    except BaseException as exc:
        manifest.update({"status": "failed", "error_type": type(exc).__name__, "error": str(exc), "traceback": traceback.format_exc(), "elapsed_seconds": time.perf_counter() - overall})
        write_json(output / "failure.json", manifest)
        raise


if __name__ == "__main__":
    raise SystemExit(main())
