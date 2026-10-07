"""Build neutral, pixel-gridded foot crops for independent visual review."""
from __future__ import annotations

import json
import math
from pathlib import Path

import av
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[3]
ARTIFACTS = ROOT / "artifacts/qwen-all-players-20261007"
OUT = ARTIFACTS / "visual-reference-qa"
LIBRARY = json.loads((ARTIFACTS / "review-library.json").read_text(encoding="utf-8"))
EXTRA_FRAMES = {
    "official-training-001": [("P5", 840), ("P5", 900), ("P7", 840), ("P7", 900)],
    "official-training-002": [("P2", 180), ("P2", 300), ("P2", 420), ("P2", 540),
                              ("P2", 840), ("P2", 900), ("P5", 840), ("P5", 900)],
}


def load_tracks(sample: dict) -> tuple[list[dict], list[dict]]:
    tracks = json.loads((ROOT / sample["tracks"]).read_text(encoding="utf-8"))
    base = ARTIFACTS / sample["id"]
    assignments = json.loads((base / "assignments.json").read_text(encoding="utf-8"))
    return tracks, assignments


def boxes_by_player(sample: dict, tracks: list[dict], assignments: list[dict]) -> dict[str, dict[int, tuple[float, ...]]]:
    result: dict[str, dict[int, tuple[float, ...]]] = {}
    for frame_index, assignment in enumerate(assignments):
        track_frame = tracks[frame_index]
        # In this repository the serialized row is [x1, y1, x2, y2, track_id, confidence, class_id].
        by_id = {int(box[4]): tuple(map(float, box[:4])) for box in track_frame.get("tracks", []) if len(box) >= 5}
        for player, track_id in assignment.items():
            if int(track_id) in by_id:
                result.setdefault(player, {})[frame_index] = by_id[int(track_id)]
    return result


def box_score(box: tuple[float, ...]) -> float:
    x1, y1, x2, y2 = box
    height = max(0, y2 - y1)
    clipped = 0.55 if y2 >= 1077 or x1 <= 2 or x2 >= 1918 else 1.0
    return height * clipped


def two_general_frames(boxes: dict[int, tuple[float, ...]], frame_count: int, first_visible: int = 60) -> list[int]:
    middle = frame_count // 2
    chosen: list[int] = []
    for lo, hi in ((first_visible, middle), (middle, frame_count)):
        candidates = [(box_score(box), frame) for frame, box in boxes.items() if lo <= frame < hi]
        candidates.sort(reverse=True)
        for _, frame in candidates:
            if all(abs(frame - other) >= 45 for other in chosen):
                chosen.append(frame)
                break
    return chosen


def reversals(boxes: dict[int, tuple[float, ...]], min_frame: int = 0) -> list[tuple[float, int]]:
    centers = {frame: (box[0] + box[2]) / 2 for frame, box in boxes.items()}
    scores = []
    for frame in sorted(centers):
        if frame < min_frame or frame - 5 not in centers or frame + 5 not in centers:
            continue
        before, after = centers[frame] - centers[frame - 5], centers[frame + 5] - centers[frame]
        if before * after < 0:
            score = min(abs(before), abs(after)) * box_score(boxes[frame]) / 700
            if score > 3.5:
                scores.append((score, frame))
    scores.sort(reverse=True)
    picked: list[tuple[float, int]] = []
    for candidate in scores:
        if all(abs(candidate[1] - other[1]) >= 35 for other in picked):
            picked.append(candidate)
        if len(picked) == 2:
            break
    return picked


def make_specs() -> list[dict]:
    specs = []
    for sample in LIBRARY["samples"]:
        tracks, assignments = load_tracks(sample)
        by_player = boxes_by_player(sample, tracks, assignments)
        sample_id = sample["id"]
        for entity_id, boxes in by_player.items():
            for frame in two_general_frames(boxes, len(assignments)):
                specs.append({"sampleId": sample_id, "entityId": entity_id, "frame": frame, "kind": "coverage"})
        target_player = "P9" if sample_id.endswith("001") else "P1"
        if target_player in by_player:
            extras = reversals(by_player[target_player], 120 if target_player == "P9" else 1250)
            if sample_id.endswith("002") and not extras:
                extras = sorted(((box_score(b), f) for f, b in by_player[target_player].items() if f >= 1250), reverse=True)[:2]
            for score, frame in extras:
                specs.append({"sampleId": sample_id, "entityId": target_player, "frame": frame,
                              "kind": "turnback" if target_player == "P9" else "drive_or_jump", "eventScore": round(score, 2)})
        for entity_id, frame in EXTRA_FRAMES.get(sample_id, []):
            if frame in by_player.get(entity_id, {}):
                specs.append({"sampleId": sample_id, "entityId": entity_id, "frame": frame, "kind": "supplemental"})
    seen = set()
    unique = []
    for spec in specs:
        key = (spec["sampleId"], spec["entityId"], spec["frame"])
        if key not in seen:
            seen.add(key)
            unique.append(spec)
    return unique


def foot_crop(image: Image.Image, box: tuple[float, ...]) -> tuple[Image.Image, tuple[int, int, int, int]]:
    width, height = image.size
    x1, y1, x2, y2 = box
    bw, bh = x2 - x1, y2 - y1
    crop_w = int(max(130, min(240, bw * 0.5)))
    crop_h = int(max(115, min(220, bh * 0.24)))
    cx = (x1 + x2) / 2
    # Keep the full sole and a little court context below the player box.
    cy = y2 - max(18, min(48, bh * 0.035))
    left = max(0, min(width - crop_w, round(cx - crop_w / 2)))
    top = max(0, min(height - crop_h, round(cy - crop_h / 2)))
    right, bottom = min(width, left + crop_w), min(height, top + crop_h)
    crop = image.crop((left, top, right, bottom))
    return crop, (left, top, right, bottom)


