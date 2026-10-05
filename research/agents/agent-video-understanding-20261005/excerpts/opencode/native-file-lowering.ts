
const mediaPart = (part: Record<string, unknown>) => {
  if (typeof part.data !== "string" && !(part.data instanceof Uint8Array))
    throw new Error("Native LLM request adapter only supports file parts with string or Uint8Array data")
  return {
    type: "media" as const,
    mediaType: typeof part.mediaType === "string" ? part.mediaType : "application/octet-stream",
    data: part.data,
    filename: typeof part.filename === "string" ? part.filename : undefined,
  }
}
