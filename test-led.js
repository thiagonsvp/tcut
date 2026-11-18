const assert = require('node:assert/strict');
const fs = require('node:fs');
const geometry = require('./led-geometry.js');

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

const frontal = geometry.ledContour(classifiedOuter, { offset: 10, rebate: false });
assert.ok(frontal);
assert.ok(frontal.points.every(point => distanceToContour(point) >= 9.999 && distanceToContour(point) <= 10.001), 'front LED always keeps the requested clearance, including corners');
const traseiro = geometry.ledContour(classifiedOuter, { offset: 10, rebate: true });
assert.ok(traseiro);
assert.ok(traseiro.points.every(point => distanceToContour(point) >= 9.999), 'rebate never gets closer than the requested clearance');

const innerFrontal = geometry.ledContour(classifiedInner, { offset: 5, rebate: false });
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
