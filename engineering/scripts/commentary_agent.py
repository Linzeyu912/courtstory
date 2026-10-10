"""Run the incremental Pi video commentary agent from an interactive terminal."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import queue
import re
import shutil
import subprocess
import threading
import time

from dotenv import dotenv_values

from commentary_video import CommentaryVideo
from commentary_plan import build_name_snapshot, model_config
from shot_feedback import build_rating_context

ROOT = Path(__file__).resolve().parents[2]
WORKER = ROOT / "engineering/tools/player-review/agents/commentary-worker.mjs"
TOKEN_PLAN_URL = "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"


def provider_environment(env_file, provider, model=None):
    values = {**dotenv_values(env_file, encoding="utf-8-sig"), **os.environ}
    if provider == "openrouter":
        key = values.get("OPENROUTER_API_KEY") or values.get("OPEN_ROUTER_KEY")
        if not key:
            raise ValueError("Missing OPENROUTER_API_KEY / OPEN_ROUTER_KEY; no automatic provider fallback")
        child = os.environ.copy()
        for name in ("QWEN_KEY", "QWEN_API_KEY", "QWEN_TOKEN_PLAN_KEY", "OPEN_ROUTER_KEY"):
            child.pop(name, None)
        child.update({"COMMENTARY_PROVIDER": "openrouter", "OPENROUTER_API_KEY": key,
                      "OPENROUTER_MODEL": model or "openai/gpt-6-astra"})
        return child, key
    key_name = "QWEN_TOKEN_PLAN_KEY" if provider == "token-plan" else "QWEN_KEY"
    key = values.get(key_name)
    if not key:
        raise ValueError(f"Missing {key_name}; no automatic provider fallback")
    child = os.environ.copy()
    child.pop("QWEN_TOKEN_PLAN_KEY", None)
    child.update({
        "COMMENTARY_PROVIDER": provider,
        "QWEN_KEY": key,
        "QWEN_BASE_URL": TOKEN_PLAN_URL if provider == "token-plan" else values.get("QWEN_BASE_URL") or "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "QWEN_MODEL": model or "qwen3.8-max",
        "QWEN_REQUEST_TIMEOUT_MS": "120000",
    })
    return child, key


def redact(text, secret=""):
    if secret:
        text = text.replace(secret, "[REDACTED]")
    text = re.sub(r"(?i)Bearer\s+[^\s\"']+", "Bearer [REDACTED]", text)
    return re.sub(r"\bsk-[A-Za-z0-9_-]{8,}", "[REDACTED]", text)


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


def commentary_markdown(result):
    plan = result.get("plan") or {}
    lines = ["# 视频解说试跑", "", f"状态：{result.get('status', 'unknown')}", "", plan.get("summary", "尚未产出完整解说。"), ""]
    for cue in plan.get("cues", []):
        start, end = cue.get("suggestedStartTime", 0), cue.get("suggestedEndTime", 0)
        delivery = "暂停讲解" if cue.get("delivery") == "pause" else "播放中讲解"
        lines.extend([f"## {start:.2f}–{end:.2f} 秒 · {delivery}", "", cue.get("text", ""), "", f"重点：{cue.get('focus', '')}", ""])
    uncertainties = list(plan.get("uncertainties", []))
    for event in plan.get("events", []):
        uncertainties.extend(event.get("uncertainties", []))
    if uncertainties:
        lines.extend(["## 待核实", "", *[f"- {item}" for item in dict.fromkeys(uncertainties)], ""])
    lines.extend(["时间均为源视频片内秒数；暂停讲解的时间是建议暂停位置区间，不是语音时长。此轮仅生成文字，未合成语音或渲染视频。", ""])
    return "\n".join(lines)


def run_worker(video, context, overview, output, child_env, secret, config, goal):
    node = shutil.which("node")
    if not node:
        raise RuntimeError("Node.js is required; see agents/package.json")
    process = subprocess.Popen(
        [node, str(WORKER)], cwd=ROOT, env=child_env,
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, encoding="utf-8", bufsize=1,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
    )
    messages = queue.Queue()
    errors = []

    def read_stdout():
        for line in process.stdout:
            messages.put(line)
        messages.put(None)

    def read_stderr():
        for line in process.stderr:
            errors.append(redact(line.strip(), secret)[:2000])
            if len(errors) > 40:
                del errors[0]
            (output / "worker-stderr.log").write_text("\n".join(errors), encoding="utf-8")

    readers = [threading.Thread(target=read_stdout, daemon=True), threading.Thread(target=read_stderr, daemon=True)]
    for reader in readers:
        reader.start()

    def send(value):
        process.stdin.write(json.dumps(value, ensure_ascii=False) + "\n")
        process.stdin.flush()

    started = time.monotonic()
    result = None
    checkpoint = None
    trace = []
    methods = {
        "get_video_context": lambda params: {k: v for k, v in context.items() if k not in ("frames", "sampleFrames")},
        "read_video_window": video.read_video_window,
        "inspect_region": video.inspect_region,
        "get_observations": video.get_observations,
    }
    try:
        send({"type": "start", "context": context, "overview": overview, "config": config, "goal": goal})
        while time.monotonic() - started < config["timeoutSeconds"] + 10:
            try:
                line = messages.get(timeout=0.5)
            except queue.Empty:
                continue
            if line is None:
                break
            try:
                message = json.loads(line)
            except json.JSONDecodeError:
                continue
            kind = message.get("type")
            if kind == "rpc":
                method, params = message.get("method"), message.get("params") or {}
                entry = {"method": method, "params": params, "elapsedSeconds": round(time.monotonic() - started, 2)}
                try:
                    if method not in methods:
                        raise ValueError(f"Unsupported video method: {method}")
                    response = methods[method](params)
                    details = response.get("details", {})
                    entry["frames"] = details.get("frames", [])
                    entry["assets"] = details.get("assets", [])
                    send({"type": "rpc_result", "id": message["id"], "result": response})
                except (BrokenPipeError, OSError):
                    # A terminated worker cannot receive a second error response.
                    raise
                except Exception as exc:
                    entry["error"] = redact(str(exc), secret)
                    send({"type": "rpc_result", "id": message["id"], "error": entry["error"]})
                trace.append(entry)
                write_json(output / "tool-calls.json", trace)
                print(f"tool {method}: {len(entry.get('frames', []))} frames" + (f" error={entry['error']}" if "error" in entry else ""), flush=True)
            elif kind == "result":
                result = message.get("result")
                break
            elif kind in ("progress", "status"):
                if message.get("status") == "checkpoint" and isinstance(message.get("safePlan"), dict):
                    checkpoint = json.loads(redact(json.dumps(message["safePlan"], ensure_ascii=False), secret))
                    write_json(output / "draft.json", checkpoint)
                # Keep progress compact; rejected structured plans are diagnostic files, not checkpoints.
                progress = {k: message[k] for k in ("type", "status", "round", "usage") if k in message}
                if isinstance(message.get("event"), dict):
                    if isinstance(message["event"].get("candidatePlan"), dict):
                        write_json(output / "rejected-plan.json", json.loads(redact(json.dumps(message["event"]["candidatePlan"], ensure_ascii=False), secret)))
                    progress["event"] = {k: v for k, v in message["event"].items() if k in ("tool", "request", "stopReason", "toolCalls", "usage", "error", "finish", "eventCount", "cueCount")}
                trace.append(json.loads(redact(json.dumps(progress, ensure_ascii=False), secret)))
                write_json(output / "tool-calls.json", trace)
        if result is None:
            result = {"status": "partial" if checkpoint else "failed", "plan": checkpoint, "error": "Worker ended without a result or exceeded wall-clock limit", "diagnostics": errors}
    except (BrokenPipeError, OSError) as exc:
        result = {"status": "partial" if checkpoint else "failed", "plan": checkpoint,
                  "error": redact(f"Worker communication closed: {exc}", secret)}
    finally:
        if process.poll() is None:
            try:
                send({"type": "cancel"})
                process.wait(timeout=3)
            except (OSError, subprocess.TimeoutExpired):
                process.kill()
        process.wait(timeout=5)
        for reader in readers:
            reader.join(timeout=1)
        for stream in (process.stdin, process.stdout, process.stderr):
            try:
                stream.close()
            except OSError:
                pass
    if errors:
        result["diagnostics"] = errors
    result["workerExitCode"] = process.returncode
    result = json.loads(redact(json.dumps(result, ensure_ascii=False), secret))
    result["elapsedSeconds"] = round(time.monotonic() - started, 2)
    result["provider"] = ({"name": "openrouter", "model": child_env["OPENROUTER_MODEL"], "reasoningEffort": "medium"}
                          if child_env.get("COMMENTARY_PROVIDER") == "openrouter" else
                          {"name": "token-plan" if child_env["QWEN_BASE_URL"] == TOKEN_PLAN_URL else "qwen", "model": child_env["QWEN_MODEL"], "reasoningEffort": "off"})
    if child_env.get("COMMENTARY_MODEL_CONFIG"):
        actual = json.loads(child_env["COMMENTARY_MODEL_CONFIG"])
        result["producerConfigSnapshot"] = actual
        result["provider"]["reasoningEffort"] = actual["reasoning"]
    write_json(output / "tool-calls.json", trace)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--video", type=Path)
    source.add_argument("--sample", help="Registered review-library sample ID")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--observations", type=Path)
    parser.add_argument("--review", type=Path, help="Saved review identity snapshot, source-bound")
    parser.add_argument("--producer-config", type=Path, help="Host-owned non-secret locked model configuration")
    parser.add_argument("--provider", choices=("token-plan", "qwen", "openrouter"), default="token-plan")
    parser.add_argument("--model")
    parser.add_argument("--env-file", type=Path, default=ROOT / ".env")
    parser.add_argument("--max-requests", type=int, default=12)
    parser.add_argument("--max-tools", type=int, default=30)
    parser.add_argument("--timeout", type=int, default=480)
    parser.add_argument("--prepare-only", action="store_true")
    parser.add_argument("--goal", default="理解全片的篮球回合，选择最值得讲的关键动作和战术关系，生成简洁、自然的中文解说及源视频出现时机。必要时回看重点。人名未经核实则用球队、球衣或位置描述；不要从文件名推断。")
    args = parser.parse_args()
    if min(args.max_requests, args.max_tools, args.timeout) < 1:
        parser.error("Budgets must be positive")
    video_path = args.video
    if args.sample:
        library = json.loads((ROOT / "data/videos/tactics/acceptance/review-library.json").read_text(encoding="utf-8"))
        sample = next((s for s in library["samples"] if s["id"] == args.sample), None)
        if sample is None:
            parser.error(f"Unknown sample: {args.sample}")
        video_path = ROOT / sample["video"]
    output = args.output.resolve()
    if output.exists():
        parser.error("Output path exists; choose a new directory to retain previous results")
    output.mkdir(parents=True)
    video = CommentaryVideo(video_path, output / "images", args.observations)
    context = video.context()
    if args.review:
        review = json.loads(args.review.read_text(encoding="utf-8"))
        source_clip = json.loads(args.observations.read_text(encoding="utf-8")) if args.observations else {"video_sha256": video.video_ref, "frames": context["frames"]}
        if source_clip.get("video_sha256", source_clip.get("videoSha256")) != video.video_ref:
            raise ValueError("Saved review does not match decoded video")
        context["nameSnapshot"] = build_name_snapshot(review, source_clip)
        context["sourceCuts"] = sorted(set(source_clip.get("sourceCuts", [])) |
                                       set(review.get("settings", {}).get("cuts", [])) |
                                       set(review.get("settings", {}).get("sourceCuts", [])))
        context["ratingContext"] = build_rating_context(review, source_clip, context["nameSnapshot"])
    context["planContract"] = True
    fps = min(2, 120 / max(context["duration"], 1))
    overview = video.read_video_window({"startTime": 0, "endTime": context["duration"], "fps": fps, "mode": "sheet"})
    write_json(output / "context.json", context)
    write_json(output / "overview.json", overview.get("details", {}))
    print(f"overview: {len(overview.get('details', {}).get('frames', []))} frames; {context['duration']:.2f}s", flush=True)
    if args.prepare_only:
        print(f"Prepared: {output}")
        return 0
    child_env, secret = provider_environment(args.env_file, args.provider, args.model)
    if args.producer_config:
        locked = model_config(json.loads(args.producer_config.read_text(encoding="utf-8")))
        if locked["provider"] != args.provider or locked["model"] != child_env.get("OPENROUTER_MODEL"):
            raise ValueError("Locked producer config differs from actual provider/model")
        child_env["COMMENTARY_MODEL_CONFIG"] = json.dumps(locked, ensure_ascii=False)
    config = {"maxRequests": args.max_requests, "maxToolCalls": args.max_tools, "timeoutSeconds": args.timeout}
    result = run_worker(video, context, overview, output, child_env, secret, config, args.goal)
    write_json(output / "result.json", result)
    (output / "commentary.md").write_text(commentary_markdown(result), encoding="utf-8")
    print(f"{result.get('status')}: {output / 'commentary.md'}", flush=True)
    return 0 if result.get("status") == "completed" else 2


if __name__ == "__main__":
    raise SystemExit(main())
