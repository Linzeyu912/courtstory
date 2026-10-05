"""Measure a local person-detection/tracking baseline; does not score accuracy."""

import argparse
import hashlib
import json
import os
import platform
import time
from datetime import datetime
from importlib.metadata import version
from pathlib import Path
from zoneinfo import ZoneInfo


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--video", required=True)
    parser.add_argument("--model", required=True, help="Downloaded local .pt file")
    parser.add_argument("--tracker", choices=["bytetrack.yaml", "botsort.yaml"], required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--snapshot")
    parser.add_argument("--device", default="0")
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--warmup", type=int, default=10)
    parser.add_argument("--max-frames", type=int, default=0, help="0 processes the full clip")
    parser.add_argument("--fp32", action="store_true")
    args = parser.parse_args()
    if args.warmup < 0 or args.max_frames < 0:
        parser.error("warmup and max-frames must be nonnegative")
    video, weights = Path(args.video), Path(args.model)
    if not video.is_file() or not weights.is_file():
        parser.error("video and model must be existing local files")

    # Keep settings local and disable optional uploads and automatic installation.
    settings_dir = Path("tmp/vision-benchmark-settings").resolve()
    settings_dir.mkdir(parents=True, exist_ok=True)
    os.environ["YOLO_CONFIG_DIR"] = str(settings_dir)
    os.environ["YOLO_AUTOINSTALL"] = "false"
    os.environ["YOLO_OFFLINE"] = "true"
    import cv2
    import numpy as np
    import torch
    from ultralytics import YOLO, settings

    settings.update({"sync": False})
    gpu = args.device != "cpu"
    if gpu and not torch.cuda.is_available():
        raise RuntimeError("CUDA requested but unavailable; no silent CPU fallback")
    if gpu:
        torch.cuda.set_device(int(args.device))

    capture = cv2.VideoCapture(str(video))
    if not capture.isOpened():
        raise RuntimeError(f"Cannot open video: {video}")
    fps = capture.get(cv2.CAP_PROP_FPS)
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
    declared_frames = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    ok, first = capture.read()
    capture.release()
    if not ok or fps <= 0:
        raise RuntimeError("No decodable first frame or invalid frame rate")

    setup_start = time.perf_counter()
    model = YOLO(str(weights))
    options = dict(device=args.device, imgsz=args.imgsz, half=gpu and not args.fp32,
                   classes=[0], conf=0.1, verbose=False, save=False)
    for _ in range(args.warmup):
        model.predict(first, **options)
    if gpu:
        torch.cuda.synchronize()
        torch.cuda.reset_peak_memory_stats()
    setup_seconds = time.perf_counter() - setup_start

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    capture = cv2.VideoCapture(str(video))
    per_frame_ms, decode_seconds, counts, unique_ids = [], 0.0, [], set()
    model_speeds = {key: [] for key in ("preprocess", "inference", "postprocess")}
    snapshot_saved = False
    snapshot_frame = min(60, max(0, declared_frames // 2))
    started = time.perf_counter()
    try:
        while not args.max_frames or len(per_frame_ms) < args.max_frames:
            read_started = time.perf_counter()
            ok, frame = capture.read()
            decode_seconds += time.perf_counter() - read_started
            if not ok:
                break
            step_started = time.perf_counter()
            result = model.track(frame, tracker=args.tracker, persist=True, **options)[0]
            if gpu:
                torch.cuda.synchronize()
            per_frame_ms.append((time.perf_counter() - step_started) * 1000)
            counts.append(len(result.boxes))
            if result.boxes.id is not None:
                unique_ids.update(int(value) for value in result.boxes.id.cpu().tolist())
            for key in model_speeds:
                model_speeds[key].append(float(result.speed[key]))
            if args.snapshot and len(per_frame_ms) - 1 == snapshot_frame:
                snapshot_path = Path(args.snapshot)
                snapshot_path.parent.mkdir(parents=True, exist_ok=True)
                snapshot_saved = cv2.imwrite(str(snapshot_path), result.plot())
            if len(per_frame_ms) % 100 == 0:
                print(f"{weights.name} {args.tracker}: {len(per_frame_ms)} frames", flush=True)
    finally:
        capture.release()
    wall_seconds = time.perf_counter() - started
    if not per_frame_ms:
        raise RuntimeError("No frames processed")
    source_seconds = len(per_frame_ms) / fps
    steady = per_frame_ms[1:] or per_frame_ms
    report = {
        "recorded_at": datetime.now(ZoneInfo("Asia/Shanghai")).isoformat(),
        "scope": "warm person detection + tracking + video decode; includes first tracker setup and optional snapshot; excludes model warmup, ball, calibration, pose, segmentation, narration, full video encoding, upload and cloud execution",
        "environment": {"os": platform.system(), "python": platform.python_version(),
                        "packages": {name: version(name) for name in ("torch", "torchvision", "ultralytics", "lap", "opencv-python", "numpy")},
                        "torch_cuda_build": torch.version.cuda,
                        "device": torch.cuda.get_device_name() if gpu else "CPU",
                        "gpu_total_mib": torch.cuda.get_device_properties(torch.cuda.current_device()).total_memory / 2**20 if gpu else None},
        "input": {"video": video.as_posix(), "video_sha256": sha256(video), "width": width,
                  "height": height, "reported_fps": fps, "reported_frame_count": declared_frames,
                  "processed_frames": len(per_frame_ms), "processed_seconds_at_reported_fps": source_seconds},
        "configuration": {"model": weights.name, "model_sha256": sha256(weights),
                          "tracker": args.tracker, "reid": False, "classes": [0], "conf": 0.1,
                          "imgsz": args.imgsz, "preprocessed_image_shape_hwc": list(model.predictor.pre_transform([first])[0].shape),
                          "fp16": options["half"], "warmup_frames": args.warmup},
        "timing": {"model_load_and_warmup_seconds": setup_seconds, "pipeline_wall_seconds": wall_seconds,
                   "decode_seconds": decode_seconds, "pipeline_fps": len(per_frame_ms) / wall_seconds,
                   "real_time_factor": wall_seconds / source_seconds,
                   "first_track_call_ms": per_frame_ms[0], "remaining_track_call_median_ms": float(np.median(steady)),
                   "remaining_track_call_p95_ms": float(np.percentile(steady, 95)),
                   "model_speed_mean_ms": {key: float(np.mean(values)) for key, values in model_speeds.items()}},
        "torch_peak_allocated_mib": torch.cuda.max_memory_allocated() / 2**20 if gpu else None,
        "torch_peak_reserved_mib": torch.cuda.max_memory_reserved() / 2**20 if gpu else None,
        "observations": {"track_count_per_frame_min": min(counts), "track_count_per_frame_max": max(counts),
                         "track_count_per_frame_mean": float(np.mean(counts)), "unique_track_ids": len(unique_ids),
                         "snapshot_saved": snapshot_saved, "accuracy_evaluated": False},
    }
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report["timing"], ensure_ascii=False), flush=True)
    print(f"Saved {output.as_posix()}", flush=True)


if __name__ == "__main__":
    main()
