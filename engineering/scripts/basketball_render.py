"""Render unverified fixed-slot suggestions with exact source PTS and copied audio.

Diagnostic evidence uses internal track IDs. The delivered preview shows Player
1–10 only within explicit model bindings; unresolved observations remain pending.
"""
import argparse
from fractions import Fraction
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

import cv2
from basketball_presentation import overlay_style, proposal_points, stabilize_points


def resolve_ffmpeg(explicit=None):
    if explicit is not None:
        path = Path(explicit).expanduser().resolve()
        if not path.is_file():
            raise FileNotFoundError(f"指定的 FFmpeg 文件不存在：{path}")
        return path
    installed = shutil.which("ffmpeg")
    if installed:
        return Path(installed).resolve()
    local = Path(__file__).resolve().parents[2] / "tmp/tactics-ffmpeg.exe"
    if local.is_file():
        return local
    raise FileNotFoundError("找不到 FFmpeg：请加入 PATH、放到仓库 tmp/tactics-ffmpeg.exe，或用 --ffmpeg 指定本机文件。")


def aliases_for_frame(suggestions, record):
    aliases, occupied = {}, set()
    for entity in suggestions.get("entities", []):
        alias = int(entity["id"].removeprefix("P"))
        if not 1 <= alias <= 10:
            raise ValueError("Preview aliases must be fixed Player 1–10 slots.")
        for binding in entity["bindings"]:
            if not binding["start"] <= record["frame"] <= binding["end"]:
                continue
            identity = int(binding["trackId"])
            if record.get("track_evidence", {}).get(str(identity), {}).get("identity_review_required"):
                continue
            if identity in aliases or alias in occupied:
                raise ValueError("Ambiguous simultaneous fixed-slot bindings.")
            aliases[identity] = alias
            occupied.add(alias)
    return aliases


def draw_candidates(image, record, variant, aliases=None):
    annotated = image.copy()
    for row in record["tracks"]:
        x1, y1, x2, y2 = map(int, row[:4])
        ident = int(row[4])
        suggested = aliases is not None and ident in aliases
        color = (70, 225, 255) if aliases is None or suggested else (180, 180, 180)
        label = (f"Player {aliases[ident]} ?" if suggested else
                 f"T{ident}" if aliases is None else "pending") + f" {row[5]:.2f}"
        cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 2)
        cv2.putText(annotated, label, (x1, max(18, y1 - 5)), cv2.FONT_HERSHEY_SIMPLEX, .5, (0, 0, 0), 3, cv2.LINE_AA)
        cv2.putText(annotated, label, (x1, max(18, y1 - 5)), cv2.FONT_HERSHEY_SIMPLEX, .5, color, 1, cv2.LINE_AA)
    for row in record["pending_detections"]:
        x1, y1, x2, y2 = map(int, row[:4])
        cv2.rectangle(annotated, (x1, y1), (x2, y2), (180, 180, 180), 1)
        cv2.putText(annotated, f"pending {row[4]:.2f}", (x1, max(18, y1 - 5)),
                    cv2.FONT_HERSHEY_SIMPLEX, .45, (220, 220, 220), 1, cv2.LINE_AA)
    cv2.rectangle(annotated, (0, 0), (image.shape[1], 45), (20, 20, 20), -1)
    cv2.putText(annotated, f"{variant} | frame {record['frame']} | PTS {record['time']:.3f}s | MODEL / UNVERIFIED",
                (12, 29), cv2.FONT_HERSHEY_SIMPLEX, .65, (255, 255, 255), 1, cv2.LINE_AA)
    return annotated

def _bgr(color):
    return tuple(int(color[index:index+2],16) for index in (5,3,1))

def _line(image,start,end,color,thickness,dashes):
    if not dashes:cv2.line(image,start,end,color,thickness,cv2.LINE_AA);return
    dx,dy=end[0]-start[0],end[1]-start[1];length=(dx*dx+dy*dy)**.5
    if not length:return
    step=sum(dashes);position=0
    while position<length:
        a=position/length;b=min(length,position+dashes[0])/length
        cv2.line(image,(round(start[0]+dx*a),round(start[1]+dy*a)),(round(start[0]+dx*b),round(start[1]+dy*b)),color,thickness,cv2.LINE_AA)
        position+=step

