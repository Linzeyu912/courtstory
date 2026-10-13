import assert from 'node:assert/strict';
import test from 'node:test';
import {runTrim} from './trim-client.mjs';
import {mountFootageUI} from './footage-ui.mjs';

const response = (data, status = 200) => ({ok: status >= 200 && status < 300, status, json: async () => data});
const options = {pollIntervalMs: 0, requestTimeoutMs: 200, timeoutMs: 1_000};

test('submits one async request, reports progress and returns the completed result', async () => {
  const calls = [], messages = [];
  const expected = {sample: 'trimmed', frames: 12, sourceCuts: [{start: 2, end: 4}], audioPolicy: 'preserve'};
  const replies = [
    {id: 'job-1', status: 'queued', message: '已排队'},
    {id: 'job-1', status: 'running', message: '正在生成候选'},
    {id: 'job-1', status: 'ready', result: expected},
  ];
  const result = await runTrim({sample: 'original', ranges: [{start: 2, end: 4}]}, {
    ...options, onProgress: message => messages.push(message), fetchImpl: async (url, init) => {
      calls.push({url, ...init});
      return response(replies.shift(), calls.length === 1 ? 202 : 200);
    },
  });
  assert.deepEqual(result, expected);
  assert.equal(calls.filter(call => call.method === 'POST').length, 1);
  assert.deepEqual(JSON.parse(calls[0].body), {sample: 'original', ranges: [{start: 2, end: 4}], async: true});
  assert.equal(calls[1].url, '/api/trim-jobs/job-1');
  assert.ok(messages.includes('正在生成候选'));
});

test('backend failure surfaces its message without a second submission', async () => {
  let posts = 0;
  await assert.rejects(runTrim({}, {...options, fetchImpl: async (_, init) => {
    if (init.method === 'POST') {posts++; return response({id: 'job', status: 'queued'}, 202);}
    return response({id: 'job', status: 'error', error: '源视频无法读取'});
  }}), /源视频无法读取/);
  assert.equal(posts, 1);
});

test('transient GET errors can recover without creating duplicate jobs', async () => {
  let posts = 0, polls = 0;
  const result = await runTrim({}, {...options, fetchImpl: async (_, init) => {
    if (init.method === 'POST') {posts++; return response({id: 'job', status: 'queued'}, 202);}
    if (++polls < 3) throw new Error('network unavailable');
    return response({id: 'job', status: 'ready', result: {sample: 'done'}});
  }});
  assert.equal(result.sample, 'done');
  assert.equal(posts, 1);
  assert.equal(polls, 3);
});

test('POST timeout is bounded and warns that background work may continue', async () => {
  let posts = 0;
  await assert.rejects(runTrim({}, {...options, requestTimeoutMs: 10, fetchImpl: async () => {
    posts++;
    return new Promise(() => {});
  }}), /后台剪辑可能仍在继续.*视频库.*勿立即重复提交/);
  assert.equal(posts, 1);
});

test('total polling deadline ends a job that stays running, without resubmission', async () => {
  let posts = 0;
  await assert.rejects(runTrim({}, {...options, timeoutMs: 25, pollIntervalMs: 5, fetchImpl: async (_, init) => {
    if (init.method === 'POST') posts++;
    return response({id: 'job', status: 'running'});
  }}), /超时.*后台剪辑可能仍在继续/);
  assert.equal(posts, 1);
});

test('failed status reads have a finite retry budget', async () => {
  let posts = 0, polls = 0;
  await assert.rejects(runTrim({}, {...options, maxPollFailures: 1, fetchImpl: async (_, init) => {
    if (init.method === 'POST') {posts++; return response({id: 'job', status: 'queued'}, 202);}
    polls++;
    return response({error: '服务暂时不可用'}, 503);
  }}), /服务暂时不可用.*视频库/);
  assert.equal(posts, 1);
  assert.equal(polls, 2);
});

test('HTTP validation failure is displayed directly, without retries', async () => {
  let calls = 0;
  await assert.rejects(runTrim({}, {...options, fetchImpl: async () => {
    calls++;
    return response({error: '请选择有效的剪辑区间'}, 400);
  }}), /^Error: 请选择有效的剪辑区间$/);
  assert.equal(calls, 1);
});

test('malformed or expired job responses terminate rather than polling forever', async () => {
  for (const invalid of [response({id: 'another-job', status: 'running'}), response({error: '任务已过期'}, 404)]) {
    let calls = 0;
    await assert.rejects(runTrim({}, {...options, fetchImpl: async () => {
      return ++calls === 1 ? response({id: 'job', status: 'queued'}, 202) : invalid;
    }}), /视频库/);
    assert.equal(calls, 2);
  }
});

test('a slow JSON body is covered by the request timeout', async () => {
  let calls = 0;
  await assert.rejects(runTrim({}, {...options, requestTimeoutMs: 10, fetchImpl: async () => {
    calls++;
    return {ok: true, status: 202, json: () => new Promise(() => {})};
  }}), /超时.*视频库/);
  assert.equal(calls, 1);
});

function mountFixture(t, ranges, fetchImpl) {
  const previous = {document: globalThis.document, location: globalThis.location, fetch: globalThis.fetch};
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  });
  const elements = new Map();
  globalThis.document = {getElementById: id => {
    if (!elements.has(id)) elements.set(id, {});
    return elements.get(id);
  }};
  const navigations = [], messages = [];
  globalThis.location = {search: '?sample=original&variant=old-variant&qa=1', assign: url => navigations.push(url)};
  globalThis.fetch = fetchImpl;
  const state = {liveRanges: ranges};
  let nextCount = 0;
  mountFootageUI({
    sample: 'original', variant: 'old-variant', qa: true,
    clip: {frames: Array.from({length: 10}, (_, i) => ({time: i / 30})), video_sha256: 'source-hash'},
    session: () => state, change: callback => callback(), next: () => nextCount++, toast: message => messages.push(message),
  });
  return {elements, state, navigations, messages, nextCount: () => nextCount};
}

test('footage UI keeps multiple ranges intact and opens the completed sample after polling', async t => {
  const ranges = [{start: 1, end: 3}, {start: 6, end: 8}], calls = [];
  const fixture = mountFixture(t, ranges, async (url, init) => {
    calls.push({url, ...init});
    return calls.length === 1
      ? response({id: 'job', status: 'queued', message: '正在准备剪辑'}, 202)
      : response({id: 'job', status: 'ready', result: {sample: 'trimmed'}});
  });
  await fixture.elements.get('liveApply').onclick();
  assert.deepEqual(JSON.parse(calls[0].body), {
    sample: 'original', variant: 'old-variant', qa: true, ranges, async: true,
  });
  assert.deepEqual(fixture.state.liveRanges, ranges);
  assert.equal(calls[1].url, '/api/trim-jobs/job');
  assert.deepEqual(fixture.navigations, ['/?sample=trimmed&qa=1']);
  assert.deepEqual(fixture.messages, []);
  assert.equal(fixture.nextCount(), 0);
});

test('footage UI still advances a whole clip immediately without creating a trim', async t => {
  const ranges = [{start: 0, end: 9}];
  const fixture = mountFixture(t, ranges, async () => {assert.fail('A whole clip must not create a trim');});
  await fixture.elements.get('liveApply').onclick();
  assert.equal(fixture.nextCount(), 1);
  assert.deepEqual(fixture.state.liveSelection.ranges, ranges);
  assert.equal(fixture.state.liveSelection.method, 'manual_whole_clip');
  assert.equal(fixture.state.liveSelection.parentVideoSha256, 'source-hash');
  assert.deepEqual(fixture.navigations, []);
});
