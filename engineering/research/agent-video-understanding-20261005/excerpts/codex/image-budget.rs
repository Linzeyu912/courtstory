pub(crate) fn resize_image(
    image_url: &str,
    detail: &mut Option<ImageDetail>,
    mode: ImagePreparationMode,
) -> Result<Option<PreparedInlineImage>, ImagePreparationError> {
    if is_remote_image_url(image_url) {
        return Err(ImagePreparationError::RemoteUrlUnsupported);
    }
    if !is_data_url(image_url) {
        return Ok(None);
    }

    let (effective_detail, image_mode) = match mode {
        ImagePreparationMode::UnifiedBudget => (
            ImageDetailSetting::Original,
            PromptImageMode::ORIGINAL_DETAIL,
        ),
        ImagePreparationMode::DetailBased => match detail {
            None | Some(ImageDetail::Auto | ImageDetail::High) => {
                (ImageDetailSetting::High, PromptImageMode::HIGH_DETAIL)
            }
            Some(ImageDetail::Original) => (
                ImageDetailSetting::Original,
                PromptImageMode::ORIGINAL_DETAIL,
            ),
            Some(ImageDetail::Low) => return Err(ImagePreparationError::UnsupportedLowDetail),
        },
    };
    let encoded = load_data_url_for_prompt(image_url, image_mode)?;
    let resize = ((encoded.source_width, encoded.source_height) != (encoded.width, encoded.height))
        .then_some(PreparedImageResize {
            source_width: encoded.source_width,
            source_height: encoded.source_height,
            prepared_width: encoded.width,
            prepared_height: encoded.height,
        });
    if mode == ImagePreparationMode::UnifiedBudget {
        // Preserve accurate context-window accounting while older transports still require an
        // image detail field. Responses Lite removes this compatibility hint before sending.
        *detail = Some(ImageDetail::Original);
    }
    Ok(Some(PreparedInlineImage {
        encoded,
        effective_detail,
        resize,
    }))
}