def draw_team_overlay(image,record,variant,entity_points,policy):
    """Same observed geometry, team colors, uncertainty and foot badge policy as UI."""
    annotated=image.copy();scale=image.shape[0]/720;thickness=max(2,round(policy['box']['lineWidthAt720']*scale))
    assigned={point.get('trackId') for _,point in entity_points if point.get('x') is not None}
    for row in record['tracks']+record.get('pending_detections',[]):
        if len(row)>6 and row[4] in assigned:continue
        x1,y1,x2,y2=map(round,row[:4]);pending=_bgr(policy['pendingColor'])
        cv2.rectangle(annotated,(x1,y1),(x2,y2),pending,1,cv2.LINE_AA)
        cv2.putText(annotated,'pending',(x1,max(18,y1-5)),cv2.FONT_HERSHEY_SIMPLEX,.45*max(1,scale),pending,1,cv2.LINE_AA)
    for entity,point in entity_points:
        if point.get('x') is None:continue
        style=overlay_style(entity,point,policy);color=_bgr(style['color'])
        dashes=[value*scale for value in policy['box']['dashAt720']] if style['dashed'] else None
        if point.get('box'):
            x1,y1,x2,y2=map(round,point['box']);corners=[(x1,y1),(x2,y1),(x2,y2),(x1,y2)]
            for start,end in zip(corners,corners[1:]+corners[:1]):_line(annotated,start,end,color,thickness,dashes)
        foot=(round(point['x']),round(point['y']));axes=(max(2,round(policy['foot']['radiusXAt720']*scale)),max(1,round(policy['foot']['radiusYAt720']*scale)))
        if style['dashed']:
            for angle in range(0,360,45):cv2.ellipse(annotated,foot,axes,0,angle,angle+30,color,thickness,cv2.LINE_AA)
        else:cv2.ellipse(annotated,foot,axes,0,0,360,color,thickness,cv2.LINE_AA)
        text=style['label'];font_scale=policy['foot']['fontSizeAt720']*scale/30
        size,_=cv2.getTextSize(text,cv2.FONT_HERSHEY_SIMPLEX,font_scale,1)
        text_point=(round(point['x']-size[0]/2),max(size[1]+2,round(point['y']-policy['foot']['numberOffsetAt720']*scale)))
        cv2.rectangle(annotated,(text_point[0]-3,text_point[1]-size[1]-3),(text_point[0]+size[0]+3,text_point[1]+4),(16,25,34),-1)
        cv2.putText(annotated,text,text_point,cv2.FONT_HERSHEY_SIMPLEX,font_scale,color,1,cv2.LINE_AA)
    cv2.rectangle(annotated,(0,0),(image.shape[1],45),(20,20,20),-1)
    cv2.putText(annotated,f"{variant} | frame {record['frame']} | PTS {record['time']:.3f}s | UNVERIFIED",(12,28),cv2.FONT_HERSHEY_SIMPLEX,.6,(255,255,255),1,cv2.LINE_AA)
    return annotated


def media_signature(path):
    import av
    with av.open(str(path)) as container:
        video = container.streams.video[0]
        signature = {"width": video.codec_context.width, "height": video.codec_context.height,
                     "pts_seconds": [float(frame.pts * frame.time_base) for frame in container.decode(video)]}
    audio = []
    with av.open(str(path)) as container:
        for stream in container.streams.audio:
            digest = hashlib.sha256()
            for packet in container.demux(stream):
                if packet.size:
                    digest.update(bytes(packet))
            audio.append({"codec": stream.codec_context.name, "packet_sha256": digest.hexdigest(),
                          "start_seconds": float(stream.start_time * stream.time_base) if stream.start_time is not None else None,
                          "duration_seconds": float(stream.duration * stream.time_base) if stream.duration is not None else None})
    signature["audio"] = audio
    return signature


def validate_media_signatures(source, rendered):
    problems = []
    if (source["width"], source["height"]) != (rendered["width"], rendered["height"]):
        problems.append("video dimensions changed")
    a, b = source["pts_seconds"], rendered["pts_seconds"]
    if len(a) != len(b) or any(abs(x - y) > 1e-6 for x, y in zip(a, b)):
        problems.append("decoded frame count or source PTS changed")
    if source["audio"] != rendered["audio"]:
        problems.append("source audio codec, payload or timing changed")
    return problems


