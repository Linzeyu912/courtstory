}

impl ResponseInputItem {
    /// Records original user-input indices to image slots in the generated message content.
    /// Inputs that do not produce an image, including failed local reads, have no entry.
    pub fn from_user_input(
        items: Vec<UserInput>,
        local_image_preparation: LocalImagePreparation,
        user_image_content_indices: &mut HashMap<usize, usize>,
    ) -> Self {
        user_image_content_indices.clear();
        let mut image_index = 0;
        let mut audio_index = 0;
        let mut content = Vec::new();
        for (input_index, input) in items.into_iter().enumerate() {
            let generated = match input {
                UserInput::Text { text, .. } => vec![ContentItem::InputText { text }],
                UserInput::Image { image, detail, .. } => {
                    image_index += 1;
                    let detail = detail.unwrap_or(DEFAULT_IMAGE_DETAIL);
                    vec![ContentItem::InputImage {
                        image,
                        detail: Some(detail),
                    }]
                }
                UserInput::LocalImage { path, detail, .. } => {
                    image_index += 1;
                    let detail = detail.unwrap_or(DEFAULT_IMAGE_DETAIL);
                    match std::fs::read(&path) {
                        Ok(file_bytes) => match local_image_preparation {
                            LocalImagePreparation::Process => {
                                local_image_content_items_with_label_number(
                                    &path,
                                    file_bytes,
                                    Some(image_index),
                                    detail,
                                )
                            }
                            LocalImagePreparation::Defer => local_image_content_items(
                                &path,
                                data_url_from_bytes("application/octet-stream", &file_bytes),
                                Some(image_index),
                                detail,
                            ),
                        },
                        Err(err) => vec![local_media_error_placeholder(
                            &path,
                            err,
                            LocalMediaKind::Image,
                        )],
                    }
                }
                UserInput::Audio { audio_url } => {
                    audio_index += 1;
                    vec![ContentItem::InputAudio { audio_url }]
                }
                UserInput::LocalAudio { path } => {
                    audio_index += 1;
                    match std::fs::read(&path) {
                        Ok(file_bytes) => {
                            local_audio_content_items(&path, &file_bytes, audio_index)
                        }
                        Err(err) => vec![local_media_error_placeholder(
                            &path,
                            err,
                            LocalMediaKind::Audio,
                        )],
                    }
                }
                UserInput::Skill { .. } | UserInput::Mention { .. } => Vec::new(), // Tool bodies are injected later in core
            };
            // Local images add framing text, while mentions and skills add no content.
            // Capture the image's actual slot before preparation replaces its reference.
            for (offset, item) in generated.iter().enumerate() {
                if matches!(item, ContentItem::InputImage { .. }) {
                    user_image_content_indices.insert(input_index, content.len() + offset);
                }
            }
            content.extend(generated);
        }
        Self::Message {
            role: "user".to_string(),
            content,
            phase: None,
        }
    }
