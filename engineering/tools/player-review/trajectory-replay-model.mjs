// Playback uses decoded source timestamps, including variable frame intervals.
export function frameAtTime(frames, time) {
  let low = 0, high = frames.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (frames[mid].time <= time + 1e-6) low = mid;
    else high = mid - 1;
  }
  return low;
}

export function imagePoint(matrix, point) {
  if (!matrix || !point || point.some(v => !Number.isFinite(v))) return null;
  const [x, y] = point, w = matrix[6] * x + matrix[7] * y + matrix[8];
  if (Math.abs(w) < 1e-9) return null;
  const p = [(matrix[0] * x + matrix[1] * y + matrix[2]) / w,
    (matrix[3] * x + matrix[4] * y + matrix[5]) / w];
  return p.every(Number.isFinite) ? p : null;
}

export function pathSegments(frames, key, end, since = -Infinity) {
  const segments = []; let segment = [];
  const flush = () => { if (segment.length) segments.push(segment); segment = []; };
  for (let i = 0; i <= end; i++) {
    const row = frames[i];
    if (row.time < since) { flush(); continue; }
    if (!row[key]) { flush(); continue; }
    // Keep actual missing frames as gaps; never draw through an unknown interval.
    if (row.breakBefore || row.cut || (i && row.frame !== frames[i - 1].frame + 1)) flush();
    segment.push(row[key]);
  }
  flush(); return segments;
}

export function replayPlayers(data) {
  return data.players?.length ? data.players : [{ id: data.entityId, name: data.player }];
}

export function selectReplayPlayers(players, selectedId = 'all') {
  return selectedId === 'all' ? players : players.filter(player => player.id === selectedId);
}

export function playerFrames(data, entityId) {
  if (!data.players?.length) return data.frames;
  return data.frames.map(row => ({ frame: row.frame, time: row.time, toImage: row.toImage, cut: row.cut,
    ...(row.players?.[entityId] ?? { raw: null, qwen: null, bbox: null }) }));
}

export function hasDenoiseComparison(data) {
  return !!data.players?.length && data.frames.some(frame =>
    Object.values(frame.players ?? {}).some(row => row && ('refined' in row || 'processedState' in row)));
}

export function availableCounts(data, key) {
  const total = data.frames.length * (data.players?.length || 1);
  if (!data.players?.length) return { count: data.counts?.[key] ?? data.frames.filter(row => row[key]).length, total: data.counts?.total ?? data.frames.length };
  const count = data.frames.reduce((sum, frame) => sum + data.players.filter(player => frame.players?.[player.id]?.[key]).length, 0);
  return { count, total };
}

export function pointSource(row) {
  if (row.processedState) return row.processedState;
  if (row.qwenState) return row.qwenState;
  if (row.unknown) return '模型标记未知';
  return row.qwen ? '模型输出' : '无最终位置';
}
