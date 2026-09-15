import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  buildImageMarkdown,
  extractImageFiles,
  insertSnippetAtCursor,
  processPastedImages,
} from '../services/imagePaste';

interface Options {
  getText: () => string;
  setText: (text: string) => void;
  altPrefix?: string;
}

/**
 * Paste-to-embed for markdown textareas: Ctrl+V with bitmaps on the
 * clipboard downscales them and inserts `![](data:…)` tags at the cursor.
 * Plain-text pastes are left to the browser default.
 */
export function useImagePaste({ getText, setText, altPrefix = 'pasted image' }: Options) {
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const textRef = useRef(getText);
  textRef.current = getText;
  const setRef = useRef(setText);
  setRef.current = setText;
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    },
    [],
  );

  const flash = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 4000);
  }, []);

  const handlePaste = useCallback(
    async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (extractImageFiles(e.clipboardData).length === 0) return;
      e.preventDefault();
      try {
        const images = await processPastedImages(e.clipboardData);
        if (!images.length) return;
        const area = areaRef.current;
        let cursor = area ? area.selectionStart ?? textRef.current().length : textRef.current().length;
        let text = textRef.current();
        images.forEach((image, index) => {
          const tag = buildImageMarkdown(image.dataUrl, `${altPrefix} ${new Date().toISOString().slice(0, 10)}-${index + 1}`);
          const result = insertSnippetAtCursor(text, cursor, cursor, tag);
          text = result.text;
          cursor = result.cursor;
        });
        setRef.current(text);
        window.setTimeout(() => {
          const el = areaRef.current;
          if (el) {
            el.focus();
            el.setSelectionRange(cursor, cursor);
          }
        }, 0);
        flash(images.length > 1 ? `${images.length} images embedded.` : 'Image embedded — save to keep it.');
      } catch (err: any) {
        flash(err?.message || 'Could not embed the pasted image.');
      }
    },
    [altPrefix, flash],
  );

  return { areaRef, handlePaste, pasteNotice: notice };
}
