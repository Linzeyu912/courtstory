
pub struct ViewImageOutput {
    image_url: String,
    image_detail: ImageDetail,
    unified_image_budget: bool,
}

impl ToolOutput for ViewImageOutput {
    fn log_output(&self) -> String {
        format!("<image data URL omitted: {} bytes>", self.image_url.len())
    }

    fn success_for_logging(&self) -> bool {
        true
    }

    fn to_response_item(&self, call_id: &str, _payload: &ToolPayload) -> ResponseInputItem {
        let body =
            FunctionCallOutputBody::ContentItems(vec![FunctionCallOutputContentItem::InputImage {
                image: ImageReference::Inline {
                    image_url: self.image_url.clone(),
                },
                detail: Some(self.image_detail),
            }]);
        let output = FunctionCallOutputPayload {
            body,
            success: Some(true),
        };

        ResponseInputItem::FunctionCallOutput {
            call_id: call_id.to_string(),
            output,
        }
    }

    fn code_mode_result(&self, _payload: &ToolPayload) -> serde_json::Value {
        if self.unified_image_budget {
            serde_json::json!({ "image_url": self.image_url })
        } else {
            serde_json::json!({
                "image_url": self.image_url,
                "detail": self.image_detail
            })
        }
    }
}

#[cfg(test)]
