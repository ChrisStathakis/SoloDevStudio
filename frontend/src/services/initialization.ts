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
  // Interactive `opencode [project]` supports --agent and --model but has no
  // top-level --variant flag (that flag is `opencode run`-only), so effort is
  // stored on the preset/project but not passed on the interactive command.
  void reasoningEffort;
  return `opencode --agent ${mode} --model ${quotedModel}`;
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
const ESC = String.fromCharCode(27);

export function formatBracketedPaste(prompt: string): string {
  return `${ESC}[200~${sanitizeTerminalPrompt(prompt)}${ESC}[201~`;
}

/** Output markers for the agent-launch handshake (see TerminalDrawer.waitForOutputMarker). */
const BEL = String.fromCharCode(7);
const ANSI_STRIP_RE = new RegExp(
  ESC + String.raw`(?:\[[0-?]*[ -/]*[@-~]|\][^` + BEL + String.raw`]*(?:` + BEL + `|` + ESC + String.raw`\\))`,
  'g',
);

/** Codex stops at an interactive trust gate before its composer opens. Never auto-accept it. */
export const CODEX_TRUST_PATTERNS: RegExp[] = [/do you trust/i, /press enter to continue/i];

/** Composer-ready signals, matched only against output produced after the launch command. */
export const CODEX_READY_PATTERNS: RegExp[] = [
  /type \/ for commands/i,
  /esc to interrupt/i,
  /[─│┌┐└┘]{4,}/,
];

export const OPENCODE_READY_PATTERNS: RegExp[] = [
  /[─│┌┐└┘]{4,}/,
  /opencode[^\n]*\d+\.\d+/i,
];

export type MarkerScan = 'ready' | 'blocked' | null;

/** Scan an output tail: trust gates win ties so the user is always asked first. */
export function scanOutputMarkers(tail: string, ready: RegExp[], blocked: RegExp[]): MarkerScan {
  const plain = tail.replace(ANSI_STRIP_RE, '');
  for (const re of blocked) {
    re.lastIndex = 0;
    if (re.test(plain)) return 'blocked';
  }
  for (const re of ready) {
    re.lastIndex = 0;
    if (re.test(plain)) return 'ready';
  }
  return null;
}

/** Heuristic: large prose/prompt text that would execute line-by-line in a bare CMD shell. */
export function looksLikeAgentPrompt(text: string): boolean {
  if (text.length < 2048) return false;
  const lines = text.split('\n');
  if (lines.length < 3) return false;
  let score = 0;
  if (/^#{1,4}\s+\S/m.test(text)) score += 2;
  if (/^[-*]\s+\[[ xX]\]/m.test(text)) score += 2;
  if (/## (Task|Documentation|Focus task)/.test(text)) score += 2;
  if (lines.filter((l) => l.length > 120).length >= 3) score += 1;
  return score >= 2;
}
