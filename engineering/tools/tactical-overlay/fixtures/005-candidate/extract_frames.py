"""Reproduce exact 005 frame assets by sequential decode, never approximate seek."""
from pathlib import Path
import argparse
import hashlib
import json
import shutil
import subprocess
import av


def digest(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


def main():
    root = Path(__file__).resolve().parents[5]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default="artifacts/tactical-overlay-preview/frozen-source")
    parser.add_argument("--ffmpeg", default=shutil.which("ffmpeg"))
    args = parser.parse_args()
    if not args.ffmpeg:
        parser.error("FFmpeg is not on PATH; pass --ffmpeg with its executable path.")
    output = (root / args.out).resolve()
    artifacts = (root / "artifacts").resolve()
    if output == artifacts or artifacts not in output.parents:
        parser.error("Output must be a subdirectory of this repository's artifacts directory.")
    if output.exists() and any(output.iterdir()):
        parser.error("Output must be empty; choose a new directory to preserve previous extraction evidence.")
    annotation = json.loads(Path(__file__).with_name("annotation.json").read_text(encoding="utf-8"))
    video = root / annotation["sourceFiles"]["video"]
    tracks_file = root / annotation["sourceFiles"]["tracks"]
    for file in (video, tracks_file):
        expected = annotation["sourceHashes"][file.relative_to(root).as_posix()]
        if digest(file) != expected:
            raise ValueError(f"005 source hash mismatch: {file.relative_to(root)}")
    tracks = json.loads(tracks_file.read_text(encoding="utf-8-sig"))
    selected = annotation["preferredFreezeFrames"]
    mapping, assets = [], []
    output.mkdir(parents=True, exist_ok=True)
    with av.open(str(video)) as container:
        for index, frame in enumerate(container.decode(video=0)):
            if frame.pts is None or frame.time_base is None:
                raise ValueError(f"Frame {index} has no exact presentation timestamp")
            time = float(frame.pts * frame.time_base)
            if index >= len(tracks) or tracks[index]["frame"] != index or tracks[index]["time"] != time:
                raise ValueError(f"Source track/decode mapping differs at frame {index}")
            if (frame.width, frame.height) != (1920, 1080):
                raise ValueError(f"Unexpected decoded dimensions at frame {index}")
            record = {"frame": index, "pts": frame.pts, "timeBase": str(frame.time_base), "time": time}
            mapping.append(record)
            if index not in selected:
                continue
            raw = output / f"005-f{index:03d}-raw.png"
            jpeg = output / f"005-f{index:03d}.jpg"
            with raw.open("xb") as handle:
                frame.to_image().save(handle, format="PNG")
            subprocess.run([args.ffmpeg, "-hide_banner", "-loglevel", "error", "-n", "-i", str(raw),
                            "-frames:v", "1", "-q:v", "2", str(jpeg)], check=True)
            assets.append({**record, "sourceFrame": index, "sourceTime": time, "file": jpeg.name,
                           "sha256": digest(jpeg), "rawImage": raw.name, "rawSha256": digest(raw)})
    if len(mapping) != 143 or [a["frame"] for a in assets] != selected:
        raise ValueError("Incomplete 005 sequential decode; no ready frame index published")
    provenance = {"video": annotation["sourceFiles"]["video"], "videoSha256": digest(video),
                  "trackingFingerprint": digest(tracks_file), "decoder": f"PyAV {av.__version__}",
                  "extraction": "sequential decode of every frame; exact PTS compared with locked tracking records",
                  "encoding": "FFmpeg JPEG q:v=2 from exact decoded PNG; no seek",
                  "ffmpegVersion": subprocess.check_output([args.ffmpeg, "-version"], text=True).splitlines()[0],
                  "decodedFrameMapping": mapping, "width": 1920, "height": 1080, "frames": assets}
    index = {"videoSha256": provenance["videoSha256"], "frames": [
        {k: a[k] for k in ("frame", "time", "sourceFrame", "sourceTime", "file", "sha256")} for a in assets]}
    # A frames.json ready index is the last artifact written, after all comparisons and encodes succeed.
    for name, value in [("provenance.json", provenance), ("frames.json", index)]:
        with (output / name).open("x", encoding="utf-8") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
    print(json.dumps({"framesIndex": str(output / "frames.json"), "decodedFrames": len(mapping),
                      "frozenFrames": selected, "videoSha256": provenance["videoSha256"]}))


if __name__ == "__main__":
    main()
