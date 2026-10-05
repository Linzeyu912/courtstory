        }
        (None, root_prompt, imgs) => {
            let prompt_text = resolve_root_prompt(root_prompt);
            let mut items: Vec<UserInput> = imgs
                .into_iter()
                .map(|path| UserInput::LocalImage { path, detail: None })
                .collect();
            items.push(UserInput::Text {
                text: prompt_text.clone(),
                // CLI input doesn't track UI element ranges, so none are available here.
                text_elements: Vec::new(),
            });
            let output_schema = load_output_schema(output_schema_path);
            (
                InitialOperation::UserTurn {
                    items,
                    output_schema,
                },
                prompt_text,
            )
        }
    };

    // When --yolo (dangerously_bypass_approvals_and_sandbox) is set, also skip the git repo check
    // since the user is explicitly running in an externally sandboxed environment.
