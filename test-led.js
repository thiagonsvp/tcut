const assert = require('node:assert/strict');
const fs = require('node:fs');
const geometry = require('./led-geometry.js');

const outer = geometry.contourFromPoints([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }, { x: 0, y: 0 }]);
assert.ok(outer);
const inner = geometry.contourFromPoints([{ x: 30, y: 30 }, { x: 70, y: 30 }, { x: 70, y: 70 }, { x: 30, y: 70 }, { x: 30, y: 30 }]);
const [classifiedOuter, classifiedInner] = geometry.classifyContours([outer, inner]);
assert.equal(classifiedOuter.kind, 'externo');
assert.equal(classifiedInner.kind, 'interno');

const frontal = geometry.ledContour(classifiedOuter, { offset: 10, rebate: false });
assert.ok(frontal);
assert.equal(Math.min(...frontal.points.map(point => point.x)), 10, 'front LED moves the outside contour inward');
assert.equal(Math.max(...frontal.points.map(point => point.x)), 90);
const traseiro = geometry.ledContour(classifiedOuter, { offset: 10, rebate: true });
assert.ok(traseiro);
assert.equal(Math.min(...traseiro.points.map(point => point.x)), -10, 'rebate moves the outside contour outward');
assert.equal(Math.max(...traseiro.points.map(point => point.x)), 110);

const innerFrontal = geometry.ledContour(classifiedInner, { offset: 5, rebate: false });
assert.equal(Math.min(...innerFrontal.points.map(point => point.x)), 25, 'front LED expands a hole into usable material');
assert.match(fs.readFileSync('led.js', 'utf8'), /data-operation="USINAGEM_LED"/);
assert.match(fs.readFileSync('corel-bridge.js', 'utf8'), /TCUT_IMPORT_LED/);
console.log('LED offsets frontal/traseiro, furos e integração Corel passed');
