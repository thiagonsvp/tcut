const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const source = fs.readFileSync('app.js', 'utf8');
const packing = source.slice(source.indexOf('function intersects'), source.indexOf('async function optimize'));
const context = vm.createContext({});
vm.runInContext(packing, context);

let seed = 123456789;
const random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296);

for (const grain of [false, true]) {
  for (let trial = 0; trial < 200; trial++) {
    const config = { width: 1200, height: 800, gap: 6, margin: 12, grain };
    const pieces = Array.from({ length: 40 }, (_, id) => ({ id, width: 20 + random() * 210, height: 20 + random() * 150 }));
    const sheets = [];
    for (const piece of pieces) {
      let placed = false;
      for (const sheet of sheets) {
        const position = context.bestPosition(sheet, piece, config);
        if (!position) continue;
        context.occupy(sheet, position);
        sheet.used.push(position);
        placed = true;
        break;
      }
      if (!placed) {
        const sheet = { free: [{ x: 12, y: 12, w: 1182, h: 782 }], used: [] };
        const position = context.bestPosition(sheet, piece, config);
        assert.ok(position, 'piece should fit on an empty sheet');
        context.occupy(sheet, position);
        sheet.used.push(position);
        sheets.push(sheet);
      }
    }
    for (const sheet of sheets) for (let i = 0; i < sheet.used.length; i++) {
      const a = sheet.used[i];
      assert.ok(a.x >= 12 && a.y >= 12 && a.x + a.w <= 1194.000001 && a.y + a.h <= 794.000001, 'piece exceeds sheet margins');
      if (grain) assert.equal(a.angle, 0, 'grain-aligned piece rotated by 90 degrees');
      for (let j = 0; j < i; j++) assert.equal(context.intersects(a, sheet.used[j]), false, 'pieces overlap or violate the gap');
    }
  }
}

console.log('400 randomized packing cases passed');
