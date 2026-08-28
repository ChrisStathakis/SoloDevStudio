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
} from 'lucide-react';
import type { SketchObject, SketchObjectType } from '../types';
import {
  bbox,
  unionBox,
  pointInBox,
  distToSegment,
  segSegDist,
  hitTest,
  resolveArrow,
  wrapText,
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
      body: (seed.techStack && seed.techStack.length ? seed.techStack : []).map(t => `� ${t}`).join('\n'),
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
  const mapX = (v: number) => nb.x + (v - ob.x) * sx;
  const mapY = (v: number) => nb.y + (v - ob.y) * sy;
  if (o.type === 'path' || o.type === 'arrow' || o.type === 'line') {
    const np = (o.points || []).map((v, i) => (i % 2 === 0 ? mapX(v) : mapY(v)));
    return { ...o, points: np };
  }
  return { ...o, x: mapX(o.x), y: mapY(o.y), w: o.w * sx, h: o.h * sy };
}

function newBoxFromHandle(orig: Box, dir: HandleDir, wx: number, wy: number): Box {
  let { x, y, w, h } = orig;
  let x2 = x + w;
  let y2 = y + h;
  if (dir.includes('w')) x = wx;
  if (dir.includes('e')) x2 = wx;
  if (dir.includes('n')) y = wy;
  if (dir.includes('s')) y2 = wy;
  const nx = Math.min(x, x2);
  const ny = Math.min(y, y2);
  const nw = Math.max(20, Math.abs(x2 - x));
  const nh = Math.max(20, Math.abs(y2 - y));
  return { x: nx, y: ny, w: nw, h: nh };
}

