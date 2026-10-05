    /// Prepares media using the originating model and preserves existing item identity.
    pub(crate) async fn prepare_conversation_items_for_history<'a>(
        &self,
        turn_context: &TurnContext,
        model_info: &ModelInfo,
        items: &'a [ResponseItem],
    ) -> (Cow<'a, [ResponseItem]>, Vec<ImagePreparationMetadata>) {
        let mut items = items.to_vec();
        let image_preparation_mode =
            if unified_image_budget_enabled(&turn_context.config.features, model_info) {
                ImagePreparationMode::UnifiedBudget
            } else {
                ImagePreparationMode::DetailBased
            };
        let image_resize_notice_mode = if turn_context
            .config
            .features
            .enabled(Feature::ImageResizeNotice)
        {
            ImageResizeNoticeMode::Enabled
        } else {
            ImageResizeNoticeMode::Disabled
        };
        // Keep nested image-upload futures out of every caller's future frame.
        let image_preparations = Box::pin(prepare_image_response_items(
            &self.thread_id.to_string(),
            &mut items,
            image_preparation_mode,
            image_resize_notice_mode,
            self.services.image_store.as_ref(),
        ))
        .await;
        prepare_audio_response_items(&mut items);
        // Most response items get their passthrough turn ID at the durable history boundary.
        for item in &mut items {
            Self::stamp_response_item_for_history(item, &turn_context.sub_id);
        }
        let items = Cow::Owned(items);
        (
            Self::assign_missing_response_item_ids(items),
            image_preparations,
        )
