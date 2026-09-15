import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildImageMarkdown,
  computeDownscale,
  estimateDataUrlBytes,
  IMAGE_MAX_DATA_URL_CHARS,
  insertSnippetAtCursor,
  isDataUrlAllowed,
} from './imagePaste.ts';

test('downscales large images preserving aspect ratio', () => {
  assert.deepEqual(computeDownscale(3200, 2000), { width: 1600, height: 1000 });
  assert.deepEqual(computeDownscale(1000, 2000), { width: 800, height: 1600 });
});

test('leaves small images untouched', () => {
  assert.deepEqual(computeDownscale(800, 600), { width: 800, height: 600 });
});

test('rejects degenerate dimensions', () => {
  assert.deepEqual(computeDownscale(0, 600), { width: 0, height: 0 });
  assert.deepEqual(computeDownscale(-5, 100), { width: 0, height: 0 });
});

test('estimates data-url binary size', () => {
  // 4 base64 chars ~= 3 bytes.
  assert.equal(estimateDataUrlBytes('data:image/png;base64,' + 'AAAA'.repeat(100)), 300);
});

test('allows only reasonably sized image data-urls', () => {
  assert.equal(isDataUrlAllowed('data:image/png;base64,AAAA'), true);
  assert.equal(isDataUrlAllowed('https://example.com/x.png'), false);
  assert.equal(isDataUrlAllowed('data:image/png;base64,' + 'A'.repeat(IMAGE_MAX_DATA_URL_CHARS)), false);
});

test('builds markdown image tags with a safe alt', () => {
  assert.equal(
    buildImageMarkdown('data:image/png;base64,AAA', 'screen[1]'),
    '![screen1](data:image/png;base64,AAA)',
  );
});

test('inserts snippets with blank lines around them', () => {
  const res = insertSnippetAtCursor('hello world', 5, 5, '![a](b)');
  assert.equal(res.text, 'hello\n\n![a](b)\n\n world');
  assert.equal(res.cursor, 'hello\n\n![a](b)\n\n'.length);
});

test('inserts at document edges without extra breaks', () => {
  const start = insertSnippetAtCursor('tail', 0, 0, '![a](b)');
  assert.equal(start.text, '![a](b)\n\ntail');
  const end = insertSnippetAtCursor('head', 4, 4, '![a](b)');
  assert.equal(end.text, 'head\n\n![a](b)');
});

test('replaces a selection', () => {
  const res = insertSnippetAtCursor('abcdef', 2, 4, 'X');
  assert.equal(res.text, 'ab\n\nX\n\nef');
});
