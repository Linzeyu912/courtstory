    Display,
    JsonSchema,
    TS,
    EnumIter,
    Hash,
)]
#[serde(rename_all = "lowercase")]
#[strum(serialize_all = "lowercase")]
pub enum InputModality {
    /// Plain text turns and tool payloads.
    Text,
    /// Image attachments included in user turns.
    Image,
    /// Audio attachments included in user turns.
    Audio,
}

/// Backward-compatible default when `input_modalities` is omitted on the wire.
///
/// Legacy payloads predate modality metadata, so we conservatively assume both text and images are
/// accepted unless a preset explicitly narrows support.
pub fn default_input_modalities() -> Vec<InputModality> {
    vec![InputModality::Text, InputModality::Image]
}
