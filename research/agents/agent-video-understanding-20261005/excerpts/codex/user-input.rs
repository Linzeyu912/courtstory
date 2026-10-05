use schemars::JsonSchema;
use serde::Deserialize;
use serde::Serialize;
use ts_rs::TS;

use crate::models::ImageDetail;
use crate::models::ImageReference;

/// Conservative cap so one user message cannot monopolize a large context window.
pub const MAX_USER_INPUT_TEXT_CHARS: usize = 1 << 20;

/// User input
#[non_exhaustive]
#[derive(derive_more::Debug, Clone, Deserialize, Serialize, PartialEq, TS, JsonSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum UserInput {
    Text {
        #[debug("{:?} <{} bytes>", &text[..text.floor_char_boundary(/*index*/ 512)], text.len())]
        text: String,
        /// UI-defined spans within `text` that should be treated as special elements.
        /// These are byte ranges into the UTF-8 `text` buffer and are used to render
        /// or persist rich input markers (e.g., image placeholders) across history
        /// and resume without mutating the literal text.
        #[serde(default)]
        text_elements: Vec<TextElement>,
    },
    /// Image reference forwarded to the Responses API.
    Image {
        #[serde(flatten)]
        image: ImageReference,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        detail: Option<ImageDetail>,
    },
    /// Local image path provided by the user.  This will be converted to an
    /// `Image` variant (base64 data URL) during request serialization.
    LocalImage {
        path: std::path::PathBuf,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        detail: Option<ImageDetail>,
    },
    /// Pre-encoded audio data URI forwarded to the Responses API.
    Audio { audio_url: String },
    /// Local audio path converted to an `Audio` data URI during request serialization.
    LocalAudio { path: std::path::PathBuf },

    /// Skill selected by the user (name + path to SKILL.md).
    Skill {
        name: String,
        path: std::path::PathBuf,
    },
    /// Explicit structured mention selected by the user.
    ///
    /// `path` identifies the exact mention target, for example
    /// `app://<connector-id>` or `plugin://<plugin-name>@<marketplace-name>`.
    Mention { name: String, path: String },
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, TS, JsonSchema)]
pub struct TextElement {
    /// Byte range in the parent `text` buffer that this element occupies.
    pub byte_range: ByteRange,
    /// Optional human-readable placeholder for the element, displayed in the UI.
    placeholder: Option<String>,
}

impl TextElement {
    pub fn new(byte_range: ByteRange, placeholder: Option<String>) -> Self {
        Self {
            byte_range,
