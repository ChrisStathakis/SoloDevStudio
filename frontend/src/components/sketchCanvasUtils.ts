import type { SketchObject, SketchObjectType } from '../types';
import { getStroke } from 'perfect-freehand';

export const GRID = 25;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** Axis-aligned bounding box of an object in world space. */
export function bbox(o: SketchObject): Box {
  if (o.type === 'path' || o.type === 'arrow' || o.type === 'line') {
    const pts = o.points && o.points.length >= 2 ? o.points : [];
    if (pts.length < 2) return { x: o.x, y: o.y, w: o.w, h: o.h };
    const xs = pts.filter((_, i) => i % 2 === 0);
    const ys = pts.filter((_, i) => i % 2 === 1);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
  }
  return { x: o.x, y: o.y, w: o.w, h: o.h };
}

export function unionBox(boxes: Box[]): Box | null {
  if (!boxes.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function pointInBox(b: Box, px: number, py: number, pad = 0): boolean {
  return px >= b.x - pad && px <= b.x + b.w + pad && py >= b.y - pad && py <= b.y + b.h + pad;
}

function segmentsIntersect(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number): boolean {
  const d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
  if (d === 0) return false;
  const t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d;
  const u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

/** Shortest distance between two segments. */
export function segSegDist(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  x4: number,
  y4: number,
): number {
  if (segmentsIntersect(x1, y1, x2, y2, x3, y3, x4, y4)) return 0;
  return Math.min(
    distToSegment(x3, y3, x1, y1, x2, y2),
    distToSegment(x4, y4, x1, y1, x2, y2),
    distToSegment(x1, y1, x3, y3, x4, y4),
    distToSegment(x2, y2, x3, y3, x4, y4),
  );
}

export function distToSegment(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - x0, py - y0);
  let t = ((px - x0) * dx + (py - y0) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
}

/** Hit test a single object (world coords, tolerance in world units). */
export function hitTest(o: SketchObject, px: number, py: number, tol: number): boolean {
  if (o.type === 'arrow' || o.type === 'line') {
    const p = o.points || [];
    return distToSegment(px, py, p[0], p[1], p[p.length - 2], p[p.length - 1]) <= tol;
  }
  if (o.type === 'path') {
    const p = o.points || [];
    const t = Math.max(tol, (o.strokeWidth || 3) / 2 + 4);
    for (let i = 2; i < p.length; i += 2) {
      if (distToSegment(px, py, p[i - 2], p[i - 1], p[i], p[i + 1]) <= t) return true;
    }
    return false;
  }
  if (o.type === 'sticky' || o.type === 'text') {
    return pointInBox(bbox(o), px, py);
  }
  const b = bbox(o);
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  if (o.type === 'ellipse') {
    const rx = b.w / 2;
    const ry = b.h / 2;
    if (rx === 0 || ry === 0) return pointInBox(b, px, py, tol);
    const norm = ((px - cx) / rx) ** 2 + ((py - cy) / ry) ** 2;
    const outer = (tol / Math.min(rx, ry)) ** 2;
    return norm <= 1 + outer;
  }
  if (o.type === 'diamond') {
    const d = Math.abs(px - cx) / (b.w / 2) + Math.abs(py - cy) / (b.h / 2);
    return d <= 1 + (tol * 2) / Math.min(b.w, b.h);
  }
  return pointInBox(b, px, py, tol);
}

/** Intersect a ray from box center toward (tx,ty) with the box perimeter. */
export function edgePoint(b: Box, tx: number, ty: number): { x: number; y: number } {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const hw = b.w / 2;
  const hh = b.h / 2;
  const scale = 1 / Math.max(Math.abs(dx) / (hw || 1), Math.abs(dy) / (hh || 1));
  return { x: cx + dx * scale, y: cy + dy * scale };
}

/**
 * Resolve arrow endpoints. Bound endpoints are projected onto the perimeter of
 * their bound shape (nearest point to the other endpoint), so they follow the
 * shape when it moves/resizes.
 */
export function resolveArrow(
  o: SketchObject,
  byId: Map<string, SketchObject>,
): { x0: number; y0: number; x1: number; y1: number } {
  const p = o.points || [o.x, o.y, o.x + o.w, o.y + o.h];
  let x0 = p[0];
  let y0 = p[1];
  let x1 = p[p.length - 2];
  let y1 = p[p.length - 1];
  const sb = o.startBinding?.objectId ? byId.get(o.startBinding.objectId) : null;
  const eb = o.endBinding?.objectId ? byId.get(o.endBinding.objectId) : null;
  if (sb) {
    const ep = edgePoint(bbox(sb), x1, y1);
    x0 = ep.x;
    y0 = ep.y;
  }
  if (eb) {
    const ep = edgePoint(bbox(eb), x0, y0);
    x1 = ep.x;
    y1 = ep.y;
  }
  return { x0, y0, x1, y1 };
}

export function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
) {
  const paragraphs = (text || '').split('\n');
  let cy = y;
  for (const para of paragraphs) {
    let line = '';
    for (const ch of para) {
      const test = line + ch;
      if (ctx.measureText(test).width > maxWidth && line) {
        ctx.fillText(line, x, cy);
        line = ch;
        cy += lineHeight;
      } else {
        line = test;
      }
    }
    ctx.fillText(line, x, cy);
    cy += lineHeight;
  }
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  if ((ctx as any).roundRect) {
    ctx.beginPath();
    (ctx as any).roundRect(x, y, w, h, rr);
  } else {
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }
}

export const STROKE_COLORS = [
  '#0f172a',
  '#4f46e5',
  '#7c3aed',
  '#e11d48',
  '#d97706',
  '#059669',
  '#0891b2',
  '#64748b',
  '#ffffff',
];

export const STICKY_COLORS = [
  '#fde68a',
  '#fbcfe8',
  '#bfdbfe',
  '#bbf7d0',
  '#ddd6fe',
  '#fed7aa',
  '#a7f3d0',
  '#fecaca',
];

export const STROKE_WIDTHS = [
  { label: 'Fine', size: 2 },
  { label: 'Medium', size: 5 },
  { label: 'Thick', size: 10 },
];

export const CANVAS_W = 800;
export const CANVAS_H = 500;

export function snap(v: number, grid: number): number {
  return Math.round(v / grid) * grid;
}

// ---- Perfect-Freehand (smooth pressure-sensitive strokes) ----
export function getSvgPathFromStroke(stroke: number[][]): string {
  if (!stroke.length) return '';
  const d = stroke.reduce(
    (acc: (string | number)[], [x0, y0]: number[], i: number, arr: number[][]) => {
      const [x1, y1] = arr[(i + 1) % arr.length];
      acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
      return acc;
    },
    ['M', stroke[0][0], stroke[0][1], 'Q'] as (string | number)[],
  );
  d.push('Z');
  return d.join(' ');
}

/** Returns an SVG path string for a freehand stroke built from flat [x,y,...] points. */
export function freehandPath(points: number[], size: number): string {
  const input: number[][] = [];
  for (let i = 0; i < points.length; i += 2) input.push([points[i], points[i + 1]]);
  const stroke = getStroke(input, {
    size,
    thinning: 0.6,
    smoothing: 0.5,
    streamline: 0.5,
    simulatePressure: true,
    last: true,
  });
  return getSvgPathFromStroke(stroke);
}

// ---- Alignment guides (edge + center snapping) ----
export interface SnapResult {
  box: Box;
  vertical: number[];
  horizontal: number[];
}

export function snapBox(box: Box, others: Box[], thresh: number): SnapResult {
  const xsCandidates: number[] = [];
  const ysCandidates: number[] = [];
  for (const b of others) {
    xsCandidates.push(b.x, b.x + b.w / 2, b.x + b.w);
    ysCandidates.push(b.y, b.y + b.h / 2, b.y + b.h);
  }
  const myX = [box.x, box.x + box.w / 2, box.x + box.w];
  const myY = [box.y, box.y + box.h / 2, box.y + box.h];

  let dxBest = 0;
  let dyBest = 0;
  let bestX = thresh + 1;
  let bestY = thresh + 1;
  let gx: number | null = null;
  let gy: number | null = null;

  for (const mx of myX) {
    for (const cx of xsCandidates) {
      const d = Math.abs(mx - cx);
      if (d <= thresh && d < bestX) {
        bestX = d;
        dxBest = cx - mx;
        gx = cx;
      }
    }
  }
  for (const my of myY) {
    for (const cy of ysCandidates) {
      const d = Math.abs(my - cy);
      if (d <= thresh && d < bestY) {
        bestY = d;
        dyBest = cy - my;
        gy = cy;
      }
    }
  }

  return {
    box: { x: box.x + dxBest, y: box.y + dyBest, w: box.w, h: box.h },
    vertical: gx != null ? [gx] : [],
    horizontal: gy != null ? [gy] : [],
  };
}
