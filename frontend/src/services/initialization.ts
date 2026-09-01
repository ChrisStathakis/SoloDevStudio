export type InitializationTool = 'opencode' | 'codex';
export type InitializationMode = 'build' | 'plan';
export type ReasoningEffort = 'low' | 'medium' | 'high';

export interface InitializationCommandOptions {
  tool: InitializationTool;
  model: string;
  reasoningEffort: ReasoningEffort;
  mode: InitializationMode;
}

/** Build the interactive CLI command used by the project terminal. */
export function buildInitializationCommand({
  tool,
  model,
  reasoningEffort,
  mode,
}: InitializationCommandOptions): string {
  const quotedModel = `"${model}"`;
  if (tool === 'codex') {
    const sandbox = mode === 'plan' ? 'read-only' : 'workspace-write';
    return `codex --strict-config --model ${quotedModel} --sandbox ${sandbox} -c model_reasoning_effort="${reasoningEffort}"`;
  }
  return `opencode --model ${quotedModel}`;
}

/** Codex's Plan mode is an interactive slash command, not prompt prose. */
export const CODEX_PLAN_COMMAND = '/plan';

/** Remove terminal control bytes while preserving normal multiline prompt text. */
export function sanitizeTerminalPrompt(prompt: string): string {
  return prompt
    .replace(/[\u001b\u009b][[\]()#;?]*(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}

/** Paste as one draft in TUIs that support bracketed paste mode. */
export function formatBracketedPaste(prompt: string): string {
  return `\u001b[200~${sanitizeTerminalPrompt(prompt)}\u001b[201~`;
}
