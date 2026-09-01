import { authedFetch } from './api';

function filenameFromDisposition(disposition: string | null, fallback: string) {
  const match = disposition?.match(/filename="?([^";]+)"?/i);
  return match?.[1] || fallback;
}

export async function downloadPdf(path: string, fallbackFilename: string) {
  const response = await authedFetch(path, { method: 'GET' });
  if (!response.ok) {
    let message = 'Unable to export PDF.';
    try {
      const payload = await response.json();
      message = payload?.detail || payload?.error || message;
    } catch {
      // The error response may not be JSON.
    }
    throw new Error(message);
  }

  const blob = await response.blob();
  if (!blob.size) throw new Error('The generated PDF was empty.');

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filenameFromDisposition(response.headers.get('content-disposition'), fallbackFilename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
