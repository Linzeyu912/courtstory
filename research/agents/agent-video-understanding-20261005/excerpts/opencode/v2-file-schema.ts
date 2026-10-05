export interface FileAttachment extends Schema.Schema.Type<typeof FileAttachment> {}
export const FileAttachment = Schema.Struct({
  uri: Schema.String,
  mime: Schema.String,
  name: Schema.String.pipe(optional),
  description: Schema.String.pipe(optional),
  source: Source.pipe(optional),
})
  .annotate({ identifier: "Prompt.FileAttachment" })
  .pipe(
    statics((schema) => ({
      create: (input: FileAttachment) =>
        schema.make({
          uri: input.uri,
          mime: input.mime,
          name: input.name,
          description: input.description,
          source: input.source,
        }),
    })),
  )

export interface AgentAttachment extends Schema.Schema.Type<typeof AgentAttachment> {}
