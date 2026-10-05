def build_codex_command(codex, directory, schema, result, images, *, model=None, effort=None):
    _validate_model(model, effort)
    command = [str(codex), 'exec', '--ignore-user-config', '--ignore-rules', '--ephemeral',
               '--sandbox', 'read-only', '--skip-git-repo-check', '-C', str(directory),
               '--output-schema', str(schema), '--json', '-o', str(result)]
    for feature in ('shell_tool', 'unified_exec', 'apps', 'plugins', 'browser_use',
                    'browser_use_external', 'browser_use_full_cdp_access', 'computer_use',
                    'in_app_browser', 'memories', 'skill_search', 'multi_agent', 'multi_agent_v2',
                    'worktrees', 'goals', 'image_generation', 'view_image',
                    'shell_snapshot', 'code_mode', 'code_mode_host'):
        command.extend(['--disable', feature])
    command.extend(['-c', 'web_search="disabled"', '-c', 'approval_policy="never"'])
    if model:
        command.extend(['--model', model])
    if effort:
        command.extend(['-c', 'model_reasoning_effort=' + json.dumps(effort)])
    for image in images:
        command.extend(['-i', str(image)])
    return command + ['-']


class TacticsAgent:
