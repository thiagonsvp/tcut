const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const source = fs.readFileSync('app.js', 'utf8');
const section = (from, to) => source.slice(source.indexOf(from), source.indexOf(to));
const piece = { id: 1, sx: .01, sy: .01, bbox: { x: 100, y: 200 }, markup: '<path d="M0 0L10 0L10 10Z"/>' };
const placement = { piece, angle: 37, originX: 300, originY: 400 };
const context = vm.createContext({
  round: n => Number(n.toFixed(4)),
  SVG_NS: 'http://www.w3.org/2000/svg',
  state: { sheets: [{ placements: [placement] }], currentSheet: 0, settings: { width: 2440, height: 1220, margin: 15 } }
});
vm.runInContext(section('function placementTransform', 'const rasterStyle'), context);
vm.runInContext(section('function pieceSvg', 'function renderPreview'), context);
vm.runInContext(section('function exportedSvg', 'function createDxf'), context);
vm.runInContext(section('function searchAngles', 'async function findIrregularPosition'), context);
const svg = context.exportedSvg();
assert.match(svg, /width="2440mm" height="1220mm" viewBox="0 0 2440 1220"/);
assert.match(svg, /translate\(300 400\) rotate\(37\)/);
assert.match(svg, /<path d="M0 0L10 0L10 10Z"\/>/);
assert.doesNotMatch(svg, /<rect/, 'SVG cut export must not include the sheet border as a cut path');
assert.deepEqual(Array.from(context.searchAngles({ grain: true })), [0, 180]);
assert.ok(context.searchAngles({ grain: false, rotationStep: 1 }).includes(37));
console.log('SVG export keeps original geometry, arbitrary rotation and millimetres');
