"""Host-owned immutable commentary contract; no credentials or inferred parent times."""
from __future__ import annotations

import copy
import hashlib
import json
import math
import re
import uuid
from urllib.request import Request, urlopen

SCHEMA_VERSION = 3
DEFAULT_MODEL = "openai/gpt-6-astra"
ASTRA_CAPABILITIES = {"input": ["text", "image"], "reasoning": True,
                      "contextWindow": 1050000, "maxTokens": 8192,
                      "cost": {"input": 10, "output": 50, "cacheRead": 1, "cacheWrite": 12.5}}


def digest(value):
    def normalize(item):
        if isinstance(item, dict):
            return {k: normalize(v) for k, v in item.items()}
        if isinstance(item, list):
            return [normalize(v) for v in item]
        if isinstance(item, float) and math.isfinite(item) and item.is_integer():
            return int(item)
        return item
    return hashlib.sha256(json.dumps(normalize(value), sort_keys=True, ensure_ascii=False,
                                    separators=(",", ":"), allow_nan=False).encode("utf-8")).hexdigest()


def model_config(config=None):
    """Only service-owned input may supply model capabilities; requests cannot supply them."""
    config = copy.deepcopy(config or {})
    provider = config.get("provider", "openrouter")
    model = config.get("model", DEFAULT_MODEL)
    if provider != "openrouter" or not isinstance(model, str) or not re.fullmatch(r"[A-Za-z0-9._:/-]{1,160}", model):
        raise ValueError("invalid commentary provider/model configuration")
    caps = config.get("modelCapabilities")
    if caps is None:
        if model != DEFAULT_MODEL:
            raise ValueError("model override requires trusted modelCapabilities; Astra metadata cannot be inherited")
        caps = copy.deepcopy(ASTRA_CAPABILITIES)
    if (not isinstance(caps, dict) or "image" not in caps.get("input", []) or
            type(caps.get("reasoning")) is not bool or
            any(type(caps.get(k)) is not int or caps[k] <= 0 for k in ("contextWindow", "maxTokens"))):
        raise ValueError("modelCapabilities must declare image input, reasoning, contextWindow and maxTokens")
    reasoning = config.get("reasoning", "medium" if caps["reasoning"] else "off")
    if reasoning not in ("off", "minimal", "low", "medium", "high", "xhigh") or reasoning != "off" and not caps["reasoning"]:
        raise ValueError("reasoning is unsupported by configured model")
    # Unknown prices remain null in provenance; SDK adapter omits cost calculation for unknown rates.
    caps = {k: copy.deepcopy(caps.get(k)) for k in ("input", "reasoning", "contextWindow", "maxTokens", "cost", "compat")}
    return {"provider": provider, "model": model, "reasoning": reasoning,
            "modelCapabilities": caps,
            "capabilitiesRef": config.get("capabilitiesRef", "astra-catalog-2026-10-07" if model == DEFAULT_MODEL else None)}


def resolve_catalog_config(model, api_key=None, fetch=None):
    """Resolve overrides through the official OpenRouter catalog before locking a job."""
    if not isinstance(model, str) or not re.fullmatch(r"[A-Za-z0-9._:/-]{1,160}", model):
        raise ValueError("invalid drawing model ID")
    url = "https://openrouter.ai/api/v1/models"
    try:
        if fetch:
            payload = fetch(url)
        else:
            headers = {"Accept": "application/json"}
            if api_key:
                headers["Authorization"] = f"Bearer {api_key}"
            with urlopen(Request(url, headers=headers), timeout=20) as response:
                payload = json.load(response)
        row = next((r for r in payload.get("data", []) if r.get("id") == model), None)
        if not row:
            raise ValueError("model is not in the official OpenRouter catalog")
        params = row.get("supported_parameters", [])
        if "tools" not in params:
            raise ValueError("drawing model does not declare tool calling support")
        prices = row.get("pricing", {})
        def price(key):
            value = prices.get(key)
            return float(value) * 1000000 if value is not None else None
        caps = {"input": row.get("architecture", {}).get("input_modalities", []),
                "reasoning": "reasoning" in params or "reasoning_effort" in params,
                "contextWindow": row.get("context_length"),
                "maxTokens": row.get("top_provider", {}).get("max_completion_tokens"),
                "cost": {"input": price("prompt"), "output": price("completion"),
                         "cacheRead": price("input_cache_read"), "cacheWrite": price("input_cache_write")}}
        return model_config({"provider": "openrouter", "model": model, "modelCapabilities": caps,
                             "capabilitiesRef": f"{url}#{model}"})
    except ValueError:
        raise
    except Exception as exc:
        # Never include credential-bearing requests or arbitrary server bodies in public errors.
        raise ValueError(f"OpenRouter model catalog unavailable ({type(exc).__name__})") from None


