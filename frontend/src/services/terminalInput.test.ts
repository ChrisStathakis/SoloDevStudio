import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BRACKETED_PASTE_END,
  BRACKETED_PASTE_START,
  isBracketedPaste,
  splitInputChunks,
} from './terminalInput.ts';

test('recognizes one complete bracketed paste and rejects partial/doubled framing', () => {
  const payload = 'line one\rline two 😀';
  const framed = BRACKETED_PASTE_START + payload + BRACKETED_PASTE_END;
  assert.equal(isBracketedPaste(framed), true);
  assert.equal(isBracketedPaste(BRACKETED_PASTE_START + payload), false);
  assert.equal(isBracketedPaste(framed + framed), false);
});

test('chunks large multiline Unicode input without splitting surrogate pairs', () => {
  const text = 'a'.repeat(7) + '😀' + '\rsecond line';
  const chunks = splitInputChunks(text, 8);
  assert.equal(chunks.join(''), text);
  for (const chunk of chunks) {
    assert.equal(/^[\uD800-\uDBFF]$/.test(chunk.at(-1) || ''), false);
    assert.equal(/[\uDC00-\uDFFF]$/.test(chunk[0] || ''), false);
  }
});

test('supports a paste larger than the transport chunk size', () => {
  const text = 'x'.repeat(20000);
  const chunks = splitInputChunks(text, 8192);
  assert.deepEqual(chunks.map(chunk => chunk.length), [8192, 8192, 3616]);
});
