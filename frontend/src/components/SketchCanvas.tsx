import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  MousePointer,
  StickyNote,
  Square,
  Circle,
  Diamond,
  Type,
  Pencil,
  Minus,
  ArrowRight,
  Eraser,
  Hand,
  FileCode,
  RotateCcw,
  RotateCw,
  Trash2,
  Download,
  Check,
  X,
  Maximize2,
  Minimize2,
  Copy,
  BringToFront,
  SendToBack,
  Grid3x3,
  Plus,
  Minus as ZoomOut,
  LayoutTemplate,
  ClipboardCopy,
  FileJson,
  Upload,
} from 'lucide-react';
import type { SketchObject, SketchObjectType } from '../types';
import { clearSketchDraft } from './sketchDraft';
import { extractImageFiles, fileToDownscaledDataUrl } from '../services/imagePaste';
import {
  bbox,
  unionBox,
  pointInBox,
  segSegDist,
  distToSegment,
  hitTest,
  resolveArrow,
  routeConnector,
  wrapText,
  wrapLinesForSvg,
  roundRect,
  freehandPath,
  snapBox,
  STROKE_COLORS,
  STICKY_COLORS,
  STROKE_WIDTHS,
  CANVAS_W,
  CANVAS_H,
  GRID,
  snap,
  uid,
  Box,
} from './sketchCanvasUtils';

type Tool = SketchObjectType | 'select' | 'eraser' | 'pan';
type HandleDir = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

interface SketchCanvasProps {
  initialDataUrl?: string;
  initialObjects?: SketchObject[];
  seed?: {
    title: string;
    tagline?: string;
    problem?: string;
    solution?: string;
    techStack?: string[];
  };
  id?: string;
  onSave: (dataUrl: string, objects: SketchObject[]) => void | Promise<void>;
  onClose?: () => void;
}

interface Camera {
  x: number; // logical px offset
  y: number;
  z: number; // zoom
}

const HISTORY_LIMIT = 100;

function handlePoints(b: Box): { x: number; y: number; dir: HandleDir }[] {
  return [
    { x: b.x, y: b.y, dir: 'nw' },
    { x: b.x + b.w / 2, y: b.y, dir: 'n' },
    { x: b.x + b.w, y: b.y, dir: 'ne' },
    { x: b.x + b.w, y: b.y + b.h / 2, dir: 'e' },
    { x: b.x + b.w, y: b.y + b.h, dir: 'se' },
    { x: b.x + b.w / 2, y: b.y + b.h, dir: 's' },
    { x: b.x, y: b.y + b.h, dir: 'sw' },
    { x: b.x, y: b.y + b.h / 2, dir: 'w' },
  ];
}

function buildSeed(seed: NonNullable<SketchCanvasProps['seed']>): SketchObject[] {
  const items: { label: string; body: string }[] = [
    { label: 'Title', body: seed.title || '' },
    { label: 'Tagline', body: seed.tagline || '' },
    { label: 'Problem', body: seed.problem || '' },
    { label: 'Solution', body: seed.solution || '' },
    {
      label: 'Tech Stack',
      body: (seed.techStack && seed.techStack.length ? seed.techStack : []).map(t => `• ${t}`).join('\n'),
    },
  ];
  const positions = [
    { x: 30, y: 30 },
    { x: 290, y: 30 },
    { x: 550, y: 30 },
    { x: 30, y: 190 },
    { x: 290, y: 190 },
  ];
  return items.map((it, i) => ({
    id: uid(),
    type: 'sticky' as SketchObjectType,
    x: positions[i].x,
    y: positions[i].y,
    w: 200,
    h: 140,
    color: STICKY_COLORS[i % STICKY_COLORS.length],
    text: `${it.label}\n${it.body}`,
  }));
}

/** Scale/translate an object's geometry from an old box to a new box. */
function transformBox(o: SketchObject, ob: Box, nb: Box): SketchObject {
  const sx = nb.w / (ob.w || 1);
  const sy = nb.h / (ob.h || 1);
  const avg = (sx + sy) / 2;
  const mapX = (v: number) => nb.x + (v - ob.x) * sx;
  const mapY = (v: number) => nb.y + (v - ob.y) * sy;
  const scaledStroke = o.strokeWidth !== undefined ? Math.max(1, Math.round(o.strokeWidth * avg)) : undefined;
  if (o.type === 'path' || o.type === 'arrow' || o.type === 'line') {
    const np = (o.points || []).map((v, i) => (i % 2 === 0 ? mapX(v) : mapY(v)));
    const nw = o.waypoints?.map((v, i) => (i % 2 === 0 ? mapX(v) : mapY(v)));
    return { ...o, points: np, waypoints: nw ?? o.waypoints, strokeWidth: scaledStroke ?? o.strokeWidth };
  }
  const next: SketchObject = { ...o, x: mapX(o.x), y: mapY(o.y), w: o.w * sx, h: o.h * sy };
  if (scaledStroke !== undefined) next.strokeWidth = scaledStroke;
  if ((o.type === 'sticky' || o.type === 'text') && o.fontSize) {
    next.fontSize = Math.max(8, Math.round(o.fontSize * sy));
  }
  return next;
}

function newBoxFromHandle(orig: Box, dir: HandleDir, wx: number, wy: number): { box: Box; flipX: boolean; flipY: boolean } {
  let { x, y, w, h } = orig;
  let x2 = x + w;
  let y2 = y + h;
  if (dir.includes('w')) x = wx;
  if (dir.includes('e')) x2 = wx;
  if (dir.includes('n')) y = wy;
  if (dir.includes('s')) y2 = wy;
  const flipX = x2 < x;
  const flipY = y2 < y;
  const nx = Math.min(x, x2);
  const ny = Math.min(y, y2);
  const nw = Math.max(20, Math.abs(x2 - x));
  const nh = Math.max(20, Math.abs(y2 - y));
  return { box: { x: nx, y: ny, w: nw, h: nh }, flipX, flipY };
}

function flipHandle(dir: HandleDir, flipX: boolean, flipY: boolean): HandleDir {
  let d = dir;
  if (flipX) d = (d.replace('e', '!').replace('w', 'e').replace('!', 'w')) as HandleDir;
  if (flipY) d = (d.replace('n', '!').replace('s', 'n').replace('!', 's')) as HandleDir;
  return d;
}

function segmentHitsBox(b: Box, x0: number, y0: number, x1: number, y1: number, tol: number): boolean {
  if (pointInBox(b, x0, y0, tol) || pointInBox(b, x1, y1, tol)) return true;
  // Test the eraser segment against each box edge so straight-through
  // strokes across large shapes are caught (corner distance alone misses).
  const corners: [number, number][] = [
    [b.x, b.y],
    [b.x + b.w, b.y],
    [b.x + b.w, b.y + b.h],
    [b.x, b.y + b.h],
  ];
  for (let i = 0; i < 4; i++) {
    const [cx, cy] = corners[i];
    const [nx, ny] = corners[(i + 1) % 4];
    if (segSegDist(cx, cy, nx, ny, x0, y0, x1, y1) <= tol) return true;
  }
  return false;
}

/** Remove the locally autosaved draft for an idea id (call when its sketch is deleted). */
export { clearSketchDraft } from './sketchDraft';

