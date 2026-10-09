"""Small background job service for commentary understanding and rendering."""
from __future__ import annotations

import hashlib
from copy import deepcopy
from datetime import datetime, timezone
import json
import math
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import threading
import uuid

from dotenv import dotenv_values

from commentary_agent import ROOT as SCRIPT_ROOT, redact
from commentary_tts import NATURAL_STYLE, STYLE


class CueConflict(ValueError):
    """The same cue changed since this editor loaded it."""


def _json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def _read(path, default=None):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return default


def _safe_error(text, secrets=()):
    text = str(text)
    for secret in secrets:
        if secret:
            text = text.replace(secret, "[REDACTED]")
    return redact("\n".join(text.splitlines()[-20:]))[-4000:]


class CommentaryJobs:
    """Owns job files and subprocesses under a private server-side root."""

    def __init__(self, root, python=sys.executable):
        self.root = Path(root).resolve()
        self.python = str(python)
        self.root.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._threads = set()
        self._processes = set()
        self._mark_interrupted()

    def _mark_interrupted(self):
        for path in self.root.glob("*/jobs/*/job.json"):
            state = _read(path, {})
            if state.get("status") == "running":
                state.update(status="failed", stage="interrupted", error="服务重启时任务仍在运行。")
                _json(path, state)

    def status(self):
        values = {**dotenv_values(SCRIPT_ROOT / ".env", encoding="utf-8-sig"), **os.environ}
        model = "openai/gpt-6-astra"
        configured = bool(values.get("OPENROUTER_API_KEY") or values.get("OPEN_ROUTER_KEY"))
        tts_configured = bool(values.get("VOLCENGINE_TTS_API_KEY"))
        return {
            "model": model, "understandingConfigured": configured, "ttsConfigured": tts_configured,
            "understandingCredential": configured, "understandingProvider": "openrouter",
            "understandingModel": model, "speechCredential": tts_configured,
        }

    @staticmethod
    def _context(clip, variant, qa):
        clip_id = clip.get("video_sha256") or clip.get("videoSha256") or clip.get("id") or clip.get("clipId")
        if not clip_id:
            raise ValueError("clip must identify the source video")
        identity = json.dumps([str(clip_id), str(clip.get("tracking_fingerprint", "")),
                               str(variant), str(qa)], ensure_ascii=False)
        # Keep generated image paths below Windows' common 260-character limit.
        return hashlib.sha256(identity.encode("utf-8")).hexdigest()[:16]

    def _dir(self, clip, variant, qa):
        return self.root / self._context(clip, variant, qa)

    @staticmethod
    def _public(state):
        return {key: state[key] for key in ("id", "status", "stage", "action", "error", "plan", "originalPlan", "polish", "timingWarnings") if key in state}

    def get_state(self, clip, variant, qa):
        folder = self._dir(clip, variant, qa)
        latest = _read(folder / "latest.json", {})
        job = self.get(latest["id"], clip, variant, qa) if latest.get("id") else None
        return {"plan": _read(folder / "plan.json"), "job": job, "status": self.status()}

    def create(self, request, clip, video, variant, qa):
        if not isinstance(request, dict) or request.get("action") not in ("understand", "polish", "render"):
            raise ValueError("action must be understand, polish or render")
        video = Path(video).resolve()
        if not video.is_file():
            raise ValueError("source video is unavailable")
        status = self.status()
        if request["action"] in ("understand", "polish") and not status["understandingConfigured"]:
            raise ValueError("commentary understanding credential is not configured")
        if request["action"] == "render" and not status["ttsConfigured"]:
            raise ValueError("speech credential is not configured")
        if request.get("voiceStyle", "classic") not in ("classic", "natural"):
            raise ValueError("unknown voice style")
        folder = self._dir(clip, variant, qa)
        with self._lock:
            for path in (folder / "jobs").glob("*/job.json"):
                state = _read(path, {})
                if state.get("status") == "running":
                    raise ValueError("a commentary job is already running for this clip")
            job_id = uuid.uuid4().hex
            output = folder / "jobs" / job_id
            output.mkdir(parents=True)
            action = request["action"]
            plan = request.get("plan")
            if action in ("render", "polish"):
                self._validate_plan(plan, clip)
                if isinstance(plan.get("plan"), dict):
                    plan = plan["plan"]
                _json(output / "edited-plan.json", {"status": "completed", "plan": plan})
            state = {"id": job_id, "status": "running", "stage": "queued", "action": action,
                     "output": str(output)}
            _json(output / "job.json", state)
            _json(folder / "latest.json", {"id": job_id})
            thread = threading.Thread(target=self._run, args=(state, output, request, clip, video, folder), daemon=True)
            self._threads.add(thread)
            created = self._public(state)
            thread.start()
        return created

    @staticmethod
    def _validate_plan(plan, clip):
        if isinstance(plan, dict) and isinstance(plan.get("plan"), dict):
            plan = plan["plan"]
        if not isinstance(plan, dict) or not isinstance(plan.get("cues"), list) or not plan["cues"]:
            raise ValueError("plan must contain at least one cue")
        duration = clip.get("duration")
        if isinstance(clip.get("video"), dict):
            duration = clip["video"].get("duration", duration)
        if isinstance(clip.get("mediaEndTime"), (int, float)):
            first_time = 0.0
            frames = clip.get("frames")
            if isinstance(frames, list) and frames and isinstance(frames[0], dict):
                first_time = frames[0].get("time", 0.0)
            duration = clip["mediaEndTime"] - first_time
        cue_ids = set()
        for cue in plan["cues"]:
            if not isinstance(cue, dict) or not isinstance(cue.get("text"), str) or not cue["text"].strip():
                raise ValueError("each cue needs text")
            cue_id = cue.get("cueId")
            if not isinstance(cue_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", cue_id) or cue_id in cue_ids:
                raise ValueError("cue IDs must be unique safe identifiers")
            cue_ids.add(cue_id)
            start, end = cue.get("suggestedStartTime"), cue.get("suggestedEndTime")
            if (isinstance(start, bool) or not isinstance(start, (int, float)) or
                    isinstance(end, bool) or not isinstance(end, (int, float)) or
                    not math.isfinite(start) or not math.isfinite(end) or
                    start < 0 or end <= start or
                    (isinstance(duration, (int, float)) and end > duration)):
                raise ValueError("cue times must be inside the source clip")
            if cue.get("delivery") not in ("during_play", "pause"):
                raise ValueError("cue delivery must be during_play or pause")
            if cue.get('language', 'zh-CN') not in ('zh-CN', 'en-US', 'mul'):
                raise ValueError('unsupported commentary language')

    def _run(self, initial, output, request, clip, video, folder):
        state = dict(initial)
        state["stage"] = "starting"
        _json(output / "job.json", state)
        try:
            env_file = SCRIPT_ROOT / ".env"
            if state["action"] == "understand":
                state["stage"] = "understanding"
                _json(output / "job.json", state)
                obs = output / "observations.json"
                if any(k in clip for k in ("frames", "playerEvidence", "tracks", "rawByPlayer")):
                    _json(obs, clip)
                command = [self.python, str(SCRIPT_ROOT / "engineering/scripts/commentary_agent.py"),
                           "--video", str(video), "--output", str(output / "understanding"),
                           "--provider", "openrouter", "--model", "openai/gpt-6-astra",
                           "--env-file", str(env_file)]
                if obs.is_file():
                    command += ["--observations", str(obs)]
                self._run_command(command)
                result = _read(output / "understanding" / "result.json", {})
                if result.get("status") != "completed" or not isinstance(result.get("plan"), dict):
                    raise RuntimeError("understanding did not produce a completed plan")
                self._validate_plan(result["plan"], clip)
                _json(folder / "plan.json", result["plan"])
                state["plan"] = result["plan"]
            elif state["action"] == "polish":
                state["stage"] = "polishing"
                _json(output / "job.json", state)
                self._run_command([self.python, str(SCRIPT_ROOT / "engineering/scripts/commentary_polish.py"),
                                   "--plan", str(output / "edited-plan.json"), "--output", str(output / "polish"),
                                   "--env-file", str(env_file)])
                result = _read(output / "polish/result.json", {})
                if result.get("status") != "completed" or not isinstance(result.get("plan"), dict):
                    raise RuntimeError("polish did not produce a completed candidate")
                self._validate_plan(result["plan"], clip)
                state.update(plan=result["plan"], originalPlan=result["originalPlan"], polish=result["polish"])
                # A candidate never replaces the saved draft; the user explicitly adopts and saves it.
            else:
                state["stage"] = "rendering"
                _json(output / "job.json", state)
                plan_path = output / "edited-plan.json"
                command = [self.python, str(SCRIPT_ROOT / "engineering/scripts/commentary_workflow.py"),
                           "--video", str(video), "--plan", str(plan_path), "--output", str(output / "render"),
                           "--env-file", str(env_file)]
                command += ["--style", NATURAL_STYLE if request.get("voiceStyle") == "natural" else STYLE]
                self._run_command(command)
                state["video"] = "render/render/commentary-final.mp4"
                state["subtitles"] = "render/render/commentary.srt"
                state["plan"] = _read(plan_path)["plan"]
                for field in ("video", "subtitles"):
                    if not (output / state[field]).is_file():
                        raise RuntimeError(f"render did not produce {field}")
                timeline = _read(output / 'render/render/timeline.json', {})
                state['timingWarnings'] = [f"{c['cueId']}：配音超出时间或发生重叠，成片改用了定格。"
                                           for c in timeline.get('cues', []) if c.get('convertedToHold')]
            state.update(status="completed", stage="complete", error=None)
        except Exception as exc:
            stderr = getattr(exc, "stderr", "") or getattr(exc, "stdout", "") or str(exc)
            values = {**dotenv_values(SCRIPT_ROOT / ".env", encoding="utf-8-sig"), **os.environ}
            secrets = [value for key, value in values.items() if "KEY" in key.upper() and isinstance(value, str)]
            state.update(status="failed", stage="failed", error=_safe_error(stderr, secrets))
        finally:
            _json(output / "job.json", state)
            with self._lock:
                self._threads.discard(threading.current_thread())

    def get(self, job_id, clip, variant, qa):
        if not isinstance(job_id, str) or not re.fullmatch(r"[a-f0-9]{32}", job_id):
            raise ValueError("invalid commentary job ID")
        path = self._dir(clip, variant, qa) / "jobs" / job_id / "job.json"
        state = _read(path)
        if state is None:
            raise ValueError("commentary job not found")
        if state.get("action") == "render" and state.get("status") == "running":
            workflow = _read(path.parent / "render" / "workflow.json", {})
            if workflow.get("stage") in ("understanding", "speech", "render"):
                state["stage"] = {"understanding": "understanding", "speech": "speech", "render": "rendering"}[workflow["stage"]]
        return self._public(state)

    def _output_path(self, job_id, clip, variant, qa, field):
        if not isinstance(job_id, str) or not re.fullmatch(r"[a-f0-9]{32}", job_id):
            raise ValueError("invalid commentary job ID")
        state = _read(self._dir(clip, variant, qa) / "jobs" / job_id / "job.json")
        if state is None:
            raise ValueError("commentary job not found")
        relative = state.get(field)
        if state.get("status") != "completed" or not relative:
            raise ValueError("commentary output is not ready")
        root = (self._dir(clip, variant, qa) / "jobs" / job_id).resolve()
        target = (root / relative).resolve()
        if not target.is_relative_to(root) or not target.is_file():
            raise ValueError("commentary output is unavailable")
        return target

    def video(self, job_id, clip, variant, qa):
        return self._output_path(job_id, clip, variant, qa, "video")

    def subtitles(self, job_id, clip, variant, qa):
        return self._output_path(job_id, clip, variant, qa, "subtitles")

    def save(self, request, clip, variant, qa):
        plan = request.get("plan") if isinstance(request, dict) else None
        self._validate_plan(plan, clip)
        if isinstance(plan.get("plan"), dict):
            plan = plan["plan"]
        folder = self._dir(clip, variant, qa)
        folder.mkdir(parents=True, exist_ok=True)
        with self._lock:
            _json(folder / "plan.json", plan)
        return plan

    def save_cue(self, cue_id, request, clip, variant, qa):
        """Atomically update one saved cue; independent of any frontend framework."""
        patch = request.get('patch')
        allowed = {'text', 'language', 'suggestedStartTime', 'suggestedEndTime', 'delivery'}
        if not isinstance(patch, dict) or not patch or not set(patch) <= allowed:
            raise ValueError('patch只允许文字、语言、开始/结束时间和讲法')
        if not isinstance(request.get('expectedCue'), dict):
            raise ValueError('需要expectedCue用于检查本句是否已被修改')
        with self._lock:
            folder = self._dir(clip, variant, qa)
            plan = _read(folder / 'plan.json')
            if not isinstance(plan, dict):
                raise ValueError('请先生成或保存解说稿')
            cue = next((c for c in plan['cues'] if c['cueId'] == cue_id), None)
            if cue is None:
                raise ValueError('找不到这条解说')
            if cue != request['expectedCue']:
                raise CueConflict('这句已在别处修改，请重新读取后核对；你的草稿仍保留。')
            edited = {**deepcopy(cue), **patch}
            edited['language'] = edited.get('language', 'zh-CN')
            edited['editedBy'] = 'human'
            edited['editedAt'] = datetime.now(timezone.utc).isoformat()
            updated = deepcopy(plan)
            updated['cues'] = [edited if c['cueId'] == cue_id else c for c in updated['cues']]
            self._validate_plan(updated, clip)
            _json(folder / 'plan.json', updated)
            return {'cue': edited, 'plan': updated}

    def close(self):
        with self._lock:
            processes = list(self._processes)
        for process in processes:
            if process.poll() is not None:
                continue
            try:
                if os.name == "nt":
                    killer = subprocess.Popen(["taskkill", "/PID", str(process.pid), "/T", "/F"],
                                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                              creationflags=subprocess.CREATE_NO_WINDOW)
                    killer.wait(timeout=5)
                else:
                    os.killpg(process.pid, signal.SIGTERM)
                    try:
                        process.wait(timeout=3)
                    except subprocess.TimeoutExpired:
                        os.killpg(process.pid, signal.SIGKILL)
            except (OSError, subprocess.TimeoutExpired):
                try:
                    process.kill()
                except OSError:
                    pass
        for thread in list(self._threads):
            thread.join(timeout=5)

    def _run_command(self, command):
        options = {"cwd": SCRIPT_ROOT, "stdout": subprocess.PIPE, "stderr": subprocess.PIPE,
                   "text": True, "encoding": "utf-8", "errors": "replace",
                   "env": {**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"}}
        if os.name == "nt":
            options["creationflags"] = subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP
        else:
            options["start_new_session"] = True
        process = subprocess.Popen(command, **options)
        with self._lock:
            self._processes.add(process)
        try:
            stdout, stderr = process.communicate(timeout=1200)
            if process.returncode:
                raise subprocess.CalledProcessError(process.returncode, command, output=stdout, stderr=stderr)
        except subprocess.TimeoutExpired:
            if os.name == "nt":
                killer = subprocess.Popen(["taskkill", "/PID", str(process.pid), "/T", "/F"],
                                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                          creationflags=subprocess.CREATE_NO_WINDOW)
                killer.wait(timeout=5)
            else:
                os.killpg(process.pid, signal.SIGKILL)
            stdout, stderr = process.communicate()
            raise RuntimeError((stderr or stdout or "commentary job timed out")[-4000:])
        finally:
            with self._lock:
                self._processes.discard(process)
