
#[derive(derive_more::Debug, Clone, Serialize, Deserialize, PartialEq, JsonSchema, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ContentItem {
    InputText {
        #[debug("{:?} <{} bytes>", &text[..text.floor_char_boundary(/*index*/ 512)], text.len())]
        text: String,
    },
    InputImage {
        #[serde(flatten)]
        image: ImageReference,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        detail: Option<ImageDetail>,
    },
    InputAudio {
        audio_url: String,
    },
    OutputText {
        text: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, JsonSchema, TS)]
#[serde(untagged)]
#[ts(untagged)]
pub enum ImageReference {
    Inline { image_url: String },
    File { file_id: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, JsonSchema, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentMessageInputContent {
    InputText { text: String },
    EncryptedContent { encrypted_content: String },
}

/// Returns the locally readable text when an agent message is entirely plaintext.
pub fn plaintext_agent_message_content(content: &[AgentMessageInputContent]) -> Option<String> {
    let mut text_parts = Vec::with_capacity(content.len());
    for part in content {
        match part {
            AgentMessageInputContent::InputText { text } => text_parts.push(text.as_str()),
            AgentMessageInputContent::EncryptedContent { .. } => return None,
        }
    }

    let text = text_parts.join("\n");
    (!text.trim().is_empty()).then_some(text)
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, JsonSchema, TS)]
#[serde(rename_all = "lowercase")]
pub enum ImageDetail {
    Auto,
    Low,
    High,
    Original,
}

pub const DEFAULT_IMAGE_DETAIL: ImageDetail = ImageDetail::High;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, JsonSchema, TS)]