def font(size: int) -> ImageFont.ImageFont:
    for candidate in ("C:/Windows/Fonts/arial.ttf", "C:/Windows/Fonts/msyh.ttc"):
        try:
            return ImageFont.truetype(candidate, size)
        except OSError:
            pass
    return ImageFont.load_default()


def draw_crop(crop: Image.Image, bounds: tuple[int, int, int, int], sample_id: str, entity_id: str, frame: int) -> Image.Image:
    left, top, _, _ = bounds
    scale = 2
    enlarged = crop.resize((crop.width * scale, crop.height * scale), Image.Resampling.NEAREST)
    label_h, axis = 34, 34
    tile = Image.new("RGB", (enlarged.width + axis, enlarged.height + label_h), "#11191c")
    d = ImageDraw.Draw(tile)
    d.text((6, 5), f"{entity_id}   frame {frame}", fill="#f2f2e8", font=font(18))
    tile.paste(enlarged, (axis, label_h))
    d = ImageDraw.Draw(tile)
    grid = 20
    x0, y0 = left, top
    for px in range((left // grid) * grid, left + crop.width + 1, grid):
        x = axis + (px - left) * scale
        d.line((x, label_h, x, label_h + enlarged.height), fill="#ffffff38", width=1)
        if px % 40 == 0:
            d.text((x + 1, label_h + enlarged.height + 2), str(px), fill="#bdc9c5", font=font(9))
    for py in range((top // grid) * grid, top + crop.height + 1, grid):
        y = label_h + (py - top) * scale
        d.line((axis, y, axis + enlarged.width, y), fill="#ffffff38", width=1)
        if py % 40 == 0:
            d.text((1, y - 5), str(py), fill="#bdc9c5", font=font(9))
    d.text((axis + 3, label_h + enlarged.height + 14), f"{sample_id[-3:]} · px", fill="#91a69e", font=font(9))
    return tile


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    specs = make_specs()
    (OUT / "reference_candidates.json").write_text(json.dumps(specs, ensure_ascii=False, indent=2), encoding="utf-8")
    for sample in LIBRARY["samples"]:
        sample_id = sample["id"]
        tracks, assignments = load_tracks(sample)
        by_player = boxes_by_player(sample, tracks, assignments)
        selected = [spec for spec in specs if spec["sampleId"] == sample_id]
        frames = {spec["frame"] for spec in selected}
        images = {}
        video_path = ROOT / sample["video"]
        with av.open(str(video_path), metadata_errors="ignore") as container:
            stream = container.streams.video[0]
            for index, frame in enumerate(container.decode(stream)):
                if index in frames:
                    images[index] = frame.to_image().convert("RGB")
        tiles = []
        for spec in sorted(selected, key=lambda s: (s["frame"], s["entityId"])):
            frame, player = spec["frame"], spec["entityId"]
            box = by_player[player].get(frame)
            if box is None or frame not in images:
                continue
            crop, bounds = foot_crop(images[frame], box)
            spec["cropBounds"] = list(bounds)
            tiles.append(draw_crop(crop, bounds, sample_id, player, frame))
        for page, start in enumerate(range(0, len(tiles), 12), 1):
            batch = tiles[start:start + 12]
            cell_w = max(tile.width for tile in batch) + 8
            cell_h = max(tile.height for tile in batch) + 8
            page_image = Image.new("RGB", (4 * cell_w, math.ceil(len(batch) / 4) * cell_h), "#20282a")
            for i, tile in enumerate(batch):
                page_image.paste(tile, ((i % 4) * cell_w, (i // 4) * cell_h))
            page_image.save(OUT / f"{sample_id[-3:]}-sheet-{page:02d}.jpg", quality=93)
        extra_specs = [spec for spec in selected if spec["kind"] == "supplemental"]
        extra_tiles = []
        for spec in sorted(extra_specs, key=lambda s: (s["frame"], s["entityId"])):
            box = by_player[spec["entityId"]].get(spec["frame"])
            if box is not None and spec["frame"] in images:
                crop, _bounds = foot_crop(images[spec["frame"]], box)
                extra_tiles.append(draw_crop(crop, _bounds, sample_id, spec["entityId"], spec["frame"]))
        if extra_tiles:
            cell_w = max(tile.width for tile in extra_tiles) + 8
            cell_h = max(tile.height for tile in extra_tiles) + 8
            extra_page = Image.new("RGB", (2 * cell_w, math.ceil(len(extra_tiles) / 2) * cell_h), "#20282a")
            for i, tile in enumerate(extra_tiles):
                extra_page.paste(tile, ((i % 2) * cell_w, (i // 2) * cell_h))
            extra_page.save(OUT / f"additional-reference-sheet-{sample_id[-3:]}.jpg", quality=93)
    (OUT / "reference_candidates.json").write_text(json.dumps(specs, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Created {len(specs)} candidate crops in {OUT}")
    for sample in LIBRARY["samples"]:
        sid = sample["id"]
        print(sid, sum(spec["sampleId"] == sid for spec in specs),
              "entities", len({spec["entityId"] for spec in specs if spec["sampleId"] == sid}))


if __name__ == "__main__":
    main()
