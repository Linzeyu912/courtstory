"""Source-bound shot feedback. Models select references; hosts own ratings and coverage."""
from __future__ import annotations

import copy
import math
import re
import unicodedata
from fractions import Fraction
from pathlib import Path

from player_identity_data import GAMES, RATING_FIELDS, PlayerIdentityData, PlayerIdentityDataUnavailable


def build_rating_context(review, clip, snapshot, *, data=None):
    from commentary_plan import digest
    review = review or {}
    profiles = {p.get("id"): p.get("playerProfile", {}) for p in review.get("playerIdentities", [])}
    for entity in review.get("entities", []):
        profiles.setdefault(entity.get("id"), entity.get("playerProfile", {}))
    season = (review.get("gameContext") or {}).get("season")
    if season is None:
        # Frame identities and confirmed profiles carry seasons without the human form.
        observed_seasons = {p["nameRecord"]["season"] for p in snapshot.get("participants", []) if (p.get("nameRecord") or {}).get("season")}
        observed_seasons |= {p["season"] for p in profiles.values() if p and p.get("status") == "confirmed" and p.get("season")}
        if len(observed_seasons) == 1:
            season = next(iter(observed_seasons))
    season = season if season in GAMES else None
    data = data or PlayerIdentityData(Path(__file__).resolve().parents[2] / "2K Player Data")
    records = []
    for person in snapshot.get("participants", []):
        profile = profiles.get(person.get("entityId"), {}) or {}
        name = person.get("nameRecord") or {}
        record = {"participantId": person["participantId"], "entityId": person.get("entityId"),
                  "playerId": None, "season": season, "game": GAMES.get(season), "status": "unknown",
                  "identityVerified": person.get("identityVerified") is True,
                  "ratings": {k: None for k in RATING_FIELDS}, "field_provenance": {k: None for k in RATING_FIELDS},
                  "reason": "缺少同赛季、与视频绑定的已确认人物身份。"}
        manual = (season and person.get("displayName") and person.get("identityVerified") is True and
                    profile.get("status") == "confirmed" and profile.get("season") == season and
                    profile.get("player_id_namespace") == "normalized_name_key" and
                    profile.get("evidence", {}).get("videoSha256") == (clip.get("video_sha256") or clip.get("videoSha256")) and
                    profile.get("team_abbreviation") and isinstance(profile.get("jersey_number"), str))
        machine = (season and person.get("displayName") and name.get("season") == season and
                   name.get("nameStatus") == "machine_accepted" and not name.get("entityAssociationAmbiguous") and
                   name.get("positionBindingStatus") in ("observed", "verified_continuation") and
                   name.get("team") and isinstance(name.get("jersey"), str))
        eligible = manual or machine
        if eligible:
            try:
                team, jersey = (profile["team_abbreviation"], profile["jersey_number"]) if manual else (name["team"], name["jersey"])
                candidates = data.lookup(season, team, jersey).get("candidates", [])
                def exact_name(value):
                    return re.sub('[^a-z0-9]', '', unicodedata.normalize('NFKD', value).encode('ascii', 'ignore').decode().lower())
                matched = [c for c in candidates if c.get("season") == season and
                           exact_name(c.get("name", "")) == exact_name(name.get("name") or person["displayName"]) and
                           (not manual or c.get("player_id") == profile.get("player_id")) and
                           (manual or name.get("playerIdNamespace") != "normalized_name_key" or c.get("player_id") == name.get("playerId"))]
                if len(matched) == 1:
                    candidate = matched[0]; rating = candidate.get("rating", {})
                    if rating.get("season") == season and rating.get("game") == GAMES[season]:
                        record.update(playerId=candidate["player_id"], status=rating.get("status", "unknown"),
                                      recordId=rating.get("record_id"), identitySource="human_confirmed" if manual else "machine_accepted",
                                      joinMethod="exact_roster_name_and_season", reason="本地同赛季 2K 快照；逐字段保留来源和缺失值。")
                        for field in RATING_FIELDS:
                            value = rating.get("ratings", {}).get(field)
                            provenance = rating.get("field_provenance", {}).get(field)
                            if type(value) in (int, float) and math.isfinite(value) and provenance:
                                record["ratings"][field] = value
                                record["field_provenance"][field] = copy.deepcopy(provenance)
            except (PlayerIdentityDataUnavailable, ValueError, OSError):
                record["reason"] = "本地同赛季 2K 数据不可用，能力值保持 null。"
        record["ratingRef"] = digest(record)
        records.append(record)
    result = {"season": season, "records": records}
    return {**result, "digest": digest(result)}


