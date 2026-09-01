import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildInitializationCommand,
  formatBracketedPaste,
  sanitizeTerminalPrompt,
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

test('builds an OpenCode interactive command without pretending to set a universal effort', () => {
  assert.equal(
    buildInitializationCommand({ tool: 'opencode', model: 'openai/gpt-5', reasoningEffort: 'high', mode: 'build' }),
    'opencode --model "openai/gpt-5"',
  );
});

test('formats multiline prompts as a safe bracketed paste draft', () => {
  const prompt = 'Plan this\n\u001b[31mred\u001b[0m\nend\u0001';
  assert.equal(sanitizeTerminalPrompt(prompt), 'Plan this\nred\nend');
  assert.equal(formatBracketedPaste(prompt), '\u001b[200~Plan this\nred\nend\u001b[201~');
});
