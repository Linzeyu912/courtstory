"""Read-only video and optional observation tools for the commentary agent."""
from __future__ import annotations

import base64
import hashlib
import io
import json
import math
from pathlib import Path

import av
from PIL import Image, ImageOps


class CommentaryVideo:
    """Index a source video once and expose bounded, read-only visual tools."""

    MAX_UNIQUE_FRAMES = 128
    MAX_FULL_FRAMES = 12
    SHEET_FRAMES = 6
    OBSERVATION_FRAMES = 12
    OBSERVATIONS_PER_FRAME = 30

    def __init__(self, video_path, output_dir, observations_path=None):
        self.video_path = Path(video_path).resolve()
        self.output_dir = Path(output_dir).resolve()
        if not self.video_path.is_file():
            raise ValueError(f"Video file does not exist: {self.video_path}")
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.observations_path = Path(observations_path).resolve() if observations_path else None
        self._observations = None
        self._observation_meta = None
        self._observation_source_state = "unknown"
        self._frames = []
        self._cache = {}
        digest = hashlib.sha256()
        with self.video_path.open("rb") as f:
            for chunk in iter(lambda: f.read(1024 * 1024), b""):
                digest.update(chunk)
        self.video_ref = digest.hexdigest()
        self._index_video()
        self._observations, self._observation_meta = self._load_observations()
        self._observation_source_state = self._validate_observations()

    @staticmethod
    def _finite_number(value, name):
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise ValueError(f"{name} must be a finite number")
        return float(value)

    def _index_video(self):
        last_display_duration = 0.0
        with av.open(str(self.video_path)) as container:
            if not container.streams.video:
                raise ValueError("Video has no video stream")
            stream = container.streams.video[0]
            stream.thread_type = "AUTO"
            width, height = stream.codec_context.width, stream.codec_context.height
            for index, frame in enumerate(container.decode(stream)):
                if frame.pts is None or frame.time is None:
                    raise ValueError(f"Decoded frame {index} has no presentation timestamp")
                time = float(frame.time)
                duration = float(frame.duration * frame.time_base) if frame.duration and frame.time_base else 0.0
                self._frames.append({
                    "frame": index,
                    "time": time,
                    "sourceTime": time,
                    "pts": int(frame.pts),
                    "timeBase": str(frame.time_base),
                    "displayDuration": max(0.0, duration),
                    "width": int(frame.width),
                    "height": int(frame.height),
                })
            self.width, self.height = int(width), int(height)
        if not self._frames:
            raise ValueError("Video contains no decodable frames")
        source_start = self._frames[0]["sourceTime"]
        for row in self._frames:
            row["time"] = row["sourceTime"] - source_start
        last = self._frames[-1]
        last_display_duration = last["displayDuration"]
        if last_display_duration <= 0 and len(self._frames) > 1:
            last_display_duration = self._frames[-1]["time"] - self._frames[-2]["time"]
        self.duration = max(0.0, last["time"] + last_display_duration)

    def _load_observations(self):
        if not self.observations_path:
            return None, None
        try:
            with self.observations_path.open("r", encoding="utf-8") as f:
                data = json.load(f)
            meta = None
            if isinstance(data, dict):
                meta = data.get("metadata", data.get("meta"))
            sidecar = self.observations_path.with_name(self.observations_path.stem + ".meta.json")
            if meta is None and sidecar.is_file():
                with sidecar.open("r", encoding="utf-8") as f:
                    meta = json.load(f)
            return data, meta if isinstance(meta, dict) else None
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise ValueError(f"Could not read observations: {exc}") from exc

    @staticmethod
    def _video_sha_from(data):
        if not isinstance(data, dict):
            return None
        for key in ("video_sha256", "videoSha256", "video_sha", "videoSha"):
            value = data.get(key)
            if isinstance(value, str) and len(value) == 64:
                return value.lower()
        video = data.get("video")
        if isinstance(video, dict):
            for key in ("sha256", "video_sha256", "videoSha256"):
                value = video.get(key)
                if isinstance(value, str) and len(value) == 64:
                    return value.lower()
        return None

    def _observation_rows(self):
        data = self._observations
        if isinstance(data, list):
            return data
        if not isinstance(data, dict):
            return []
        rows = data.get("frames")
        if isinstance(rows, list):
            return rows
        rows = data.get("playerEvidence")
        if isinstance(rows, list):
            return rows
        if isinstance(rows, dict) and isinstance(rows.get("frames"), list):
            return rows["frames"]
        rows = data.get("tracks")
        if isinstance(rows, list) and rows and isinstance(rows[0], dict) and "frame" in rows[0]:
            return rows
        raw = data.get("rawByPlayer")
        if isinstance(raw, dict):
            return []
        return []

    def _validate_observations(self):
        if self._observations is None:
            return "unknown"
        known_sha = self._video_sha_from(self._observations) or self._video_sha_from(self._observation_meta)
        if known_sha is not None and known_sha != self.video_ref:
            return "mismatch"
        expected_count = None
        for source in (self._observations, self._observation_meta):
            if isinstance(source, dict):
                expected_count = next((source.get(key) for key in ("frame_count", "frameCount", "frames")
                                       if type(source.get(key)) is int), expected_count)
        if expected_count is not None and expected_count != len(self._frames):
            return "mismatch"
        rows = self._observation_rows()
        pts_checked = 0
        # Validate frame bounds and source PTS only when those fields are present.
        for ordinal, row in enumerate(rows):
            if not isinstance(row, dict):
                continue
            index = row.get("frame", ordinal)
            if type(index) is not int or not 0 <= index < len(self._frames):
                return "mismatch"
            pts = row.get("source_frame_pts", row.get("sourceFramePts"))
            base = row.get("source_time_base", row.get("sourceTimeBase"))
            if pts is not None and base is not None:
                try:
                    source_time = float(pts) * float(base[0]) / float(base[1])
                except (TypeError, ValueError, ZeroDivisionError, IndexError):
                    return "mismatch"
                if abs(source_time - self._frames[index]["sourceTime"]) > 0.025:
                    return "mismatch"
                pts_checked += 1
            elif isinstance(row.get("time"), (int, float)) and not isinstance(row.get("time"), bool):
                if abs(float(row["time"]) - self._frames[index]["time"]) > 0.025:
                    return "mismatch"
        if known_sha is not None:
            return "verified"
        return "pts_matched" if pts_checked and len(rows) == len(self._frames) else "unverified"

    def context(self):
        """Return compact clip metadata and a time-based 2 fps frame index."""
        first, last = self._frames[0]["time"], self._frames[-1]["time"]
        sample_times = []
        t = first
        while t <= last + 1e-9:
            sample_times.append(t)
            t += 0.5
        selected = self._select_nearest(sample_times)
        return {
            "videoRef": self.video_ref,
            "width": self.width,
            "height": self.height,
            "duration": self.duration,
            "sourceStartTime": self._frames[0]["sourceTime"],
            "frames": [self._frame_meta(i) for i in range(len(self._frames))],
            "sampleFrames": [self._frame_meta(i) for i in selected],
            "observations": self._observation_source_state,
        }

    def _frame_meta(self, index):
        row = self._frames[index]
        return {"frame": index, "time": row["time"], "sourceTime": row["sourceTime"],
                "pts": row["pts"], "timeBase": row["timeBase"],
                "assetFrame": index, "assetPts": row["pts"], "assetTimeBase": row["timeBase"],
                "assetPtsSeconds": row["sourceTime"], "clipTimeSeconds": row["time"],
                "parentFrame": None, "parentTimeSeconds": None, "parentVideoSha256": None}

    def _select_nearest(self, times):
        selected = set()
        for target in times:
            # Binary search keeps selection fast for long videos.
            lo, hi = 0, len(self._frames)
            while lo < hi:
                mid = (lo + hi) // 2
                if self._frames[mid]["time"] < target:
                    lo = mid + 1
                else:
                    hi = mid
            candidates = [i for i in (lo - 1, lo) if 0 <= i < len(self._frames)]
            if candidates:
                selected.add(min(candidates, key=lambda i: abs(self._frames[i]["time"] - target)))
        return sorted(selected)

    def _resolve_frames(self, params, max_count=None):
        if "frames" in params and params["frames"] is not None:
            values = params["frames"]
            if not isinstance(values, list) or not values:
                raise ValueError("frames must be a non-empty list of frame indices")
            if any(type(i) is not int or not 0 <= i < len(self._frames) for i in values):
                raise ValueError("frames contains an invalid frame index")
            indices = sorted(set(values))
        else:
            start = self._finite_number(params.get("startTime"), "startTime")
            end = self._finite_number(params.get("endTime"), "endTime")
            if start < 0 or end < start or end > self.duration + 1e-6:
                raise ValueError("Requested time window is outside the video")
            fps = self._finite_number(params.get("fps", 2), "fps")
            if fps <= 0 or fps > 60:
                raise ValueError("fps must be greater than 0 and at most 60")
            times, cursor = [], start
            while cursor <= end + 1e-9:
                times.append(cursor)
                cursor += 1.0 / fps
                if len(times) > self.MAX_UNIQUE_FRAMES:
                    raise ValueError("Request exceeds 128 sampled frames")
            indices = self._select_nearest(times)
        if len(indices) > self.MAX_UNIQUE_FRAMES:
            raise ValueError("Request exceeds 128 unique frames")
        if max_count is not None and len(indices) > max_count:
            raise ValueError(f"Request exceeds {max_count} frames for this mode")
        return indices

    def _decode(self, indices):
        missing = set(indices) - self._cache.keys()
        decoded_new = {}
        if missing:
            # Decode one sequential pass for all cache misses, preserving exact
            # decode-order frame numbers and the indexed PTS/time mapping.
            with av.open(str(self.video_path)) as container:
                stream = container.streams.video[0]
                stream.thread_type = "AUTO"
                for index, frame in enumerate(container.decode(stream)):
                    if index not in missing:
                        continue
                    row = self._frames[index]
                    if frame.pts != row["pts"] or abs(float(frame.time) - row["sourceTime"]) > 1e-7:
                        raise ValueError("Decoded frame no longer matches indexed source PTS")
                    buf = io.BytesIO()
                    frame.to_image().convert("RGB").save(buf, format="JPEG", quality=94)
                    decoded_new[index] = buf.getvalue()
                    missing.remove(index)
                    if not missing:
                        break
            if missing:
                raise ValueError(f"Could not decode indexed frames: {sorted(missing)}")
        # Keep this request's working set available even if the LRU cache must
        # evict older entries to stay bounded.
        cached = {index: self._cache[index] for index in indices if index in self._cache}
        for index in cached:
            self._cache.pop(index)
        self._cache.update(cached)
        self._cache.update(decoded_new)
        while len(self._cache) > self.MAX_UNIQUE_FRAMES:
            self._cache.pop(next(iter(self._cache)))
        return {i: self._cache[i] for i in indices}

    @staticmethod
    def _content(data):
        return {"type": "image", "data": base64.b64encode(data).decode("ascii"), "mimeType": "image/jpeg"}

    def _asset(self, image, kind, metadata):
        buf = io.BytesIO()
        image.save(buf, format="JPEG", quality=94)
        data = buf.getvalue()
        digest = hashlib.sha256(data).hexdigest()
        path = self.output_dir / f"{digest}.jpg"
        if not path.exists():
            path.write_bytes(data)
        return self._content(data), {
            "assetId": digest, "sha256": digest, "kind": kind,
            "width": image.width, "height": image.height, "path": str(path), **metadata,
        }

    @staticmethod
    def _label(meta):
        return f"frame {meta['frame']} | time {meta['time']:.3f}s | source {meta['sourceTime']:.3f}s"

    def read_video_window(self, params):
        if not isinstance(params, dict):
            raise ValueError("params must be an object")
        mode = params.get("mode", "sheet")
        if mode not in ("sheet", "full", "raw"):
            raise ValueError("mode must be 'sheet', 'full' or 'raw'")
        indices = self._resolve_frames(params, self.MAX_FULL_FRAMES if mode in ("full", "raw") else None)
        decoded = self._decode(indices)
        contents, assets = [], []
        if mode == "raw":
            for index in indices:
                image = Image.open(io.BytesIO(decoded[index])).convert("RGB")
                content, asset = self._asset(image, "raw", {
                    **self._frame_meta(index), "sourceSize": list(image.size),
                    "crop": [0, 0, image.width, image.height], "scale": 1, "labelHeight": 0,
                    "coordinateSpace": "asset_pixels",
                    "transform": {"scaleX": 1, "scaleY": 1, "offsetX": 0, "offsetY": 0},
                })
                contents.append(content); assets.append(asset)
        elif mode == "full":
            for index in indices:
                meta = self._frame_meta(index)
                image = Image.open(io.BytesIO(decoded[index])).convert("RGB")
                original = image.size
                fitted = ImageOps.contain(image, (1280, 1280), Image.Resampling.LANCZOS)
                canvas = Image.new("RGB", (fitted.width, fitted.height + 28), "#121826")
                canvas.paste(fitted, (0, 28))
                from PIL import ImageDraw
                ImageDraw.Draw(canvas).text((5, 6), self._label(meta), fill="white")
                content, asset = self._asset(canvas, "full", {
                    **meta, "sourceSize": list(original), "crop": [0, 0, *original],
                    "scale": fitted.width / original[0], "labelHeight": 28,
                    "coordinateSpace": "source_image_pixels",
                    "transform": {"scaleX": fitted.width / original[0], "scaleY": fitted.height / original[1], "offsetX": 0, "offsetY": 28},
                })
                contents.append(content); assets.append(asset)
        else:
            from PIL import ImageDraw
            tiles, tile_meta = [], []
            for index in indices:
                meta = self._frame_meta(index)
                image = Image.open(io.BytesIO(decoded[index])).convert("RGB")
                original = image.size
                fitted = ImageOps.contain(image, (640, 640), Image.Resampling.LANCZOS)
                canvas = Image.new("RGB", (fitted.width, fitted.height + 28), "#121826")
                canvas.paste(fitted, (0, 28))
                ImageDraw.Draw(canvas).text((5, 6), self._label(meta), fill="white")
                tiles.append(canvas)
                tile_meta.append({**meta, "sourceSize": list(original), "crop": [0, 0, *original],
                                  "scale": fitted.width / original[0], "labelHeight": 28,
                                  "coordinateSpace": "source_image_pixels",
                                  "transform": {"scaleX": fitted.width / original[0], "scaleY": fitted.height / original[1], "offsetX": 0, "offsetY": 28}})
            for offset in range(0, len(tiles), self.SHEET_FRAMES):
                group = tiles[offset:offset + self.SHEET_FRAMES]
                cell_w = max(tile.width for tile in group)
                cell_h = max(tile.height for tile in group)
                sheet = Image.new("RGB", (cell_w * 2, cell_h * math.ceil(len(group) / 2)), "#121826")
                metadata = []
                for i, tile in enumerate(group):
                    origin = [(i % 2) * cell_w, (i // 2) * cell_h]
                    sheet.paste(tile, origin)
                    tile_contract = tile_meta[offset + i]
                    metadata.append({**tile_contract, "tileOrigin": origin, "transform": {
                        **tile_contract["transform"], "offsetX": origin[0], "offsetY": origin[1] + 28}})
                content, asset = self._asset(sheet, "sheet", {"tiles": metadata})
                contents.append(content); assets.append(asset)
        frames = [self._frame_meta(i) for i in indices]
        contents.insert(0, {"type": "text", "text": json.dumps({"mode": mode, "frames": frames}, ensure_ascii=False)})
        return {"content": contents, "details": {"frames": frames, "requestedFrames": indices,
                "returnedFrames": frames, "unavailableFrames": [], "assets": assets}}

    def inspect_region(self, params):
        if not isinstance(params, dict):
            raise ValueError("params must be an object")
        indices = self._resolve_frames({"frames": params.get("frames")}, 12)
        box = params.get("box")
        if box is None and (params.get("entityId") is not None or params.get("trackId") is not None):
            box = "entity"
        if box != "entity" and (not isinstance(box, (list, tuple)) or len(box) != 4
                or any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in box)):
            raise ValueError("box must contain four finite source-image coordinates")
        decoded = self._decode(indices)
        contents, assets = [], []
        for index in indices:
            meta = self._frame_meta(index)
            image = Image.open(io.BytesIO(decoded[index])).convert("RGB")
            original = image.size
            crop_box = box
            entity = None
            if box == "entity":
                entity = self._entity_observation(params, index)
                crop_box = entity.get("box") if entity else None
                if crop_box is None:
                    continue
            x1, y1, x2, y2 = crop_box
            rect = [max(0, math.floor(x1)), max(0, math.floor(y1)),
                    min(image.width, math.ceil(x2)), min(image.height, math.ceil(y2))]
            if rect[2] <= rect[0] or rect[3] <= rect[1]:
                raise ValueError("box is outside the source image or has no area")
            crop = image.crop(rect)
            content, asset = self._asset(crop, "region", {
                **meta, "entityId": params.get("entityId"), "trackId": params.get("trackId"),
                "candidate": entity, "crop": rect,
                "sourceSize": list(original), "scale": 1, "labelHeight": 0,
                "transform": {"scaleX": 1, "scaleY": 1, "offsetX": -rect[0], "offsetY": -rect[1]},
                "coordinateSpace": "source_image_pixels",
            })
            contents.append(content); assets.append(asset)
        returned = [asset["frame"] for asset in assets]
        frames = [self._frame_meta(i) for i in returned]
        contents.insert(0, {"type": "text", "text": json.dumps({"region": params.get("box"), "frames": frames}, ensure_ascii=False)})
        return {"content": contents, "details": {"frames": frames, "requestedFrames": indices,
                "returnedFrames": frames, "unavailableFrames": sorted(set(indices) - set(returned)), "assets": assets}}

    def _entity_observation(self, params, frame):
        if self._observation_source_state == "mismatch":
            return None
        data = self._observations or {}
        track_id = params.get("trackId")
        entity_id = params.get("entityId")
        selector = str(track_id if track_id is not None else entity_id)
        # courtPreparation snapshots keep one raw observation series per P id.
        raw = data.get("rawByPlayer") if isinstance(data, dict) else None
        if isinstance(raw, dict) and isinstance(raw.get(selector), list) and frame < len(raw[selector]):
            point = raw[selector][frame]
            if isinstance(point, dict):
                candidate = point.get("box") or point.get("imageBox")
                if self._valid_box(candidate):
                    return {"box": candidate, "entityId": selector, "source": "rawByPlayer",
                            "identityState": "unknown"}
        for row_index, row in enumerate(self._observation_rows()):
            if not isinstance(row, dict) or row.get("frame", row_index) != frame:
                continue
            records = row.get("players", row.get("tracks", []))
            for record in records if isinstance(records, list) else []:
                candidate = self._track_candidate(record)
                if candidate is None:
                    continue
                if str(candidate.get("trackId", candidate.get("entityId", ""))) != selector:
                    continue
                return candidate
        return None

    @staticmethod
    def _track_candidate(record):
        if isinstance(record, (list, tuple)) and len(record) >= 7:
            values = record[:7]
            if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in values):
                return None
            box = list(values[:4])
            if not CommentaryVideo._valid_box(box):
                return None
            track_id, confidence, class_id = values[4:7]
            return {"trackId": int(track_id), "box": box, "confidence": float(confidence),
                    "classId": int(class_id), "source": "track_candidate",
                    "identityState": "unknown"}
        if isinstance(record, dict):
            candidate_id = record.get("entityId", record.get("trackId", record.get("track_id", record.get("id"))))
            box = record.get("box") or record.get("imageBox")
            if not CommentaryVideo._valid_box(box):
                return None
            result = {"box": list(box), "source": record.get("source", "observation"),
                      "identityState": record.get("identityState", "unknown")}
            if candidate_id is not None:
                result["trackId" if "trackId" in record or "track_id" in record else "entityId"] = candidate_id
            confidence = record.get("confidence", record.get("conf"))
            if isinstance(confidence, (int, float)) and not isinstance(confidence, bool) and math.isfinite(confidence):
                result["confidence"] = float(confidence)
            class_id = record.get("classId", record.get("class_id"))
            if isinstance(class_id, (int, float)) and not isinstance(class_id, bool) and math.isfinite(class_id):
                result["classId"] = int(class_id)
            return result
        return None

    def _entity_box(self, entity_id, frame):
        candidate = self._entity_observation({"entityId": entity_id}, frame)
        return candidate.get("box") if candidate else None

    @staticmethod
    def _valid_box(value):
        return (isinstance(value, (list, tuple)) and len(value) == 4
                and all(not isinstance(v, bool) and isinstance(v, (int, float)) and math.isfinite(v) for v in value)
                and value[2] > value[0] and value[3] > value[1])

    @staticmethod
    def _even_sample(values, limit):
        values = list(values)
        if len(values) <= limit:
            return values
        if limit == 1:
            return [values[len(values) // 2]]
        positions = [round(i * (len(values) - 1) / (limit - 1)) for i in range(limit)]
        return [values[i] for i in positions]

    def _row_candidates(self, row):
        if not isinstance(row, dict):
            return []
        records = row.get("players", row.get("tracks", []))
        result = []
        for record in records if isinstance(records, list) else []:
            candidate = self._track_candidate(record)
            if candidate is not None:
                result.append(candidate)
        return result

    def get_observations(self, params):
        if not isinstance(params, dict):
            raise ValueError("params must be an object")
        start = self._finite_number(params.get("startTime"), "startTime")
        end = self._finite_number(params.get("endTime"), "endTime")
        if start < 0 or end < start or end > self.duration + 1e-6:
            raise ValueError("Requested time window is outside the video")
        requested = params.get("entityIds")
        requested_tracks = params.get("trackIds")
        if requested is not None and (not isinstance(requested, list) or len(requested) > 32
                                      or any(not isinstance(x, (str, int)) for x in requested)):
            raise ValueError("entityIds must be a list of at most 32 identifiers")
        if requested_tracks is not None and (not isinstance(requested_tracks, list) or len(requested_tracks) > 32
                                             or any(type(x) is not int for x in requested_tracks)):
            raise ValueError("trackIds must be a list of at most 32 integer track identifiers")
        if requested is not None and requested_tracks is not None and len(requested) + len(requested_tracks) > 32:
            raise ValueError("At most 32 entity or track identifiers may be requested")
        if self._observations is None or self._observation_source_state == "mismatch":
            return {"status": "unknown", "source": "unavailable", "sourceState": self._observation_source_state,
                    "startTime": start,
                    "endTime": end, "entities": []}
        if requested is None and requested_tracks is None:
            # Give the model a small overview of available tracks without
            # flooding context with every 60fps detection.
            row_by_frame = {}
            for ordinal, row in enumerate(self._observation_rows()):
                if isinstance(row, dict):
                    index = row.get("frame", ordinal)
                    if type(index) is int and 0 <= index < len(self._frames):
                        row_by_frame[index] = row
            eligible = [i for i, row in enumerate(self._frames)
                        if start <= row["time"] <= end and (not row_by_frame or i in row_by_frame)]
            selected = self._even_sample(eligible, self.OBSERVATION_FRAMES)
            frames = []
            for index in selected:
                candidates = self._row_candidates(row_by_frame[index]) if index in row_by_frame else []
                if not candidates and isinstance(self._observations, dict):
                    raw = self._observations.get("rawByPlayer")
                    if isinstance(raw, dict):
                        for entity_id in raw:
                            candidate = self._entity_observation({"entityId": entity_id}, index)
                            if candidate is not None:
                                candidates.append(candidate)
                truncated = len(candidates) > self.OBSERVATIONS_PER_FRAME
                frames.append({**self._frame_meta(index), "tracks": candidates[:self.OBSERVATIONS_PER_FRAME],
                               "tracksTruncated": truncated})
            return {"status": "available", "source": self.observations_path.name,
                    "sourceState": self._observation_source_state, "startTime": start, "endTime": end,
                    "sampled": len(eligible) > len(selected),
                    "sampling": {"method": "evenly_spaced", "availableFrames": len(eligible),
                                 "returnedFrames": len(selected), "maxFrames": self.OBSERVATION_FRAMES,
                                 "maxTracksPerFrame": self.OBSERVATIONS_PER_FRAME},
                    "frames": frames}

        # Return only matching compact entities; track ids remain candidates and
        # are never promoted to person names or stable P identities.
        ids = [("entityId", str(x)) for x in requested or []]
        ids.extend(("trackId", x) for x in requested_tracks or [])
        entities = []
        for key, entity_id in ids:
            frames = []
            matched = []
            for index, row in enumerate(self._frames):
                if start <= row["time"] <= end:
                    candidate = self._entity_observation({key: entity_id}, index)
                    if candidate is not None:
                        matched.append({"frame": index, "time": row["time"], "sourceTime": row["sourceTime"],
                                        **candidate, "state": "observed"})
            frames = self._even_sample(matched, self.OBSERVATION_FRAMES)
            entry = {key: entity_id, "status": "observed" if frames else "unknown",
                     "sampled": len(matched) > len(frames), "availableFrames": len(matched), "frames": frames}
            if key == "trackId":
                entry["identityState"] = "unknown"
            entities.append(entry)
        return {"status": "available", "source": self.observations_path.name,
                "sourceState": self._observation_source_state,
                "startTime": start, "endTime": end, "sampled": any(e["sampled"] for e in entities),
                "entities": entities,
                "unrequestedEntities": "omitted" if requested is None else "unknown"}
