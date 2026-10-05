    enum McpContent {
        #[serde(rename = "text")]
        Text {
            text: String,
            #[serde(rename = "_meta", default)]
            meta: Option<serde_json::Value>,
        },
        #[serde(rename = "image")]
        Image {
            data: String,
            #[serde(rename = "mimeType", alias = "mime_type")]
            mime_type: Option<String>,
            #[serde(rename = "_meta", default)]
            meta: Option<serde_json::Value>,
        },
        #[serde(rename = "audio")]
        Audio {
            data: String,
            #[serde(rename = "mimeType", alias = "mime_type")]
            mime_type: Option<String>,
            #[serde(rename = "_meta", default)]
            _meta: Option<serde_json::Value>,
        },
        #[serde(other)]
        Unknown,
    }

    let mut items = Vec::with_capacity(contents.len());

    for content in contents {
        let item = match serde_json::from_value::<McpContent>(content.clone()) {
            Ok(McpContent::Text { text, meta }) => {
                if meta
                    .as_ref()
                    .and_then(|meta| meta.get(CODEX_ENCRYPTED_CONTENT_META_KEY))
                    .and_then(serde_json::Value::as_bool)
                    == Some(true)
                {
                    FunctionCallOutputContentItem::EncryptedContent {
                        encrypted_content: text,
                    }
                } else {
                    FunctionCallOutputContentItem::InputText { text }
                }
            }
            Ok(McpContent::Image {
                data,
                mime_type,
                meta,
            }) => {
                let image_url = if data.starts_with("data:") {
                    data
                } else {
                    let mime_type = mime_type.unwrap_or_else(|| "application/octet-stream".into());
                    format!("data:{mime_type};base64,{data}")
                };
                FunctionCallOutputContentItem::InputImage {
                    image: ImageReference::Inline { image_url },
                    detail: meta
                        .as_ref()
                        .and_then(serde_json::Value::as_object)
                        .and_then(|meta| meta.get(CODEX_IMAGE_DETAIL_META_KEY))
                        .and_then(serde_json::Value::as_str)
                        .and_then(|detail| match detail {
                            "auto" => Some(ImageDetail::Auto),
                            "low" => Some(ImageDetail::Low),
                            "high" => Some(ImageDetail::High),
                            "original" => Some(ImageDetail::Original),
                            _ => None,
                        })
                        .or(Some(DEFAULT_IMAGE_DETAIL)),
                }
            }
            Ok(McpContent::Audio {
                data, mime_type, ..
            }) => {
                let audio_url = if data.starts_with("data:") {
                    data
                } else {
                    let mime_type = mime_type.unwrap_or_else(|| "application/octet-stream".into());
                    format!("data:{mime_type};base64,{data}")
                };
                FunctionCallOutputContentItem::InputAudio { audio_url }
            }
            Ok(McpContent::Unknown) | Err(_) => FunctionCallOutputContentItem::InputText {
                text: serde_json::to_string(content).unwrap_or_else(|_| "<content>".to_string()),
            },
        };
        items.push(item);