export const SketchCanvas: React.FC<SketchCanvasProps> = ({
  initialDataUrl,
  initialObjects,
  seed,
  id,
  onSave,
  onClose,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [objects, setObjectsState] = useState<SketchObject[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeTool, setActiveToolState] = useState<Tool>('select');
  const [selectedColor, setSelectedColor] = useState<string>('#4f46e5');
  const [stickyColor, setStickyColor] = useState<string>(STICKY_COLORS[0]);
  const [strokeWidth, setStrokeWidth] = useState<number>(3);
  const [eraserSize, setEraserSize] = useState<number>(10);
  const [fillShape, setFillShape] = useState<boolean>(false);
  const [dashShape, setDashShape] = useState<boolean>(false);
  const [legacyImg, setLegacyImg] = useState<HTMLImageElement | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState<string>('');
  const [gridSnap, setGridSnap] = useState<boolean>(true);
  const [cam, setCamState] = useState<Camera>({ x: 0, y: 0, z: 1 });
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [canvasScale, setCanvasScale] = useState<number>(1);
  const [showTemplates, setShowTemplates] = useState<boolean>(false);
  const [copiedImg, setCopiedImg] = useState<boolean>(false);
  const [armClear, setArmClear] = useState<boolean>(false);

  const objectsRef = useRef<SketchObject[]>([]);
  const camRef = useRef<Camera>({ x: 0, y: 0, z: 1 });
  const historyRef = useRef<SketchObject[][]>([]);
  const histIndexRef = useRef<number>(-1);
  const clipboardRef = useRef<SketchObject[]>([]);
  const spaceRef = useRef<boolean>(false);
  const erasePreviewRef = useRef<Set<string>>(new Set());
  const marqueeRef = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const guidesRef = useRef<{ vertical: number[]; horizontal: number[] }>({ vertical: [], horizontal: [] });
  const firstRenderRef = useRef<boolean>(true);

  const dragRef = useRef<{
    mode: 'drag' | 'resize' | 'draw' | 'drawpath' | 'pan' | 'marquee' | 'erase' | 'pinch' | 'waypoint';
    handle?: HandleDir;
    startX?: number;
    startY?: number;
    orig?: SketchObject;
    origBox?: Box;
    id?: string;
    index?: number;
    lastX?: number;
    lastY?: number;
    pinchDist?: number;
    pinchMid?: { x: number; y: number };
    origObjects?: SketchObject[];
  } | null>(null);

  const setObjects = useCallback((updater: SketchObject[] | ((p: SketchObject[]) => SketchObject[])) => {
    // Read from the ref (maintained synchronously below) instead of a setState
    // updater function, so the update stays pure and StrictMode-safe.
    const next = typeof updater === 'function' ? (updater as (p: SketchObject[]) => SketchObject[])(objectsRef.current) : updater;
    objectsRef.current = next;
    setObjectsState(next);
  }, []);

  const setCam = useCallback((updater: Camera | ((p: Camera) => Camera)) => {
    const next = typeof updater === 'function' ? (updater as (p: Camera) => Camera)(camRef.current) : updater;
    camRef.current = next;
    setCamState(next);
  }, []);

  const clone = (items: SketchObject[]): SketchObject[] =>
    JSON.parse(JSON.stringify(items)) as SketchObject[];

  // Mirrors history position for rendering (buttons read this, not refs).
  const [histState, setHistState] = useState({ index: 0, length: 1 });
  const syncHistState = useCallback(() => {
    setHistState({ index: histIndexRef.current, length: historyRef.current.length });
  }, []);

  const pushHistory = useCallback((snap?: SketchObject[]) => {
    const s = clone(snap ?? objectsRef.current);
    const cur = historyRef.current.slice(0, histIndexRef.current + 1);
    cur.push(s);
    if (cur.length > HISTORY_LIMIT) cur.shift();
    historyRef.current = cur;
    histIndexRef.current = cur.length - 1;
    setHistState({ index: histIndexRef.current, length: cur.length });
  }, []);

  const commit = useCallback(
    (next: SketchObject[], record = true) => {
      setObjects(next);
      if (record) pushHistory(next);
    },
    [setObjects, pushHistory],
  );

  const setActiveTool = (t: Tool) => {
    // Never strand the text editor open under another tool: commit first
    if (editingId) commitEditing();
    setActiveToolState(t);
    if (t !== 'select' && t !== 'pan') setSelectedIds([]);
  };

  // Draft metadata shown in the "draft restored" banner (null = no draft in play)
  const [draftInfo, setDraftInfo] = useState<{ savedAt: number } | null>(null);

  // Shared init path: draft > explicit objects (even empty) > legacy image (empty board) > seed.
  // `initialObjects === undefined` means "never sketched" (seed allowed);
  // an explicit empty array means "intentionally cleared" (stays empty).
  const initializeFromProps = useCallback((useDraft: boolean) => {
    let initial: SketchObject[] = [];
    let draftCam: Camera | null = null;
    let restoredDraft = false;
    if (useDraft && id) {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(`solodev:sketch-draft:${id}`) : null;
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed.objects && parsed.objects.length) {
            initial = parsed.objects;
            if (parsed.cam) draftCam = parsed.cam;
            restoredDraft = true;
            setDraftInfo({ savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : Date.now() });
          }
        } catch {
          /* ignore corrupt draft */
        }
      }
    }
    if (!restoredDraft) {
      setDraftInfo(null);
      if (initialObjects !== undefined) {
        initial = clone(initialObjects);
      } else if (!initialDataUrl && seed) {
        initial = buildSeed(seed);
      }
    }
    if (draftCam) setCam(draftCam);
    if (initialDataUrl) {
      const img = new Image();
      img.onload = () => setLegacyImg(img);
      img.src = initialDataUrl;
    } else {
      setLegacyImg(null);
    }
    setObjects(initial);
    setSelectedIds([]);
    setEditingId(null);
    historyRef.current = [clone(initial)];
    histIndexRef.current = 0;
    syncHistState();
  }, [id, initialObjects, initialDataUrl, seed, setObjects, setCam, syncHistState]);

  // Initialize
  useEffect(() => {
    initializeFromProps(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const discardDraft = useCallback(() => {
    try {
      if (id) localStorage.removeItem(`solodev:sketch-draft:${id}`);
    } catch { /* ignore */ }
    initializeFromProps(false);
  }, [id, initializeFromProps]);

  // Autosave draft (debounced) keyed by idea id
  useEffect(() => {
    if (!id) return;
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      return;
    }
    const t = setTimeout(() => {
      try {
        localStorage.setItem(
          `solodev:sketch-draft:${id}`,
          JSON.stringify({ objects: objectsRef.current, cam: camRef.current, savedAt: Date.now() }),
        );
      } catch {
        /* ignore quota errors */
      }
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objects, cam]);

  const dpr = typeof window !== 'undefined' ? Math.min(2, Math.max(1, window.devicePixelRatio || 1)) : 1;

  // Keep the logical 800×500 drawing space stable while scaling its display to
  // the available editor area (especially when the in-app fullscreen mode is on).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const updateScale = () => {
      const width = Math.max(1, container.clientWidth - 32);
      const height = Math.max(1, container.clientHeight - 32);
      const next = Math.min(width / CANVAS_W, height / CANVAS_H);
      setCanvasScale(Number.isFinite(next) ? Math.max(0.2, next) : 1);
    };
    const observer = new ResizeObserver(updateScale);
    observer.observe(container);
    updateScale();
    return () => observer.disconnect();
  }, [isFullscreen]);

  useEffect(() => {
    if (!isFullscreen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isFullscreen]);

  // Core scene renderer (shared by screen + export)
  const renderScene = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      opts: {
        offset: { x: number; y: number };
        zoom: number;
        background: boolean;
        showGrid: boolean;
        showSelection: boolean;
        erasePreview?: Set<string> | null;
        marquee?: { x0: number; y0: number; x1: number; y1: number } | null;
        guides?: { vertical: number[]; horizontal: number[] };
      },
    ) => {
      const { offset, zoom, background, showGrid, showSelection, erasePreview, marquee, guides } = opts;
      const renderScale = dpr * canvasScale;
      ctx.setTransform(zoom * renderScale, 0, 0, zoom * renderScale, offset.x * renderScale, offset.y * renderScale);

      if (background) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(-offset.x / zoom - 1, -offset.y / zoom - 1, CANVAS_W / zoom + 2, CANVAS_H / zoom + 2);
      } else {
        ctx.clearRect(-offset.x / zoom - 1, -offset.y / zoom - 1, CANVAS_W / zoom + 2, CANVAS_H / zoom + 2);
      }

      if (legacyImg) {
        ctx.drawImage(legacyImg, 0, 0, CANVAS_W, CANVAS_H);
      }

      // Board boundary (the world extends beyond it: grid + content render anywhere)
      ctx.save();
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 1.5 / zoom;
      ctx.setLineDash([10 / zoom, 8 / zoom]);
      ctx.strokeRect(0, 0, CANVAS_W, CANVAS_H);
      ctx.setLineDash([]);
      ctx.restore();

      if (showGrid) {
        ctx.fillStyle = '#e2e8f0';
        const vx0 = -offset.x / zoom;
        const vy0 = -offset.y / zoom;
        const vx1 = vx0 + CANVAS_W / zoom;
        const vy1 = vy0 + CANVAS_H / zoom;
        const x0 = Math.floor(vx0 / GRID) * GRID;
        const y0 = Math.floor(vy0 / GRID) * GRID;
        for (let gx = x0; gx <= vx1; gx += GRID) {
          for (let gy = y0; gy <= vy1; gy += GRID) {
            ctx.beginPath();
            ctx.arc(gx, gy, 1.2 / zoom, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      const byId = new Map<string, SketchObject>(objectsRef.current.map((o): [string, SketchObject] => [o.id, o]));

      for (const o of objectsRef.current) {
        ctx.save();
        if (erasePreview && erasePreview.has(o.id)) ctx.globalAlpha = 0.25;
        drawObject(ctx, o, byId);
        ctx.restore();
      }

      if (showSelection && selectedIds.length) {
        const sel = objectsRef.current.filter(o => selectedIds.includes(o.id));
        if (sel.length) {
          const ub = unionBox(sel.map(bbox))!;
          const allLocked = sel.every(o => o.locked);
          ctx.save();
          ctx.strokeStyle = allLocked ? '#94a3b8' : '#4f46e5';
          ctx.lineWidth = 1.5 / zoom;
          ctx.setLineDash([6 / zoom, 4 / zoom]);
          ctx.strokeRect(ub.x - 3 / zoom, ub.y - 3 / zoom, ub.w + 6 / zoom, ub.h + 6 / zoom);
          ctx.setLineDash([]);
          if (allLocked) {
            // Padlock badge at the top-left of the selection
            const s = 11 / zoom;
            const bx = ub.x - 3 / zoom;
            const by = ub.y - 3 / zoom - s * 2.1;
            ctx.fillStyle = '#64748b';
            ctx.fillRect(bx, by + s * 0.8, s * 2, s * 1.3);
            ctx.beginPath();
            ctx.arc(bx + s, by + s * 0.8, s * 0.55, Math.PI, 0);
            ctx.lineWidth = 2.5 / zoom;
            ctx.strokeStyle = '#64748b';
            ctx.stroke();
          }
          const hs = 5 / zoom;
          for (const hp of handlePoints(ub)) {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(hp.x - hs, hp.y - hs, hs * 2, hs * 2);
            ctx.strokeRect(hp.x - hs, hp.y - hs, hs * 2, hs * 2);
          }
          // Elbow waypoint handles for a singly-selected connector
          if (sel.length === 1 && (sel[0].type === 'arrow' || sel[0].type === 'line') && sel[0].waypoints?.length) {
            const wr = 5 / zoom;
            ctx.fillStyle = '#4f46e5';
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.5 / zoom;
            for (let i = 0; i < sel[0].waypoints.length; i += 2) {
              ctx.beginPath();
              ctx.arc(sel[0].waypoints[i], sel[0].waypoints[i + 1], wr, 0, Math.PI * 2);
              ctx.fill();
              ctx.stroke();
            }
          }
          ctx.restore();
        }
      }

      if (marquee) {
        const x = Math.min(marquee.x0, marquee.x1);
        const y = Math.min(marquee.y0, marquee.y1);
        const w = Math.abs(marquee.x1 - marquee.x0);
        const h = Math.abs(marquee.y1 - marquee.y0);
        ctx.save();
        ctx.fillStyle = 'rgba(79,70,229,0.12)';
        ctx.strokeStyle = '#4f46e5';
        ctx.lineWidth = 1 / zoom;
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);
        ctx.restore();
      }

      if (guides && (guides.vertical.length || guides.horizontal.length)) {
        const viewW = CANVAS_W / zoom;
        const viewH = CANVAS_H / zoom;
        ctx.save();
        ctx.strokeStyle = '#ec4899';
        ctx.lineWidth = 1 / zoom;
        ctx.setLineDash([4 / zoom, 3 / zoom]);
        for (const gx of guides.vertical) {
          ctx.beginPath();
          ctx.moveTo(gx, -offset.y / zoom);
          ctx.lineTo(gx, -offset.y / zoom + viewH);
          ctx.stroke();
        }
        for (const gy of guides.horizontal) {
          ctx.beginPath();
          ctx.moveTo(-offset.x / zoom, gy);
          ctx.lineTo(-offset.x / zoom + viewW, gy);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.restore();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [legacyImg, selectedIds, dpr, canvasScale],
  );

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = CANVAS_W * dpr * canvasScale;
    canvas.height = CANVAS_H * dpr * canvasScale;
    canvas.style.width = `${CANVAS_W * canvasScale}px`;
    canvas.style.height = `${CANVAS_H * canvasScale}px`;
    renderScene(ctx, {
      offset: { x: camRef.current.x, y: camRef.current.y },
      zoom: camRef.current.z,
      background: true,
      showGrid: gridSnap,
      showSelection: true,
      erasePreview: erasePreviewRef.current,
      marquee: marqueeRef.current,
      guides: guidesRef.current,
    });
  }, [renderScene, dpr, gridSnap, canvasScale]);

  useEffect(() => {
    draw();
  }, [draw, cam, objects, selectedIds, legacyImg, editingId]);

  // Coalesce per-pointermove repaints into one frame (move handlers are hot)
  const rafRef = useRef<number>(0);
  const requestDraw = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      draw();
    });
  }, [draw]);
  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);

  // Repaint once pasted images finish decoding (drawObject draws a
  // placeholder until the bitmap is ready).
  useEffect(() => {
    registerSketchImageNotify(() => requestDraw());
    return () => registerSketchImageNotify(null);
  }, [requestDraw]);

  // ---------- minimap (board + content overview, click/drag to navigate) ----------
  const miniRef = useRef<HTMLCanvasElement | null>(null);
  const miniDragRef = useRef<boolean>(false);
  const MINI_W = 168;
  const MINI_H = 104;

  const miniTransform = () => {
    const boxes = [{ x: 0, y: 0, w: CANVAS_W, h: CANVAS_H }, ...objectsRef.current.map(bbox)];
    const ub = unionBox(boxes) || { x: 0, y: 0, w: CANVAS_W, h: CANVAS_H };
    const pad = 40;
    const ex = ub.x - pad;
    const ey = ub.y - pad;
    const ew = Math.max(1, ub.w + pad * 2);
    const eh = Math.max(1, ub.h + pad * 2);
    const s = Math.min(MINI_W / ew, MINI_H / eh);
    return { s, ox: (MINI_W - ew * s) / 2 - ex * s, oy: (MINI_H - eh * s) / 2 - ey * s };
  };

  useEffect(() => {
    const mc = miniRef.current;
    if (!mc) return;
    const mctx = mc.getContext('2d');
    if (!mctx) return;
    const d = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
    mc.width = MINI_W * d;
    mc.height = MINI_H * d;
    mctx.setTransform(d, 0, 0, d, 0, 0);
    mctx.clearRect(0, 0, MINI_W, MINI_H);
    const { s, ox, oy } = miniTransform();
    for (const o of objectsRef.current) {
      const b = bbox(o);
      mctx.fillStyle = o.color;
      mctx.fillRect(b.x * s + ox, b.y * s + oy, Math.max(2, b.w * s), Math.max(2, b.h * s));
    }
    mctx.strokeStyle = '#475569';
    mctx.lineWidth = 1;
    mctx.strokeRect(ox, oy, CANVAS_W * s, CANVAS_H * s);
    // Viewport rect
    const z = camRef.current.z;
    const vx = -camRef.current.x / z;
    const vy = -camRef.current.y / z;
    mctx.strokeStyle = '#818cf8';
    mctx.lineWidth = 1.5;
    mctx.strokeRect(vx * s + ox, vy * s + oy, (CANVAS_W / z) * s, (CANVAS_H / z) * s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objects, cam]);

  const miniGoto = (clientX: number, clientY: number) => {
    const mc = miniRef.current;
    if (!mc) return;
    const r = mc.getBoundingClientRect();
    const { s, ox, oy } = miniTransform();
    const wx = ((clientX - r.left) * (MINI_W / r.width) - ox) / s;
    const wy = ((clientY - r.top) * (MINI_H / r.height) - oy) / s;
    const z = camRef.current.z;
    setCam({ x: CANVAS_W / 2 - wx * z, y: CANVAS_H / 2 - wy * z, z });
  };

  // Native non-passive wheel for zoom/pan
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const scale = rect.width / CANVAS_W;
      const logicalX = (e.clientX - rect.left) / scale;
      const logicalY = (e.clientY - rect.top) / scale;
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * 0.0015);
        const nz = Math.min(5, Math.max(0.2, camRef.current.z * factor));
        const worldX = (logicalX - camRef.current.x) / camRef.current.z;
        const worldY = (logicalY - camRef.current.y) / camRef.current.z;
        setCam({ x: logicalX - worldX * nz, y: logicalY - worldY * nz, z: nz });
      } else {
        // Wheel delta is in screen px; convert to logical canvas px
        setCam(c => ({ ...c, x: c.x - e.deltaX / scale, y: c.y - e.deltaY / scale }));
      }
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getCoords = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scale = rect.width / CANVAS_W;
    const lx = (e.clientX - rect.left) / scale;
    const ly = (e.clientY - rect.top) / scale;
    return { x: (lx - camRef.current.x) / camRef.current.z, y: (ly - camRef.current.y) / camRef.current.z };
  };

  const tol = () => 6 / camRef.current.z;

  const topHit = (wx: number, wy: number): SketchObject | null => {
    const t = tol();
    for (let i = objectsRef.current.length - 1; i >= 0; i--) {
      const o = objectsRef.current[i];
      if (hitTest(o, wx, wy, t)) return o;
    }
    return null;
  };

  /** Expand ids to full groups (selecting one member selects all). */
  const expandWithGroups = (ids: string[]): string[] => {
    const byId = new Map(objectsRef.current.map(o => [o.id, o]));
    const out = new Set(ids);
    for (const id of ids) {
      const o = byId.get(id);
      if (o?.groupId) {
        for (const m of objectsRef.current) if (m.groupId === o.groupId) out.add(m.id);
      }
    }
    return [...out];
  };

  const selectIds = (ids: string[]) => setSelectedIds(expandWithGroups(ids));

  /** Shift a set of objects by dx/dy (locked objects stay put). */
  const moveObjectsBy = (list: SketchObject[], ids: Set<string>, dx: number, dy: number): SketchObject[] =>
    list.map(o => {
      if (!ids.has(o.id) || o.locked) return o;
      if (o.type === 'path' || o.type === 'arrow' || o.type === 'line') {
        const pts = (o.points || []).map((v, i) => (i % 2 === 0 ? v + dx : v + dy));
        const wp = o.waypoints?.map((v, i) => (i % 2 === 0 ? v + dx : v + dy));
        return { ...o, points: pts, x: o.x + dx, y: o.y + dy, waypoints: wp ?? o.waypoints };
      }
      return { ...o, x: o.x + dx, y: o.y + dy };
    });

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    const isPan = activeTool === 'pan' || spaceRef.current || e.button === 1;
    if (isPan) {
      const { x, y } = getCoords(e);
      dragRef.current = { mode: 'pan', startX: x, startY: y, lastX: e.clientX, lastY: e.clientY };
      return;
    }

    if (pointersRef.current.size >= 2) {
      // Don't hijack an in-progress stroke: keep drawing with the first finger
      if (dragRef.current?.mode === 'draw' || dragRef.current?.mode === 'drawpath') return;
      const pts = [...pointersRef.current.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      dragRef.current = { mode: 'pinch', pinchDist: dist, pinchMid: mid };
      return;
    }

    const { x, y } = getCoords(e);

    if (activeTool === 'eraser') {
      dragRef.current = { mode: 'erase', startX: x, startY: y, lastX: x, lastY: y };
      eraseAt(x, y, x, y);
      return;
    }

    if (activeTool === 'select') {
      // Waypoint handles of a singly-selected elbow connector come first
      const single = selectedIds.length === 1 ? objectsRef.current.find(o => o.id === selectedIds[0]) : undefined;
      if (single && !single.locked && (single.type === 'arrow' || single.type === 'line') && (single.route || 'straight') === 'elbow' && single.waypoints?.length) {
        const wr = 11 / (camRef.current.z * canvasScale);
        const wi = single.waypoints.findIndex((_, i) => {
          if (i % 2 === 1) return false;
          return Math.abs(single.waypoints![i] - x) <= wr && Math.abs(single.waypoints![i + 1] - y) <= wr;
        });
        if (wi >= 0 && wi % 2 === 0) {
          const idx = wi / 2;
          if (e.altKey) {
            // Alt+click removes the waypoint
            const wp = single.waypoints.filter((_, i) => i < idx * 2 || i >= idx * 2 + 2);
            commit(objectsRef.current.map(o => (o.id === single.id ? { ...o, waypoints: wp.length ? wp : undefined } : o)));
            return;
          }
          dragRef.current = { mode: 'waypoint', id: single.id, index: idx };
          return;
        }
      }
      if (selectedIds.length) {
        const sel = objectsRef.current.filter(o => selectedIds.includes(o.id));
        const ub = unionBox(sel.map(bbox))!;
        // Constant ~11px screen-space grab target at any zoom
        const hs = 11 / (camRef.current.z * canvasScale);
        const hp = handlePoints(ub).find(p => Math.abs(p.x - x) <= hs && Math.abs(p.y - y) <= hs);
        if (hp) {
          dragRef.current = {
            mode: 'resize',
            handle: hp.dir,
            origBox: ub,
            startX: x,
            startY: y,
            origObjects: clone(sel),
          };
          return;
        }
      }
      const hit = topHit(x, y);
      if (hit) {
        let nextIds: string[];
        if (e.shiftKey) {
          if (selectedIds.includes(hit.id)) {
            // Shift-click removes the whole group when grouped
            const mates = new Set(expandWithGroups([hit.id]));
            nextIds = selectedIds.filter(i => !mates.has(i));
          } else {
            nextIds = [...selectedIds, hit.id];
          }
        } else {
          nextIds = selectedIds.includes(hit.id) ? selectedIds : [hit.id];
        }
        const expanded = expandWithGroups(nextIds);
        setSelectedIds(expanded);
        if (expanded.includes(hit.id)) {
          const selectedObjects = objectsRef.current.filter(o => expanded.includes(o.id));
          const sb = unionBox(selectedObjects.map(bbox)) || bbox(hit);
          dragRef.current = {
            mode: 'drag',
            startX: x,
            startY: y,
            origBox: sb,
            origObjects: clone(selectedObjects),
          };
        }
      } else {
        if (!e.shiftKey) setSelectedIds([]);
        dragRef.current = { mode: 'marquee', startX: x, startY: y, lastX: x, lastY: y };
        marqueeRef.current = { x0: x, y0: y, x1: x, y1: y };
      }
      return;
    }

    if (activeTool === 'sticky' || activeTool === 'text') {
      const id = uid();
      const o: SketchObject =
        activeTool === 'sticky'
          ? { id, type: 'sticky', x: x - 100, y: y - 60, w: 200, h: 140, color: stickyColor, text: '' }
          : { id, type: 'text', x, y, w: 220, h: 40, color: selectedColor, text: '', fontSize: 18 };
      commit([...objectsRef.current, o]);
      setSelectedIds([id]);
      setEditingId(id);
      setEditText('');
      return;
    }

    if (activeTool === 'rect' || activeTool === 'ellipse' || activeTool === 'diamond') {
      const id = uid();
      const o: SketchObject = {
        id,
        type: activeTool,
        x,
        y,
        w: 0,
        h: 0,
        color: selectedColor,
        strokeWidth,
        fill: fillShape,
        dash: dashShape,
      };
      dragRef.current = { mode: 'draw', startX: x, startY: y, id };
      setObjects(prev => [...prev, o]);
      return;
    }

    if (activeTool === 'arrow' || activeTool === 'line') {
      const id = uid();
      const o: SketchObject = {
        id,
        type: activeTool,
        x,
        y,
        w: 0,
        h: 0,
        color: selectedColor,
        strokeWidth,
        points: [x, y, x, y],
        arrowhead: activeTool === 'arrow' ? 'end' : 'none',
        dash: dashShape,
      };
      dragRef.current = { mode: 'draw', startX: x, startY: y, id };
      setObjects(prev => [...prev, o]);
      return;
    }

    if (activeTool === 'path') {
      const id = uid();
      const o: SketchObject = {
        id,
        type: 'path',
        x,
        y,
        w: 0,
        h: 0,
        color: selectedColor,
        strokeWidth,
        points: [x, y],
      };
      dragRef.current = { mode: 'drawpath', id };
      setObjects(prev => [...prev, o]);
      return;
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (pointersRef.current.has(e.pointerId)) pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const d = dragRef.current;
    if (!d) return;
    const { x, y } = getCoords(e);

    if (d.mode === 'pinch' && pointersRef.current.size >= 2) {
      const pts = [...pointersRef.current.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      const rect = canvasRef.current!.getBoundingClientRect();
      const scale = rect.width / CANVAS_W;
      if (d.pinchDist) {
        const nz = Math.min(5, Math.max(0.2, camRef.current.z * (dist / d.pinchDist)));
        const lx = (mid.x - rect.left) / scale;
        const ly = (mid.y - rect.top) / scale;
        const worldX = (lx - camRef.current.x) / camRef.current.z;
        const worldY = (ly - camRef.current.y) / camRef.current.z;
        setCam({ x: lx - worldX * nz, y: ly - worldY * nz, z: nz });
      }
      d.pinchDist = dist;
      return;
    }

    if (d.mode === 'pan') {
      const rect = canvasRef.current!.getBoundingClientRect();
      const scale = rect.width / CANVAS_W;
      const dx = (e.clientX - (d.lastX || e.clientX)) / scale;
      const dy = (e.clientY - (d.lastY || e.clientY)) / scale;
      d.lastX = e.clientX;
      d.lastY = e.clientY;
      setCam(c => ({ ...c, x: c.x + dx, y: c.y + dy }));
      return;
    }

    if (d.mode === 'waypoint' && d.id != null && d.index != null) {
      let nx = x;
      let ny = y;
      if (gridSnap && !e.altKey) {
        nx = snap(x, GRID);
        ny = snap(y, GRID);
      }
      const idx = d.index;
      setObjects(prev => prev.map(o => {
        if (o.id !== d.id || !o.waypoints || o.locked) return o;
        const wp = [...o.waypoints];
        wp[idx * 2] = nx;
        wp[idx * 2 + 1] = ny;
        return { ...o, waypoints: wp };
      }));
      requestDraw();
      return;
    }

    if (d.mode === 'erase') {
      eraseAt(d.lastX!, d.lastY!, x, y);
      d.lastX = x;
      d.lastY = y;
      return;
    }

    if (d.mode === 'drag' && d.origBox) {
      let dx = x - (d.startX ?? x);
      let dy = y - (d.startY ?? y);
      if (gridSnap && !e.altKey) {
        // Snap the absolute target so off-grid starts still land on-grid
        dx = snap(d.origBox.x + dx, GRID) - d.origBox.x;
        dy = snap(d.origBox.y + dy, GRID) - d.origBox.y;
      }
      const sel = new Set(selectedIds);
      const byId = new Map(objectsRef.current.map(o => [o.id, o]));
      // Locked members stay put; if nothing movable, just redraw guides
      const movable = [...sel].some(id => !byId.get(id)?.locked);
      const others = objectsRef.current.filter(o => !sel.has(o.id)).map(bbox);
      const trial: Box = { x: d.origBox.x + dx, y: d.origBox.y + dy, w: d.origBox.w, h: d.origBox.h };
      const res = snapBox(trial, others, 6 / camRef.current.z);
      dx = res.box.x - d.origBox.x;
      dy = res.box.y - d.origBox.y;
      guidesRef.current = { vertical: res.vertical, horizontal: res.horizontal };
      if (movable) {
        setObjects(moveObjectsBy(objectsRef.current, sel, dx, dy));
      }
      requestDraw();
      return;
    }

    if (d.mode === 'resize' && d.handle && d.origBox) {
      // Snap the cursor (not the box values) so the fixed edge never shifts
      let cx = x;
      let cy = y;
      if (gridSnap && !e.altKey) {
        cx = snap(x, GRID);
        cy = snap(y, GRID);
      }
      const { box: nb, flipX, flipY } = newBoxFromHandle(d.origBox, d.handle, cx, cy);
      if (flipX || flipY) d.handle = flipHandle(d.handle, flipX, flipY);
      const others = objectsRef.current.filter(o => !selectedIds.includes(o.id)).map(bbox);
      const res = snapBox(nb, others, 6 / camRef.current.z);
      guidesRef.current = { vertical: res.vertical, horizontal: res.horizontal };
      const ob = d.origBox;
      const nb2 = res.box;
      const sel = selectedIds;
      const originals = d.origObjects || objectsRef.current.filter(o => sel.includes(o.id));
      const originalById = new Map<string, SketchObject>(originals.map(o => [o.id, o]));
      setObjects(prev => prev.map(o => {
        const original = originalById.get(o.id);
        if (!original || original.locked) return o;
        return transformBox(original, ob, nb2);
      }));
      requestDraw();
      return;
    }

    if (d.mode === 'marquee') {
      marqueeRef.current = { x0: d.startX, y0: d.startY, x1: x, y1: y };
      requestDraw();
      return;
    }

    if (d.mode === 'draw' && d.id) {
      const sx = d.startX;
      const sy = d.startY;
      setObjects(prev =>
        prev.map(o => {
          if (o.id !== d.id) return o;
          if (o.type === 'arrow' || o.type === 'line') {
            const nx = x;
            const ny = y;
            return { ...o, points: [sx, sy, nx, ny], x: Math.min(sx, nx), y: Math.min(sy, ny), w: Math.abs(nx - sx), h: Math.abs(ny - sy) };
          }
          return { ...o, x: Math.min(sx, x), y: Math.min(sy, y), w: Math.abs(x - sx), h: Math.abs(y - sy) };
        }),
      );
      return;
    }

    if (d.mode === 'drawpath' && d.id) {
      // Decimate: skip points closer than 2 world units to bound memory/render cost
      const prev = objectsRef.current.find(o => o.id === d.id);
      const pl = prev?.points || [];
      if (pl.length >= 2) {
        const dx = x - pl[pl.length - 2];
        const dy = y - pl[pl.length - 1];
        if (dx * dx + dy * dy < 4) return;
      }
      setObjects(prev => prev.map(o => (o.id === d.id && o.points ? { ...o, points: [...o.points!, x, y] } : o)));
      return;
    }
  };

  const eraseAt = (x0: number, y0: number, x1: number, y1: number) => {
    const t = eraserSize / camRef.current.z;
    const toErase: string[] = [];
    for (let i = objectsRef.current.length - 1; i >= 0; i--) {
      const o = objectsRef.current[i];
      if (o.type === 'path' || o.type === 'arrow' || o.type === 'line') {
        const p = o.points || [];
        let hit = false;
        for (let j = 2; j < p.length; j += 2) {
          if (segSegDist(p[j - 2], p[j - 1], p[j], p[j + 1], x0, y0, x1, y1) <= t) {
            hit = true;
            break;
          }
        }
        if (p.length < 4 && segmentHitsBox(bbox(o), x0, y0, x1, y1, t)) hit = true;
        if (hit) toErase.push(o.id);
      } else if (segmentHitsBox(bbox(o), x0, y0, x1, y1, t)) {
        toErase.push(o.id);
      }
    }
    let changed = false;
    for (const id of toErase) {
      if (!erasePreviewRef.current.has(id)) {
        erasePreviewRef.current.add(id);
        changed = true;
      }
    }
    if (changed) requestDraw();
  };

  /** Snap a point to the nearest shape connection point (edge centers) within tolerance. */
  const snapToConnection = (px: number, py: number, excludeId: string): { x: number; y: number } => {
    const t = tol() + 8 / camRef.current.z;
    let best: { x: number; y: number } | null = null;
    let bestD = t;
    for (let i = objectsRef.current.length - 1; i >= 0; i--) {
      const s = objectsRef.current[i];
      if (s.id === excludeId || s.type === 'arrow' || s.type === 'line' || s.type === 'path') continue;
      const b = bbox(s);
      const pts = [
        { x: b.x + b.w / 2, y: b.y },
        { x: b.x + b.w / 2, y: b.y + b.h },
        { x: b.x, y: b.y + b.h / 2 },
        { x: b.x + b.w, y: b.y + b.h / 2 },
      ];
      for (const q of pts) {
        const d = Math.hypot(q.x - px, q.y - py);
        if (d <= bestD) {
          bestD = d;
          best = q;
        }
      }
    }
    return best || { x: px, y: py };
  };

  const bindArrow = (o: SketchObject): SketchObject => {    if (o.type !== 'arrow' && o.type !== 'line') return o;
    const p = o.points || [0, 0, 0, 0];
    const x0 = p[0];
    const y0 = p[1];
    const x1 = p[p.length - 2];
    const y1 = p[p.length - 1];
    const t = tol() + 6 / camRef.current.z;
    const shapeAt = (px: number, py: number) => {
      for (let i = objectsRef.current.length - 1; i >= 0; i--) {
        const s = objectsRef.current[i];
        if (s.type === 'arrow' || s.type === 'line' || s.type === 'path' || s.id === o.id) continue;
        if (hitTest(s, px, py, t)) return s;
      }
      return null;
    };
    const sb = shapeAt(x0, y0);
    const eb = shapeAt(x1, y1);
    return { ...o, startBinding: sb ? { objectId: sb.id } : null, endBinding: eb ? { objectId: eb.id } : null };
  };

  /** Freeze a bound arrow's current endpoints and detach it from its shapes. */
  const unbindArrow = (target: SketchObject) => {
    const byId = new Map(objectsRef.current.map(o => [o.id, o] as [string, SketchObject]));
    const { x0, y0, x1, y1 } = resolveArrow(target, byId);
    commit(objectsRef.current.map(o => o.id === target.id
      ? { ...o, points: [x0, y0, x1, y1], x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0), startBinding: null, endBinding: null }
      : o));
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // Touch double-tap = edit text (mouse uses onDoubleClick; touch never fires it)
    if (e.pointerType === 'touch') {
      const now = Date.now();
      const last = lastTapRef.current;
      lastTapRef.current = { t: now, x: e.clientX, y: e.clientY };
      if (last && now - last.t < 350 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 16) {
        lastTapRef.current = null;
        if (tryEditTextAt(e.clientX, e.clientY)) {
          pointersRef.current.delete(e.pointerId);
          dragRef.current = null;
          marqueeRef.current = null;
          draw();
          return;
        }
      }
    }
    pointersRef.current.delete(e.pointerId);
    const d = dragRef.current;
    dragRef.current = null;

    if (d?.mode === 'pinch') {
      return;
    }

    if (d?.mode === 'erase') {
      const ids = erasePreviewRef.current;
      if (ids.size) {
        const killed = new Set(ids);
        commit(objectsRef.current.filter(o => !killed.has(o.id)));
      }
      erasePreviewRef.current = new Set();
      draw();
      return;
    }

    if (d?.mode === 'waypoint') {
      guidesRef.current = { vertical: [], horizontal: [] };
      draw();
      pushHistory();
      return;
    }

    if (d?.mode === 'resize' || d?.mode === 'drag') {
      guidesRef.current = { vertical: [], horizontal: [] };
      // Re-bind moved arrows/lines so endpoints attach (or detach) after the move
      const rebound = objectsRef.current.map(o =>
        (o.type === 'arrow' || o.type === 'line') && selectedIds.includes(o.id) ? bindArrow(o) : o,
      );
      setObjects(rebound);
      draw();
      pushHistory();
      return;
    }

    if (d?.mode === 'marquee') {
      const m = marqueeRef.current;
      marqueeRef.current = null;
      if (m) {
        const box = {
          x: Math.min(m.x0, m.x1),
          y: Math.min(m.y0, m.y1),
          w: Math.abs(m.x1 - m.x0),
          h: Math.abs(m.y1 - m.y0),
        };
        // Alt = strict containment; default = intersect (hint in status bar)
        const strict = e.altKey;
        const inside = objectsRef.current.filter(o => {
          const b = bbox(o);
          if (strict) {
            return b.x >= box.x && b.y >= box.y && b.x + b.w <= box.x + box.w && b.y + b.h <= box.y + box.h;
          }
          return b.x + b.w >= box.x && b.x <= box.x + box.w && b.y + b.h >= box.y && b.y <= box.y + box.h;
        });
        if (inside.length)
          setSelectedIds(e.shiftKey ? expandWithGroups(Array.from(new Set([...selectedIds, ...inside.map(i => i.id)]))) : expandWithGroups(inside.map(i => i.id)));
      }
      draw();
      return;
    }

    if (d?.mode === 'draw' && d.id) {
      const next = objectsRef.current.map(o => {
        if (o.id !== d.id) return o;
        if (o.type === 'arrow' || o.type === 'line') {
          if (
            Math.abs((o.points?.[2] || 0) - (o.points?.[0] || 0)) < 6 &&
            Math.abs((o.points?.[3] || 0) - (o.points?.[1] || 0)) < 6
          ) {
            return { ...o, points: [o.points![0], o.points![1], o.points![0] + 120, o.points![1]] };
          }
          // Snap endpoints to nearby shape connection points, then bind
          const p = o.points || [0, 0, 0, 0];
          const s0 = snapToConnection(p[0], p[1], o.id);
          const s1 = snapToConnection(p[p.length - 2], p[p.length - 1], o.id);
          return bindArrow({ ...o, points: [s0.x, s0.y, s1.x, s1.y] });
        }
        if (o.w < 6 && o.h < 6) return { ...o, w: 140, h: 90, x: o.x - 70, y: o.y - 45 };
        return o;
      });
      setObjects(next);
      pushHistory();
      return;
    }

    if (d?.mode === 'drawpath' && d.id) {
      const kept = objectsRef.current.filter(o => o.id !== d.id || (o.points && o.points.length >= 4));
      // Single tap without movement leaves no visible stroke: keep a dot instead of nothing.
      const drawn = objectsRef.current.find(o => o.id === d.id);
      if (drawn && (drawn.points?.length ?? 0) < 4) {
        const px = drawn.points?.[0] ?? 0;
        const py = drawn.points?.[1] ?? 1;
        kept.push({ ...drawn, points: [px, py, px + 0.5, py + 0.5] });
      }
      setObjects(kept);
      pushHistory();
      return;
    }
  };

  const onDoubleClick = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // Double-click a connector inserts an elbow waypoint (converts route to elbow)
    if (activeTool === 'select') {
      const { x, y } = getCoords(e);
      const hit = topHit(x, y);
      if (hit && !hit.locked && (hit.type === 'arrow' || hit.type === 'line')) {
        insertWaypoint(hit, x, y);
        return;
      }
    }
    tryEditTextAt(e.clientX, e.clientY);
  };

  const insertWaypoint = (target: SketchObject, x: number, y: number) => {
    const byId = new Map(objectsRef.current.map(o => [o.id, o] as [string, SketchObject]));
    const { x0, y0, x1, y1 } = resolveArrow(target, byId);
    const routed = routeConnector('elbow', x0, y0, x1, y1, target.waypoints);
    const q = routed.pts;
    let best = 1;
    let bestD = Infinity;
    for (let i = 2; i < q.length; i += 2) {
      const d = distToSegment(x, y, q[i - 2], q[i - 1], q[i], q[i + 1]);
      if (d < bestD) {
        bestD = d;
        best = i / 2;
      }
    }
    // Vertex position `best` → waypoint index is best-1 (start point isn't stored)
    const wp = [...(target.waypoints || [])];
    wp.splice((best - 1) * 2, 0, Math.round(x), Math.round(y));
    commit(objectsRef.current.map(o => (o.id === target.id ? { ...o, route: 'elbow' as const, waypoints: wp } : o)));
    setSelectedIds([target.id]);
  };

  const lastTapRef = useRef<{ t: number; x: number; y: number } | null>(null);

  /** Shared tap-to-edit path for mouse double-click and touch double-tap. */
  const tryEditTextAt = (clientX: number, clientY: number): boolean => {
    const canvas = canvasRef.current;
    if (!canvas) return false;
    const rect = canvas.getBoundingClientRect();
    const scale = rect.width / CANVAS_W;
    const lx = (clientX - rect.left) / scale;
    const ly = (clientY - rect.top) / scale;
    const x = (lx - camRef.current.x) / camRef.current.z;
    const y = (ly - camRef.current.y) / camRef.current.z;
    const hit = topHit(x, y);
    if (hit && !hit.locked && (hit.type === 'sticky' || hit.type === 'text')) {
      setSelectedIds([hit.id]);
      setEditingId(hit.id);
      setEditText(hit.text || '');
      return true;
    }
    return false;
  };

  const commitEditing = () => {
    if (!editingId) return;
    const id = editingId;
    const txt = editText;
    const current = objectsRef.current.find(o => o.id === id);
    if (!current || current.locked) {
      setEditingId(null);
      setEditText('');
      return;
    }
    // Don't pollute history when nothing changed (blur/Esc with identical text)
    if (current && (current.text || '') === txt) {
      setEditingId(null);
      setEditText('');
      return;
    }
    commit(objectsRef.current.map(o => (o.id === id ? { ...o, text: txt } : o)));
    setEditingId(null);
    setEditText('');
  };

  const handleUndo = () => {
    if (histIndexRef.current <= 0) return;
    histIndexRef.current -= 1;
    setObjects(clone(historyRef.current[histIndexRef.current]));
    setSelectedIds([]);
    setEditingId(null);
    syncHistState();
  };

  const handleRedo = () => {
    if (histIndexRef.current >= historyRef.current.length - 1) return;
    histIndexRef.current += 1;
    setObjects(clone(historyRef.current[histIndexRef.current]));
    setSelectedIds([]);
    setEditingId(null);
    syncHistState();
  };

  const deleteSelected = () => {
    const kill = new Set(selectedIds.filter(id => !objectsRef.current.find(o => o.id === id)?.locked));
    if (!kill.size) return;
    commit(
      objectsRef.current
        .filter(o => !kill.has(o.id))
        .map(o => ({
          ...o,
          startBinding: o.startBinding && kill.has(o.startBinding.objectId) ? null : o.startBinding,
          endBinding: o.endBinding && kill.has(o.endBinding.objectId) ? null : o.endBinding,
        })),
    );
    setSelectedIds([]);
  };

  const duplicateSelected = () => {
    const sources = objectsRef.current.filter(o => selectedIds.includes(o.id) && !o.locked);
    if (!sources.length) return;
    const clones = sources.map(o => {
      const c = clone([o])[0];
      c.id = uid();
      c.locked = false;
      if (c.type === 'path' || c.type === 'arrow' || c.type === 'line') {
        c.points = (c.points || []).map((v, i) => (i % 2 === 0 ? v + 16 : v + 16));
      } else {
        c.x += 16;
        c.y += 16;
      }
      // Duplicates are independent copies (same as paste): never steal the original's bindings
      c.startBinding = null;
      c.endBinding = null;
      return c;
    });
    commit([...objectsRef.current, ...clones]);
    setSelectedIds(clones.map(c => c.id));
  };

  const bringToFront = () => {
    if (!selectedIds.length) return;
    const sel = new Set(selectedIds);
    const kept = objectsRef.current.filter(o => !sel.has(o.id));
    const moved = objectsRef.current.filter(o => sel.has(o.id));
    commit([...kept, ...moved]);
  };

  const sendToBack = () => {
    if (!selectedIds.length) return;
    const sel = new Set(selectedIds);
    const kept = objectsRef.current.filter(o => !sel.has(o.id));
    const moved = objectsRef.current.filter(o => sel.has(o.id));
    commit([...moved, ...kept]);
  };

  const reorderSelected = (dir: 'forward' | 'backward') => {
    if (selectedIds.length !== 1) return;
    const list = [...objectsRef.current];
    const i = list.findIndex(o => o.id === selectedIds[0]);
    const j = dir === 'forward' ? i + 1 : i - 1;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    commit(list);
  };

  const unlockedSelected = () => objectsRef.current.filter(o => selectedIds.includes(o.id) && !o.locked);

  /** Apply a style patch to the current selection (bulk styling). */
  const applyStyleToSelection = (patch: Partial<SketchObject>) => {
    if (!selectedIds.length) return;
    const ids = new Set(selectedIds);
    commit(objectsRef.current.map(o => (ids.has(o.id) && !o.locked ? { ...o, ...patch } : o)));
  };

  const alignSelected = (edge: 'left' | 'centerX' | 'right' | 'top' | 'middle' | 'bottom') => {
    const sel = unlockedSelected();
    if (sel.length < 2) return;
    const boxes = new Map(sel.map(o => [o.id, bbox(o)] as [string, Box]));
    const bs = sel.map(o => boxes.get(o.id)!);
    const minX = Math.min(...bs.map(b => b.x));
    const maxX = Math.max(...bs.map(b => b.x + b.w));
    const minY = Math.min(...bs.map(b => b.y));
    const maxY = Math.max(...bs.map(b => b.y + b.h));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const next = objectsRef.current.map(o => {
      const b = boxes.get(o.id);
      if (!b) return o;
      let dx = 0;
      let dy = 0;
      if (edge === 'left') dx = minX - b.x;
      if (edge === 'centerX') dx = cx - (b.x + b.w / 2);
      if (edge === 'right') dx = maxX - (b.x + b.w);
      if (edge === 'top') dy = minY - b.y;
      if (edge === 'middle') dy = cy - (b.y + b.h / 2);
      if (edge === 'bottom') dy = maxY - (b.y + b.h);
      if (!dx && !dy) return o;
      if (o.type === 'path' || o.type === 'arrow' || o.type === 'line') {
        const pts = (o.points || []).map((v, i) => (i % 2 === 0 ? v + dx : v + dy));
        const wp = o.waypoints?.map((v, i) => (i % 2 === 0 ? v + dx : v + dy));
        return { ...o, points: pts, x: o.x + dx, y: o.y + dy, waypoints: wp ?? o.waypoints };
      }
      return { ...o, x: o.x + dx, y: o.y + dy };
    });
    commit(next);
  };

  const distributeSelected = (dir: 'h' | 'v') => {
    const sel = unlockedSelected();
    if (sel.length < 3) return;
    const items = sel
      .map(o => ({ o, b: bbox(o) }))
      .sort((a, b2) => (dir === 'h' ? a.b.x + a.b.w / 2 - (b2.b.x + b2.b.w / 2) : a.b.y + a.b.h / 2 - (b2.b.y + b2.b.h / 2)));
    const first = dir === 'h' ? items[0].b.x + items[0].b.w / 2 : items[0].b.y + items[0].b.h / 2;
    const last = dir === 'h' ? items[items.length - 1].b.x + items[items.length - 1].b.w / 2 : items[items.length - 1].b.y + items[items.length - 1].b.h / 2;
    const step = (last - first) / (items.length - 1);
    const deltas = new Map<string, { dx: number; dy: number }>();
    items.forEach((it, idx) => {
      const target = first + step * idx;
      const current = dir === 'h' ? it.b.x + it.b.w / 2 : it.b.y + it.b.h / 2;
      const d = target - current;
      deltas.set(it.o.id, dir === 'h' ? { dx: d, dy: 0 } : { dx: 0, dy: d });
    });
    const next = objectsRef.current.map(o => {
      const d = deltas.get(o.id);
      if (!d) return o;
      if (o.type === 'path' || o.type === 'arrow' || o.type === 'line') {
        const pts = (o.points || []).map((v, i) => (i % 2 === 0 ? v + d.dx : v + d.dy));
        const wp = o.waypoints?.map((v, i) => (i % 2 === 0 ? v + d.dx : v + d.dy));
        return { ...o, points: pts, x: o.x + d.dx, y: o.y + d.dy, waypoints: wp ?? o.waypoints };
      }
      return { ...o, x: o.x + d.dx, y: o.y + d.dy };
    });
    commit(next);
  };

  const groupSelected = () => {
    const sel = unlockedSelected();
    if (sel.length < 2) return;
    const gid = uid();
    const ids = new Set(sel.map(o => o.id));
    commit(objectsRef.current.map(o => (ids.has(o.id) ? { ...o, groupId: gid } : o)));
  };

  const ungroupSelected = () => {
    const gids = new Set(
      objectsRef.current.filter(o => selectedIds.includes(o.id) && o.groupId).map(o => o.groupId as string),
    );
    if (!gids.size) return;
    commit(objectsRef.current.map(o => (o.groupId && gids.has(o.groupId) ? { ...o, groupId: null } : o)));
  };

  const toggleLockSelected = () => {
    if (!selectedIds.length) return;
    const sel = objectsRef.current.filter(o => selectedIds.includes(o.id));
    const allLocked = sel.length > 0 && sel.every(o => o.locked);
    const ids = new Set(sel.map(o => o.id));
    commit(objectsRef.current.map(o => (ids.has(o.id) ? { ...o, locked: !allLocked || undefined } : o)));
    if (!allLocked) setSelectedIds([]);
  };

  const copySelected = () => {
    if (!selectedIds.length) return;
    clipboardRef.current = objectsRef.current.filter(o => selectedIds.includes(o.id)).map(o => JSON.parse(JSON.stringify(o)));
  };

  const pasteSelected = () => {
    if (!clipboardRef.current.length) return;
    const clones = clipboardRef.current.map(o => {
      const c = JSON.parse(JSON.stringify(o)) as SketchObject;
      c.id = uid();
      if (c.type === 'path' || c.type === 'arrow' || c.type === 'line') {
        c.points = (c.points || []).map((v, i) => (i % 2 === 0 ? v + 16 : v + 16));
      } else {
        c.x += 16;
        c.y += 16;
      }
      c.startBinding = null;
      c.endBinding = null;
      return c;
    });
    commit([...objectsRef.current, ...clones]);
    setSelectedIds(clones.map(c => c.id));
  };

  const zoomTo = (z: number) => {
    const nz = Math.min(5, Math.max(0.2, z));
    setCam(c => ({ ...c, z: nz }));
  };

  // Paste clipboard bitmaps as selectable `image` objects at the viewport
  // center. Plain-text pastes are ignored here (canvas has no text fields).
  const pasteImages = useCallback(async (files: File[]) => {
    if (!files.length) return;
    setSaveError(null);
    try {
      const cam = camRef.current;
      const cx = (CANVAS_W / 2 - cam.x) / cam.z;
      const cy = (CANVAS_H / 2 - cam.y) / cam.z;
      const added: SketchObject[] = [];
      for (const [index, file] of files.slice(0, 4).entries()) {
        const image = await fileToDownscaledDataUrl(file);
        const scale = Math.min(1, 420 / Math.max(image.width, image.height));
        const w = Math.max(1, Math.round(image.width * scale));
        const h = Math.max(1, Math.round(image.height * scale));
        added.push({
          id: uid(),
          type: 'image',
          x: Math.round(cx - w / 2 + index * 24),
          y: Math.round(cy - h / 2 + index * 24),
          w,
          h,
          color: '#818cf8',
          fill: true,
          src: image.dataUrl,
        });
      }
      if (!added.length) return;
      commit([...objectsRef.current, ...added]);
      setSelectedIds(added.map(o => o.id));
    } catch (e: any) {
      setSaveError(e?.message || 'Could not paste the image.');
    }
  }, [commit]);

  const handleCanvasPaste = useCallback((e: React.ClipboardEvent) => {
    const files = extractImageFiles(e.clipboardData);
    if (!files.length) return;
    e.preventDefault();
    e.stopPropagation();
    void pasteImages(files);
  }, [pasteImages]);

  const fitToContent = () => {
    const boxes = objectsRef.current.map(bbox);
    const b = unionBox(boxes);
    if (!b || b.w === 0) {
      setCam({ x: 0, y: 0, z: 1 });
      return;
    }
    const pad = 40;
    const z = Math.min(5, Math.max(0.2, Math.min(CANVAS_W / (b.w + pad * 2), CANVAS_H / (b.h + pad * 2))));
    setCam({ x: (CANVAS_W - b.w * z) / 2 - b.x * z, y: (CANVAS_H - b.h * z) / 2 - b.y * z, z });
  };

  const exportFileBase = () => `idea-sketch-${id || 'untitled'}-${Date.now()}`;

  const exportDataUrl = (): string => {
    const boxes = objectsRef.current.map(bbox);
    const b = unionBox(boxes) || { x: 0, y: 0, w: CANVAS_W, h: CANVAS_H };
    const pad = 24;
    const w = Math.ceil(b.w + pad * 2);
    const h = Math.ceil(b.h + pad * 2);
    // 2x export so saved PNGs match on-screen (DPR-aware) sharpness
    const SCALE = 2;
    const off = document.createElement('canvas');
    off.width = Math.max(1, w * SCALE);
    off.height = Math.max(1, h * SCALE);
    const octx = off.getContext('2d');
    if (!octx) return '';
    octx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    octx.fillStyle = '#ffffff';
    octx.fillRect(0, 0, w, h);
    octx.save();
    octx.translate(-b.x + pad, -b.y + pad);
    if (legacyImg) octx.drawImage(legacyImg, 0, 0, CANVAS_W, CANVAS_H);
    const byId = new Map<string, SketchObject>(objectsRef.current.map((o): [string, SketchObject] => [o.id, o]));
    for (const o of objectsRef.current) {
      drawObject(octx, o, byId);
    }
    octx.restore();
    return off.toDataURL('image/png');
  };

  const exportSVG = (): string => {
    const boxes = objectsRef.current.map(bbox);
    const b = unionBox(boxes) || { x: 0, y: 0, w: CANVAS_W, h: CANVAS_H };
    const pad = 24;
    const vbX = b.x - pad;
    const vbY = b.y - pad;
    const vbW = b.w + pad * 2;
    const vbH = b.h + pad * 2;
    const byId = new Map<string, SketchObject>(objectsRef.current.map((o): [string, SketchObject] => [o.id, o]));
    const parts: string[] = [];
    parts.push(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(vbW)}" height="${Math.ceil(vbH)}" viewBox="${vbX} ${vbY} ${vbW} ${vbH}">`,
    );
    parts.push(`<rect x="${vbX}" y="${vbY}" width="${vbW}" height="${vbH}" fill="#ffffff"/>`);
    if (legacyImg && initialDataUrl) {
      parts.push(`<image href="${initialDataUrl}" x="0" y="0" width="${CANVAS_W}" height="${CANVAS_H}"/>`);
    }
    for (const o of objectsRef.current) parts.push(svgForObject(o, byId));
    parts.push('</svg>');
    return parts.join('\n');
  };

  const handleSave = async () => {
    if (isSaving) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      await onSave(exportDataUrl(), clone(objectsRef.current));
      clearSketchDraft(id);
      setDraftInfo(null);
    } catch (e: any) {
      const detail = e?.response?.data?.detail
        || e?.response?.data?.error
        || e?.message;
      setSaveError(detail ? `Failed to save sketch: ${detail}` : 'Failed to save sketch. Your draft is still available.');
    } finally {
      setIsSaving(false);
    }
  };
  const handleDownload = () => {
    const a = document.createElement('a');
    a.href = exportDataUrl();
    a.download = `${exportFileBase()}.png`;
    a.click();
  };
  const handleDownloadSVG = () => {
    const svg = exportSVG();
    const a = document.createElement('a');
    a.href = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    a.download = `${exportFileBase()}.svg`;
    a.click();
  };

  const boardCenter = () => {
    const boxes = objectsRef.current.map(bbox);
    const b = unionBox(boxes);
    return b ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : { x: CANVAS_W / 2, y: CANVAS_H / 2 };
  };

  const insertTemplate = (kind: 'mindmap' | 'flowchart' | 'kanban') => {
    const c = boardCenter();
    const mk = (partial: Partial<SketchObject> & { type: SketchObjectType }): SketchObject => ({
      id: uid(),
      x: 0,
      y: 0,
      w: 160,
      h: 90,
      color: selectedColor,
      ...partial,
    } as SketchObject);
    let fresh: SketchObject[] = [];
    if (kind === 'mindmap') {
      const center = mk({ type: 'ellipse', x: c.x - 110, y: c.y - 60, w: 220, h: 120, color: '#4f46e5', fill: true, text: undefined });
      const centerLabel = mk({ type: 'text', x: c.x - 90, y: c.y - 14, w: 180, h: 28, color: '#ffffff', text: 'Main idea', fontSize: 20 });
      const branches = ['Why', 'Who', 'How', 'Risks'].map((t, i) => {
        const ang = (i / 4) * Math.PI * 2 - Math.PI / 2;
        const bx = c.x + Math.cos(ang) * 300 - 80;
        const by = c.y + Math.sin(ang) * 200 - 45;
        return mk({ type: 'sticky', x: bx, y: by, w: 160, h: 90, color: STICKY_COLORS[i % STICKY_COLORS.length], text: t, fontSize: 16 });
      });
      const cx = c.x;
      const cy = c.y;
      const arrows = branches.map(b => {
        const x1 = b.x + b.w / 2;
        const y1 = b.y + b.h / 2;
        return mk({ type: 'arrow', x: Math.min(cx, x1), y: Math.min(cy, y1), w: Math.abs(x1 - cx), h: Math.abs(y1 - cy), color: '#64748b', strokeWidth: 3, points: [cx, cy, x1, y1], arrowhead: 'end' as const });
      });
      fresh = [center, centerLabel, ...branches, ...arrows];
    } else if (kind === 'flowchart') {
      const start = mk({ type: 'ellipse', x: c.x - 80, y: c.y - 160, w: 160, h: 70, color: '#059669', fill: true });
      const decision = mk({ type: 'diamond', x: c.x - 90, y: c.y - 40, w: 180, h: 120, color: '#d97706' });
      const yes = mk({ type: 'rect', x: c.x - 240, y: c.y + 130, w: 160, h: 80, color: '#4f46e5' });
      const no = mk({ type: 'rect', x: c.x + 80, y: c.y + 130, w: 160, h: 80, color: '#e11d48' });
      // Shapes don't render text: overlay labels as text objects
      const labels = [
        mk({ type: 'text', x: c.x - 70, y: c.y - 142, w: 140, h: 30, color: '#ffffff', text: 'Start', fontSize: 18 }),
        mk({ type: 'text', x: c.x - 70, y: c.y + 6, w: 140, h: 30, color: '#ffffff', text: 'Ship it?', fontSize: 18 }),
        mk({ type: 'text', x: c.x - 230, y: c.y + 152, w: 140, h: 30, color: '#ffffff', text: 'Yes ✓', fontSize: 16 }),
        mk({ type: 'text', x: c.x + 90, y: c.y + 152, w: 140, h: 30, color: '#ffffff', text: 'No ✕', fontSize: 16 }),
      ];
      const link = (x0: number, y0: number, x1: number, y1: number, label?: string) =>
        mk({ type: 'arrow', x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0), color: '#64748b', strokeWidth: 3, points: [x0, y0, x1, y1], arrowhead: 'end' as const, route: 'elbow', label });
      fresh = [
        start,
        decision,
        yes,
        no,
        ...labels,
        link(c.x, c.y - 90, c.x, c.y - 40),
        link(c.x - 90, c.y + 20, c.x - 160, c.y + 130, 'yes'),
        link(c.x + 90, c.y + 20, c.x + 160, c.y + 130, 'no'),
      ];
    } else {
      const cols = ['Todo', 'Doing', 'Done'];
      fresh = cols.flatMap((title, ci) => {
        const x = c.x - 270 + ci * 190;
        const header = mk({ type: 'text', x, y: c.y - 120, w: 170, h: 30, color: '#f1f5f9', text: title.toUpperCase(), fontSize: 20 });
        const cards = [0, 1].map(ri =>
          mk({ type: 'sticky', x, y: c.y - 60 + ri * 130, w: 170, h: 110, color: STICKY_COLORS[(ci + ri) % STICKY_COLORS.length], text: `${title} ${ri + 1}` }),
        );
        return [header, ...cards];
      });
    }
    commit([...objectsRef.current, ...fresh]);
    setSelectedIds(fresh.map(o => o.id));
    setShowTemplates(false);
  };

  const clearBoard = () => {
    if (!objectsRef.current.length) return;
    if (!armClear) {
      setArmClear(true);
      window.setTimeout(() => setArmClear(false), 3000);
      return;
    }
    setArmClear(false);
    commit([]);
    setSelectedIds([]);
  };

  const copyImageToClipboard = async () => {
    try {
      const blob = await (await fetch(exportDataUrl())).blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setCopiedImg(true);
      window.setTimeout(() => setCopiedImg(false), 1800);
    } catch {
      setSaveError('Could not copy the image — your browser may block clipboard access.');
    }
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), objects: objectsRef.current }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${exportFileBase()}.json`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  const importJsonFile = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text());
      const items = Array.isArray(parsed) ? parsed : parsed.objects;
      if (!Array.isArray(items)) throw new Error('bad shape');
      const valid = items.filter((o: unknown): o is SketchObject => {
        const v = o as SketchObject;
        return !!v && typeof v.id === 'string' && typeof v.type === 'string' && typeof v.x === 'number' && typeof v.y === 'number';
      });
      if (!valid.length) throw new Error('empty');
      // Offset so imported boards don't stack exactly on current content
      const shifted = valid.map(o => {
        const c = clone([o])[0];
        c.id = uid();
        c.groupId = null;
        c.startBinding = null;
        c.endBinding = null;
        if (c.type === 'path' || c.type === 'arrow' || c.type === 'line') {
          c.points = (c.points || []).map((v, i) => v + 40);
        } else {
          c.x += 40;
          c.y += 40;
        }
        return c;
      });
      commit([...objectsRef.current, ...shifted]);
      setSelectedIds(shifted.map(o => o.id));
    } catch {
      setSaveError('Could not import that file — expected a sketch JSON export.');
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      // Never hijack typing or native control behavior
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || el?.isContentEditable) return;
      if (e.code === 'Space') {
        e.preventDefault();
        spaceRef.current = true;
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelectedIds(objectsRef.current.map(o => o.id));
        return;
      }
      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicateSelected();
        return;
      }
      if (mod && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        copySelected();
        return;
      }
      if (mod && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        pasteSelected();
        return;
      }
      if (mod && e.key.toLowerCase() === 'x') {
        e.preventDefault();
        copySelected();
        deleteSelected();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelected();
        return;
      }
      // Arrow-key nudge when the canvas itself has focus (Shift = grid step)
      if (
        (document.activeElement === canvasRef.current) &&
        (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') &&
        selectedIds.length
      ) {
        e.preventDefault();
        const step = e.shiftKey ? GRID : 2;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        const byId = new Map(objectsRef.current.map(o => [o.id, o]));
        if (!selectedIds.some(id => !byId.get(id)?.locked)) return;
        commit(moveObjectsBy(objectsRef.current, new Set(selectedIds), dx, dy));
        return;
      }
      if (e.key === 'Escape') {
        if (editingId) commitEditing();
        else if (isFullscreen) setIsFullscreen(false);
        else setSelectedIds([]);
        return;
      }
      if (e.key === '=' || e.key === '+') {
        zoomTo(camRef.current.z * 1.2);
        return;
      }
      if (e.key === '-') {
        zoomTo(camRef.current.z / 1.2);
        return;
      }
      if (e.key === '0') {
        setCam({ x: 0, y: 0, z: 1 });
        return;
      }
      if (!mod) {
        const map: Record<string, Tool> = {
          v: 'select',
          '1': 'select',
          r: 'rect',
          o: 'ellipse',
          d: 'diamond',
          t: 'text',
          a: 'arrow',
          l: 'line',
          p: 'path',
          e: 'eraser',
          h: 'pan',
          n: 'sticky',
        };
        const t = map[e.key.toLowerCase()];
        if (t) {
          setActiveTool(t);
          return;
        }
        if (e.key === ']') {
          bringToFront();
          return;
        }
        if (e.key === '[') {
          sendToBack();
          return;
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceRef.current = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId, selectedIds, isFullscreen]);

  const toolBtn = (t: Tool, title: string, icon: React.ReactNode) => (
    <button
      type="button"
      onClick={() => setActiveTool(t)}
      aria-label={title}
      className={`p-2 rounded-lg transition-all ${
        activeTool === t ? 'bg-indigo-600 text-white shadow-sm' : 'text-content-faint hover:text-white hover:bg-slate-800'
      }`}
      title={`${title} (${shortcutFor(t)})`}
    >
      {icon}
    </button>
  );

  const stripBtn = (label: string, title: string, onClick: () => void, disabled = false, active = false) => (
    <button
      key={label}
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={`px-2 py-1 rounded-md font-bold transition-all text-[11px] ${
        active ? 'bg-indigo-600 text-white' : 'text-content-faint hover:text-white hover:bg-slate-800'
      } disabled:opacity-30 disabled:hover:bg-transparent`}
    >
      {label}
    </button>
  );

  const setArrowRoute = (route: 'straight' | 'curve' | 'elbow') => {
    if (!selSingleArrow) return;
    const id = selSingleArrow.id;
    commit(objectsRef.current.map(o => (o.id === id && !o.locked ? { ...o, route } : o)));
  };

  const commitArrowLabel = (value: string) => {
    if (!selSingleArrow) return;
    const label = value.trim() || undefined;
    if ((selSingleArrow.label || undefined) === label) return;
    const id = selSingleArrow.id;
    commit(objectsRef.current.map(o => (o.id === id && !o.locked ? { ...o, label } : o)));
  };

  const shortcutFor = (t: Tool): string => {
    const m: Record<string, string> = {
      select: 'V',
      sticky: 'N',
      rect: 'R',
      ellipse: 'O',
      diamond: 'D',
      text: 'T',
      arrow: 'A',
      line: 'L',
      path: 'P',
      eraser: 'E',
      pan: 'H',
    };
    return m[t] || '';
  };

  const editorStyle: React.CSSProperties = {};
  if (editingId && canvasRef.current && containerRef.current) {
    const crect = canvasRef.current.getBoundingClientRect();
    const prect = containerRef.current.getBoundingClientRect();
    const scale = crect.width / CANVAS_W;
    const o = objectsRef.current.find(x => x.id === editingId);
    if (o) {
      const b = bbox(o);
      editorStyle.left = crect.left - prect.left + (b.x * camRef.current.z + camRef.current.x) * scale;
      editorStyle.top = crect.top - prect.top + (b.y * camRef.current.z + camRef.current.y) * scale;
      editorStyle.width = b.w * camRef.current.z * scale;
      editorStyle.height = Math.max(40, b.h * camRef.current.z * scale);
    }
  }

  const cursor =
    activeTool === 'pan' || spaceRef.current ? 'grab' : activeTool === 'text' ? 'text' : activeTool === 'select' ? 'default' : 'crosshair';

  // Selection-derived styling state (bulk styling in select mode)
  const selObjs = objects.filter(o => selectedIds.includes(o.id));
  const selUnlocked = selObjs.filter(o => !o.locked);
  const selHasStroke = selUnlocked.some(o => o.type !== 'sticky');
  const selHasText = selUnlocked.some(o => o.type === 'sticky' || o.type === 'text');
  const selHasShape = selUnlocked.some(o => o.type === 'rect' || o.type === 'ellipse' || o.type === 'diamond');
  const selHasDashable = selUnlocked.some(o => o.type === 'rect' || o.type === 'ellipse' || o.type === 'diamond' || o.type === 'arrow' || o.type === 'line');
  const selAllFill = selUnlocked.length > 0 && selUnlocked.every(o => o.type === 'rect' || o.type === 'ellipse' || o.type === 'diamond' ? !!o.fill : true);
  const selAllDash = selUnlocked.length > 0 && selUnlocked.every(o => o.dash);
  const selSingleArrow = selUnlocked.length === 1 && (selUnlocked[0].type === 'arrow' || selUnlocked[0].type === 'line') ? selUnlocked[0] : null;
  const selAllLocked = selObjs.length > 0 && selObjs.every(o => o.locked);
  const FONT_SIZES = [12, 14, 18, 24, 32];
  // Plain boolean to avoid union-narrowing issues in toolbar conditions
  const isSelectTool = activeTool === 'select';

  return (
    <div
      className={`bg-surface border border-line shadow-2xl overflow-hidden flex flex-col ${
        isFullscreen
          ? 'fixed inset-0 z-[70] h-[100dvh] rounded-none'
          : 'rounded-3xl'
      }`}
    >
      {/* Top Toolbar */}
      <div className="p-3 bg-surface-inverse border-b border-line flex flex-wrap items-center justify-between gap-3">
        {draftInfo && (
          <div className="flex w-full items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs" role="status">
            <span className="font-bold text-amber-700 dark:text-amber-300">
              Unsaved draft restored{` — saved ${new Date(draftInfo.savedAt).toLocaleString()}`}. Server version is hidden until you save.
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <button type="button" onClick={discardDraft} className="rounded-lg border border-amber-500/40 px-2.5 py-1 font-black text-amber-700 dark:text-amber-200 hover:bg-amber-500/15">
                Discard draft
              </button>
              <button type="button" onClick={() => setDraftInfo(null)} className="rounded-lg px-2.5 py-1 font-bold text-amber-700/70 dark:text-amber-300/70 hover:text-amber-700">
                Keep editing
              </button>
            </span>
          </div>
        )}
        <div className="flex items-center gap-1 bg-surface-3 p-1 rounded-xl border border-line">
          {toolBtn('select', 'Select / Move', <MousePointer className="w-4 h-4" />)}
          {toolBtn('sticky', 'Sticky Note', <StickyNote className="w-4 h-4" />)}
          {toolBtn('rect', 'Rectangle', <Square className="w-4 h-4" />)}
          {toolBtn('ellipse', 'Ellipse', <Circle className="w-4 h-4" />)}
          {toolBtn('diamond', 'Diamond', <Diamond className="w-4 h-4" />)}
          {toolBtn('text', 'Text Label', <Type className="w-4 h-4" />)}
          {toolBtn('arrow', 'Arrow', <ArrowRight className="w-4 h-4" />)}
          {toolBtn('line', 'Line', <Minus className="w-4 h-4" />)}
          {toolBtn('path', 'Freehand Pen', <Pencil className="w-4 h-4" />)}
          {toolBtn('eraser', 'Eraser', <Eraser className="w-4 h-4" />)}
          {toolBtn('pan', 'Pan / Hand', <Hand className="w-4 h-4" />)}
        </div>

        <div className="flex items-center gap-1.5 bg-surface-3 px-2.5 py-1.5 rounded-xl border border-line">
          {(activeTool === 'sticky' ? STICKY_COLORS : STROKE_COLORS).map(c => (
            <button
              key={c}
              type="button"
              onClick={() => {
                // In select mode with a selection, recolor the selection (bulk styling)
                if (activeTool === 'select' && selectedIds.length) applyStyleToSelection({ color: c });
                else if (activeTool === 'sticky') setStickyColor(c);
                else setSelectedColor(c);
              }}
              aria-label={`Apply color ${c}${activeTool === 'select' && selectedIds.length ? ' to selection' : ''}`}
              className={`w-5 h-5 rounded-full border transition-transform ${
                (activeTool === 'sticky' ? stickyColor : selectedColor) === c
                  ? 'scale-125 ring-2 ring-indigo-500 ring-offset-1 ring-offset-[#0A0A0B]'
                  : 'border-line-strong'
              }`}
              style={{ backgroundColor: c }}
              title={`Select ${c}`}
            />
          ))}
        </div>

        {(isSelectTool && selHasStroke) || (activeTool !== 'sticky' && activeTool !== 'pan' && activeTool !== 'eraser' && activeTool !== 'select') ? (
          <div className="flex items-center gap-1 bg-surface-3 p-1 rounded-xl border border-line text-xs" role="group" aria-label="Stroke width">
            {STROKE_WIDTHS.map(sw => (
              <button
                key={sw.size}
                type="button"
                onClick={() => {
                  if (activeTool === 'select' && selectedIds.length) applyStyleToSelection({ strokeWidth: sw.size });
                  else setStrokeWidth(sw.size);
                }}
                aria-pressed={strokeWidth === sw.size}
                className={`px-2 py-1 rounded-md font-bold transition-all ${
                  strokeWidth === sw.size ? 'bg-indigo-600 text-white' : 'text-content-faint hover:text-white'
                }`}
              >
                {sw.label}
              </button>
            ))}
          </div>
        ) : null}

        {activeTool === 'select' && selHasText && (
          <div className="flex items-center gap-1 bg-surface-3 p-1 rounded-xl border border-line text-xs" role="group" aria-label="Font size">
            {FONT_SIZES.map(fs => (
              <button
                key={fs}
                type="button"
                onClick={() => {
                  const ids = new Set(selectedIds);
                  commit(objectsRef.current.map(o => (ids.has(o.id) && !o.locked && (o.type === 'sticky' || o.type === 'text') ? { ...o, fontSize: fs } : o)));
                }}
                className="px-2 py-1 rounded-md font-bold transition-all text-content-faint hover:text-white hover:bg-slate-800"
                title={`Set font size ${fs}px on selected text`}
                aria-label={`Set font size ${fs} pixels on selected text`}
              >
                {fs}
              </button>
            ))}
          </div>
        )}

        {activeTool === 'eraser' && (
          <div className="flex items-center gap-1 bg-surface-3 p-1 rounded-xl border border-line text-xs" role="group" aria-label="Eraser size">
            {[{ label: 'Small', size: 6 }, { label: 'Medium', size: 12 }, { label: 'Large', size: 22 }].map(s => (
              <button
                key={s.size}
                type="button"
                onClick={() => setEraserSize(s.size)}
                aria-pressed={eraserSize === s.size}
                className={`px-2 py-1 rounded-md font-bold transition-all ${
                  eraserSize === s.size ? 'bg-indigo-600 text-white' : 'text-content-faint hover:text-white'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}

        {(activeTool === 'rect' || activeTool === 'ellipse' || activeTool === 'diamond' || (activeTool === 'select' && selHasShape)) ? (
          <div className="flex items-center gap-1 bg-surface-3 p-1 rounded-xl border border-line text-xs" role="group" aria-label="Shape fill and dash">
            <button
              type="button"
              onClick={() => {
                if (activeTool === 'select' && selectedIds.length) {
                  const ids = new Set(selectedIds);
                  const target = !selAllFill;
                  commit(objectsRef.current.map(o => (ids.has(o.id) && !o.locked && (o.type === 'rect' || o.type === 'ellipse' || o.type === 'diamond') ? { ...o, fill: target } : o)));
                } else setFillShape(v => !v);
              }}
              aria-pressed={activeTool === 'select' ? selAllFill : fillShape}
              className={`px-2 py-1 rounded-md font-bold transition-all ${(activeTool === 'select' ? selAllFill : fillShape) ? 'bg-indigo-600 text-white' : 'text-content-faint hover:text-white'}`}
            >
              Fill
            </button>
            <button
              type="button"
              onClick={() => {
                if (activeTool === 'select' && selectedIds.length) {
                  const ids = new Set(selectedIds);
                  const target = !selAllDash;
                  commit(objectsRef.current.map(o => (ids.has(o.id) && !o.locked && (o.type === 'rect' || o.type === 'ellipse' || o.type === 'diamond' || o.type === 'arrow' || o.type === 'line') ? { ...o, dash: target } : o)));
                } else setDashShape(v => !v);
              }}
              aria-pressed={activeTool === 'select' ? selAllDash : dashShape}
              className={`px-2 py-1 rounded-md font-bold transition-all ${(activeTool === 'select' ? selAllDash : dashShape) ? 'bg-indigo-600 text-white' : 'text-content-faint hover:text-white'}`}
            >
              Dash
            </button>
          </div>
        ) : (activeTool === 'arrow' || activeTool === 'line' || (activeTool === 'select' && selHasDashable && !selHasShape)) ? (
          <div className="flex items-center gap-1 bg-surface-3 p-1 rounded-xl border border-line text-xs">
            <button
              type="button"
              onClick={() => {
                if (activeTool === 'select' && selectedIds.length) {
                  const ids = new Set(selectedIds);
                  const target = !selAllDash;
                  commit(objectsRef.current.map(o => (ids.has(o.id) && !o.locked && (o.type === 'arrow' || o.type === 'line') ? { ...o, dash: target } : o)));
                } else setDashShape(v => !v);
              }}
              aria-pressed={activeTool === 'select' ? selAllDash : dashShape}
              className={`px-2 py-1 rounded-md font-bold transition-all ${(activeTool === 'select' ? selAllDash : dashShape) ? 'bg-indigo-600 text-white' : 'text-content-faint hover:text-white'}`}
            >
              Dash
            </button>
          </div>
        ) : null}

        <div className="flex items-center gap-1.5 ml-auto">
          <button
            type="button"
            onClick={handleUndo}
            disabled={histState.index <= 0}
            aria-label="Undo"
            className="p-2 rounded-xl text-content-faint hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent"
            title="Undo (Ctrl+Z)"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={handleRedo}
            disabled={histState.index >= histState.length - 1}
            aria-label="Redo"
            className="p-2 rounded-xl text-content-faint hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent"
            title="Redo (Ctrl+Shift+Z)"
          >
            <RotateCw className="w-4 h-4" />
          </button>
          <div className="w-px h-5 bg-line-strong" />
          <button
            type="button"
            onClick={bringToFront}
            disabled={!selectedIds.length}
            className="p-2 rounded-xl text-content-faint hover:text-white hover:bg-slate-800 disabled:opacity-30"
            title="Bring to front (])"
            aria-label="Bring selection to front"
          >
            <BringToFront className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={sendToBack}
            disabled={!selectedIds.length}
            className="p-2 rounded-xl text-content-faint hover:text-white hover:bg-slate-800 disabled:opacity-30"
            title="Send to back ([)"
            aria-label="Send selection to back"
          >
            <SendToBack className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={duplicateSelected}
            disabled={!selectedIds.length}
            className="p-2 rounded-xl text-content-faint hover:text-white hover:bg-slate-800 disabled:opacity-30"
            title="Duplicate (Ctrl+D)"
            aria-label="Duplicate selection"
          >
            <Copy className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={deleteSelected}
            disabled={!selectedIds.length}
            className="p-2 rounded-xl text-rose-400 hover:bg-rose-950/40 disabled:opacity-30"
            title="Delete (Del)"
            aria-label="Delete selection"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <div className="w-px h-5 bg-line-strong" />
          <button
            type="button"
            onClick={() => setGridSnap(v => !v)}
            aria-pressed={gridSnap}
            className={`p-2 rounded-xl transition-all ${gridSnap ? 'text-indigo-400 bg-indigo-500/10' : 'text-content-faint hover:text-white hover:bg-slate-800'}`}
            title="Toggle grid snap"
            aria-label="Toggle grid snap"
          >
            <Grid3x3 className="w-4 h-4" />
          </button>
          <button type="button" onClick={() => zoomTo(camRef.current.z / 1.2)} className="p-2 rounded-xl text-content-faint hover:text-white hover:bg-slate-800" title="Zoom out (-)" aria-label="Zoom out">
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-xs text-content-faint font-mono w-10 text-center" role="status" aria-label={`Zoom ${Math.round(camRef.current.z * 100)} percent`}>{Math.round(camRef.current.z * 100)}%</span>
          <button type="button" onClick={() => zoomTo(camRef.current.z * 1.2)} className="p-2 rounded-xl text-content-faint hover:text-white hover:bg-slate-800" title="Zoom in (+)" aria-label="Zoom in">
            <Plus className="w-4 h-4" />
          </button>
          <button type="button" onClick={fitToContent} className="px-2 py-1 rounded-xl text-xs text-content-faint hover:text-white hover:bg-slate-800" title="Fit to content (0)">
            Fit
          </button>
          <button
            type="button"
            onClick={() => setIsFullscreen(v => !v)}
            className="p-2 rounded-xl text-content-faint hover:text-white hover:bg-slate-800"
            title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Expand sketch'}
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Expand sketch'}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
          <div className="w-px h-5 bg-line-strong" />
          <button type="button" onClick={handleDownload} className="p-2 rounded-xl text-content-faint hover:text-white hover:bg-slate-800" title="Download PNG image" aria-label="Download PNG image">
            <Download className="w-4 h-4" />
          </button>
          <button type="button" onClick={handleDownloadSVG} className="p-2 rounded-xl text-content-faint hover:text-white hover:bg-slate-800" title="Download SVG" aria-label="Download SVG">
            <FileCode className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => void copyImageToClipboard()}
            className="p-2 rounded-xl text-content-faint hover:text-white hover:bg-slate-800"
            title="Copy canvas image to clipboard"
            aria-label="Copy canvas image to clipboard"
          >
            {copiedImg ? <Check className="w-4 h-4 text-emerald-400" /> : <ClipboardCopy className="w-4 h-4" />}
          </button>
          <button type="button" onClick={exportJson} className="p-2 rounded-xl text-content-faint hover:text-white hover:bg-slate-800" title="Export board as JSON" aria-label="Export board as JSON">
            <FileJson className="w-4 h-4" />
          </button>
          <label className="p-2 rounded-xl text-content-faint hover:text-white hover:bg-slate-800 cursor-pointer" title="Import board JSON (appends to canvas)" aria-label="Import board JSON">
            <Upload className="w-4 h-4" />
            <input type="file" accept=".json,application/json" className="sr-only" onChange={e => { const f = e.target.files?.[0]; if (f) void importJsonFile(f); e.target.value = ''; }} />
          </label>
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowTemplates(v => !v)}
              aria-expanded={showTemplates}
              aria-label="Insert template"
              className={`p-2 rounded-xl transition-all ${showTemplates ? 'bg-indigo-600 text-white' : 'text-content-faint hover:text-white hover:bg-slate-800'}`}
              title="Insert template (mindmap, flowchart, kanban)"
            >
              <LayoutTemplate className="w-4 h-4" />
            </button>
            {showTemplates && (
              <div className="absolute right-0 top-full z-30 mt-2 w-52 overflow-hidden rounded-xl border border-line bg-surface shadow-2xl" role="menu" aria-label="Insert template">
                {(['mindmap', 'flowchart', 'kanban'] as const).map(kind => (
                  <button
                    key={kind}
                    type="button"
                    role="menuitem"
                    onClick={() => insertTemplate(kind)}
                    className="flex w-full flex-col gap-0.5 px-3.5 py-2.5 text-left hover:bg-surface-2 focus-visible:outline-none focus-visible:bg-surface-2"
                  >
                    <span className="text-xs font-black capitalize text-content">{kind}</span>
                    <span className="text-[11px] text-content-faint">
                      {kind === 'mindmap' ? 'Central idea with 4 branches' : kind === 'flowchart' ? 'Start, decision, two outcomes' : 'Todo / Doing / Done columns'}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={clearBoard}
            disabled={!objectsRef.current.length && !armClear}
            className={`p-2 rounded-xl transition-all ${armClear ? 'bg-rose-600 text-white' : 'text-content-faint hover:text-rose-300 hover:bg-rose-950/40'} disabled:opacity-30`}
            title={armClear ? 'Click again to confirm clearing the board' : 'Clear board'}
            aria-label={armClear ? 'Confirm clear board' : 'Clear board'}
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black shadow-sm transition-all disabled:opacity-60 disabled:cursor-wait"
          >
            <Check className="w-3.5 h-3.5" />
            <span>{isSaving ? 'Saving…' : 'Attach Sketch'}</span>
          </button>
          {onClose && (
            <button type="button" onClick={onClose} aria-label="Close sketch editor" className="p-2 rounded-xl text-content-faint hover:text-white hover:bg-slate-800">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Selection strip: arrange + connector controls */}
      {selectedIds.length > 0 && (
        <div className="px-3 py-2 bg-surface-inverse border-b border-line flex flex-wrap items-center gap-x-1 gap-y-1.5 text-[11px]" role="toolbar" aria-label="Selection actions">
          <span className="px-1 font-black uppercase tracking-wider text-content-faint">Arrange</span>
          {stripBtn('L', 'Align left', () => alignSelected('left'), selUnlocked.length < 2)}
          {stripBtn('C', 'Align center horizontally', () => alignSelected('centerX'), selUnlocked.length < 2)}
          {stripBtn('R', 'Align right', () => alignSelected('right'), selUnlocked.length < 2)}
          {stripBtn('T', 'Align top', () => alignSelected('top'), selUnlocked.length < 2)}
          {stripBtn('M', 'Align middle vertically', () => alignSelected('middle'), selUnlocked.length < 2)}
          {stripBtn('B', 'Align bottom', () => alignSelected('bottom'), selUnlocked.length < 2)}
          {stripBtn('Dist H', 'Distribute horizontally (3+ selected)', () => distributeSelected('h'), selUnlocked.length < 3)}
          {stripBtn('Dist V', 'Distribute vertically (3+ selected)', () => distributeSelected('v'), selUnlocked.length < 3)}
          <span className="w-px h-4 bg-line-strong mx-1" />
          {stripBtn('Group', 'Group selection (moves together)', groupSelected, selUnlocked.length < 2)}
          {stripBtn('Ungroup', 'Ungroup selection', ungroupSelected, !selObjs.some(o => o.groupId))}
          {stripBtn(selAllLocked ? 'Unlock' : 'Lock', selAllLocked ? 'Unlock selection' : 'Lock selection (stays selectable, cannot move or edit)', toggleLockSelected, false, selAllLocked)}
          <span className="w-px h-4 bg-line-strong mx-1" />
          {stripBtn('Front', 'Bring to front', bringToFront)}
          {stripBtn('Fwd', 'Bring forward one step', () => reorderSelected('forward'), selectedIds.length !== 1)}
          {stripBtn('Bwd', 'Send backward one step', () => reorderSelected('backward'), selectedIds.length !== 1)}
          {stripBtn('Back', 'Send to back', sendToBack)}
          {selSingleArrow && (
            <>
              <span className="w-px h-4 bg-line-strong mx-1" />
              <span className="px-1 font-black uppercase tracking-wider text-content-faint">Route</span>
              {stripBtn('Straight', 'Straight connector', () => setArrowRoute('straight'), false, (selSingleArrow.route || 'straight') === 'straight')}
              {stripBtn('Curve', 'Curved connector', () => setArrowRoute('curve'), false, selSingleArrow.route === 'curve')}
              {stripBtn('Elbow', 'Elbow connector', () => setArrowRoute('elbow'), false, selSingleArrow.route === 'elbow')}
              {(selSingleArrow.startBinding || selSingleArrow.endBinding) &&
                stripBtn('Unbind', 'Detach connector from shapes (keeps position)', () => unbindArrow(selSingleArrow!))}
              {(!selSingleArrow.route || selSingleArrow.route === 'elbow') && (
                <span className="px-1 font-bold text-content-faint">Double-click adds corners · Alt+click removes</span>
              )}
              <input
                key={selSingleArrow.id}
                defaultValue={selSingleArrow.label || ''}
                placeholder="Label…"
                aria-label="Connector label"
                onBlur={e => commitArrowLabel(e.currentTarget.value)}
                onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                className="w-28 rounded-md border border-line bg-surface-3 px-2 py-1 text-[11px] text-content outline-none focus:border-indigo-500"
              />
            </>
          )}
          {selAllLocked && <span className="px-1 font-bold text-content-faint">Locked — unlock to edit</span>}
        </div>
      )}

      {/* Canvas Area */}
      <div
        ref={containerRef}
        onPaste={handleCanvasPaste}
        className={`relative flex items-center justify-center p-4 bg-surface-inverse overflow-auto ${
          isFullscreen ? 'flex-1 min-h-0' : 'min-h-[400px]'
        }`}
      >
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={onDoubleClick}
          className="rounded-2xl shadow-xl border border-line bg-white touch-none max-w-full"
          style={{ cursor, touchAction: 'none' }}
          tabIndex={0}
          role="application"
          aria-label={`Sketch canvas with ${objects.length} objects${selectedIds.length ? `, ${selectedIds.length} selected` : ''}. Arrow keys nudge the selection, Delete removes it.`}
        />

        {editingId && (
          <textarea
            autoFocus
            value={editText}
            onChange={e => setEditText(e.target.value)}
            onBlur={commitEditing}
            onKeyDown={e => {
              if (e.key === 'Escape') {
                e.preventDefault();
                commitEditing();
              }
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                commitEditing();
              }
            }}
            placeholder="Type text…"
            aria-label="Sketch text editor. Escape or Control Enter to finish."
            className="absolute z-20 bg-surface-3 p-2 rounded-xl shadow-2xl border border-line-strong text-sm text-content outline-none focus:border-indigo-500 resize-none"
            style={editorStyle}
            rows={4}
          />
        )}

        {/* Minimap overview: click or drag to move the viewport */}
        <div className="absolute bottom-3 right-3 z-10 rounded-xl border border-line bg-surface-inverse/95 p-1.5 shadow-xl">
          <canvas
            ref={miniRef}
            style={{ width: MINI_W, height: MINI_H }}
            className="block rounded-lg cursor-crosshair touch-none"
            role="img"
            aria-label="Minimap overview. Click or drag to move the canvas viewport."
            onPointerDown={e => {
              (e.target as Element).setPointerCapture?.(e.pointerId);
              miniDragRef.current = true;
              miniGoto(e.clientX, e.clientY);
            }}
            onPointerMove={e => {
              if (miniDragRef.current) miniGoto(e.clientX, e.clientY);
            }}
            onPointerUp={() => {
              miniDragRef.current = false;
            }}
            onPointerCancel={() => {
              miniDragRef.current = false;
            }}
          />
        </div>
      </div>

      {saveError && (
        <div className="px-4 py-2 bg-rose-950/40 border-t border-rose-900/60 text-xs text-rose-200" role="alert">
          {saveError}
        </div>
      )}
      <div className="px-4 py-2.5 bg-surface-inverse border-t border-line flex items-center justify-between text-xs text-content-faint font-mono">
        <span>Double-click / double-tap text to edit · double-click a connector for corners · drag the minimap to travel.</span>
        <span className="text-indigo-400 font-bold">{gridSnap ? `Grid ${GRID}px` : 'Free'}</span>
      </div>
    </div>
  );
};

// ---- drawing of a single object (module-level, uses world coords) ----
// Decoded bitmap cache for pasted `image` objects (keyed by data-URL).
// drawObject is synchronous, so first paint draws a placeholder and the
// onload callback asks the mounted canvas to repaint via requestDraw.
const sketchImageCache = new Map<string, HTMLImageElement>();
let sketchImageNotify: (() => void) | null = null;
export function registerSketchImageNotify(fn: (() => void) | null) {
  sketchImageNotify = fn;
}
function cachedSketchImage(src: string): HTMLImageElement | null {
  let img = sketchImageCache.get(src);
  if (!img) {
    img = new Image();
    img.onload = () => sketchImageNotify?.();
    img.src = src;
    sketchImageCache.set(src, img);
    return null;
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

function drawObject(ctx: CanvasRenderingContext2D, o: SketchObject, byId: Map<string, SketchObject>) {
  if (o.type === 'image') {
    const img = o.src ? cachedSketchImage(o.src) : null;
    if (img) {
      ctx.drawImage(img, o.x, o.y, o.w, o.h);
    } else {
      ctx.save();
      ctx.fillStyle = '#e0e7ff';
      ctx.strokeStyle = '#818cf8';
      ctx.setLineDash([6, 4]);
      ctx.fillRect(o.x, o.y, o.w, o.h);
      ctx.strokeRect(o.x, o.y, o.w, o.h);
      ctx.restore();
    }
    return;
  }
  if (o.type === 'sticky') {
    ctx.fillStyle = o.color;
    roundRect(ctx, o.x, o.y, o.w, o.h, 10);
    ctx.fill();
    ctx.fillStyle = '#1f2937';
    const sfs = o.fontSize || 14;
    ctx.font = `${sfs}px sans-serif`;
    ctx.textBaseline = 'top';
    wrapText(ctx, o.text || '', o.x + 12, o.y + 12, o.w - 24, sfs + 4);
    return;
  }
  if (o.type === 'rect' || o.type === 'ellipse' || o.type === 'diamond') {
    ctx.strokeStyle = o.color;
    ctx.lineWidth = o.strokeWidth || 3;
    ctx.setLineDash(o.dash ? [8, 6] : []);
    ctx.beginPath();
    if (o.type === 'rect') {
      roundRect(ctx, o.x, o.y, o.w, o.h, 4);
    } else if (o.type === 'ellipse') {
      ctx.ellipse(o.x + o.w / 2, o.y + o.h / 2, Math.abs(o.w / 2), Math.abs(o.h / 2), 0, 0, Math.PI * 2);
    } else {
      ctx.moveTo(o.x + o.w / 2, o.y);
      ctx.lineTo(o.x + o.w, o.y + o.h / 2);
      ctx.lineTo(o.x + o.w / 2, o.y + o.h);
      ctx.lineTo(o.x, o.y + o.h / 2);
      ctx.closePath();
    }
    if (o.fill) {
      ctx.fillStyle = o.color;
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.stroke();
    }
    ctx.setLineDash([]);
    return;
  }
  if (o.type === 'text') {
    ctx.fillStyle = o.color;
    const fs = o.fontSize || 18;
    ctx.font = `${fs}px sans-serif`;
    ctx.textBaseline = 'top';
    wrapText(ctx, o.text || '', o.x, o.y, 10000, fs * 1.25);
    return;
  }
  if (o.type === 'path') {
    if (o.points && o.points.length >= 4) {
      const d = freehandPath(o.points, (o.strokeWidth || 3) * 2);
      ctx.fillStyle = o.color;
      ctx.fill(new Path2D(d));
    }
    return;
  }
  if (o.type === 'arrow' || o.type === 'line') {
    const { x0, y0, x1, y1 } = resolveArrow(o, byId);
    const routed = routeConnector(o.route, x0, y0, x1, y1, o.waypoints);
    ctx.strokeStyle = o.color;
    ctx.lineWidth = o.strokeWidth || 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash(o.dash ? [8, 6] : []);
    ctx.beginPath();
    if (routed.kind === 'curve' && routed.control) {
      ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo(routed.control.x, routed.control.y, x1, y1);
    } else {
      // Straight (2 pts) and elbow (N pts) both stroke as polylines
      ctx.moveTo(routed.pts[0], routed.pts[1]);
      for (let i = 2; i < routed.pts.length; i += 2) ctx.lineTo(routed.pts[i], routed.pts[i + 1]);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    if (o.type === 'arrow') {
      const head = o.arrowhead || 'end';
      const len = 12 + (o.strokeWidth || 3) * 1.5;
      if (head === 'end' || head === 'both') {
        arrowHead(ctx, x1, y1, routed.endAngle, len, o.color);
      }
      if (head === 'start' || head === 'both') {
        arrowHead(ctx, x0, y0, routed.startAngle + Math.PI, len, o.color);
      }
    }
    if (o.label) {
      ctx.save();
      ctx.font = '12px sans-serif';
      ctx.textBaseline = 'middle';
      const w = ctx.measureText(o.label).width;
      const { x: lx, y: ly } = routed.label;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(lx - w / 2 - 4, ly - 9, w + 8, 18);
      ctx.fillStyle = '#0f172a';
      ctx.fillText(o.label, lx - w / 2, ly);
      ctx.restore();
    }
    return;
  }
}

function arrowHead(ctx: CanvasRenderingContext2D, x: number, y: number, ang: number, len: number, color: string) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - len * Math.cos(ang - Math.PI / 7), y - len * Math.sin(ang - Math.PI / 7));
  ctx.lineTo(x - len * Math.cos(ang + Math.PI / 7), y - len * Math.sin(ang + Math.PI / 7));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ---- SVG export ----
function svgEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function svgArrowHead(x: number, y: number, ang: number, len: number, color: string): string {
  const p1 = `${x - len * Math.cos(ang - Math.PI / 7)},${y - len * Math.sin(ang - Math.PI / 7)}`;
  const p2 = `${x - len * Math.cos(ang + Math.PI / 7)},${y - len * Math.sin(ang + Math.PI / 7)}`;
  return `<polygon points="${x},${y} ${p1} ${p2}" fill="${color}"/>`;
}

function svgForObject(o: SketchObject, byId: Map<string, SketchObject>): string {
  const sw = o.strokeWidth || 3;
  if (o.type === 'image') {
    if (!o.src) return '';
    return `<image href="${svgEscape(o.src)}" x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" preserveAspectRatio="xMidYMid meet"/>`;
  }
  if (o.type === 'sticky') {
    // Same metrics as canvas: per-object font size, 12px pad, fs+4 rhythm
    const fs = o.fontSize || 14;
    const lh = fs + 4;
    const lines = wrapLinesForSvg(o.text || '', Math.max(10, o.w - 24), `${fs}px sans-serif`);
    const tspans = lines
      .map((ln, i) => `<tspan x="${o.x + 12}" y="${o.y + 12 + fs + lh * i}">${svgEscape(ln)}</tspan>`)
      .join('');
    return `<g><rect x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" rx="10" fill="${o.color}"/><text font-family="sans-serif" font-size="${fs}" fill="#1f2937">${tspans}</text></g>`;
  }
  if (o.type === 'rect' || o.type === 'ellipse' || o.type === 'diamond') {
    const stroke = `stroke="${o.color}" stroke-width="${sw}" fill="${o.fill ? o.color : 'none'}"${o.dash ? ' stroke-dasharray="8 6"' : ''}`;
    if (o.type === 'rect') return `<rect x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" rx="4" ${stroke}/>`;
    if (o.type === 'ellipse')
      return `<ellipse cx="${o.x + o.w / 2}" cy="${o.y + o.h / 2}" rx="${Math.abs(o.w / 2)}" ry="${Math.abs(o.h / 2)}" ${stroke}/>`;
    const pts = `${o.x + o.w / 2},${o.y} ${o.x + o.w},${o.y + o.h / 2} ${o.x + o.w / 2},${o.y + o.h} ${o.x},${o.y + o.h / 2}`;
    return `<polygon points="${pts}" ${stroke}/>`;
  }
  if (o.type === 'text') {
    const fs = o.fontSize || 18;
    const lines = wrapLinesForSvg(o.text || '', 10000, `${fs}px sans-serif`);
    const tspans = lines.map((ln, i) => `<tspan x="${o.x}" y="${o.y + fs + fs * 1.25 * i}">${svgEscape(ln)}</tspan>`).join('');
    return `<text font-family="sans-serif" font-size="${fs}" fill="${o.color}">${tspans}</text>`;
  }
  if (o.type === 'path') {
    if (o.points && o.points.length >= 4) {
      const d = freehandPath(o.points, sw * 2);
      return `<path d="${d}" fill="${o.color}"/>`;
    }
    return '';
  }
  if (o.type === 'arrow' || o.type === 'line') {
    const { x0, y0, x1, y1 } = resolveArrow(o, byId);
    const routed = routeConnector(o.route, x0, y0, x1, y1, o.waypoints);
    const stroke = `stroke="${o.color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"${o.dash ? ' stroke-dasharray="8 6"' : ''}`;
    let s: string;
    if (routed.kind === 'curve' && routed.control) {
      s = `<path d="M${x0},${y0} Q${routed.control.x},${routed.control.y} ${x1},${y1}" ${stroke} fill="none"/>`;
    } else if (routed.kind === 'elbow') {
      const pairs: string[] = [];
      for (let i = 0; i < routed.pts.length; i += 2) pairs.push(`${routed.pts[i]},${routed.pts[i + 1]}`);
      s = `<polyline points="${pairs.join(' ')}" ${stroke} fill="none"/>`;
    } else {
      s = `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" ${stroke} fill="none"/>`;
    }
    if (o.type === 'arrow') {
      const head = o.arrowhead || 'end';
      const len = 12 + sw * 1.5;
      if (head === 'end' || head === 'both') s += svgArrowHead(x1, y1, routed.endAngle, len, o.color);
      if (head === 'start' || head === 'both') s += svgArrowHead(x0, y0, routed.startAngle + Math.PI, len, o.color);
    }
    if (o.label) {
      const { x: lx, y: ly } = routed.label;
      s += `<g><rect x="${lx - 4}" y="${ly - 9}" width="${o.label.length * 7 + 8}" height="18" rx="4" fill="#ffffff"/><text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif" font-size="12" fill="#0f172a">${svgEscape(o.label)}</text></g>`;
    }
    return s;
  }
  return '';
}

export default SketchCanvas;
