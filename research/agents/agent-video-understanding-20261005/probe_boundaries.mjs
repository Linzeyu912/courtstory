// Run real upstream attachment detection and Google SDK request conversion offline.
// Requires Node >=24 and @ai-sdk/google@3.0.73 installed in --sdk-root.
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { parseArgs, promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'

const run = promisify(execFile)

const { values } = parseArgs({ options: {
  'opencode-root': { type: 'string' }, 'sdk-root': { type: 'string' }, output: { type: 'string' },
} })
assert(values['opencode-root'] && values['sdk-root'], 'Pass --opencode-root and --sdk-root')
const upstream = path.resolve(values['opencode-root'])
const expected = '907b3bc518fa48e90e8ec24dd327d13eee71c36c'
assert.equal((await run('git', ['-C', upstream, 'rev-parse', 'HEAD'])).stdout.trim(), expected)
// Resolve one upstream tsconfig alias without changing upstream files or functions.
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === '@/constants/file-picker') return {
    url: pathToFileURL(path.join(upstream, 'packages/app/src/constants/file-picker.ts')).href,
    shortCircuit: true,
  }
  return nextResolve(specifier, context)
} })
const { attachmentMime } = await import(pathToFileURL(path.join(upstream, 'packages/app/src/components/prompt-input/files.ts')))
const sdkRoot = path.resolve(values['sdk-root'])
const sdkPackage = JSON.parse(await readFile(path.join(sdkRoot, 'node_modules/@ai-sdk/google/package.json')))
assert.equal(sdkPackage.version, '3.0.73')
const { createGoogleGenerativeAI } = await import(pathToFileURL(path.join(sdkRoot, 'node_modules/@ai-sdk/google/dist/index.mjs')))
const temporary = await mkdtemp(path.join(tmpdir(), 'agent-video-probe-'))
try {
  const clip = path.join(temporary, 'fixture.mp4')
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
    'testsrc=size=160x96:rate=4', '-t', '1', '-c:v', 'mpeg4', '-pix_fmt', 'yuv420p', clip])
  const bytes = await readFile(clip)
  const observations = []
  for (const [name, type, data, expectedMime] of [
    ['fixture.mp4', 'video/mp4', bytes, undefined],
    ['fixture-no-mime.mp4', '', bytes, undefined],
    ['fixture-octet.mp4', 'application/octet-stream', bytes, undefined],
    ['frame.jpg', 'image/jpeg', new Uint8Array([255, 216, 255]), 'image/jpeg'],
    ['main.ts', 'video/mp2t', Buffer.from('export const x = 1\n'), 'text/plain'],
  ]) {
    const actual = await attachmentMime(new File([data], name, { type }))
    assert.equal(actual, expectedMime)
    observations.push({ case: name, mime: type, detected: actual ?? null })
  }
  const captured = []
  const google = createGoogleGenerativeAI({
    apiKey: 'offline-unused',
    fetch: async (_url, init) => {
      captured.push(JSON.parse(init.body))
      // Synthetic response allows doGenerate to complete. No model inference occurs.
      return new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: 'offline fixture' }] },
        finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 } }),
        { status: 200, headers: { 'content-type': 'application/json' } })
    },
  })
  // Model identifier is an upstream documented fixture; this only exercises serialization.
  const model = google('gemini-2.5-flash')
  await model.doGenerate({ prompt: [{ role: 'user', content: [
    { type: 'text', text: 'Describe the clip.' },
    { type: 'file', mediaType: 'video/mp4', data: new Uint8Array(bytes) },
  ] }] })
  const inline = captured[0].contents[0].parts[1]
  assert.equal(inline.inlineData.mimeType, 'video/mp4')
  assert.deepEqual(Buffer.from(inline.inlineData.data, 'base64'), bytes)
  await model.doGenerate({ prompt: [{ role: 'user', content: [
    { type: 'file', mediaType: 'video/mp4', data: new URL('https://youtu.be/offlinefixture') },
  ] }] })
  assert.equal(captured[1].contents[0].parts[0].fileData.fileUri, 'https://youtu.be/offlinefixture')
  const report = { collected_date: '2026-10-05', kind: 'offline_real_code_boundary_probe',
    opencode_commit: expected, sdk: '@ai-sdk/google@3.0.73', runtime: process.version,
    model_inference: false, network_requests: 0, synthetic_video: { bytes: bytes.length, duration_seconds: 1 },
    attachment_detection: observations,
    sdk_video_inline: { mime: inline.inlineData.mimeType, roundtrip_bytes_equal: true },
    sdk_video_url: { fileData: true }, assertions: 10, status: 'passed' }
  if (values.output) await writeFile(values.output, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
} finally { await rm(temporary, { recursive: true, force: true }) }