function segmentHitsBox(b: Box, x0: number, y0: number, x1: number, y1: number, tol: number): boolean {
  if (pointInBox(b, x0, y0, tol) || pointInBox(b, x1, y1, tol)) return true;
  const corners = [
    [b.x, b.y],
    [b.x + b.w, b.y],
    [b.x + b.w, b.y + b.h],
    [b.x, b.y + b.h],
  ];
  for (let i = 0; i < 4; i++) {
    const [cx, cy] = corners[i];
    const [nx, ny] = corners[(i + 1) % 4];
    if (distToSegment(cx, cy, x0, y0, x1, y1) <= tol) return true;
  }
  return false;
}

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
    mode: 'drag' | 'resize' | 'draw' | 'drawpath' | 'pan' | 'marquee' | 'erase' | 'pinch';
    handle?: HandleDir;
    startX: number;
    startY: number;
    orig?: SketchObject;
    origBox?: Box;
    id?: string;
    lastX?: number;
    lastY?: number;
    pinchDist?: number;
    pinchMid?: { x: number; y: number };
    origObjects?: SketchObject[];
  } | null>(null);

  const setObjects = useCallback((updater: SketchObject[] | ((p: SketchObject[]) => SketchObject[])) => {
    setObjectsState(prev => {
      const next = typeof updater === 'function' ? (updater as Function)(prev) : updater;
      objectsRef.current = next;
      return next;
    });
  }, []);

  const setCam = useCallback((updater: Camera | ((p: Camera) => Camera)) => {
    setCamState(prev => {
      const next = typeof updater === 'function' ? (updater as Function)(prev) : updater;
      camRef.current = next;
      return next;
    });
  }, []);

  const pushHistory = useCallback((snap?: SketchObject[]) => {
    const s = snap ?? JSON.parse(JSON.stringify(objectsRef.current));
    const cur = historyRef.current.slice(0, histIndexRef.current + 1);
    cur.push(s);
    if (cur.length > HISTORY_LIMIT) cur.shift();
    historyRef.current = cur;
    histIndexRef.current = cur.length - 1;
  }, []);

  const commit = useCallback(
    (next: SketchObject[], record = true) => {
      setObjects(next);
      if (record) pushHistory(next);
    },
    [setObjects, pushHistory],
  );

  const setActiveTool = (t: Tool) => {
    setActiveToolState(t);
    if (t !== 'select' && t !== 'pan') setSelectedIds([]);
  };

  // Initialize
  useEffect(() => {
    let initial: SketchObject[] = [];
    let draftCam: Camera | null = null;
    if (id) {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(`solodev:sketch-draft:${id}`) : null;
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed.objects && parsed.objects.length) {
            initial = parsed.objects;
            if (parsed.cam) draftCam = parsed.cam;
          }
        } catch {
          /* ignore corrupt draft */
        }
      }
    }
    if (!initial.length && initialObjects && initialObjects.length) {
      initial = initialObjects;
    } else if (!initial.length && seed) {
      initial = buildSeed(seed);
    }
    if (draftCam) setCam(draftCam);
    if (initialDataUrl) {
      const img = new Image();
      img.onload = () => setLegacyImg(img);
      img.src = initialDataUrl;
    }
    setObjects(initial);
    historyRef.current = [JSON.parse(JSON.stringify(initial))];
    histIndexRef.current = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          JSON.stringify({ objects: objectsRef.current, cam: camRef.current }),
        );
      } catch {
        /* ignore quota errors */
      }
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objects, cam]);

  const dpr = typeof window !== 'undefined' ? Math.max(1, window.devicePixelRatio || 1) : 1;

  const cloneObjects = (items: SketchObject[]): SketchObject[] =>
    JSON.parse(JSON.stringify(items)) as SketchObject[];

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

      if (showGrid) {
        ctx.fillStyle = '#e2e8f0';
        const x0 = Math.floor((-offset.x / zoom) / GRID) * GRID;
        const y0 = Math.floor((-offset.y / zoom) / GRID) * GRID;
        const maxX = offset.x / zoom + CANVAS_W / zoom;
        const maxY = offset.y / zoom + CANVAS_H / zoom;
        for (let gx = Math.max(0, x0); gx <= maxX; gx += GRID) {
          for (let gy = Math.max(0, y0); gy <= maxY; gy += GRID) {
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
          ctx.save();
          ctx.strokeStyle = '#4f46e5';
          ctx.lineWidth = 1.5 / zoom;
          ctx.setLineDash([6 / zoom, 4 / zoom]);
          ctx.strokeRect(ub.x - 3 / zoom, ub.y - 3 / zoom, ub.w + 6 / zoom, ub.h + 6 / zoom);
          ctx.setLineDash([]);
          const hs = 5 / zoom;
          for (const hp of handlePoints(ub)) {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(hp.x - hs, hp.y - hs, hs * 2, hs * 2);
            ctx.strokeRect(hp.x - hs, hp.y - hs, hs * 2, hs * 2);
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
        setCam(c => ({ ...c, x: c.x - e.deltaX, y: c.y - e.deltaY }));
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
      if (hitTest(o, wx, wy, o.type === 'sticky' || o.type === 'text' ? 0 : t)) return o;
    }
    return null;
  };

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
      if (selectedIds.length) {
        const sel = objectsRef.current.filter(o => selectedIds.includes(o.id));
        const ub = unionBox(sel.map(bbox))!;
        const hs = 6 / camRef.current.z;
        const hp = handlePoints(ub).find(p => Math.abs(p.x - x) <= hs && Math.abs(p.y - y) <= hs);
        if (hp) {
          dragRef.current = {
            mode: 'resize',
            handle: hp.dir,
            origBox: ub,
            startX: x,
            startY: y,
            origObjects: cloneObjects(sel),
          };
          return;
        }
      }
      const hit = topHit(x, y);
      if (hit) {
        const nextIds = e.shiftKey
          ? (selectedIds.includes(hit.id)
            ? selectedIds.filter(i => i !== hit.id)
            : [...selectedIds, hit.id])
          : (selectedIds.includes(hit.id) ? selectedIds : [hit.id]);
        setSelectedIds(nextIds);
        if (nextIds.includes(hit.id)) {
          const selectedObjects = objectsRef.current.filter(o => nextIds.includes(o.id));
          const sb = unionBox(selectedObjects.map(bbox)) || bbox(hit);
          dragRef.current = {
            mode: 'drag',
            startX: x,
            startY: y,
            origBox: sb,
            origObjects: cloneObjects(selectedObjects),
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

    if (d.mode === 'erase') {
      eraseAt(d.lastX!, d.lastY!, x, y);
      d.lastX = x;
      d.lastY = y;
      return;
    }

    if (d.mode === 'drag' && d.origBox) {
      let dx = x - d.startX;
      let dy = y - d.startY;
      if (gridSnap && !e.altKey) {
        dx = snap(dx, GRID);
        dy = snap(dy, GRID);
      }
      const sel = selectedIds;
      const originals = d.origObjects || objectsRef.current.filter(o => sel.includes(o.id));
      const originalById = new Map<string, SketchObject>(originals.map(o => [o.id, o]));
      const others = objectsRef.current.filter(o => !sel.includes(o.id)).map(bbox);
      const trial: Box = { x: d.origBox.x + dx, y: d.origBox.y + dy, w: d.origBox.w, h: d.origBox.h };
      const res = snapBox(trial, others, 6 / camRef.current.z);
      dx = res.box.x - d.origBox.x;
      dy = res.box.y - d.origBox.y;
      guidesRef.current = { vertical: res.vertical, horizontal: res.horizontal };
      setObjects(prev =>
        prev.map(o => {
          const original = originalById.get(o.id);
          if (!original) return o;
          if (original.type === 'path' || original.type === 'arrow' || original.type === 'line') {
            const pts = (original.points || []).map((v, i) => (i % 2 === 0 ? v + dx : v + dy));
            return { ...original, points: pts };
          }
          return { ...original, x: original.x + dx, y: original.y + dy };
        }),
      );
      draw();
      return;
    }

    if (d.mode === 'resize' && d.handle && d.origBox) {
      let nb = newBoxFromHandle(d.origBox, d.handle, x, y);
      if (gridSnap && !e.altKey) {
        nb = { x: snap(nb.x, GRID), y: snap(nb.y, GRID), w: snap(nb.w, GRID), h: snap(nb.h, GRID) };
      }
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
        return original ? transformBox(original, ob, nb2) : o;
      }));
      draw();
      return;
    }

    if (d.mode === 'marquee') {
      marqueeRef.current = { x0: d.startX, y0: d.startY, x1: x, y1: y };
      draw();
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
      setObjects(prev => prev.map(o => (o.id === d.id && o.points ? { ...o, points: [...o.points!, x, y] } : o)));
      return;
    }
  };

  const eraseAt = (x0: number, y0: number, x1: number, y1: number) => {
    const t = tol() + 4 / camRef.current.z;
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
    if (changed) draw();
  };

  const bindArrow = (o: SketchObject): SketchObject => {
    if (o.type !== 'arrow' && o.type !== 'line') return o;
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

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
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

    if (d?.mode === 'resize' || d?.mode === 'drag') {
      guidesRef.current = { vertical: [], horizontal: [] };
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
        const inside = objectsRef.current.filter(o => {
          const b = bbox(o);
          return b.x + b.w >= box.x && b.x <= box.x + box.w && b.y + b.h >= box.y && b.y <= box.y + box.h;
        });
        if (inside.length)
          setSelectedIds(prev => (e.shiftKey ? Array.from(new Set([...prev, ...inside.map(i => i.id)])) : inside.map(i => i.id)));
      }
      draw();
      return;
    }

    if (d?.mode === 'draw' && d.id) {
      setObjects(prev => {
        const next = prev.map(o => {
          if (o.id !== d.id) return o;
          if (o.type === 'arrow' || o.type === 'line') {
            if (
              Math.abs((o.points?.[2] || 0) - (o.points?.[0] || 0)) < 6 &&
              Math.abs((o.points?.[3] || 0) - (o.points?.[1] || 0)) < 6
            ) {
              return { ...o, points: [o.points![0], o.points![1], o.points![0] + 120, o.points![1]] };
            }
            return bindArrow(o);
          }
          if (o.w < 6 && o.h < 6) return { ...o, w: 140, h: 90, x: o.x - 70, y: o.y - 45 };
          return o;
        });
        objectsRef.current = next;
        return next;
      });
      pushHistory();
      return;
    }

    if (d?.mode === 'drawpath' && d.id) {
      setObjects(prev => {
        const next = prev.filter(o => o.id !== d.id || (o.points && o.points.length >= 4));
        objectsRef.current = next;
        return next;
      });
      pushHistory();
      return;
    }
  };

  const onDoubleClick = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = getCoords(e);
    const hit = topHit(x, y);
    if (hit && (hit.type === 'sticky' || hit.type === 'text')) {
      setSelectedIds([hit.id]);
      setEditingId(hit.id);
      setEditText(hit.text || '');
    }
  };

  const commitEditing = () => {
    if (!editingId) return;
    const id = editingId;
    const txt = editText;
    commit(objectsRef.current.map(o => (o.id === id ? { ...o, text: txt } : o)));
    setEditingId(null);
    setEditText('');
  };

  const handleUndo = () => {
    if (histIndexRef.current <= 0) return;
    histIndexRef.current -= 1;
    const snap = historyRef.current[histIndexRef.current];
    setObjects(snap);
    setSelectedIds([]);
  };

  const handleRedo = () => {
    if (histIndexRef.current >= historyRef.current.length - 1) return;
    histIndexRef.current += 1;
    setObjects(historyRef.current[histIndexRef.current]);
  };

  const deleteSelected = () => {
    if (!selectedIds.length) return;
    const kill = new Set(selectedIds);
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
    if (!selectedIds.length) return;
    const clones = objectsRef.current.filter(o => selectedIds.includes(o.id)).map(o => {
      const c = JSON.parse(JSON.stringify(o)) as SketchObject;
      c.id = uid();
      if (c.type === 'path' || c.type === 'arrow' || c.type === 'line') {
        c.points = (c.points || []).map((v, i) => (i % 2 === 0 ? v + 16 : v + 16));
      } else {
        c.x += 16;
        c.y += 16;
      }
      c.startBinding = c.startBinding ? { objectId: c.startBinding.objectId } : null;
      c.endBinding = c.endBinding ? { objectId: c.endBinding.objectId } : null;
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

  const exportDataUrl = (): string => {
    const boxes = objectsRef.current.map(bbox);
    const b = unionBox(boxes) || { x: 0, y: 0, w: CANVAS_W, h: CANVAS_H };
    const pad = 24;
    const w = Math.ceil(b.w + pad * 2);
    const h = Math.ceil(b.h + pad * 2);
    const off = document.createElement('canvas');
    off.width = Math.max(1, w);
    off.height = Math.max(1, h);
    const octx = off.getContext('2d');
    if (!octx) return '';
    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.fillStyle = '#ffffff';
    octx.fillRect(0, 0, w, h);
    if (legacyImg) octx.drawImage(legacyImg, -b.x + pad, -b.y + pad, CANVAS_W, CANVAS_H);
    const byId = new Map<string, SketchObject>(objectsRef.current.map((o): [string, SketchObject] => [o.id, o]));
    for (const o of objectsRef.current) {
      octx.save();
      octx.translate(-b.x + pad, -b.y + pad);
      drawObject(octx, o, byId);
      octx.restore();
    }
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
    for (const o of objectsRef.current) parts.push(svgForObject(o, byId));
    parts.push('</svg>');
    return parts.join('\n');
  };

  const handleSave = async () => {
    if (isSaving) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      await onSave(exportDataUrl(), cloneObjects(objectsRef.current));
      if (id) {
        try {
          localStorage.removeItem(`solodev:sketch-draft:${id}`);
        } catch {
          /* ignore */
        }
      }
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
    a.download = `idea-concept-sketch-${Date.now()}.png`;
    a.click();
  };
  const handleDownloadSVG = () => {
    const svg = exportSVG();
    const a = document.createElement('a');
    a.href = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    a.download = `idea-concept-sketch-${Date.now()}.svg`;
    a.click();
  };

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.code === 'Space') {
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
        copySelected();
        return;
      }
      if (mod && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        pasteSelected();
        return;
      }
      if (mod && e.key.toLowerCase() === 'x') {
        copySelected();
        deleteSelected();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelected();
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
      className={`p-2 rounded-lg transition-all ${
        activeTool === t ? 'bg-indigo-600 text-white shadow-sm' : 'text-content-faint hover:text-white hover:bg-slate-800'
      }`}
      title={`${title} (${shortcutFor(t)})`}
    >
      {icon}
    </button>
  );

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
              onClick={() => (activeTool === 'sticky' ? setStickyColor(c) : setSelectedColor(c))}
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

        {activeTool !== 'sticky' && activeTool !== 'pan' && activeTool !== 'eraser' && (
          <div className="flex items-center gap-1 bg-surface-3 p-1 rounded-xl border border-line text-xs">
            {STROKE_WIDTHS.map(sw => (
              <button
                key={sw.size}
                type="button"
                onClick={() => setStrokeWidth(sw.size)}
                className={`px-2 py-1 rounded-md font-bold transition-all ${
                  strokeWidth === sw.size ? 'bg-indigo-600 text-white' : 'text-content-faint hover:text-white'
                }`}
              >
                {sw.label}
              </button>
            ))}
          </div>
        )}

        {activeTool === 'rect' || activeTool === 'ellipse' || activeTool === 'diamond' ? (
          <div className="flex items-center gap-1 bg-surface-3 p-1 rounded-xl border border-line text-xs">
            <button
              type="button"
              onClick={() => setFillShape(v => !v)}
              className={`px-2 py-1 rounded-md font-bold transition-all ${fillShape ? 'bg-indigo-600 text-white' : 'text-content-faint hover:text-white'}`}
            >
              Fill
            </button>
            <button
              type="button"
              onClick={() => setDashShape(v => !v)}
              className={`px-2 py-1 rounded-md font-bold transition-all ${dashShape ? 'bg-indigo-600 text-white' : 'text-content-faint hover:text-white'}`}
            >
              Dash
            </button>
          </div>
        ) : activeTool === 'arrow' || activeTool === 'line' ? (
          <div className="flex items-center gap-1 bg-surface-3 p-1 rounded-xl border border-line text-xs">
            <button
              type="button"
              onClick={() => setDashShape(v => !v)}
              className={`px-2 py-1 rounded-md font-bold transition-all ${dashShape ? 'bg-indigo-600 text-white' : 'text-content-faint hover:text-white'}`}
            >
              Dash
            </button>
          </div>
        ) : null}

        <div className="flex items-center gap-1.5 ml-auto">
          <button
            type="button"
            onClick={handleUndo}
            disabled={histIndexRef.current <= 0}
            className="p-2 rounded-xl text-content-faint hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent"
            title="Undo (Ctrl+Z)"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={handleRedo}
            disabled={histIndexRef.current >= historyRef.current.length - 1}
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
          >
            <BringToFront className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={sendToBack}
            disabled={!selectedIds.length}
            className="p-2 rounded-xl text-content-faint hover:text-white hover:bg-slate-800 disabled:opacity-30"
            title="Send to back ([)"
          >
            <SendToBack className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={duplicateSelected}
            disabled={!selectedIds.length}
            className="p-2 rounded-xl text-content-faint hover:text-white hover:bg-slate-800 disabled:opacity-30"
            title="Duplicate (Ctrl+D)"
          >
            <Copy className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={deleteSelected}
            disabled={!selectedIds.length}
            className="p-2 rounded-xl text-rose-400 hover:bg-rose-950/40 disabled:opacity-30"
            title="Delete (Del)"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <div className="w-px h-5 bg-line-strong" />
          <button
            type="button"
            onClick={() => setGridSnap(v => !v)}
            className={`p-2 rounded-xl transition-all ${gridSnap ? 'text-indigo-400 bg-indigo-500/10' : 'text-content-faint hover:text-white hover:bg-slate-800'}`}
            title="Toggle grid snap"
          >
            <Grid3x3 className="w-4 h-4" />
          </button>
          <button type="button" onClick={() => zoomTo(camRef.current.z / 1.2)} className="p-2 rounded-xl text-content-faint hover:text-white hover:bg-slate-800" title="Zoom out (-)">
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-xs text-content-faint font-mono w-10 text-center">{Math.round(camRef.current.z * 100)}%</span>
          <button type="button" onClick={() => zoomTo(camRef.current.z * 1.2)} className="p-2 rounded-xl text-content-faint hover:text-white hover:bg-slate-800" title="Zoom in (+)">
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
          <button type="button" onClick={handleDownload} className="p-2 rounded-xl text-content-faint hover:text-white hover:bg-slate-800" title="Download PNG image">
            <Download className="w-4 h-4" />
          </button>
          <button type="button" onClick={handleDownloadSVG} className="p-2 rounded-xl text-content-faint hover:text-white hover:bg-slate-800" title="Download SVG">
            <FileCode className="w-4 h-4" />
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
            <button type="button" onClick={onClose} className="p-2 rounded-xl text-content-faint hover:text-white hover:bg-slate-800">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Canvas Area */}
      <div
        ref={containerRef}
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
            placeholder="Type text�"
            className="absolute z-20 bg-surface-3 p-2 rounded-xl shadow-2xl border border-line-strong text-sm text-content outline-none focus:border-indigo-500 resize-none"
            style={editorStyle}
            rows={4}
          />
        )}
      </div>

      {saveError && (
        <div className="px-4 py-2 bg-rose-950/40 border-t border-rose-900/60 text-xs text-rose-200" role="alert">
          {saveError}
        </div>
      )}
      <div className="px-4 py-2.5 bg-surface-inverse border-t border-line flex items-center justify-between text-xs text-content-faint font-mono">
        <span>Stickies, shapes, arrows & freehand � drag to move, double-click to edit. Marquee select, arrows bind to shapes.</span>
        <span className="text-indigo-400 font-bold">{gridSnap ? `Grid ${GRID}px` : 'Free'}</span>
      </div>
    </div>
  );
};

