const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const geometry = require('./letterbox-geometry.js');

const square = geometry.contourFromPoints([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }, { x: 0, y: 0 }]);
assert.ok(square);
assert.equal(square.perimeter, 400);
const squareMarks = geometry.bendMarks(square, 30, 20);
assert.equal(squareMarks.filter(mark => mark.type === 'corner').length, 4, 'each right angle needs one groove');
assert.equal(squareMarks.filter(mark => mark.type === 'curve').length, 0, 'straight edges need no relief grooves');
const squareStrips = geometry.makeStrips(square, { maxLength: 250, overlap: 20, minAngle: 30, curveSpacing: 20 });
assert.equal(squareStrips.length, 2);
assert.ok(squareStrips.every(strip => strip.length <= 250));
assert.equal(squareStrips.reduce((sum, strip) => sum + strip.length, 0), 420, 'one overlap is added to a two-piece perimeter');

const circlePoints = Array.from({ length: 721 }, (_, i) => ({ x: 100 * Math.cos(2 * Math.PI * i / 720), y: 100 * Math.sin(2 * Math.PI * i / 720) }));
const circle = geometry.contourFromPoints(circlePoints);
const circleMarks = geometry.bendMarks(circle, 30, 20);
assert.equal(circleMarks.filter(mark => mark.type === 'corner').length, 0, 'a round contour has no sharp corner');
assert.ok(circleMarks.filter(mark => mark.type === 'curve').length > 20, 'a curved side needs repeated bend marks');

const inner = geometry.contourFromPoints([{ x: 25, y: 25 }, { x: 75, y: 25 }, { x: 75, y: 75 }, { x: 25, y: 75 }, { x: 25, y: 25 }]);
const classified = geometry.classifyContours([square, inner]);
assert.equal(classified[0].kind, 'externo');
assert.equal(classified[1].kind, 'interno');

const source = fs.readFileSync('letterbox.js', 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const output = [];
const context = vm.createContext({
  state: { config: { depth: 100, thickness: 3 }, strips: [
    { length: 220, contourIndex: 1, segmentIndex: 1, overlap: 20, marks: [{ x: 50, type: 'corner' }] },
    { length: 200, contourIndex: 1, segmentIndex: 2, overlap: 0, marks: [{ x: 100, type: 'curve' }] }
  ] },
  round: value => Number(value.toFixed(3)),
  SVG_NS: 'http://www.w3.org/2000/svg',
  download: (...args) => output.push(args)
});
vm.runInContext(section('function stripLayout', 'function stripMarkup'), context);
vm.runInContext(section('function exportedSvg', 'function reset'), context);
const svg = context.exportedSvg();
assert.equal((svg.match(/<g id="tira_/g) || []).length, 2, 'each strip remains a separate SVG group');
assert.equal((svg.match(/data-operation="CORTE"/g) || []).length, 2);
assert.equal((svg.match(/data-operation="USINAGEM"/g) || []).length, 2);
assert.equal((svg.match(/<line /g) || []).length, 2);
assert.match(svg, /data-acm-thickness-mm="3"/);
context.exportDxf();
assert.equal(output[0][0], 't-cut-letra-caixa-tiras.dxf');
assert.equal((output[0][1].match(/0\nPOLYLINE/g) || []).length, 2);
assert.equal((output[0][1].match(/0\nLINE\n8\nUSINAGEM/g) || []).length, 2);
console.log('Letterbox corners, curves, inner contours and split overlaps passed');
