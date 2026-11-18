const assert = require('node:assert/strict');
const fs = require('node:fs');
const geometry = require('./led-geometry.js');

// H with a sample per millimetre, as returned by SVG getPointAtLength.
const corners = [[0,0],[40,0],[40,58],[95,58],[95,0],[135,0],[135,150],
  [95,150],[95,89],[40,89],[40,150],[0,150]];
const samples = corners.flatMap(([x,y], i) => {
  const [nx,ny] = corners[(i+1) % corners.length];
  const n = Math.hypot(nx-x,ny-y);
  return Array.from({length:n}, (_,j) => ({x:x+(nx-x)*j/n,y:y+(ny-y)*j/n}));
});
const ring = geometry.contourFromPoints([...samples,samples[0]]);
const [h] = geometry.pieceRoutes([{...ring,kind:'externo'}], {offset:8,channelWidth:4});
const expected = [[10,10],[30,10],[30,68],[105,68],[105,10],[125,10],[125,140],
  [105,140],[105,79],[30,79],[30,140],[10,140]];
// Verify adjacency too: the same vertices connected in a different order can cross.
const edges = points => points.map((p,i) => [p.join(','), points[(i+1)%points.length].join(',')].sort().join('|')).sort();
assert.deepEqual(edges(h.points.map(p=>[p.x,p.y])), edges(expected));
assert.deepEqual(geometry.pieceRoutes([{...ring,kind:'externo'}], {offset:100,channelWidth:4}), []);

const outer = geometry.contourFromPoints([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }, { x: 0, y: 0 }]);
assert.ok(outer);
const inner = geometry.contourFromPoints([{ x: 30, y: 30 }, { x: 70, y: 30 }, { x: 70, y: 70 }, { x: 30, y: 70 }, { x: 30, y: 30 }]);
const [classifiedOuter, classifiedInner] = geometry.classifyContours([outer, inner]);
assert.equal(classifiedOuter.kind, 'externo');
assert.equal(classifiedInner.kind, 'interno');
const distanceToSegment = (point, a, b) => {
  const dx = b.x - a.x, dy = b.y - a.y;
  const ratio = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point.x - (a.x + ratio * dx), point.y - (a.y + ratio * dy));
};
const distanceToContour = point => Math.min(...outer.points.map((a, index) => distanceToSegment(point, a, outer.points[(index + 1) % outer.points.length])));

const [frontal] = geometry.channelsForPiece([classifiedOuter], { offset: 8, channelWidth: 4, rebate: false });
assert.ok(frontal);
assert.ok(frontal.points.every(point => distanceToContour(point) >= 9.999 && distanceToContour(point) <= 10.001), 'front LED always keeps the requested clearance, including corners');
const [traseiro] = geometry.channelsForPiece([classifiedOuter], { offset: 8, channelWidth: 4, rebate: true });
assert.ok(traseiro);
assert.ok(traseiro.points.every(point => distanceToContour(point) >= 9.999), 'rebate never gets closer than the requested clearance');

const innerFrontal = geometry.channelsForPiece([classifiedOuter,classifiedInner], { offset: 4, channelWidth: 2 }).find(r => r.kind === 'interno');
assert.ok(Math.min(...innerFrontal.points.map(point => point.x)) <= 30, 'front LED expands a hole into usable material');
const duplicate = geometry.mergeClosePaths([
  { points: outer.points.map(point => ({ ...point })) },
  { points: outer.points.map(point => ({ x: point.x + 1, y: point.y })) },
], 4);
assert.equal(geometry.visibleSegments(duplicate[0]).length, 1, 'the primary route remains');
assert.equal(geometry.visibleSegments(duplicate[1]).length, 0, 'an overlapping route is merged into one line');
assert.match(fs.readFileSync('led.js', 'utf8'), /data-operation="USINAGEM_LED"/);
assert.match(fs.readFileSync('corel-bridge.js', 'utf8'), /TCUT_IMPORT_LED/);
console.log('LED offsets frontal/traseiro, furos e integração Corel passed');
