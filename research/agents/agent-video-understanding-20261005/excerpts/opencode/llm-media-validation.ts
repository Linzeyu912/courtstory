export const IMAGE_MIMES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const
export const VIDEO_MIMES = ["video/mp4", "video/webm", "video/quicktime"] as const
export const AUDIO_MIMES = ["audio/wav", "audio/mp3", "audio/aiff", "audio/aac", "audio/ogg", "audio/flac"] as const
export const MEDIA_MIMES = [...IMAGE_MIMES, ...VIDEO_MIMES, ...AUDIO_MIMES] as const
export const MAX_MEDIA_ENCODED_BYTES = 28 * 1024 * 1024
export const MAX_MEDIA_DECODED_BYTES = 20 * 1024 * 1024

const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

export interface ValidatedMedia {
  readonly mime: string
  readonly base64: string
  readonly dataUrl: string
  readonly bytes: Uint8Array
}

export const validateMedia = Effect.fn("ProviderShared.validateMedia")(function* (
  route: string,
  part: MediaPart,
  supportedMimes: ReadonlySet<string>,
) {
  const mime = part.mediaType.toLowerCase()
  if (!supportedMimes.has(mime)) return yield* invalidRequest(`${route} does not support media type ${part.mediaType}`)

  let base64: string
  if (typeof part.data !== "string") {
    if (part.data.byteLength > MAX_MEDIA_DECODED_BYTES)
      return yield* invalidRequest(`${route} media exceeds the ${MAX_MEDIA_DECODED_BYTES} byte decoded limit`)
    base64 = Buffer.from(part.data).toString("base64")
  } else if (part.data.startsWith("data:")) {
    const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/s.exec(part.data)
    if (!match) return yield* invalidRequest(`${route} media data URL must contain valid base64`)
    if (match[1]!.toLowerCase() !== mime)
      return yield* invalidRequest(`${route} media type ${part.mediaType} does not match data URL type ${match[1]}`)
    base64 = match[2]!
  } else {
    base64 = part.data
  }

  if (Buffer.byteLength(base64, "utf8") > MAX_MEDIA_ENCODED_BYTES)
    return yield* invalidRequest(`${route} media exceeds the ${MAX_MEDIA_ENCODED_BYTES} byte encoded limit`)
  if (!base64 || base64.length % 4 !== 0 || !base64Pattern.test(base64))
    return yield* invalidRequest(`${route} media must contain valid base64`)
  const bytes = Buffer.from(base64, "base64")
  if (bytes.byteLength > MAX_MEDIA_DECODED_BYTES)
    return yield* invalidRequest(`${route} media exceeds the ${MAX_MEDIA_DECODED_BYTES} byte decoded limit`)
  if (bytes.toString("base64") !== base64) return yield* invalidRequest(`${route} media must contain canonical base64`)
  return { mime, base64, dataUrl: `data:${mime};base64,${base64}`, bytes } satisfies ValidatedMedia
})

export const validateToolFile = (route: string, part: ToolFileContent, supportedMimes: ReadonlySet<string>) =>
  validateMedia(route, { type: "media", mediaType: part.mime, data: part.uri, filename: part.name }, supportedMimes)
