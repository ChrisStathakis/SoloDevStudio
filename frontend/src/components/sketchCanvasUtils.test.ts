import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bbox,
  distToShapeEdge,
  edgePoint,
  routeConnector,
  wrapLines,
} from './sketchCanvasUtils.ts';

test('straight route returns endpoints and midpoint label', () => {
  const r = routeConnector('straight', 0, 0, 100, 0);
  assert.equal(r.kind, 'line');
  assert.deepEqual(r.pts, [0, 0, 100, 0]);
  assert.deepEqual(r.label, { x: 50, y: 0 });
  assert.equal(r.endAngle, 0);
});

test('curve route bows outward with matching control point', () => {
  const r = routeConnector('curve', 0, 0, 100, 0);
  assert.equal(r.kind, 'curve');
  assert.ok(r.control);
  assert.ok(r.control!.y > 0);
  // label sits on the curve midpoint
  assert.ok(r.label.y > 0);
  assert.equal(r.pts.length, 22);
});

test('elbow route goes horizontal-first with a corner label', () => {
  const r = routeConnector('elbow', 0, 0, 100, 80);
  assert.equal(r.kind, 'elbow');
  assert.deepEqual(r.pts, [0, 0, 100, 0, 100, 80]);
  assert.deepEqual(r.label, { x: 100, y: 0 });
  assert.equal(r.endAngle, Math.PI / 2);
});

test('edgePoint respects true ellipse and diamond edges', () => {
  const box = { x: 0, y: 0, w: 200, h: 100 };
  // 45° ray toward bottom-right corner: box perimeter would give (200,100),
  // the true ellipse edge is inside that corner.
  const e = edgePoint(box, 200, 100, 'ellipse');
  assert.ok(e.x < 200 && e.y < 100);
  assert.ok(Math.abs(((e.x - 100) / 100) ** 2 + ((e.y - 50) / 50) ** 2 - 1) < 0.001);
  const d = edgePoint(box, 200, 50, 'diamond');
  // due east: diamond edge vertex
  assert.ok(Math.abs(d.x - 200) < 0.001 && Math.abs(d.y - 50) < 0.001);
  // rect fallback unchanged
  const r = edgePoint(box, 200, 100);
  assert.deepEqual({ x: Math.round(r.x), y: Math.round(r.y) }, { x: 200, y: 100 });
});

test('distToShapeEdge is ~0 on hollow edges and positive inside', () => {
  const b = { x: 0, y: 0, w: 100, h: 100 };
  assert.ok(distToShapeEdge('rect', b, 0, 50) < 0.001);
  assert.ok(distToShapeEdge('rect', b, 50, 50) > 20);
  assert.ok(distToShapeEdge('ellipse', b, 50, 0) < 1);
});

test('wrapLines splits paragraphs and long runs identically each call', () => {
  const widths = (s: string) => s.length * 10;
  assert.deepEqual(wrapLines('ab\ncdef', 25, widths), ['ab', 'cd', 'ef']);
  assert.deepEqual(wrapLines('', 100, widths), ['']);
});

test('bbox contains routed connector bows', () => {
  const o: any = { id: 'a', type: 'arrow', x: 0, y: 0, w: 100, h: 0, color: '#000', points: [0, 0, 100, 0], route: 'curve' };
  const b = bbox(o);
  // horizontal line bows downward: endpoints at y=0, belly below
  assert.equal(b.y, 0);
  assert.ok(b.y + b.h > 0);
  const straight: any = { ...o, route: 'straight' };
  assert.ok(bbox(straight).h <= b.h);
});

test('elbow with waypoints threads every corner', () => {
  const r = routeConnector('elbow', 0, 0, 100, 80, [30, 10, 60, 60]);
  assert.equal(r.kind, 'elbow');
  assert.deepEqual(r.pts, [0, 0, 30, 10, 60, 60, 100, 80]);
  assert.equal(r.startAngle, Math.atan2(10, 30));
  assert.equal(r.endAngle, Math.atan2(20, 40));
  // label sits on the middle vertex
  assert.deepEqual(r.label, { x: 60, y: 60 });
});

test('elbow without waypoints keeps the horizontal-first corner label', () => {
  const r = routeConnector('elbow', 0, 0, 100, 80, undefined);
  assert.deepEqual(r.pts, [0, 0, 100, 0, 100, 80]);
  assert.deepEqual(r.label, { x: 100, y: 0 });
});