def _time(row):
    """Use actual decoded PTS; frame indices and parent timeline are not clocks."""
    if type(row.get("pts")) is not int or not isinstance(row.get("timeBase"), str):
        raise ValueError("shot release needs actual decoded PTS/timeBase")
    try:
        value = float(row["pts"] * Fraction(row["timeBase"]))
    except (ValueError, ZeroDivisionError):
        raise ValueError("shot release has invalid decoded timeBase") from None
    if not math.isfinite(value):
        raise ValueError("shot release has invalid decoded PTS")
    return value


def prepare_shot_feedback(plan, context, review=None, evidence=None):
    """Validate shot refs, then derive coverage and demote unsupported evaluations."""
    events = {e.get("eventId"): e for e in plan.get("events", [])}
    releases = [n for n in plan.get("nodes", []) if n.get("kind") == "shot_release"]
    for event in events.values():
        if event.get("shotStatus") is not None and event.get("kind") != "shot":
            raise ValueError("shotStatus requires shot event kind")
        if event.get("kind") == "shot":
            if event.get("shotStatus") not in ("confirmed", "uncertain"):
                raise ValueError("shot event requires confirmed or uncertain shotStatus")
            count = sum(n.get("eventId") == event["eventId"] for n in releases)
            if event["shotStatus"] == "confirmed" and count != 1:
                raise ValueError("every confirmed shot requires exactly one shot_release node")
            if event["shotStatus"] == "uncertain" and count:
                raise ValueError("uncertain shot cannot masquerade as a confirmed release")
    if not releases:
        if any("shotFeedback" in n for n in plan.get("nodes", [])):
            raise ValueError("shotFeedback requires shot_release node kind")
        return
    context = context or {}
    frames = {r.get("frame", i): r for i, r in enumerate(context.get("frames", []))}
    seen = set((evidence or plan.get("evidenceRef") or {}).get("frames", []))
    people = {p.get("participantId"): p for p in plan.get("participants", [])}
    cues = {c.get("cueId"): c for c in plan.get("cues", [])}
    ratings = context.get("ratingContext", {})
    if (plan.get("ratingContext") is not None and plan["ratingContext"] != ratings or
            plan.get("ratingSnapshotRef") is not None and plan["ratingSnapshotRef"] != {"digest": ratings.get("digest")}):
        raise ValueError("rating snapshot differs from locked host context")
    rating_records = {r.get("ratingRef"): r for r in ratings.get("records", [])}
    review_season = ((review or {}).get("gameContext") or {}).get("season")
    if review_season is not None and ratings.get("season") != (review_season if review_season in GAMES else None):
        raise ValueError("rating snapshot season differs from current review")
    cuts = set(context.get("sourceCuts", [])) | set((review or {}).get("settings", {}).get("cuts", [])) | set((review or {}).get("settings", {}).get("sourceCuts", []))
    for node in releases:
        event = events.get(node.get("eventId"), {})
        if event.get("kind") != "shot" or event.get("shotStatus") != "confirmed":
            raise ValueError("shot_release node requires a confirmed shot event")
        anchor = node.get("anchorAssetFrame")
        if type(anchor) is not int or anchor not in seen or anchor not in frames:
            raise ValueError("shot release anchor must be actually returned")
        if not any(cues.get(cid, {}).get("delivery") == "pause" for cid in node.get("cueIds", [])):
            raise ValueError("confirmed shot release requires a pause cue for its freeze")
        shot = node.get("shotFeedback")
        if not isinstance(shot, dict) or set(shot) - {"shooterRef", "defenderRefs", "opportunity", "pressure", "evidenceFrames", "defenseWindow", "ratingsRefs"}:
            raise ValueError("shotFeedback permits references and evaluations, not invented rating values")
        shooter = shot.get("shooterRef")
        defenders = shot.get("defenderRefs")
        if not isinstance(shooter, str) or not shooter or not isinstance(defenders, list) or any(not isinstance(p, str) for p in defenders) or len(set(defenders)) != len(defenders) or shooter in defenders:
            raise ValueError("shot shooterRef is required and defenderRefs must be unique")
        for pid in [shooter, *defenders]:
            person = people.get(pid); span = (person or {}).get("validRange", {})
            if pid not in node.get("participantRefs", []) or not person or not span.get("startFrame", math.inf) <= anchor <= span.get("endFrame", -1):
                raise ValueError("shot participant reference is outside its release identity interval")
        for key, grades in (("opportunity", ("good", "fair", "poor", "unknown")), ("pressure", ("low", "medium", "high", "unknown"))):
            evaluation = shot.get(key, {})
            if not isinstance(evaluation, dict) or set(evaluation) != {"grade", "reason"} or evaluation.get("grade") not in grades or not isinstance(evaluation.get("reason"), str) or not evaluation["reason"].strip():
                raise ValueError(f"shot {key} needs an independent grade and reason")
        rating_refs = shot.get("ratingsRefs")
        if not isinstance(rating_refs, list) or any(not isinstance(r, str) or r not in rating_records or rating_records[r].get("participantId") not in [shooter, *defenders] for r in rating_refs):
            raise ValueError("shot rating refs must select the host snapshot for its participants")
        shot["ratingsRefs"] = sorted(set(rating_refs) | {r for r, value in rating_records.items() if value.get("participantId") in [shooter, *defenders]})
        refs = shot.get("evidenceFrames")
        if not isinstance(refs, list) or any(type(f) is not int or f not in seen or f not in frames for f in refs):
            raise ValueError("shot evidence must be actually returned frames")
        if any(f > anchor for f in refs):
            raise ValueError("shot defense evidence cannot be after release")
        release_time = _time(frames[anchor]); target = release_time - 1
        prior = sorted((f, _time(r)) for f, r in frames.items() if f <= anchor)
        target_start = min(prior, key=lambda ft: (abs(ft[1] - target), ft[0]))[0]
        start = max(target_start, node.get("evidenceWindow", {}).get("startFrame", 0), max((c for c in cuts if c <= anchor), default=0))
        if any(f < start for f in refs):
            raise ValueError("shot defense evidence is outside the pre-release window")
        duration = release_time - _time(frames[start])
        times = sorted({_time(frames[f]) for f in refs})
        complete = (duration >= .9 and len(times) >= 5 and times[0] <= target + .15 and
                    anchor in refs and all(b - a <= .25 + 1e-8 for a, b in zip(times, times[1:])))
        coverage = "complete" if complete else "partial" if times else "unavailable"
        reason = "已返回接近完整前一秒及出手帧，采样间隔不超过 0.25 秒。" if complete else "前一秒证据不完整：片段起点、切镜或缺失关键采样，评价保持 unknown。"
        shot["defenseWindow"] = {"startFrame": start, "endFrame": anchor, "requestedSeconds": 1,
                                 "actualDurationSeconds": duration, "coverage": coverage, "reason": reason}
        if not complete:
            for key in ("opportunity", "pressure"):
                shot[key] = {"grade": "unknown", "reason": reason}
