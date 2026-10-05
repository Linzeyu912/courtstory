pub const PROMPT_IMAGE_PATCH_SIZE: u32 = 32;
/// Maximum width or height used when resizing images before uploading.
pub const MAX_DIMENSION: u32 = 2048;
/// Maximum accepted byte length for prompt image input representations.
///
/// This is a high sanity guard against pathological inputs, not a protocol
/// requirement or target upload size.
pub const MAX_PROMPT_IMAGE_INPUT_BYTES: usize = 1024 * 1024 * 1024;
const MAX_IMAGE_CACHE_BYTES: usize = 64 * 1024 * 1024;

pub mod error;

pub use crate::error::ImageProcessingError;

#[derive(Debug, Clone)]
pub struct EncodedImage {
    pub bytes: Arc<[u8]>,
    pub mime: String,
    pub source_width: u32,
    pub source_height: u32,
    pub width: u32,
    pub height: u32,
}

impl EncodedImage {
    pub fn into_data_url(self) -> String {
        data_url_from_bytes(&self.mime, &self.bytes)
    }
}

/// Wraps image bytes in a data URL without decoding or validating them.
pub fn data_url_from_bytes(mime: &str, bytes: &[u8]) -> String {
    let encoded = BASE64_STANDARD.encode(bytes);
    format!("data:{mime};base64,{encoded}")
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PromptImageMode {
    ResizeToFit,
    Original,
    ResizeWithLimits(PromptImageResizeLimits),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct PromptImageResizeLimits {
    pub max_dimension: u32,
    pub max_patches: usize,
}

impl PromptImageMode {
    /// Resize policy for high-detail prompt images.
    pub const HIGH_DETAIL: Self = Self::ResizeWithLimits(PromptImageResizeLimits {
        max_dimension: 2048,
        max_patches: 2_500,
    });
    /// Resize policy for original-detail prompt images.
    pub const ORIGINAL_DETAIL: Self = Self::ResizeWithLimits(PromptImageResizeLimits {
        max_dimension: 6000,
        max_patches: 10_000,
    });
