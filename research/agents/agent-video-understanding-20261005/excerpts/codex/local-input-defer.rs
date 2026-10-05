    pub(crate) fn response_item_from_user_input(&self, input: Vec<UserInput>) -> ResponseItem {
        self.response_item_from_user_input_with_image_positions(input, &mut HashMap::new())
    }

    fn response_item_from_user_input_with_image_positions(
        &self,
        input: Vec<UserInput>,
        user_image_content_indices: &mut HashMap<usize, usize>,
    ) -> ResponseItem {
        let mut item = ResponseItem::from(ResponseInputItem::from_user_input(
            input,
            LocalImagePreparation::Defer,
            user_image_content_indices,
        ));
        if let ResponseItem::Message {
            content,
