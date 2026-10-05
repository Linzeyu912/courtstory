#!/usr/bin/env node
// Read-only adapter around the workbench's actual pure calibration functions.
// Usage: node candidate_matrices.mjs REPO COURT_JSON TRACKS_JSON
// Relative input paths are resolved against REPO. No files or user drafts are written.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

function fail(message) { throw new Error(message); }
function digest(file) { return createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 3) fail('Usage: node candidate_matrices.mjs REPO COURT_JSON TRACKS_JSON');
  const repo = path.resolve(args[0]);
  const inputPath = value => path.resolve(repo, value);
  const courtPath = inputPath(args[1]), tracksPath = inputPath(args[2]);
  const courtModule = path.join(repo, 'engineering/tools/player-review/court.mjs');
  const geometryModule = path.join(repo, 'engineering/tools/player-review/court-geometry.mjs');
  const guideModule = path.join(repo, 'engineering/tools/player-review/calibration-guide.mjs');
  const {fitKeyframe, calibrationAt, COURT} = await import(pathToFileURL(courtModule).href);
  const {acceptCourtCandidates} = await import(pathToFileURL(guideModule).href);
  const profile = JSON.parse(fs.readFileSync(courtPath, 'utf8'));
  const frames = JSON.parse(fs.readFileSync(tracksPath, 'utf8'));
  if (!profile || !Array.isArray(profile.keyframes) || profile.template !== 'NBA') fail('Expected an NBA court profile with keyframes.');
  if (!Array.isArray(frames) || !frames.length) fail('Expected a nonempty top-level tracking frame array.');
  for (let i = 0; i < frames.length; i++) {
    if (!Number.isInteger(frames[i].frame) || frames[i].frame !== i || !Number.isFinite(frames[i].time)) fail(`Invalid tracking frame/time at index ${i}.`);
    if (i && frames[i].time <= frames[i - 1].time) fail(`Tracking times are not strictly increasing at ${i}.`);
  }
  const seen = new Set();
  for (const key of profile.keyframes) {
    if (!Number.isInteger(key.frame) || key.frame < 0 || key.frame >= frames.length || seen.has(key.frame)) fail('Court frame indices must be unique and inside the tracking timeline.');
    seen.add(key.frame);
  }

  const metaPath = tracksPath.replace(/\.json$/i, '.meta.json');
  let metadataVideoMatch = null;
  if (fs.existsSync(metaPath)) {
    const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    metadataVideoMatch = metadata.video_sha256 === profile.videoHash;
    if (!metadataVideoMatch || metadata.frames !== frames.length) fail('Court videoHash and tracking metadata video/frame count differ.');
  }
  // Source cuts are video-level. Browser-only user cuts and calibrations are unknown.
  const libraryPath = path.join(repo, 'data/videos/tactics/acceptance/review-library.json');
  let cuts = [], sampleId = null;
  if (fs.existsSync(libraryPath)) {
    const library = JSON.parse(fs.readFileSync(libraryPath, 'utf8'));
    const sample = library.samples?.find(s => s.courtCandidates && inputPath(s.courtCandidates) === courtPath);
    if (sample) { sampleId = sample.id; cuts = [...(sample.sourceCuts || [])]; }
  }
  const originalProfile = JSON.stringify(profile);
  const originalFrames = JSON.stringify(frames);
  const session = {courtCalibration: {keyframes: []}, cuts};
  const acceptance = acceptCourtCandidates(session, profile, frames.length, profile.videoHash);
  const adoptedByFrame = new Map(session.courtCalibration.keyframes.map(k => [k.frame, k]));
  const rows = profile.keyframes.map(key => {
    const fit = fitKeyframe(key);
    const rawMapping = calibrationAt(profile, key.frame, frames, cuts);
    const mapping = calibrationAt(session.courtCalibration, key.frame, frames, cuts);
    const adopted = adoptedByFrame.get(key.frame);
    return {
      frame: key.frame, time_seconds: frames[key.frame].time, side: key.side,
      raw_status: key.status ?? null, raw_source: key.source ?? profile.source ?? null,
      fit: fit ? {toCourt: fit.toCourt, toImage: fit.toImage, supportHull: fit.supportHull,
        fitRmsePixels: fit.fitRmsePixels, fit_point_ids: fit.points.map(p => p.id),
        check_point_ids: fit.checkResiduals.map(p => p.id)} : null,
      raw_calibration_available: Boolean(rawMapping),
      accepted_status: adopted?.status ?? null,
      accepted_review_required: adopted?.reviewRequired ?? null,
      accepted_calibration_available: Boolean(mapping),
      mapping: mapping ? {toCourt: mapping.toCourt, toImage: mapping.toImage,
        supportHulls: mapping.supportHulls, fitRmsePixels: mapping.fitRmsePixels,
        side: mapping.side, method: mapping.method, supportFrames: mapping.supportFrames,
        controlCount: mapping.controlCount, referenceOnly: mapping.referenceOnly,
        reviewRequired: mapping.reviewRequired} : null,
    };
  });
  if (originalProfile !== JSON.stringify(profile) || originalFrames !== JSON.stringify(frames)) fail('Pure function inputs were mutated.');
  const sourceFiles = [courtPath, tracksPath, courtModule, geometryModule, guideModule];
  if (fs.existsSync(metaPath)) sourceFiles.push(metaPath);
  if (fs.existsSync(libraryPath)) sourceFiles.push(libraryPath);
  const output = {
    schema_version: 1, sample_id: sampleId, court: COURT,
    assumption: 'Candidates adopted only in an independent blank in-memory session; no browser draft or source file is changed. This simulates candidate preview, not human confirmation or accuracy validation.',
    metricAccuracyValidated: false, browser_user_cuts_included: false, source_cuts: cuts,
    metadata_video_hash_matches: metadataVideoMatch,
    tracking_fingerprint_is_provenance_only_for_court: true,
    maxKeyframeGapSeconds: session.courtCalibration.maxKeyframeGapSeconds,
    acceptance, source_sha256: Object.fromEntries(sourceFiles.map(file => [path.relative(repo, file).replaceAll('\\', '/'), digest(file)])),
    keyframes: rows,
    totals: {keyframes: rows.length, raw_calibration_available: rows.filter(r => r.raw_calibration_available).length,
      accepted_calibration_available: rows.filter(r => r.accepted_calibration_available).length,
      accepted_mappings_requiring_review: rows.filter(r => r.mapping?.reviewRequired).length},
  };
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

main().catch(error => { process.stderr.write(`${error.name}: ${error.message}\n`); process.exitCode = 1; });
