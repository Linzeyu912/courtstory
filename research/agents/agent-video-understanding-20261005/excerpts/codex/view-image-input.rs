    async fn handle_call(
        &self,
        invocation: ToolInvocation,
    ) -> Result<Box<dyn crate::tools::context::ToolOutput>, FunctionCallError> {
        if !invocation
            .step_context
            .settings
            .model_info
            .input_modalities
            .contains(&InputModality::Image)
        {
            return Err(FunctionCallError::RespondToModel(
                VIEW_IMAGE_UNSUPPORTED_MESSAGE.to_string(),
            ));
        }

        let ToolInvocation {
            session,
            turn,
            step_context,
            payload,
            call_id,
            ..
        } = invocation;

        let arguments = match payload {
            ToolPayload::Function { arguments } => arguments,
            _ => {
                return Err(FunctionCallError::RespondToModel(
                    "view_image handler received unsupported payload".to_string(),
                ));
            }
        };

        let ViewImageArgs {
            path,
            environment_id,
            detail,
        } = parse_arguments(&arguments)?;
        // Keep accepting previously supported detail hints after they disappear from the schema.
        let detail = match detail.as_deref() {
            None => None,
            Some("high") => Some(ViewImageDetail::High),
            Some("original") => Some(ViewImageDetail::Original),
            Some(detail) => {
                return Err(FunctionCallError::RespondToModel(format!(
                    "view_image.detail only supports `high` or `original`; omit `detail` for default high resized behavior, got `{detail}`"
                )));
            }
        };

        let turn_environment = resolve_tool_environment(
            &step_context,
            environment_id.as_deref(),
            "view_image is unavailable in this session",
        )?;
        let path_uri = turn_environment.cwd().join(&path).map_err(|err| {
            FunctionCallError::RespondToModel(format!(
                "unable to resolve image path `{path}` against environment cwd `{}`: {err}",
                turn_environment.cwd(),
            ))
        })?;
        let model_visible_path = path_uri.inferred_native_path_string();
        let sandbox = turn_environment.sandbox_context(/*additional_permissions*/ None);
        let fs = turn_environment.environment.get_filesystem();

        let metadata = fs
            .get_metadata(&path_uri, GetMetadataOptions::default(), Some(&sandbox))
            .await
            .map_err(|error| {
                FunctionCallError::RespondToModel(format!(
                    "unable to locate image at `{model_visible_path}`: {error}"
                ))
            })?;

        if !metadata.is_file {
            return Err(FunctionCallError::RespondToModel(format!(
                "image path `{model_visible_path}` is not a file"
            )));
        }
        let file_bytes = fs
            .read_file(&path_uri, ReadFileOptions::default(), Some(&sandbox))
            .await
            .map_err(|error| {
                FunctionCallError::RespondToModel(format!(
                    "unable to read image at `{model_visible_path}`: {error}"
                ))
            })?;
        // Reject non-images before their bytes can reach code mode without changing
        // valid image bytes, metadata, or centralized image preparation.
        image::load_from_memory(&file_bytes).map_err(|_| {
            FunctionCallError::RespondToModel(VIEW_IMAGE_INVALID_MESSAGE.to_string())
        })?;

        let can_request_original_detail =
            can_request_original_image_detail(&step_context.settings.model_info);
        let use_original_detail = self.options.unified_image_budget
            || can_request_original_detail && matches!(detail, Some(ViewImageDetail::Original));
        let image_detail = if use_original_detail {
            ImageDetail::Original
        } else {
            DEFAULT_IMAGE_DETAIL
        };

        // The history insertion path owns image preparation and resizing.
        let image_url = data_url_from_bytes("application/octet-stream", &file_bytes);

        let item = TurnItem::ImageView(ImageViewItem {
            id: call_id,
            path: path_uri,
        });
        session.emit_turn_item_started(turn.as_ref(), &item).await;
        session.emit_turn_item_completed(turn.as_ref(), item).await;

        Ok(boxed_tool_output(ViewImageOutput {
            image_url,
            image_detail,
            unified_image_budget: self.options.unified_image_budget,
        }))
    }
}

impl CoreToolRuntime for ViewImageHandler {
