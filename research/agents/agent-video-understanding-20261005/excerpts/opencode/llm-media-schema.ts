  type: Schema.Literal("text"),
  text: Schema.String,
  cache: Schema.optional(CacheHint),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: "LLM.Content.Text" })
export type TextPart = Schema.Schema.Type<typeof TextPart>

export const MediaPart = Schema.Struct({
  type: Schema.Literal("media"),
  mediaType: Schema.String,
  data: Schema.Union([Schema.String, Schema.Uint8Array]),
  filename: Schema.optional(Schema.String),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}).annotate({ identifier: "LLM.Content.Media" })
export type MediaPart = Schema.Schema.Type<typeof MediaPart>

export { ToolContent, ToolFileContent, ToolTextContent }

const isToolResultValue = (value: unknown): value is ToolResultValue =>
