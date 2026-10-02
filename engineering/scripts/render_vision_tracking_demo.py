"""Render a local YOLO/ByteTrack demo with original audio and tracked boxes."""

import argparse
import hashlib
import json
import os
import time
from fractions import Fraction
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--video", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--player-profile", help="Optional manual, clip-specific candidate-area profile")
    parser.add_argument("--full-frame-only", action="store_true", help="Disable extra image tiles for an ablation")
    args = parser.parse_args()
    source_path, weights, destination = map(Path, (args.video, args.model, args.output))
    if not source_path.is_file() or not weights.is_file():
        parser.error("Input video and weights must exist locally")
    if destination.exists() or destination.resolve() == source_path.resolve():
        parser.error("Choose a new output path; existing videos are preserved")
    profile = None
    if args.player_profile:
        profile = json.loads(Path(args.player_profile).read_text(encoding="utf-8"))
        with source_path.open("rb") as source_file:
            source_hash = hashlib.file_digest(source_file, "sha256").hexdigest()
        if source_hash != profile["video_sha256"]:
            parser.error("This manual profile belongs to a different video")
    destination.parent.mkdir(parents=True, exist_ok=True)
    settings_path = Path("tmp/vision-benchmark-settings").resolve()
    settings_path.mkdir(parents=True, exist_ok=True)
    os.environ.update(YOLO_CONFIG_DIR=str(settings_path), YOLO_AUTOINSTALL="false", YOLO_OFFLINE="true")

    print("Loading local CUDA model...", flush=True)
    started = time.perf_counter()
    import av
    import cv2
    import torch
    from ultralytics import YOLO, settings
    if profile:
        import numpy as np
        from types import SimpleNamespace
        from ultralytics.engine.results import Boxes, Results
        from ultralytics.trackers.byte_tracker import BYTETracker
        from basketball_player_filter import candidate_polygon, detect_multiscale, filter_candidates, draw_pending_candidates
        from player_proposals import pending_candidates

        tracker = BYTETracker(SimpleNamespace(track_high_thresh=0.20, track_low_thresh=0.07,
                                             new_track_thresh=0.20, track_buffer=30,
                                             match_thresh=0.8, fuse_score=False))

    settings.update({"sync": False})
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is required for this demo")
    model = YOLO(str(weights))
    options = dict(device=0, half=True, classes=[0], conf=0.1, imgsz=args.imgsz,
                   verbose=False, save=False)
    frame_count = 0
    audio_packets = 0
    ids = set()
    frame_records = []
    render_started = time.perf_counter()
    with av.open(str(source_path)) as source, av.open(
        str(destination), "w", options={"movflags": "+faststart"}
    ) as output:
        video = source.streams.video[0]
        if profile and (video.width, video.height) != (profile["width"], profile["height"]):
            raise RuntimeError("Video dimensions do not match the manual profile")
        rate = video.average_rate
        if not rate:
            raise RuntimeError("Input frame rate unavailable")
        encoded = output.add_stream("libx264", rate=rate)
        encoded.width, encoded.height = video.width, video.height
        encoded.pix_fmt = "yuv420p"
        encoded.options = {"crf": "20", "preset": "fast", "tune": "zerolatency"}
        encoded.time_base = video.time_base or Fraction(rate.denominator, rate.numerator)
        encoded.codec_context.time_base = encoded.time_base
        audio = source.streams.audio[0] if source.streams.audio else None
        audio_out = output.add_stream_from_template(audio) if audio else None
        selected = [video] + ([audio] if audio else [])
        for packet in source.demux(*selected):
            if packet.stream.type == "audio":
                if packet.dts is not None:
                    packet.stream = audio_out
                    output.mux(packet)
                    audio_packets += 1
                continue
            for decoded in packet.decode():
                frame = decoded.to_ndarray(format="bgr24")
                if profile:
                    if args.full_frame_only:
                        predictions = model.predict(frame, **{**options, "conf": 0.07})[0].boxes.data.cpu().numpy()
                    else:
                        predictions = detect_multiscale(model, frame, args.imgsz)
                    polygon = candidate_polygon(profile, frame_count)
                    selected, observations = filter_candidates(frame, predictions, polygon, profile)
                    tracked = tracker.update(Boxes(selected, frame.shape[:2]), frame)
                    tracked = tracked.reshape(-1, 8)
                    pending = np.asarray(pending_candidates(selected,tracked),dtype=np.float32).reshape(-1,6)
                    result = Results(frame, path=str(source_path), names={0: "candidate"},
                                     boxes=torch.from_numpy(tracked[:, :7]))
                    frame_records.append({"frame": frame_count, "time": float(decoded.time),
                                          "raw_count": len(predictions), "candidate_count": len(selected),
                                          "tracks": tracked[:, :7].tolist(),
                                          "pending_detections": pending.tolist(),
                                          "candidates": selected.tolist(),
                                          "rejection_counts": {reason: sum(record["reason"] == reason for record in observations)
                                              for reason in ("outside_candidate_area", "partial_or_implausible_body", "clothing_not_supported")}})
                else:
                    result = model.track(frame, tracker="bytetrack.yaml", persist=True, **options)[0]
                    frame_records.append({"frame": frame_count, "time": float(decoded.time),
                                          "tracks": result.boxes.data.cpu().tolist()})
                canvas = result.plot(line_width=2, font_size=12, color_mode="instance")
                if profile:
                    draw_pending_candidates(canvas, pending)
                if result.boxes.id is not None:
                    ids.update(int(value) for value in result.boxes.id.cpu().tolist())
                timestamp = float(decoded.time or frame_count / rate)
                cv2.rectangle(canvas, (0, 0), (canvas.shape[1], 72), (20, 23, 30), -1)
                mode = "player candidates" if profile else "person"
                label = f"{weights.stem} + ByteTrack | {mode} | imgsz {args.imgsz} | {timestamp:.2f}s"
                cv2.putText(canvas, label, (22, 31), cv2.FONT_HERSHEY_SIMPLEX, 0.78, (255, 255, 255), 2, cv2.LINE_AA)
                subtitle = ("Manual area + yellow/white rules | solid = tracked; dashed = ID pending | experimental"
                            if profile else "IDs are temporary tracks; players, referees and spectators are included.")
                cv2.putText(canvas, subtitle,
                            (22, 58), cv2.FONT_HERSHEY_SIMPLEX, 0.62, (180, 195, 210), 1, cv2.LINE_AA)
                if frame_count == 60:
                    if not cv2.imwrite(str(destination.with_suffix(".jpg")), canvas):
                        raise RuntimeError("Could not save preview image")
                if frame_count in (0, 30, 90, 120, 150, 180, 210, 242):
                    cv2.imwrite(str(destination.with_name(destination.stem + f"-frame-{frame_count:03d}.jpg")), canvas)
                visual = av.VideoFrame.from_ndarray(canvas, format="bgr24")
                if decoded.pts is not None:
                    # Keep source timestamps aligned with the copied audio packets.
                    visual.pts = decoded.pts
                    visual.time_base = decoded.time_base
                else:
                    visual.pts = frame_count
                    visual.time_base = Fraction(rate.denominator, rate.numerator)
                for encoded_packet in encoded.encode(visual):
                    output.mux(encoded_packet)
                frame_count += 1
                if frame_count % 60 == 0:
                    print(f"Rendered {frame_count} frames", flush=True)
        for encoded_packet in encoded.encode():
            output.mux(encoded_packet)
    if frame_count == 0:
        raise RuntimeError("No frames rendered")
    report = {"source": source_path.as_posix(), "output": destination.as_posix(),
              "model": weights.name, "tracker": "bytetrack.yaml", "imgsz": args.imgsz,
              "classes": [0], "conf": 0.07 if profile else 0.1, "fp16": True, "frames": frame_count,
              "player_profile": args.player_profile, "extra_tiles": bool(profile and not args.full_frame_only),
              "tracker_parameters": (vars(tracker.args) if profile else "ultralytics bytetrack.yaml defaults"),
              "pending_display_threshold": 0.20 if profile else None,
              "audio_packets_copied": audio_packets, "unique_track_ids": len(ids),
              "render_seconds": time.perf_counter() - render_started,
              "total_seconds_including_imports": time.perf_counter() - started,
              "note": "Visualization only; includes drawing and encoding, no accuracy evaluation or tactical overlays."}
    destination.with_suffix(".json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    destination.with_suffix(".tracks.json").write_text(json.dumps(frame_records, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report), flush=True)


if __name__ == "__main__":
    main()
