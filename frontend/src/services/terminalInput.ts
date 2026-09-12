export const BRACKETED_PASTE_START = '\x1b[200~';
export const BRACKETED_PASTE_END = '\x1b[201~';

export function splitInputChunks(text: string, maxChars: number): string[] {
  if (maxChars < 1) throw new Error('maxChars must be positive.');
  const chunks: string[] = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + maxChars, text.length);
    if (end - start > 1 && end < text.length && /[\uDC00-\uDFFF]/.test(text[end])) end -= 1;
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

export function isBracketedPaste(data: string): boolean {
  if (!data.startsWith(BRACKETED_PASTE_START) || !data.endsWith(BRACKETED_PASTE_END)) return false;
  const payload = data.slice(BRACKETED_PASTE_START.length, -BRACKETED_PASTE_END.length);
  return !payload.includes(BRACKETED_PASTE_START) && !payload.includes(BRACKETED_PASTE_END);
}
