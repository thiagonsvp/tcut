(function (root) {
  const radians = (angle) => angle * Math.PI / 180;

  function bounds(width, height, angle) {
    const c = Math.cos(radians(angle)), s = Math.sin(radians(angle));
    const points = [[0, 0], [width, 0], [width, height], [0, height]].map(([x, y]) => [x * c - y * s, x * s + y * c]);
    const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
  }

  function newGrid(width, height) {
    const w = Math.ceil(width), h = Math.ceil(height), stride = Math.ceil(w / 32);
    return { width: w, height: h, stride, bits: new Uint32Array(stride * h) };
  }

  function maskFromAlpha(alpha, width, height, offsetX = 0, offsetY = 0) {
    let left = width, top = height, right = -1, bottom = -1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (alpha[y * width + x] === 0) continue;
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
    if (right < left) return null;
    const w = right - left + 1, h = bottom - top + 1, stride = Math.ceil(w / 32);
    const rows = [];
    for (let y = 0; y < h; y++) {
      const words = new Uint32Array(stride);
      for (let x = 0; x < w; x++) if (alpha[(top + y) * width + left + x]) words[x >>> 5] |= (1 << (x & 31));
      const active = [];
      for (let i = 0; i < stride; i++) if (words[i]) active.push([i, words[i]]);
      if (active.length) rows.push([y, active]);
    }
    return { width: w, height: h, offsetX: offsetX + left, offsetY: offsetY + top, rows };
  }

  function maskFromCanvas(canvas, offsetX = 0, offsetY = 0) {
    const { width, height } = canvas;
    const rgba = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height).data;
    const alpha = new Uint8Array(width * height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3];
    return maskFromAlpha(alpha, width, height, offsetX, offsetY);
  }

  function fits(grid, mask, x, y) {
    if (x < 0 || y < 0 || x + mask.width > grid.width || y + mask.height > grid.height) return false;
    const shift = x & 31, wordX = x >>> 5;
    for (const [row, words] of mask.rows) {
      const base = (y + row) * grid.stride + wordX;
      for (const [index, word] of words) {
        if (grid.bits[base + index] & (word << shift)) return false;
        if (shift && wordX + index + 1 < grid.stride && (grid.bits[base + index + 1] & (word >>> (32 - shift)))) return false;
      }
    }
    return true;
  }

  function stamp(grid, mask, x, y) {
    if (x < 0 || y < 0 || x + mask.width > grid.width || y + mask.height > grid.height) return;
    const shift = x & 31, wordX = x >>> 5;
    for (const [row, words] of mask.rows) {
      const base = (y + row) * grid.stride + wordX;
      for (const [index, word] of words) {
        grid.bits[base + index] |= word << shift;
        if (shift && wordX + index + 1 < grid.stride) grid.bits[base + index + 1] |= word >>> (32 - shift);
      }
    }
  }

  function search(grid, mask, pieceBounds, margin, step) {
    const minX = Math.max(0, Math.ceil(margin + mask.offsetX - pieceBounds.minX));
    const minY = Math.max(0, Math.ceil(margin + mask.offsetY - pieceBounds.minY));
    const maxX = Math.min(grid.width - mask.width, Math.floor(grid.width - margin + mask.offsetX - pieceBounds.maxX));
    const maxY = Math.min(grid.height - mask.height, Math.floor(grid.height - margin + mask.offsetY - pieceBounds.maxY));
    if (maxX < minX || maxY < minY) return null;
    for (let x = minX; x <= maxX; x += step) for (let y = minY; y <= maxY; y += step) {
      if (fits(grid, mask, x, y)) return { x, y };
    }
    return null;
  }

  const api = { bounds, newGrid, maskFromAlpha, maskFromCanvas, fits, stamp, search };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TCutRaster = api;
})(typeof window === 'undefined' ? globalThis : window);