// ---- drawing of a single object (module-level, uses world coords) ----
function drawObject(ctx: CanvasRenderingContext2D, o: SketchObject, byId: Map<string, SketchObject>) {
  if (o.type === 'sticky') {
    ctx.fillStyle = o.color;
    roundRect(ctx, o.x, o.y, o.w, o.h, 10);
    ctx.fill();
    ctx.fillStyle = '#1f2937';
    ctx.font = '14px sans-serif';
    ctx.textBaseline = 'top';
    wrapText(ctx, o.text || '', o.x + 12, o.y + 12, o.w - 24, 18);
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
    ctx.strokeStyle = o.color;
    ctx.lineWidth = o.strokeWidth || 3;
    ctx.lineCap = 'round';
    ctx.setLineDash(o.dash ? [8, 6] : []);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.setLineDash([]);
    if (o.type === 'arrow') {
      const head = o.arrowhead || 'end';
      const ang = Math.atan2(y1 - y0, x1 - x0);
      const len = 12 + (o.strokeWidth || 3) * 1.5;
      if (head === 'end' || head === 'both') {
        arrowHead(ctx, x1, y1, ang, len, o.color);
      }
      if (head === 'start' || head === 'both') {
        arrowHead(ctx, x0, y0, ang + Math.PI, len, o.color);
      }
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
  if (o.type === 'sticky') {
    const fs = 14;
    const lines = (o.text || '').split('\n');
    const tspans = lines
      .map((ln, i) => `<tspan x="${o.x + 12}" y="${o.y + 12 + fs * 1.3 * (i + 1)}">${svgEscape(ln)}</tspan>`)
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
    const lines = (o.text || '').split('\n');
    const tspans = lines.map((ln, i) => `<tspan x="${o.x}" y="${o.y + fs * 1.25 * (i + 1)}">${svgEscape(ln)}</tspan>`).join('');
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
    const stroke = `stroke="${o.color}" stroke-width="${sw}" stroke-linecap="round"${o.dash ? ' stroke-dasharray="8 6"' : ''}`;
    let s = `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" ${stroke} fill="none"/>`;
    if (o.type === 'arrow') {
      const head = o.arrowhead || 'end';
      const ang = Math.atan2(y1 - y0, x1 - x0);
      const len = 12 + sw * 1.5;
      if (head === 'end' || head === 'both') s += svgArrowHead(x1, y1, ang, len, o.color);
      if (head === 'start' || head === 'both') s += svgArrowHead(x0, y0, ang + Math.PI, len, o.color);
    }
    return s;
  }
  return '';
}

export default SketchCanvas;
