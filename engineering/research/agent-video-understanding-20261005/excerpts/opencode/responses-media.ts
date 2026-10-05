
const lowerUserContent = Effect.fn("OpenAIResponses.lowerUserContent")(function* (
  part: LLMRequest["messages"][number]["content"][number],
) {
  if (part.type === "text") return { type: "input_text" as const, text: part.text }
  if (part.type === "media") {
    const media = yield* ProviderShared.validateMedia(
      "OpenAI Responses",
      part,
      new Set<string>(ProviderShared.IMAGE_MIMES),
    )
    return { type: "input_image" as const, image_url: media.dataUrl }
  }
  return yield* ProviderShared.unsupportedContent("OpenAI Responses", "user", ["text", "media"])
})
