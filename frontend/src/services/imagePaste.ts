/**
 * Shared clipboard-image helpers (paste screenshots/photos as inline images).
 *
 * Images are stored as data-URLs so no backend upload endpoint is needed:
 * markdown docs/notes embed them as `![](data:…)` (the DOMPurify HTML profile
 * allows data-image URIs and the PDF exporter already renders data URLs),
 * while the sketch canvas keeps them as `image` objects with a `src` field.
 */

export const IMAGE_MAX_DIMENSION = 1600;
export const IMAGE_JPEG_QUALITY = 0.85;
/** Max data-URL length (~1.9 MB of binary) to avoid bloating DB rows. */
export const IMAGE_MAX_DATA_URL_CHARS = 2_500_000;

export interface PastedImage {
  dataUrl: string;
  width: number;
  height: number;
  mimeType: string;
}

/** Scale dimensions to fit within `max` while preserving aspect ratio. Pure. */
export function computeDownscale(
  width: number,
  height: number,
  max = IMAGE_MAX_DIMENSION,
): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: 0, height: 0 };
  }
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** Rough binary size of a data-URL in bytes. Pure. */
export function estimateDataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  const payload = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  return Math.floor(payload.length * 0.75);
}

export function isDataUrlAllowed(dataUrl: string): boolean {
  return (
    typeof dataUrl === 'string' &&
    dataUrl.startsWith('data:image/') &&
    dataUrl.length <= IMAGE_MAX_DATA_URL_CHARS
  );
}

/** Markdown image tag for an inline data-URL. Pure. */
export function buildImageMarkdown(dataUrl: string, alt = 'pasted image'): string {
  const safeAlt = alt.replace(/[\[\]]/g, '');
  return `![${safeAlt}](${dataUrl})`;
}

export interface InsertResult {
  text: string;
  cursor: number;
}

/** Insert `snippet` at a textarea selection, keeping blank lines around it. Pure. */
export function insertSnippetAtCursor(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  snippet: string,
): InsertResult {
  const safeText = text ?? '';
  const start = Math.max(0, Math.min(selectionStart ?? safeText.length, safeText.length));
  const end = Math.max(start, Math.min(selectionEnd ?? start, safeText.length));
  const before = safeText.slice(0, start);
  const after = safeText.slice(end);
  const needsLeadingBreak = before.length > 0 && !before.endsWith('\n');
  const needsTrailingBreak = after.length > 0 && !after.startsWith('\n');
  const block = `${needsLeadingBreak ? '\n\n' : ''}${snippet}${needsTrailingBreak ? '\n\n' : ''}`;
  const next = `${before}${block}${after}`;
  return { text: next, cursor: (before + block).length };
}

/** Image files on a paste/drop DataTransfer. Thin DOM wrapper. */
export function extractImageFiles(data: DataTransfer | null | undefined): File[] {
  if (!data) return [];
  const out: File[] = [];
  if (data.files) {
    for (const file of Array.from(data.files)) {
      if (file.type.startsWith('image/')) out.push(file);
    }
  }
  if (out.length === 0 && data.items) {
    for (const item of Array.from(data.items)) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) out.push(file);
      }
    }
  }
  return out;
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode the pasted image.'));
    img.src = src;
  });
}

/**
 * Downscale an image file to a data-URL (JPEG unless it has transparency,
 * detected via a cheap alpha scan — keeps screenshots small, logos crisp).
 */
export async function fileToDownscaledDataUrl(file: File): Promise<PastedImage> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImageElement(objectUrl);
    const { width, height } = computeDownscale(img.naturalWidth || img.width, img.naturalHeight || img.height);
    if (!width || !height) throw new Error('Could not decode the pasted image.');
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not process the pasted image.');
    ctx.drawImage(img, 0, 0, width, height);
    let mimeType = 'image/jpeg';
    try {
      const pixels = ctx.getImageData(0, 0, width, height).data;
      for (let i = 3; i < pixels.length; i += 16) {
        if (pixels[i] < 255) {
          mimeType = 'image/png';
          break;
        }
      }
    } catch {
      mimeType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    }
    const dataUrl =
      mimeType === 'image/png' ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', IMAGE_JPEG_QUALITY);
    if (!isDataUrlAllowed(dataUrl)) {
      throw new Error('That image is too large to embed (limit ~2 MB). Try a smaller screenshot.');
    }
    return { dataUrl, width, height, mimeType };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** Full pipeline for a paste event: files → downscaled embeddable images. */
export async function processPastedImages(data: DataTransfer | null | undefined): Promise<PastedImage[]> {
  const files = extractImageFiles(data);
  const out: PastedImage[] = [];
  for (const file of files.slice(0, 4)) {
    out.push(await fileToDownscaledDataUrl(file));
  }
  return out;
}
