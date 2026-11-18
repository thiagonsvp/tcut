const assert = require('node:assert/strict');
const Raster = require('./irregular.js');

const grid = Raster.newGrid(80, 60);
const lShape = new Uint8Array(12 * 12);
for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) if (x < 2 || y >= 10) lShape[y * 12 + x] = 255;
const lMask = Raster.maskFromAlpha(lShape, 12, 12);
Raster.stamp(grid, lMask, 31, 10);

const square = Raster.maskFromAlpha(new Uint8Array(4 * 4).fill(255), 4, 4);
assert.equal(Raster.fits(grid, square, 32, 11), false, 'shape overlaps the solid arm');
assert.equal(Raster.fits(grid, square, 36, 12), true, 'shape should fit into the concavity');
assert.equal(Raster.fits(grid, square, 36, 19), false, 'shape overlaps the lower arm');
Raster.stamp(grid, square, 36, 12);
assert.equal(Raster.fits(grid, square, 36, 12), false, 'stamped shape should occupy the space');

const box = Raster.bounds(100, 20, 45);
assert.ok(box.maxX - box.minX > 84 && box.maxX - box.minX < 86);
assert.ok(box.maxY - box.minY > 84 && box.maxY - box.minY < 86);

const empty = Raster.newGrid(50, 50);
const fit = Raster.search(empty, square, Raster.bounds(4, 4, 0), 6, 7);
assert.deepEqual(fit, { x: 6, y: 6 });

console.log('Irregular mask collision, concavity, rotation and margins passed');
