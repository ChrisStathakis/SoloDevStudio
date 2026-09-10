/** Local autosave-draft helpers for the sketch whiteboard (dependency-free). */

export function sketchDraftKey(id: string): string {
  return `solodev:sketch-draft:${id}`;
}

/** Remove the locally autosaved draft for an idea id (call when its sketch is deleted). */
export function clearSketchDraft(id?: string | null) {
  if (!id) return;
  try {
    localStorage.removeItem(sketchDraftKey(id));
  } catch { /* ignore */ }
}
