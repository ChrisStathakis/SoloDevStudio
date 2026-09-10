import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildInitializationCommand,
  formatBracketedPaste,
  sanitizeTerminalPrompt,
  scanOutputMarkers,
  looksLikeAgentPrompt,
  CODEX_READY_PATTERNS,
  CODEX_TRUST_PATTERNS,
} from './initialization.ts';

test('builds Codex High Plan command with strict read-only settings', () => {
  assert.equal(
    buildInitializationCommand({ tool: 'codex', model: 'gpt-5.6-terra', reasoningEffort: 'high', mode: 'plan' }),
    'codex --strict-config --model "gpt-5.6-terra" --sandbox read-only -c model_reasoning_effort="high"',
  );
});

test('builds Codex Build command with workspace-write settings', () => {
  assert.equal(
    buildInitializationCommand({ tool: 'codex', model: 'gpt-5.6-terra', reasoningEffort: 'medium', mode: 'build' }),
    'codex --strict-config --model "gpt-5.6-terra" --sandbox workspace-write -c model_reasoning_effort="medium"',
  );
});

test('builds an OpenCode Build command with agent and model', () => {
  assert.equal(
    buildInitializationCommand({ tool: 'opencode', model: 'openai/gpt-5', reasoningEffort: 'high', mode: 'build' }),
    'opencode --agent build --model "openai/gpt-5"',
  );
});

test('builds an OpenCode Plan command with agent and model', () => {
  assert.equal(
    buildInitializationCommand({ tool: 'opencode', model: 'openai/gpt-5', reasoningEffort: 'low', mode: 'plan' }),
    'opencode --agent plan --model "openai/gpt-5"',
  );
});

test('formats multiline prompts as a safe bracketed paste draft', () => {
  const esc = String.fromCharCode(27);
  const prompt = 'Plan this\n' + esc + '[31mred' + esc + '[0m\nend' + String.fromCharCode(1);
  assert.equal(sanitizeTerminalPrompt(prompt), 'Plan this\nred\nend');
  assert.equal(formatBracketedPaste(prompt), esc + '[200~Plan this\nred\nend' + esc + '[201~');
});

test('scanOutputMarkers prefers trust gates and spots composer output', () => {
  assert.equal(scanOutputMarkers('Microsoft Windows banner', CODEX_READY_PATTERNS, CODEX_TRUST_PATTERNS), null);
  assert.equal(scanOutputMarkers('Do you trust the contents of this directory?', CODEX_READY_PATTERNS, CODEX_TRUST_PATTERNS), 'blocked');
  assert.equal(scanOutputMarkers('Press enter to continue', CODEX_READY_PATTERNS, CODEX_TRUST_PATTERNS), 'blocked');
  assert.equal(scanOutputMarkers('esc to interrupt - type / for commands', CODEX_READY_PATTERNS, CODEX_TRUST_PATTERNS), 'ready');
  assert.equal(scanOutputMarkers('codex ' + '-'.repeat(10), CODEX_READY_PATTERNS, CODEX_TRUST_PATTERNS), null);
});

test('scanOutputMarkers strips ANSI styling before matching', () => {
  const esc = String.fromCharCode(27);
  const styled = `${esc}[1mDo you trust${esc}[0m this directory?`;
  assert.equal(scanOutputMarkers(styled, CODEX_READY_PATTERNS, CODEX_TRUST_PATTERNS), 'blocked');
});

test('looksLikeAgentPrompt flags prose prompts, not shell commands', () => {
  assert.equal(looksLikeAgentPrompt('npm run build'), false);
  assert.equal(looksLikeAgentPrompt('echo hello\ncd server\nnpm test'), false);
  const prompt = `## Task: Initialise django\nSecond line of context\n${'y'.repeat(2100)}`;
  assert.equal(looksLikeAgentPrompt(prompt), true);
});
