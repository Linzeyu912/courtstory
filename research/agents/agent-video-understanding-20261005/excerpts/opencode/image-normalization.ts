    )
    const normalize = Effect.fn("Image.normalize")(function* (
      resource: string,
      content: FileSystem.Content & { readonly encoding: "base64" },
    ) {
      const image = Object.assign(
        {},
        ...(yield* config.entries()).flatMap((entry) =>
          entry.type === "document" && entry.info.attachments?.image ? [entry.info.attachments.image] : [],
        ),
      )
      const normalize = yield* loadAdapter
      return yield* normalize(resource, content, {
        autoResize: image.auto_resize ?? true,
        maxWidth: image.max_width ?? 2_000,
        maxHeight: image.max_height ?? 2_000,
        maxBase64Bytes: image.max_base64_bytes ?? 5 * 1024 * 1024,
      })
    })
    return Service.of({ normalize })
  }),
