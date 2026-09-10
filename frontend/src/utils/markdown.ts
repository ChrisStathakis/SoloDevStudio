import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({ gfm: true, breaks: true });

export function renderMarkdownSafe(markdown: string): string {
  const raw = String(marked.parse(markdown || ''));
  return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
}
