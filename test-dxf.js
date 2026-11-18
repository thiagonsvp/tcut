const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const source = fs.readFileSync('app.js', 'utf8');
const section = (from, to) => source.slice(source.indexOf(from), source.indexOf(to));
const shape = {
  closest: () => null,
  getCTM: () => ({ a: 1, b: 0, c: 0, d: 1 }),
  getTotalLength: () => 40,
  getPointAtLength: value => ({
    matrixTransform: () => value <= 10 ? { x: value, y: 0 } : value <= 20 ? { x: 10, y: value - 10 } : value <= 30 ? { x: 30 - value, y: 10 } : { x: 0, y: 40 - value }
  })
};
const machineShape = { ...shape, closest: selector => selector.includes('USINAGEM') ? {} : null };
const measure = { setAttribute() {}, classList: { add() {} }, appendChild() {}, remove() {} };
const group = { setAttribute() {}, innerHTML: '', querySelectorAll: () => [shape, machineShape], remove() {} };
let calls = 0;
const document = { createElementNS: () => calls++ === 0 ? measure : group, body: { appendChild() {} } };
const context = vm.createContext({ document, SVG_NS: 'http://www.w3.org/2000/svg', round: n => Number(n.toFixed(4)) });
vm.runInContext(section('function placementTransform', 'const rasterStyle'), context);
vm.runInContext(section('function createDxf', 'function exportPlan'), context);
const piece = { sourceTag: 'path', markup: '<path/>', sx: 1, sy: 1, bbox: { x: 0, y: 0 } };
const dxf = context.createDxf({ placements: [{ piece, angle: 37, originX: 5, originY: 8 }] }, { width: 100, height: 80 });
assert.match(dxf, /SECTION\n2\nHEADER/);
assert.match(dxf, /8\nCHAPA/);
assert.match(dxf, /8\nCORTE/);
assert.match(dxf, /8\nUSINAGEM/);
assert.match(dxf, /0\nVERTEX\n8\nCORTE/);
assert.match(dxf, /0\nEOF\n$/);
console.log('DXF emits sheet and cut layers as valid polyline entities');