def _clip_identity(clip):
    return {"videoSha256": clip.get("video_sha256") or clip.get("videoSha256"),
            "trackingFingerprint": clip.get("tracking_fingerprint") or clip.get("trackingFingerprint"),
            "trackingRevision": clip.get("tracking_revision") or clip.get("trackingRevision") or clip.get("variant") or "original"}


def _mapping(clip, review):
    frames = clip.get("frames", [])
    expected = [{"frame": row.get("frame", i), "time": row.get("time"),
                 "sourceFrame": row.get("source_frame", row.get("sourceFrame", row.get("frame", i))),
                 "sourceTime": row.get("source_time", row.get("sourceTime", row.get("time")))}
                for i, row in enumerate(frames)]
    supplied = (review or {}).get("sourceFrameMapping")
    if supplied is not None:
        if not isinstance(supplied, list) or digest(supplied) != digest(expected):
            raise ValueError("review frame mapping does not match current asset")
        return copy.deepcopy(supplied)
    # Registered asset frame mapping can bind source checks, but cannot certify a parent.
    return expected


def source_ref(clip, review=None):
    identity = _clip_identity(clip)
    if not identity["videoSha256"]:
        raise ValueError("source video digest is required")
    if review is not None:
        if not isinstance(review, dict):
            raise ValueError("review must be the saved review object")
        for key, expected in identity.items():
            if key in review and review[key] != expected:
                raise ValueError(f"review {key} does not match current source")
        parent = review.get("sourceVideoSha256")
        if parent and parent != (clip.get("source_video_sha256") or identity["videoSha256"]):
            raise ValueError("review parent video digest does not match registered source")
        base = review.get("nameIdentitySource")
        if review.get("playerNameIdentities") and not isinstance(base, dict):
            raise ValueError("name snapshot has no source binding")
        if isinstance(base, dict) and any(base.get(k) != v for k, v in identity.items()):
            raise ValueError("name identity source is stale")
    # Display toggles and graphical edits do not change identity or commentary provenance.
    lanes = {key: (review or {}).get(key) for key in
             ("nameIdentitySource", "playerNameIdentities", "playerIdentities", "identitySelection", "settings", "entities")}
    lanes["sourceCuts"] = clip.get("sourceCuts", [])
    return {**identity, "frameMappingDigest": digest(_mapping(clip, review)), "reviewDigest": digest(lanes)}


def build_name_snapshot(review, clip):
    source = source_ref(clip, review)
    participants = []
    cuts = set(clip.get("sourceCuts", [])) | set((review or {}).get("settings", {}).get("cuts", [])) | set((review or {}).get("settings", {}).get("sourceCuts", []))
    for entity in (review or {}).get("playerNameIdentities", []):
        rows = sorted(entity.get("observations", []), key=lambda p: p.get("frame", -1))
        segment = None
        for row in rows:
            frame = row.get("frame")
            if type(frame) is not int or frame < 0 or clip.get("frames") and frame >= len(clip["frames"]):
                raise ValueError("name observation frame is outside asset")
            raw = row.get("nameIdentity") or {}
            status = raw.get("nameStatus", "unknown")
            verified = raw.get("identityVerified") is True
            usable = bool(raw.get("name")) and (status == "human_confirmed" and verified or
                      status == "machine_accepted" and not raw.get("entityAssociationAmbiguous") and
                      raw.get("positionBindingStatus") in ("observed", "verified_continuation"))
            record = {key: value for key, value in raw.items() if key not in ("start", "end")}
            name_ref = digest({"entityId": entity.get("id"), "record": record}) if usable else None
            label = raw.get("displayName") or raw.get("name") if usable else None
            key = (row.get("trackId"), name_ref, status, label)
            if segment and segment.pop("_key", None) == key and frame not in cuts and frame == segment["validRange"]["endFrame"] + 1:
                segment["validRange"]["endFrame"] = frame
                segment["_key"] = key
                continue
            if segment:
                segment.pop("_key", None)
            segment = {"participantId": f"{entity.get('id', 'person')}-f{frame}", "entityId": entity.get("id"),
                       "trackId": row.get("trackId"), "nameRecordRef": name_ref,
                       "validRange": {"startFrame": frame, "endFrame": frame},
                       "identityStatus": status if usable else "unknown", "identityVerified": verified if usable else False,
                       "displayName": label, "nameRecord": copy.deepcopy(raw) if usable else None, "_key": key}
            participants.append(segment)
        if segment:
            segment.pop("_key", None)
    return {"sourceRef": source, "digest": digest(participants), "participants": participants}


