/** Strict canonical-json-v1; never performs the lossy JSON.stringify(object) normalization. */
export function canonicalJSON(value) {
  const ancestors = new Set();
  function encode(item) {
    if (item === null) return 'null';
    if (typeof item === 'string' || typeof item === 'boolean') return JSON.stringify(item);
    if (typeof item === 'number' && Number.isFinite(item)) return JSON.stringify(item);
    if (typeof item !== 'object') throw new TypeError('Only finite JSON values are accepted');
    if (ancestors.has(item)) throw new TypeError('Cyclic JSON value');
    const array = Array.isArray(item);
    if (!array && ![Object.prototype, null].includes(Object.getPrototypeOf(item))) throw new TypeError('Expected plain JSON object');
    const keys = Reflect.ownKeys(item);
    if (keys.some(key => typeof key !== 'string')) throw new TypeError('Symbol keys are not JSON');
    if (keys.some(key => !(array && key === 'length') && (!Object.getOwnPropertyDescriptor(item,key).enumerable || !('value' in Object.getOwnPropertyDescriptor(item,key))))) throw new TypeError('Non-JSON property descriptor');
    ancestors.add(item);
    let result;
    if (array) {
      if (keys.length !== item.length + 1 || keys.some(key => key !== 'length' && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= item.length))) throw new TypeError('Expected dense JSON array');
      result = '[' + item.map(encode).join(',') + ']';
    } else result = '{' + keys.sort().map(key => JSON.stringify(key) + ':' + encode(item[key])).join(',') + '}';
    ancestors.delete(item);
    return result;
  }
  return encode(value);
}

async function sha256(text) {
  let subtle = globalThis.crypto?.subtle;
  if (!subtle && typeof process !== 'undefined' && process.versions?.node) subtle = (await import('node:crypto')).webcrypto.subtle;
  if (!subtle) throw new Error('Web Crypto SHA-256 is required');
  return [...new Uint8Array(await subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(v=>v.toString(16).padStart(2,'0')).join('');
}

export async function createSourceBinding(review) {
  const serialized = canonicalJSON(review);
  const mapping = canonicalJSON(review.sourceFrameMapping);
  const [reviewDigest,frameMappingDigest] = await Promise.all([sha256(serialized),sha256(mapping)]);
  return {digestVersion:'canonical-json-v1',videoSha256:review.videoSha256??null,
    sourceVideoSha256:review.sourceVideoSha256??null,trackingFingerprint:review.trackingFingerprint??null,
    trackingRevision:review.trackingRevision??null,frameMappingDigest,reviewDigest};
}
