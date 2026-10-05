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
    if (i && row.frame !== frames[i - 1].frame + 1) flush();
    segment.push(row[key]);
  }
  flush(); return segments;
}
