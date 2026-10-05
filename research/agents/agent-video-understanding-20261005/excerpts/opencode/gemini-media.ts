    required: () => ({ functionCallingConfig: { mode: "ANY" as const } }),
    tool: (name) => ({ functionCallingConfig: { mode: "ANY" as const, allowedFunctionNames: [name] } }),
  })

const lowerUserPart = Effect.fn("Gemini.lowerUserPart")(function* (part: TextPart | MediaPart) {
  if (part.type === "text") return { text: part.text }
  const media = yield* ProviderShared.validateMedia("Gemini", part, MEDIA_MIMES)
  return { inlineData: { mimeType: media.mime, data: media.base64 } }
})

const googleMetadata = (metadata: Record<string, unknown>): ProviderMetadata => ({ google: metadata })

const thoughtSignature = (providerMetadata: ProviderMetadata | undefined) => {
  const google = providerMetadata?.google
  return ProviderShared.isRecord(google) && typeof google.thoughtSignature === "string"
    ? google.thoughtSignature
    : undefined
}

const lowerToolCall = (part: ToolCallPart) => ({
  functionCall: { name: part.name, args: part.input },
  thoughtSignature: thoughtSignature(part.providerMetadata),
})

const lowerMessages = Effect.fn("Gemini.lowerMessages")(function* (request: LLMRequest) {
  const contents: GeminiContent[] = []

  for (const message of request.messages) {
    if (message.role === "system") {
      const part = yield* ProviderShared.wrappedSystemUpdate("Gemini", message)
      const previous = contents.at(-1)
      if (previous?.role === "user")
        contents[contents.length - 1] = { role: "user", parts: [...previous.parts, { text: part.text }] }
      else contents.push({ role: "user", parts: [{ text: part.text }] })
      continue
    }

    if (message.role === "user") {
      const parts: Array<Schema.Schema.Type<typeof GeminiContentPart>> = []
      for (const part of message.content) {
        if (!ProviderShared.supportsContent(part, ["text", "media"]))
          return yield* ProviderShared.unsupportedContent("Gemini", "user", ["text", "media"])
        parts.push(yield* lowerUserPart(part))
      }
      contents.push({ role: "user", parts })
      continue
    }

    if (message.role === "assistant") {
      const parts: Array<Schema.Schema.Type<typeof GeminiContentPart>> = []
      for (const part of message.content) {
        if (!ProviderShared.supportsContent(part, ["text", "reasoning", "tool-call"]))
          return yield* ProviderShared.unsupportedContent("Gemini", "assistant", ["text", "reasoning", "tool-call"])
        if (part.type === "text") {
          parts.push({ text: part.text })
          continue
        }
        if (part.type === "reasoning") {
          parts.push({ text: part.text, thought: true, thoughtSignature: thoughtSignature(part.providerMetadata) })
          continue
        }
        if (part.type === "tool-call") {
          parts.push(lowerToolCall(part))
          continue
        }
      }
      contents.push({ role: "model", parts })
      continue
    }

    const parts: Array<Schema.Schema.Type<typeof GeminiContentPart>> = []
    for (const part of message.content) {
      if (!ProviderShared.supportsContent(part, ["tool-result"]))
        return yield* ProviderShared.unsupportedContent("Gemini", "tool", ["tool-result"])
      if (part.result.type !== "content") {
        parts.push({
          functionResponse: {
            name: part.name,
            response: {
              name: part.name,
              content: ProviderShared.toolResultText(part),
            },
          },
        })
        continue
      }
      const content: ReadonlyArray<ToolContent> = part.result.value
      const text = content.filter((item) => item.type === "text").map((item) => item.text)
      parts.push({
        functionResponse: {
          name: part.name,
          response: {
            name: part.name,
            content: text.join("\n"),
          },
        },
      })
      for (const item of content) {
        if (item.type === "text") continue
        const media = yield* ProviderShared.validateToolFile("Gemini", item, MEDIA_MIMES)
        parts.push({ inlineData: { mimeType: media.mime, data: media.base64 } })
      }
    }
    contents.push({ role: "user", parts })
  }