def _id(value):
    return isinstance(value, str) and bool(re.fullmatch(r"[A-Za-z0-9_-]{1,100}", value))


def validate_handoff(plan, clip, review, context=None, evidence=None, *, require_contract=False):
    """Validate upstream refs at every save and resolve, independent of model tool validation."""
    snapshot = build_name_snapshot(review, clip)
    people = plan.get("participants", [])
    nodes = plan.get("nodes", [])
    if not isinstance(people, list) or not isinstance(nodes, list):
        raise ValueError("participants and nodes must be structured lists")
    if require_contract:
        if (not isinstance(plan.get("participants"), list) or not nodes or
                not isinstance(plan.get("events"), list) or not plan["events"] or
                not isinstance(plan.get("uncertainties"), list) or not isinstance(plan.get("summary"), str) or
                not plan["summary"].strip() or not (context or {}).get("frames")):
            raise ValueError("new understanding requires the complete commentary contract and decode context")
    by_person = {}
    known = {p["participantId"]: p for p in snapshot["participants"]}
    for person in people:
        pid = person.get("participantId")
        if not _id(pid) or pid in by_person:
            raise ValueError("participantId must be unique")
        span = person.get("validRange", {})
        if any(type(span.get(k)) is not int or span[k] < 0 for k in ("startFrame", "endFrame")) or span["endFrame"] < span["startFrame"]:
            raise ValueError("participant needs an asset frame interval")
        if clip.get("frames") and span["endFrame"] >= len(clip["frames"]):
            raise ValueError("participant interval exceeds decoded asset")
        if person.get("entityId") is not None and pid not in known:
            raise ValueError("participant entity is not in saved identity snapshot")
        if pid in known and person != known[pid]:
            raise ValueError("participant identity/name interval does not match saved snapshot")
        if person.get("displayName") and not person.get("nameRecordRef"):
            raise ValueError("named participant needs a verified snapshot reference")
        by_person[pid] = person
    events = {e.get("eventId"): e for e in plan.get("events", [])}
    cues = {c.get("cueId"): c for c in plan.get("cues", [])}
    frames = {r.get("frame", i): r for i, r in enumerate((context or {}).get("frames", []))}
    seen = set((evidence or plan.get("evidenceRef") or {}).get("frames", []))
    if require_contract:
        if len(events) != len(plan["events"]) or any(not _id(e) for e in events):
            raise ValueError("new understanding requires unique event IDs")
        for event in events.values():
            if (not isinstance(event.get("description"), str) or not event["description"].strip() or
                    not isinstance(event.get("participants"), list) or not isinstance(event.get("uncertainties"), list)):
                raise ValueError("new understanding event fields are incomplete")
            start, end = event.get("startTime"), event.get("endTime")
            if (type(start) not in (int, float) or type(end) not in (int, float) or
                    not math.isfinite(start) or not math.isfinite(end) or not 0 <= start <= end or
                    end > (context or {}).get("duration", clip.get("duration", float("inf")))):
                raise ValueError("new understanding event time is outside decoded asset")
        for item in [*events.values(), *cues.values()]:
            refs = item.get("evidenceFrames")
            if not isinstance(refs, list) or not refs or any(type(f) is not int or f not in seen for f in refs):
                raise ValueError("new understanding requires actually returned event and cue evidence")
        if not any(f in (evidence or {}).get("detailFrames", []) for event in events.values() for f in event["evidenceFrames"]):
            raise ValueError("new understanding needs event evidence from a detailed image read")
        for cue in cues.values():
            if cue.get("eventId") not in events or not isinstance(cue.get("focus"), str) or not cue["focus"].strip():
                raise ValueError("new understanding cue fields are incomplete")
    node_ids = set()
    cue_nodes = {cid: 0 for cid in cues}
    for node in nodes:
        nid, anchor = node.get("nodeId"), node.get("anchorAssetFrame")
        window = node.get("evidenceWindow", {})
        if not _id(nid) or nid in node_ids or node.get("eventId") not in events:
            raise ValueError("node needs unique nodeId and existing event")
        node_ids.add(nid)
        if not node.get("cueIds") or any(c not in cues or cues[c].get("eventId") != node["eventId"] for c in node["cueIds"]):
            raise ValueError("node cueIds must reference its event")
        for cid in node["cueIds"]:
            cue_nodes[cid] += 1
        if require_contract and (not isinstance(node.get("participantRefs"), list) or
                not isinstance(node.get("uncertainties"), list) or not isinstance(node.get("focus"), str) or not node["focus"].strip()):
            raise ValueError("new understanding node fields are incomplete")
        if type(anchor) is not int or anchor not in seen:
            raise ValueError("node anchor must be an actually returned evidence frame")
        if require_contract:
            row = frames.get(anchor, {})
            if (type(row.get("pts")) is not int or not isinstance(row.get("timeBase"), str) or
                    any(type(row.get(k)) not in (int, float) or not math.isfinite(row[k]) for k in ("time", "sourceTime"))):
                raise ValueError("node anchor is missing actual decode timestamp metadata")
        if any(type(window.get(k)) is not int for k in ("startFrame", "endFrame")) or not 0 <= window["startFrame"] <= anchor <= window["endFrame"]:
            raise ValueError("node anchor is outside its evidence window")
        if frames:
            event = events[node["eventId"]]
            for frame in (window["startFrame"], anchor, window["endFrame"]):
                row = frames.get(frame)
                if not row or not event.get("startTime", 0) - 1e-8 <= row["time"] <= event.get("endTime", float("inf")) + 1e-8:
                    raise ValueError("node evidence window is outside the event")
        cuts = list(clip.get("sourceCuts", [])) + (review or {}).get("settings", {}).get("cuts", []) + (review or {}).get("settings", {}).get("sourceCuts", [])
        if any(window["startFrame"] < cut <= window["endFrame"] for cut in cuts):
            raise ValueError("node evidence window cannot cross a scene cut")
        if any(key in node for key in ("x", "y", "points", "coordinates", "route", "controlPoints")):
            raise ValueError("commentary node cannot contain drawing geometry")
        for pid in node.get("participantRefs", []):
            person = by_person.get(pid)
            if not person or not person["validRange"]["startFrame"] <= anchor <= person["validRange"]["endFrame"]:
                raise ValueError("node participant is outside its identity interval")
    if (require_contract or nodes) and any(count != 1 for count in cue_nodes.values()):
        raise ValueError("each commentary cue must belong to exactly one node")
    for cue in cues.values():
        refs = cue.get("participantRefs", [])
        records = cue.get("nameRecordRefs", [])
        for pid in refs:
            person = by_person.get(pid)
            if not person:
                raise ValueError("cue participant reference is unknown")
            if person.get("nameRecordRef"):
                if person["nameRecordRef"] not in records or any(not person["validRange"]["startFrame"] <= f <= person["validRange"]["endFrame"] for f in cue.get("evidenceFrames", [])):
                    raise ValueError("cue name reference is outside its valid interval")
        if any(ref not in [by_person[p].get("nameRecordRef") for p in refs] for ref in records):
            raise ValueError("cue nameRecordRef is not one of its participant references")
    return snapshot