def render(args):
    ffmpeg = resolve_ffmpeg(args.ffmpeg)
    import av
    from basketball_run import ROOT, save_json, sha256, validate_output_paths
    source, tracks_path, output = args.video.resolve(), args.tracks.resolve(), args.output.resolve()
    track_meta_path = tracks_path.with_suffix(".meta.json")
    output_meta_path = output.with_name(output.name + ".meta.json")
    for protected in (source, tracks_path, track_meta_path):
        validate_output_paths(source, protected, output)
        validate_output_paths(source, protected, output_meta_path)
    records = json.loads(tracks_path.read_text(encoding="utf-8"))
    meta = json.loads(track_meta_path.read_text(encoding="utf-8"))
    source_hash = sha256(source)
    if source_hash != meta["video_sha256"] or len(records) != meta["frames"]:
        raise ValueError("Tracking candidates do not belong to the supplied source.")
    suggestions = meta.get("identitySuggestions", {"entities": []})
    presentation=meta.get('presentation');policy=presentation.get('policy') if presentation else None
    raw_points=proposal_points(suggestions,records,meta.get('source_cuts',[])) if policy else {}
    display_points={key:stabilize_points(points,meta.get('source_cuts',[]),meta['width'],meta['height'],policy) for key,points in raw_points.items()}
    output.parent.mkdir(parents=True, exist_ok=True)
    cache = ROOT / "tmp/player-identity-test"
    cache.mkdir(parents=True, exist_ok=True)
    source_signature = media_signature(source)
    with tempfile.TemporaryDirectory(prefix="basketball-preview-", dir=cache) as temporary:
        intermediate = Path(temporary) / "annotated.mp4"
        candidate = Path(temporary) / "encoded.mp4"
        with av.open(str(source)) as original, av.open(str(intermediate), "w") as annotated:
            stream = original.streams.video[0]
            rate, time_base = stream.average_rate, stream.time_base
            encoder = annotated.add_stream("libx264", rate=rate)
            encoder.width, encoder.height = stream.codec_context.width, stream.codec_context.height
            encoder.pix_fmt = "yuv420p"
            encoder.time_base = encoder.codec_context.time_base = time_base
            encoder.options = {"preset": "ultrafast", "crf": "18"}
            count = 0
            for count, decoded in enumerate(original.decode(stream), 1):
                if count > len(records):
                    raise ValueError("Source has more decoded frames than candidates.")
                record = records[count - 1]
                if record["frame"] != count - 1 or abs(record["time"] - float(decoded.pts * decoded.time_base)) > 1e-6:
                    raise ValueError("Candidate index/PTS does not match actual source frame.")
                if policy:
                    entity_points=[({**entity,'modelTeamGroup':entity.get('teamGroup')},display_points[entity['id']][count-1]) for entity in suggestions['entities']]
                    image=draw_team_overlay(decoded.to_ndarray(format='bgr24'),record,'Blue / Orange | stable display',entity_points,policy)
                else:
                    image = draw_candidates(decoded.to_ndarray(format="bgr24"), record, "Model suggestion / review required",
                                            aliases_for_frame(suggestions, record))
                rendered = av.VideoFrame.from_ndarray(image, format="bgr24")
                rendered.pts, rendered.time_base = decoded.pts, decoded.time_base
                for packet in encoder.encode(rendered):
                    annotated.mux(packet)
                if record["frame"] in {100, 159, 212}:
                    cv2.imwrite(str(output.parent / f"{output.stem}-frame-{record['frame']:03d}.jpg"), image)
            if count != len(records):
                raise ValueError("Source has fewer decoded frames than candidates.")
            for packet in encoder.encode(None):
                annotated.mux(packet)
        attempts = []
        for codec, options in (("h264_nvenc", ["-preset", "p4", "-cq", "22", "-b:v", "0"]),
                               ("libx264", ["-preset", "fast", "-crf", "20"])):
            command = [str(ffmpeg), "-hide_banner", "-y", "-copyts", "-i", str(intermediate),
                       "-i", str(source), "-map", "0:v:0", "-map", "1:a?", "-c:v", codec, *options,
                       "-fps_mode:v", "passthrough", "-pix_fmt", "yuv420p", "-c:a", "copy",
                       "-avoid_negative_ts", "disabled", "-movflags", "+faststart", str(candidate)]
            completed = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace")
            log = output.parent / f"{output.stem}-{codec}.log"
            log.write_text(completed.stdout + "\n" + completed.stderr, encoding="utf-8")
            attempt = {"encoder": codec, "returncode": completed.returncode, "log": str(log), "command": command}
            attempts.append(attempt)
            if completed.returncode:
                continue
            rendered_signature = media_signature(candidate)
            problems = validate_media_signatures(source_signature, rendered_signature)
            attempt["validation_problems"] = problems
            if not problems:
                break
        else:
            raise RuntimeError(f"No encoder preserved source frame/audio timing: {attempts}")
        if sha256(source) != source_hash:
            raise RuntimeError("Source changed during rendering.")
        candidate.replace(output)
    save_json(output_meta_path, {"video_sha256": source_hash, "tracks_sha256": sha256(tracks_path),
                               "tracking_meta_sha256": sha256(track_meta_path), "output_sha256": sha256(output),
                               "frames": len(records), "display": "two team colors / deterministic stable boxes / numbered image-foot estimates" if policy else "fixed P1–P10 explicit model bindings only; unassigned gray/pending",
                               "presentation":presentation,"ground_contact_verified":False,
                               "identity_verified": False, "source_media": source_signature,
                               "rendered_media": rendered_signature, "encoder_attempts": attempts})
    print(json.dumps({"output": str(output), "frames": len(records), "encoder": attempts[-1]["encoder"],
                      "first_pts": rendered_signature["pts_seconds"][0], "last_pts": rendered_signature["pts_seconds"][-1],
                      "audio_payload_and_timing_identical": True}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--video", type=Path, required=True)
    parser.add_argument("--tracks", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--ffmpeg", type=Path, help="Local FFmpeg executable; defaults to PATH, then repository tmp/tactics-ffmpeg.exe")
    render(parser.parse_args())


if __name__ == "__main__":
    main()
