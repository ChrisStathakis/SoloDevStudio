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
    let xs = pts.filter((_, i) => i % 2 === 0);
    let ys = pts.filter((_, i) => i % 2 === 1);
    if ((o.type === 'arrow' || o.type === 'line') && o.route && o.route !== 'straight' && pts.length >= 4) {
      // Routed connectors bow outside the straight endpoints: pad so selection
      // boxes, marquees, and exports always contain the visible stroke.
      const r = routeConnector(o.route, pts[0], pts[1], pts[pts.length - 2], pts[pts.length - 1]);
      xs = r.pts.filter((_, i) => i % 2 === 0);
      ys = r.pts.filter((_, i) => i % 2 === 1);
    }
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
    if (p.length >= 4 && o.route && o.route !== 'straight') {
      const r = routeConnector(o.route, p[0], p[1], p[p.length - 2], p[p.length - 1]);
      const q = r.pts;
      for (let i = 2; i < q.length; i += 2) {
        if (distToSegment(px, py, q[i - 2], q[i - 1], q[i], q[i + 1]) <= tol) return true;
      }
      return false;
    }
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
    return pointInBox(bbox(o), px, py, tol * 0.5);
  }
  const b = bbox(o);
  // Hollow shapes are edge-selectable so objects underneath stay reachable
  if (!o.fill) {
    return distToShapeEdge(o.type, b, px, py) <= tol;
  }
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

/** Distance from a point to the true edge of a rect/ellipse/diamond shape. */
export function distToShapeEdge(type: SketchObjectType, b: Box, px: number, py: number): number {
  if (type === 'ellipse') {
    const rx = Math.max(0.001, b.w / 2);
    const ry = Math.max(0.001, b.h / 2);
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const norm = Math.sqrt(((px - cx) / rx) ** 2 + ((py - cy) / ry) ** 2);
    // Approximate world-space distance from the ellipse perimeter
    return Math.abs(norm - 1) * Math.min(rx, ry);
  }
  if (type === 'diamond') {
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const d = Math.abs(px - cx) / (b.w / 2 || 1) + Math.abs(py - cy) / (b.h / 2 || 1);
    return Math.abs(d - 1) * (Math.min(b.w, b.h) / 2);
  }
  // rect: distance to the box perimeter (0 when inside)
  const dx = Math.max(b.x - px, 0, px - (b.x + b.w));
  const dy = Math.max(b.y - py, 0, py - (b.y + b.h));
  if (dx === 0 && dy === 0) {
    // Inside: distance to nearest edge
    return Math.min(px - b.x, b.x + b.w - px, py - b.y, b.y + b.h - py);
  }
  return Math.hypot(dx, dy);
}

/** Intersect a ray from shape center toward (tx,ty) with the true shape edge. */
export function edgePoint(b: Box, tx: number, ty: number, type?: SketchObjectType): { x: number; y: number } {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  if (type === 'ellipse') {
    const rx = Math.max(0.001, b.w / 2);
    const ry = Math.max(0.001, b.h / 2);
    const t = 1 / Math.sqrt((dx / rx) ** 2 + (dy / ry) ** 2);
    return { x: cx + dx * t, y: cy + dy * t };
  }
  if (type === 'diamond') {
    const hw = Math.max(0.001, b.w / 2);
    const hh = Math.max(0.001, b.h / 2);
    const t = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
    return { x: cx + dx * t, y: cy + dy * t };
  }
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
    const ep = edgePoint(bbox(sb), x1, y1, sb.type);
    x0 = ep.x;
    y0 = ep.y;
  }
  if (eb) {
    const ep = edgePoint(bbox(eb), x0, y0, eb.type);
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
  let cy = y;
  for (const line of wrapLines(text, maxWidth, s => ctx.measureText(s).width)) {
    ctx.fillText(line, x, cy);
    cy += lineHeight;
  }
}

/** Word-agnostic line splitter shared by canvas rendering and SVG export. */
export function wrapLines(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const out: string[] = [];
  for (const para of (text || '').split('\n')) {
    let line = '';
    for (const ch of para) {
      const test = line + ch;
      if (measure(test) > maxWidth && line) {
        out.push(line);
        line = ch;
      } else {
        line = test;
      }
    }
    out.push(line);
  }
  return out;
}

let measureCtx: CanvasRenderingContext2D | null | undefined;
function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (measureCtx !== undefined) return measureCtx;
  try {
    measureCtx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
  } catch {
    measureCtx = null;
  }
  return measureCtx;
}

/** Wrap text for SVG export using the same metrics as a canvas font string. */
export function wrapLinesForSvg(text: string, maxWidth: number, font: string): string[] {
  const ctx = getMeasureCtx();
  if (!ctx) return (text || '').split('\n');
  ctx.font = font;
  return wrapLines(text, maxWidth, s => ctx.measureText(s).width);
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

// ---- Routed connectors (straight / curve / elbow) ----
export interface RoutedConnector {
  kind: 'line' | 'curve' | 'elbow';
  /** Polyline approximation of the visible stroke (flat coords). */
  pts: number[];
  /** Quadratic control point for curves (undefined otherwise). */
  control?: { x: number; y: number };
  startAngle: number;
  endAngle: number;
  label: { x: number; y: number };
}

/** Route a connector between endpoints. Pure geometry shared by canvas + SVG. */
export function routeConnector(
  route: 'straight' | 'curve' | 'elbow' | undefined,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  waypoints?: number[],
): RoutedConnector {
  if (route === 'curve') {
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const k = Math.min(len * 0.25, 120);
    const cx = mx + (-dy / len) * k;
    const cy = my + (dx / len) * k;
    // Sample the quadratic for hit-testing / bbox
    const pts: number[] = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const mt = 1 - t;
      pts.push(mt * mt * x0 + 2 * mt * t * cx + t * t * x1, mt * mt * y0 + 2 * mt * t * cy + t * t * y1);
    }
    return {
      kind: 'curve',
      pts,
      control: { x: cx, y: cy },
      startAngle: Math.atan2(cy - y0, cx - x0),
      endAngle: Math.atan2(y1 - cy, x1 - cx),
      label: { x: mt2(x0, cx, x1), y: mt2(y0, cy, y1) },
    };
  }
  if (route === 'elbow') {
    // Custom waypoints define the full corner path; default is horizontal-first
    const pts = waypoints && waypoints.length >= 2
      ? [x0, y0, ...waypoints, x1, y1]
      : [x0, y0, x1, y0, x1, y1];
    const n = pts.length;
    const startAngle = Math.atan2(pts[3] - pts[1], pts[2] - pts[0]);
    const endAngle = Math.atan2(pts[n - 1] - pts[n - 3], pts[n - 2] - pts[n - 4]);
    // Upper-middle vertex so labels sit on a corner, not an endpoint
    const mid = Math.floor(n / 4) * 2;
    return {
      kind: 'elbow',
      pts,
      startAngle,
      endAngle,
      label: { x: pts[mid], y: pts[mid + 1] },
    };
  }
  return {
    kind: 'line',
    pts: [x0, y0, x1, y1],
    startAngle: Math.atan2(y1 - y0, x1 - x0),
    endAngle: Math.atan2(y1 - y0, x1 - x0),
    label: { x: (x0 + x1) / 2, y: (y0 + y1) / 2 },
  };
}

function mt2(a: number, c: number, b: number): number {
  return 0.25 * a + 0.5 * c + 0.25 * b;
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