def finalize_plan(plan, clip, review, context, evidence, config, job_id, current, *, require_contract=False):
    result = copy.deepcopy(plan)
    snapshot = validate_handoff(result, clip, review, context, evidence, require_contract=require_contract)
    result.update(schemaVersion=SCHEMA_VERSION, planId=(current or {}).get("planId") or uuid.uuid4().hex,
                  revision=(current or {}).get("revision", 0) + 1, sourceRef=source_ref(clip, review),
                  nameSnapshotRef={"digest": snapshot["digest"]}, producerJobRef=job_id,
                  producerConfigSnapshot=copy.deepcopy(config), evidenceRef=copy.deepcopy(evidence or {}))
    mapping = {r["frame"]: r for r in _mapping(clip, review)}
    decoded = {r["frame"]: r for r in (context or {}).get("frames", [])}
    for node in result.get("nodes", []):
        row = decoded.get(node["anchorAssetFrame"], {})
        mapped = mapping.get(node["anchorAssetFrame"], {})
        parent_hash = (review or {}).get("sourceVideoSha256")
        parent_verified = bool(parent_hash and (review or {}).get("sourceFrameMapping"))
        node.update(assetPts=row.get("pts"), assetTimeBase=row.get("timeBase"),
                    assetPtsSeconds=row.get("sourceTime"), clipTimeSeconds=row.get("time"),
                    reviewTimeSeconds=mapped.get("time"), parentFrame=mapped.get("sourceFrame") if parent_verified else None,
                    parentTimeSeconds=mapped.get("sourceTime") if parent_verified else None,
                    parentVideoSha256=parent_hash if parent_verified else None)
    result.pop("digest", None)
    result["digest"] = digest(result)
    return result


def plan_ref(plan):
    return {key: plan.get(key) for key in ("planId", "revision", "digest")}
