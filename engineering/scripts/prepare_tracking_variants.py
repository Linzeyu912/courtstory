"""Prepare independent model choices without changing a library or older candidates.

Run with the pinned Ultralytics environment described in model-deployment.md.
The default library remains read-only. A report contains proposed manifest entries.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import sys

from basketball_run import ROOT, sha256, save_json


MODELS = {
    "ebard": ("BODD_yolov8n_0001.pt", "dfe3534d51bb21024d1a400c37f0c1fbf0c8b96ea9a56a5f3cb5454813bfd641"),
    "yolo": ("yolov8s.pt", "1f47a78bf100391c2a140b7ac73a1caae18c32779be7d310658112f7ac9aa78a"),
}
LABELS = {
    "baseline": "THY · BoT-SORT 基线",
    "low": "THY · 低分续接",
    "reid": "THY · 原生 ReID 外观续接",
    "optimized": "THY · 综合优化",
    "yolo": "通用 YOLOv8s · ByteTrack",
}


def inspect_runtime(model_dir, detector_keys=None):
    import av
    import torch
    import ultralytics

    checked = {}
    for key, (filename, expected) in MODELS.items():
        if detector_keys is not None and key not in detector_keys:
            continue
        path = model_dir / filename
        actual = sha256(path)
        if actual != expected:
            raise ValueError(f"Model SHA-256 mismatch: {filename}")
        checked[key] = {"path": path.relative_to(ROOT).as_posix() if path.is_relative_to(ROOT) else path.name,
                        "sha256": actual, "bytes": path.stat().st_size}
    if ultralytics.__version__ != "8.4.171":
        raise RuntimeError("Use Ultralytics 8.4.171 for these THY presets; other versions are unverified.")
    if not torch.cuda.is_available():
        raise RuntimeError("The recorded THY configuration requires an available CUDA GPU.")
    return {"python": sys.version.split()[0], "torch": torch.__version__, "cuda": torch.version.cuda,
            "ultralytics": ultralytics.__version__, "pyav": av.__version__,
            "device": torch.cuda.get_device_name(0), "models": checked,
            "reid": "detector-native features; no separate ReID weight or network download"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--library", type=Path, default=ROOT / "data/videos/tactics/acceptance/review-library.json")
    parser.add_argument("--models", type=Path, default=ROOT / "tmp/models")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "tmp/tracking-variants")
    parser.add_argument("--report", type=Path, help="Fresh report JSON destination")
    parser.add_argument("--sample", action="append", help="Repeat for multiple sample IDs")
    parser.add_argument("--variants", nargs="+", choices=LABELS, default=["baseline", "low", "reid"])
    parser.add_argument("--max-frames", type=int, help="Smoke prefix only; omits proposed library entries")
    parser.add_argument("--check", action="store_true", help="Verify deployed weights, pinned runtime and CUDA only")
    args = parser.parse_args()
    if args.max_frames is not None and args.max_frames < 1:
        parser.error("--max-frames must be positive")
    runtime = inspect_runtime(args.models.resolve())
    if args.check:
        print(json.dumps(runtime, ensure_ascii=False, indent=2))
        return
    if not args.report or args.report.exists():
        parser.error("Choose a fresh --report path; earlier evidence is preserved")
    samples = json.loads(args.library.read_text(encoding="utf-8"))["samples"]
    if args.sample:
        known = {sample["id"] for sample in samples}
        if set(args.sample) - known:
            parser.error(f"Unknown samples: {sorted(set(args.sample) - known)}")
        samples = [sample for sample in samples if sample["id"] in args.sample]
    jobs = []
    for sample in samples:
        source = ROOT / sample["video"]
        if sha256(source) != sample["videoSha256"]:
            raise ValueError(f"Video SHA-256 mismatch: {sample['id']}")
        for variant in dict.fromkeys(args.variants):
            output = args.output_dir.resolve() / f"{sample['id']}-{variant}.json"
            if output.exists() or output.with_suffix(".meta.json").exists():
                raise FileExistsError(f"Choose a fresh output; preserving {output}")
            jobs.append((sample, source, variant, output))
    report = {"created_at_utc": datetime.now(timezone.utc).isoformat(), "runtime": runtime,
              "partial_run": args.max_frames is not None, "identity_accuracy_verified": False, "runs": []}
    for sample, source, variant, output in jobs:
        weights = args.models.resolve() / MODELS["yolo" if variant == "yolo" else "ebard"][0]
        command = [sys.executable, str(Path(__file__).with_name("basketball_run.py")),
                   "--video", str(source), "--weights", str(weights), "--variant", variant,
                   "--output", str(output), "--imgsz", "640" if variant == "yolo" else "704",
                   "--evidence-frames"]
        if args.max_frames:
            command += ["--max-frames", str(args.max_frames)]
        subprocess.run(command, check=True, cwd=ROOT)
        metadata = json.loads(output.with_suffix(".meta.json").read_text(encoding="utf-8"))
        records = json.loads(output.read_text(encoding="utf-8"))
        if metadata["video_sha256"] != sample["videoSha256"] or len(records) != metadata["frames"]:
            raise RuntimeError("Prepared observations do not match source/metadata")
        entry = {"sample": sample["id"], "variant": variant, "frames": len(records),
                 "video_sha256": metadata["video_sha256"], "tracks_sha256": sha256(output),
                 "metadata_sha256": sha256(output.with_suffix(".meta.json")),
                 "seconds": metadata["timing_seconds"]["decode_infer_candidates_evidence"]}
        if not args.max_frames:
            if not output.is_relative_to(ROOT):
                raise ValueError("Full library candidates must be stored inside the repository")
            entry["library_entry"] = {"id": variant, "label": LABELS[variant],
                                      "tracks": output.relative_to(ROOT).as_posix()}
        report["runs"].append(entry)
        save_json(args.report, report)
    print(json.dumps({"report": str(args.report), "prepared": len(jobs)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
