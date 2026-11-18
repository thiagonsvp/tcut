const SVG_NS = 'http://www.w3.org/2000/svg';
const $ = (id) => document.getElementById(id);
const state = { pieces: [], sheets: [], unplaced: [], fileName: '', settings: null, currentSheet: 0, zoom: 1, busy: false };
const SHEET_PRESETS_KEY = 'tcut.sheetPresets.v1';
let savedSheets = [];
const allowedShapes = new Set(['path', 'polygon', 'polyline', 'rect', 'circle', 'ellipse', 'line']);
const shapeAttributes = {
  path: ['d'], polygon: ['points'], polyline: ['points'], rect: ['x', 'y', 'width', 'height', 'rx', 'ry'],
  circle: ['cx', 'cy', 'r'], ellipse: ['cx', 'cy', 'rx', 'ry'], line: ['x1', 'y1', 'x2', 'y2']
};
const format = (n, digits = 0) => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: digits, minimumFractionDigits: digits });
const round = (n) => Number(n.toFixed(4));
const escapeXml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

function notify(message, isError = false) {
  const el = $('toast');
  el.textContent = message;
  el.className = `toast ${isError ? 'error' : ''}`;
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => el.classList.add('hidden'), 4800);
}

function lengthInMm(value) {
  if (!value) return null;
  const match = String(value).trim().match(/^([+-]?(?:\d+\.?\d*|\.\d+))\s*(mm|cm|in|pt|pc|px)?$/i);
  if (!match) return null;
  const unit = (match[2] || 'px').toLowerCase();
  return Number(match[1]) * ({ mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: 25.4 / 96 }[unit]);
}

function safeShape(element) {
  const tag = element.localName.toLowerCase();
  const clone = document.createElementNS(SVG_NS, tag);
  for (const attr of [...shapeAttributes[tag], 'transform', 'fill-rule', 'clip-rule']) {
    if (element.hasAttribute(attr)) clone.setAttribute(attr, element.getAttribute(attr));
  }
  return clone;
}

function shapeMarkup(element, root) {
  const wrapper = document.createElementNS(SVG_NS, 'g');
  let current = wrapper;
  const ancestors = [];
  for (let p = element.parentElement; p && p !== root; p = p.parentElement) {
    if (p.localName === 'g' && p.hasAttribute('transform')) ancestors.unshift(p.getAttribute('transform'));
  }
  for (const transform of ancestors) {
    const group = document.createElementNS(SVG_NS, 'g');
    group.setAttribute('transform', transform);
    current.appendChild(group);
    current = group;
  }
  current.appendChild(safeShape(element));
  return wrapper;
}

function visibleShape(element) {
  return allowedShapes.has(element.localName) && !element.closest('defs,clipPath,mask,pattern,symbol') && element.getAttribute('display') !== 'none' && element.getAttribute('visibility') !== 'hidden';
}

function svgUnits(root) {
  const units = [];
  const visit = (parent) => {
    for (const child of parent.children) {
      if (child.localName === 'g') {
        const layer = /^camada|^layer/i.test(child.id || '') || child.getAttribute('inkscape:groupmode') === 'layer' || [...child.children].some(item => item.localName === 'metadata');
        if (layer) visit(child);
        else {
          const shapes = [...child.querySelectorAll('path,polygon,polyline,rect,circle,ellipse,line')].filter(visibleShape);
          if (shapes.length) units.push({ shapes, grouped: true });
        }
      } else if (visibleShape(child)) units.push({ shapes: [child], grouped: false });
    }
  };
  visit(root);
  return units;
}

function classStrokeMap(root) {
  const colors = new Map();
  for (const style of root.querySelectorAll('style')) {
    const rules = style.textContent.matchAll(/\.([\w-]+)\s*\{([^}]*)\}/g);
    for (const rule of rules) {
      const stroke = rule[2].match(/(?:^|;)\s*stroke\s*:\s*(#[0-9a-f]{3,8})/i);
      if (stroke) colors.set(rule[1], stroke[1]);
    }
  }
  return colors;
}

function shapeOperation(element, colors) {
  const operation = element.closest('[data-operation]')?.getAttribute('data-operation');
  if (operation === 'USINAGEM' || operation === 'CORTE') return operation;
  let stroke;
  for (let current = element; current && !stroke; current = current.parentElement) {
    stroke = current.getAttribute('stroke') || (current.getAttribute('style') || '').match(/(?:^|;)\s*stroke\s*:\s*(#[0-9a-f]{3,8})/i)?.[1];
    if (!stroke) for (const name of (current.getAttribute('class') || '').split(/\s+/)) if (colors.has(name)) { stroke = colors.get(name); break; }
  }
  if (!stroke) return 'CORTE';
  const hex = stroke.slice(1);
  const expanded = hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex.slice(0, 6);
  if (expanded.length !== 6) return 'CORTE';
  const r = parseInt(expanded.slice(0, 2), 16), g = parseInt(expanded.slice(2, 4), 16), b = parseInt(expanded.slice(4, 6), 16);
  return g > r * 1.15 && g > b * 1.08 ? 'USINAGEM' : 'CORTE';
}

function estimatedArea(element, localBox, scaleX, scaleY) {
  if (!('isPointInFill' in element) || !localBox.width || !localBox.height) return localBox.width * localBox.height * scaleX * scaleY;
  const gridX = Math.min(64, Math.max(12, Math.round(localBox.width / Math.max(localBox.width, localBox.height) * 64)));
  const gridY = Math.min(64, Math.max(12, Math.round(localBox.height / Math.max(localBox.width, localBox.height) * 64)));
  let hits = 0;
  for (let y = 0; y < gridY; y++) for (let x = 0; x < gridX; x++) {
    if (element.isPointInFill(new DOMPoint(localBox.x + (x + .5) * localBox.width / gridX, localBox.y + (y + .5) * localBox.height / gridY))) hits++;
  }
  const fraction = hits / (gridX * gridY);
  return localBox.width * localBox.height * scaleX * scaleY * (fraction || .6);
}

function extractPieces(text, filename) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'svg') throw new Error('O arquivo não é um SVG válido.');
  const root = doc.documentElement;
  const viewBox = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  const vb = viewBox.length === 4 && viewBox[2] > 0 && viewBox[3] > 0
    ? { x: viewBox[0], y: viewBox[1], width: viewBox[2], height: viewBox[3] }
    : { x: 0, y: 0, width: parseFloat(root.getAttribute('width')) || 1000, height: parseFloat(root.getAttribute('height')) || 1000 };
  const widthMm = lengthInMm(root.getAttribute('width'));
  const heightMm = lengthInMm(root.getAttribute('height'));
  const sx = widthMm ? widthMm / vb.width : 1;
  const sy = heightMm ? heightMm / vb.height : sx;
  const measureSvg = document.createElementNS(SVG_NS, 'svg');
  measureSvg.setAttribute('width', '1');
  measureSvg.setAttribute('height', '1');
  measureSvg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.width} ${vb.height}`);
  measureSvg.classList.add('measure-svg');
  document.body.appendChild(measureSvg);
  const units = svgUnits(root);
  const strokes = classStrokeMap(root);
  const pieces = [];
  try {
    for (const unit of units) {
      const wrapper = document.createElementNS(SVG_NS, 'g');
      const cutGroup = document.createElementNS(SVG_NS, 'g');
      const machineGroup = document.createElementNS(SVG_NS, 'g');
      cutGroup.setAttribute('data-operation', 'CORTE');
      cutGroup.setAttribute('fill', 'none');
      cutGroup.setAttribute('stroke', '#EC268F');
      machineGroup.setAttribute('data-operation', 'USINAGEM');
      machineGroup.setAttribute('fill', 'none');
      machineGroup.setAttribute('stroke', '#67BD50');
      for (const original of unit.shapes) (shapeOperation(original, strokes) === 'USINAGEM' ? machineGroup : cutGroup).appendChild(shapeMarkup(original, root));
      if (cutGroup.children.length) wrapper.appendChild(cutGroup);
      if (machineGroup.children.length) wrapper.appendChild(machineGroup);
      measureSvg.appendChild(wrapper);
      let box;
      try { box = wrapper.getBBox(); } catch { wrapper.remove(); continue; }
      const width = box.width * sx;
      const height = box.height * sy;
      if (width > .01 && height > .01 && Number.isFinite(width) && Number.isFinite(height)) {
        let area = 0;
        for (const shape of (cutGroup.children.length ? cutGroup : machineGroup).querySelectorAll('path,polygon,polyline,rect,circle,ellipse,line')) {
          let localBox;
          try { localBox = shape.getBBox(); } catch { continue; }
          let transformArea = 1;
          try {
            const matrix = measureSvg.getCTM().inverse().multiply(shape.getCTM());
            transformArea = Math.abs(matrix.a * matrix.d - matrix.b * matrix.c);
          } catch {}
          shape.setAttribute('fill', '#000');
          area += estimatedArea(shape, localBox, sx, sy) * transformArea;
          shape.removeAttribute('fill');
        }
        area = Math.min(width * height, area);
        const id = pieces.length + 1;
        pieces.push({ id, name: `${unit.grouped ? 'Letra' : 'Peça'} ${String(id).padStart(2, '0')}`, width, height, area, bbox: { x: box.x, y: box.y }, markup: wrapper.innerHTML, cutMarkup: cutGroup.children.length ? cutGroup.innerHTML : machineGroup.innerHTML, sx, sy, grouped: unit.grouped, operations: { cut: cutGroup.children.length, machining: machineGroup.children.length } });
      }
      wrapper.remove();
    }
  } finally { measureSvg.remove(); }
  if (!pieces.length) throw new Error('Nenhum contorno vetorial fechado foi encontrado no SVG.');
  return { pieces, filename, hasScale: !!widthMm && !!heightMm };
}

function readSettings() {
  const width = Number($('sheetWidth').value), height = Number($('sheetHeight').value);
  const gap = Number($('gap').value), margin = Number($('margin').value);
  const rotationStep = Number($('rotationStep').value);
  if (![width, height, gap, margin].every(Number.isFinite) || width <= 0 || height <= 0 || gap < 0 || margin < 0) throw new Error('Informe dimensões positivas e folga/margem não negativas.');
  if (2 * margin >= width || 2 * margin >= height) throw new Error('A margem é maior que a área disponível da chapa.');
  if (![1, 5, 15].includes(rotationStep)) throw new Error('Selecione um passo de rotação válido.');
  return { width, height, gap, margin, grain: $('grain').checked, rotationStep };
}

function restoreSheetPresets() {
  try {
    const entries = JSON.parse(localStorage.getItem(SHEET_PRESETS_KEY) || '[]');
    savedSheets = Array.isArray(entries) ? entries.filter(item => item && typeof item.name === 'string' && item.name.trim() && Number.isFinite(item.width) && item.width > 0 && Number.isFinite(item.height) && item.height > 0).map(item => ({ name: item.name.trim().slice(0, 60), width: item.width, height: item.height })) : [];
  } catch { savedSheets = []; }
  renderSheetPresets();
}

function renderSheetPresets(selected = '') {
  const select = $('sheetPreset');
  select.replaceChildren(new Option('Selecione uma chapa', ''));
  for (const sheet of savedSheets) select.add(new Option(`${sheet.name} · ${format(sheet.width)} × ${format(sheet.height)} mm`, sheet.name));
  select.value = selected;
}

function saveSheetPreset() {
  const name = $('sheetName').value.trim();
  const width = Number($('sheetWidth').value), height = Number($('sheetHeight').value);
  if (!name) { notify('Informe um nome para salvar a chapa.', true); $('sheetName').focus(); return; }
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) { notify('Informe largura e altura positivas antes de salvar.', true); return; }
  const existing = savedSheets.findIndex(sheet => sheet.name.toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR'));
  const entry = { name: existing >= 0 ? savedSheets[existing].name : name, width, height };
  const next = [...savedSheets];
  if (existing >= 0) next[existing] = entry;
  else next.push(entry);
  try { localStorage.setItem(SHEET_PRESETS_KEY, JSON.stringify(next)); }
  catch { notify('Não foi possível salvar a chapa neste navegador.', true); return; }
  savedSheets = next;
  $('sheetName').value = entry.name;
  renderSheetPresets(entry.name);
  renderMetrics();
  notify(`Dimensões de “${entry.name}” salvas.`);
}

function resetPlan() {
  if (state.busy) return;
  state.pieces = [];
  state.sheets = [];
  state.unplaced = [];
  state.fileName = '';
  state.settings = null;
  state.currentSheet = 0;
  state.zoom = 1;
  $('fileInput').value = '';
  $('sheetWidth').value = '2750';
  $('sheetHeight').value = '1850';
  $('gap').value = '6';
  $('margin').value = '12';
  $('grain').checked = false;
  $('rotationStep').value = '5';
  $('sheetPreset').value = '';
  $('sheetName').value = '';
  $('exportMenu').classList.add('hidden');
  $('canvasViewport').scrollTo(0, 0);
  $('settingsMessage').textContent = 'Importe um SVG para começar um novo plano.';
  render();
  notify('Plano resetado. As chapas salvas continuam disponíveis.');
}

function intersects(a, b) { return a.x < b.x + b.w - 1e-7 && a.x + a.w > b.x + 1e-7 && a.y < b.y + b.h - 1e-7 && a.y + a.h > b.y + 1e-7; }
function contained(a, b) { return a.x >= b.x - 1e-7 && a.y >= b.y - 1e-7 && a.x + a.w <= b.x + b.w + 1e-7 && a.y + a.h <= b.y + b.h + 1e-7; }

function occupy(sheet, used) {
  const next = [];
  for (const free of sheet.free) {
    if (!intersects(free, used)) { next.push(free); continue; }
    if (used.x > free.x) next.push({ x: free.x, y: free.y, w: used.x - free.x, h: free.h });
    if (used.x + used.w < free.x + free.w) next.push({ x: used.x + used.w, y: free.y, w: free.x + free.w - used.x - used.w, h: free.h });
    if (used.y > free.y) next.push({ x: free.x, y: free.y, w: free.w, h: used.y - free.y });
    if (used.y + used.h < free.y + free.h) next.push({ x: free.x, y: used.y + used.h, w: free.w, h: free.y + free.h - used.y - used.h });
  }
  sheet.free = next.filter((rect, i) => rect.w > .001 && rect.h > .001 && !next.some((other, j) => i !== j && contained(rect, other) && (j < i || !contained(other, rect))));
}

function bestPosition(sheet, piece, config) {
  let best = null;
  for (const free of sheet.free) {
    for (const angle of (config.grain ? [0] : [0, 90])) {
      const w = (angle === 90 ? piece.height : piece.width) + config.gap;
      const h = (angle === 90 ? piece.width : piece.height) + config.gap;
      if (w > free.w + 1e-7 || h > free.h + 1e-7) continue;
      const candidate = { x: free.x, y: free.y, w, h, angle, piece, short: Math.min(free.w - w, free.h - h), long: Math.max(free.w - w, free.h - h) };
      if (!best || candidate.short < best.short - 1e-7 || (Math.abs(candidate.short - best.short) < 1e-7 && candidate.long < best.long)) best = candidate;
    }
  }
  return best;
}

async function optimize() {
  if (state.busy) return;
  if (!state.pieces.length) { notify('Importe um SVG para começar.', true); return; }
  let config;
  try { config = readSettings(); } catch (error) { notify(error.message, true); return; }
  const createSheet = () => ({ free: [{ x: config.margin, y: config.margin, w: config.width - 2 * config.margin + config.gap, h: config.height - 2 * config.margin + config.gap }], placements: [] });
  const sheets = [];
  const unplaced = [];
  const sorted = [...state.pieces].sort((a, b) => Math.max(b.width, b.height) - Math.max(a.width, a.height) || b.width * b.height - a.width * a.height);
  for (const piece of sorted) {
    let selection = null;
    let target = -1;
    for (let i = 0; i < sheets.length; i++) {
      const position = bestPosition(sheets[i], piece, config);
      if (position && (!selection || position.short < selection.short || (position.short === selection.short && i < target))) { selection = position; target = i; }
    }
    if (!selection) {
      const fresh = createSheet();
      selection = bestPosition(fresh, piece, config);
      if (selection) { target = sheets.length; sheets.push(fresh); }
    }
    if (!selection) { unplaced.push(piece); continue; }
    occupy(sheets[target], selection);
    sheets[target].placements.push({ piece, x: selection.x, y: selection.y, angle: selection.angle });
  }
  state.sheets = sheets;
  state.unplaced = unplaced;
  state.settings = config;
  state.currentSheet = Math.min(state.currentSheet, Math.max(0, sheets.length - 1));
  render();
  let refinementError = null;
  state.busy = true;
  for (const id of ['optimizeButton', 'importButton', 'exportButton', 'resetButton', 'saveSheetButton', 'sheetPreset', 'sheetWidth', 'sheetHeight', 'gap', 'margin', 'grain', 'rotationStep']) $(id).disabled = true;
  $('settingsMessage').textContent = 'Compactando os contornos da esquerda para a direita…';
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  try {
    if (sheets.length > 1 || unplaced.length) {
      await refineIrregular(sheets, config, unplaced);
    }
    const compacted = sheets.filter(sheet => sheet.placements.length);
    const leftPlan = await buildLeftLayout(state.pieces, config);
    const useLeft = leftPlan.unplaced.length < unplaced.length || (leftPlan.unplaced.length === unplaced.length && (leftPlan.sheets.length < compacted.length || (leftPlan.sheets.length === compacted.length && layoutScore(leftPlan.sheets) < layoutScore(compacted))));
    state.sheets = useLeft ? leftPlan.sheets : compacted;
    state.unplaced = useLeft ? leftPlan.unplaced : unplaced;
    state.currentSheet = Math.min(state.currentSheet, Math.max(0, state.sheets.length - 1));
    render();
  } catch (error) {
    refinementError = error;
    notify(`Refino por contorno indisponível: ${error.message}`, true);
  } finally {
    state.busy = false;
    for (const id of ['optimizeButton', 'importButton', 'exportButton', 'resetButton', 'saveSheetButton', 'sheetPreset', 'sheetWidth', 'sheetHeight', 'gap', 'margin', 'grain']) $(id).disabled = false;
    $('rotationStep').disabled = config.grain;
  }
  $('settingsMessage').textContent = refinementError ? 'O refino falhou; o encaixe inicial permanece disponível.' : state.unplaced.length ? `${state.unplaced.length} peça(s) não cabem nas dimensões informadas.` : `Encaixe recalculado com folga de ${format(config.gap, 1)} mm.`;
  if (!refinementError && state.unplaced.length) notify(`${state.unplaced.length} peça(s) não couberam. Confira a chapa e a margem.`, true);
  else if (!refinementError) notify('Plano de corte otimizado.');
}

function placementTransform(placement) {
  const { piece, x, y, angle } = placement;
  const originX = placement.originX ?? (angle === 90 ? x + piece.height : x);
  const originY = placement.originY ?? y;
  return `translate(${round(originX)} ${round(originY)}) rotate(${angle}) scale(${round(piece.sx)} ${round(piece.sy)}) translate(${-round(piece.bbox.x)} ${-round(piece.bbox.y)})`;
}

const rasterStyle = '<style>path,polygon,polyline,rect,circle,ellipse,line{vector-effect:non-scaling-stroke;stroke-linecap:round;stroke-linejoin:round}</style>';

function rasterPiece(placement, gap) {
  return `<g transform="${placementTransform(placement)}" fill="#000" stroke="#000" stroke-width="${gap + 2}">${placement.piece.cutMarkup || placement.piece.markup}</g>`;
}

async function svgCanvas(svg, width, height) {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  const image = new Image();
  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('Não foi possível rasterizar os contornos.'));
      image.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(width); canvas.height = Math.ceil(height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('O navegador não criou o mapa de encaixe.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally { URL.revokeObjectURL(url); }
}

async function rasterGrid(sheet, config) {
  const width = Math.ceil(config.width), height = Math.ceil(config.height);
  const grid = TCutRaster.newGrid(width, height);
  if (!sheet.placements.length) return grid;
  const markup = sheet.placements.map(placement => rasterPiece(placement, config.gap)).join('');
  const svg = `<svg xmlns="${SVG_NS}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${rasterStyle}${markup}</svg>`;
  const canvas = await svgCanvas(svg, width, height);
  const mask = TCutRaster.maskFromCanvas(canvas);
  if (mask) TCutRaster.stamp(grid, mask, Math.round(mask.offsetX), Math.round(mask.offsetY));
  return grid;
}

async function rasterBase(piece, gap) {
  const pad = Math.ceil(gap / 2 + 2);
  const width = Math.ceil(piece.width + 2 * pad), height = Math.ceil(piece.height + 2 * pad);
  const placement = { piece, angle: 0, originX: 0, originY: 0 };
  const svg = `<svg xmlns="${SVG_NS}" width="${width}" height="${height}" viewBox="${-pad} ${-pad} ${width} ${height}">${rasterStyle}${rasterPiece(placement, gap)}</svg>`;
  return { canvas: await svgCanvas(svg, width, height), pad };
}

function rotatedMask(base, angle) {
  const { canvas: image, pad } = base;
  const rad = angle * Math.PI / 180, c = Math.cos(rad), s = Math.sin(rad);
  const box = TCutRaster.bounds(image.width, image.height, angle);
  const startX = -pad * c + pad * s, startY = -pad * s - pad * c;
  const minX = startX + box.minX, minY = startY + box.minY;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(box.maxX - box.minX); canvas.height = Math.ceil(box.maxY - box.minY);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('O navegador não criou a máscara de rotação.');
  context.translate(-minX, -minY);
  context.rotate(rad);
  context.drawImage(image, -pad, -pad);
  return TCutRaster.maskFromCanvas(canvas, minX, minY);
}

function searchAngles(config) {
  if (config.grain) return [0, 180];
  const angles = [0, 90, 180, 270, 45, 135, 225, 315];
  for (let angle = 0; angle < 360; angle += config.rotationStep) if (!angles.includes(angle)) angles.push(angle);
  return angles;
}

async function findIrregularPosition(grid, piece, config) {
  const base = await rasterBase(piece, config.gap);
  const masks = new Map();
  const angles = searchAngles(config);
  for (const step of [20, 7]) {
    let best = null;
    for (let i = 0; i < angles.length; i++) {
      const angle = angles[i];
      if (!masks.has(angle)) masks.set(angle, rotatedMask(base, angle));
      const mask = masks.get(angle);
      if (!mask) continue;
      const bounds = TCutRaster.bounds(piece.width, piece.height, angle);
      const position = TCutRaster.search(grid, mask, bounds, config.margin, step);
      if (position) {
        const originX = position.x - mask.offsetX, originY = position.y - mask.offsetY;
        const result = { placement: { piece, angle, originX, originY, x: originX + bounds.minX, y: originY + bounds.minY }, mask, position };
        if (!best || result.placement.x < best.placement.x - 1 || (Math.abs(result.placement.x - best.placement.x) <= 1 && result.placement.y < best.placement.y)) best = result;
      }
      if (best && (best.placement.x <= config.margin + step || (i >= (config.grain ? 1 : 7) && best.placement.x <= grid.width * .4))) return best;
      if (i % 12 === 11) await new Promise(resolve => requestAnimationFrame(resolve));
    }
    if (best) return best;
  }
  return null;
}

async function buildLeftLayout(pieces, config) {
  const sheets = [], grids = [], unplaced = [];
  const sorted = [...pieces].sort((a, b) => Math.max(b.width, b.height) - Math.max(a.width, a.height) || b.area - a.area);
  for (let i = 0; i < sorted.length; i++) {
    const piece = sorted[i];
    let found = null, targetIndex = -1;
    for (let index = 0; index < grids.length; index++) {
      found = await findIrregularPosition(grids[index], piece, config);
      if (found) { targetIndex = index; break; }
    }
    if (!found) {
      const grid = TCutRaster.newGrid(config.width, config.height);
      found = await findIrregularPosition(grid, piece, config);
      if (found) { targetIndex = grids.length; grids.push(grid); sheets.push({ free: [], placements: [] }); }
    }
    if (!found) { unplaced.push(piece); continue; }
    sheets[targetIndex].placements.push(found.placement);
    TCutRaster.stamp(grids[targetIndex], found.mask, found.position.x, found.position.y);
    if (i % 5 === 4) {
      $('settingsMessage').textContent = `Compactando da esquerda para a direita: ${i + 1} de ${sorted.length} peças.`;
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
  }
  return { sheets, unplaced };
}

function layoutScore(sheets) {
  return sheets.reduce((total, sheet) => total + sheet.placements.reduce((sum, placement) => {
    const box = TCutRaster.bounds(placement.piece.width, placement.piece.height, placement.angle);
    return sum + placement.piece.area * (placement.x + (box.maxX - box.minX) / 2);
  }, 0), 0);
}

async function refineIrregular(sheets, config, unplaced) {
  if (!sheets.length) sheets.push({ free: [], placements: [] });
  for (let targetIndex = 0; targetIndex < sheets.length; targetIndex++) {
    const target = sheets[targetIndex];
    const grid = await rasterGrid(target, config);
    const candidates = [
      ...unplaced.map(piece => ({ piece, source: null, placement: null })),
      ...sheets.slice(targetIndex + 1).flatMap(source => source.placements.map(placement => ({ piece: placement.piece, source, placement })))
    ].sort((a, b) => b.piece.area - a.piece.area);
    for (const candidate of candidates) {
      if (candidate.source && !candidate.source.placements.includes(candidate.placement)) continue;
      if (!candidate.source && !unplaced.includes(candidate.piece)) continue;
      const found = await findIrregularPosition(grid, candidate.piece, config);
      if (!found) continue;
      if (candidate.source) candidate.source.placements.splice(candidate.source.placements.indexOf(candidate.placement), 1);
      else unplaced.splice(unplaced.indexOf(candidate.piece), 1);
      target.placements.push(found.placement);
      TCutRaster.stamp(grid, found.mask, found.position.x, found.position.y);
      $('settingsMessage').textContent = `Peça ${candidate.piece.id} encaixada na chapa ${targetIndex + 1} com rotação de ${found.placement.angle}°.`;
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
  }
  if (unplaced.length) {
    const remaining = [...unplaced].sort((a, b) => b.area - a.area);
    for (const piece of remaining) {
      let target = sheets.at(-1);
      let grid = await rasterGrid(target, config);
      let found = await findIrregularPosition(grid, piece, config);
      if (!found) {
        target = { free: [], placements: [] };
        grid = TCutRaster.newGrid(config.width, config.height);
        found = await findIrregularPosition(grid, piece, config);
        if (found) sheets.push(target);
      }
      if (!found) continue;
      target.placements.push(found.placement);
      unplaced.splice(unplaced.indexOf(piece), 1);
    }
  }
}

function pieceSvg(placement, forExport = false) {
  const { piece } = placement;
  return `<g transform="${placementTransform(placement)}" fill="none" stroke-width="${round((forExport ? .1 : 1.5) / Math.min(piece.sx, piece.sy))}" stroke-linejoin="round">${piece.markup}</g>`;
}

function sheetContent(sheet, config, forExport = false) {
  let svg = forExport ? '' : `<rect width="${config.width}" height="${config.height}" fill="#f5f8f5"/>`;
  if (!forExport) {
    for (let x = 100; x < config.width; x += 100) svg += `<path d="M${x} 0V${config.height}" stroke="#dfe7df" stroke-width="1"/>`;
    for (let y = 100; y < config.height; y += 100) svg += `<path d="M0 ${y}H${config.width}" stroke="#dfe7df" stroke-width="1"/>`;
    svg += `<rect x="${config.margin}" y="${config.margin}" width="${config.width - config.margin * 2}" height="${config.height - config.margin * 2}" fill="none" stroke="#a9c7b9" stroke-width="2" stroke-dasharray="15 12"/>`;
  }
  for (const placement of sheet.placements) svg += pieceSvg(placement, forExport);
  if (!forExport) svg += `<rect x="1" y="1" width="${config.width - 2}" height="${config.height - 2}" fill="none" stroke="#85a398" stroke-width="2"/>`;
  return svg;
}

function renderPreview() {
  const config = state.settings || readSettings();
  $('canvasDimensions').textContent = `${format(config.width)} × ${format(config.height)} mm`;
  $('grainIndicator').textContent = config.grain ? '≋ Veio preservado' : '↔ Rotação livre';
  $('rotationText').textContent = config.grain ? '0° · 180°' : 'Livre em 360°';
  $('rotationStep').disabled = config.grain;
  const sheet = state.sheets[state.currentSheet];
  $('emptyState').classList.toggle('hidden', !!sheet);
  $('sheetSvg').classList.toggle('hidden', !sheet);
  $('sheetLabel').textContent = `CHAPA ${String(sheet ? state.currentSheet + 1 : 0).padStart(2, '0')} / ${String(state.sheets.length).padStart(2, '0')}`;
  $('zoomLabel').textContent = `${Math.round(state.zoom * 100)}%`;
  if (!sheet) { $('sheetSvg').replaceChildren(); return; }
  const svg = $('sheetSvg');
  svg.setAttribute('viewBox', `0 0 ${config.width} ${config.height}`);
  svg.setAttribute('width', `${config.width}mm`);
  svg.setAttribute('height', `${config.height}mm`);
  svg.innerHTML = sheetContent(sheet, config);
  svg.style.aspectRatio = `${config.width} / ${config.height}`;
  svg.style.transform = `scale(${state.zoom})`;
}

function renderPieces() {
  $('inventoryCount').textContent = state.pieces.length;
  $('fileName').textContent = state.fileName || 'Nenhum arquivo';
  $('fileSubtitle').textContent = state.pieces.length ? `${state.pieces.length} peças vetoriais importadas` : 'Importe um desenho vetorial';
  $('fileStatus').textContent = state.pieces.length ? 'SVG' : '—';
  $('unplacedValue').textContent = state.unplaced.length;
  if (!state.pieces.length) { $('piecesList').innerHTML = '<div class="pieces-empty">As peças importadas aparecerão aqui.</div>'; return; }
  const placed = new Set(state.sheets.flatMap(sheet => sheet.placements.map(p => p.piece.id)));
  $('piecesList').innerHTML = state.pieces.map(piece => {
    const thumb = `<svg viewBox="0 0 ${Math.max(piece.width, 1)} ${Math.max(piece.height, 1)}" preserveAspectRatio="xMidYMid meet"><g transform="scale(${piece.sx} ${piece.sy}) translate(${-piece.bbox.x} ${-piece.bbox.y})" fill="none" stroke-width="${1.5 / Math.min(piece.sx, piece.sy)}">${piece.markup}</g></svg>`;
    return `<div class="piece-item"><div class="piece-thumb">${thumb}</div><div class="piece-info"><strong>${piece.name}</strong><span>${format(piece.width, 1)} × ${format(piece.height, 1)} mm</span></div><span class="piece-state ${placed.has(piece.id) ? 'ok' : 'pending'}">${placed.has(piece.id) ? '✓' : '!'}</span></div>`;
  }).join('');
}

function renderMetrics() {
  const config = state.settings || readSettings();
  const selectedSheet = savedSheets.find(sheet => sheet.name === $('sheetPreset').value && sheet.width === config.width && sheet.height === config.height);
  const placedPieces = state.sheets.flatMap(s => s.placements.map(p => p.piece));
  const occupiedArea = placedPieces.reduce((sum, p) => sum + p.area, 0);
  const percent = state.sheets.length ? occupiedArea / (config.width * config.height * state.sheets.length) * 100 : 0;
  $('usageValue').textContent = state.sheets.length ? format(percent, 1) : '—';
  $('usageDetail').textContent = state.sheets.length ? `${format(occupiedArea / 1e6, 2)} m² estimados / ${state.sheets.length} chapa(s)` : 'Área estimada das peças';
  $('placedValue').textContent = placedPieces.length;
  $('placedTotal').textContent = `/ ${state.pieces.length}`;
  $('placedDetail').textContent = state.pieces.length ? `${format(placedPieces.length / state.pieces.length * 100)}% do inventário` : 'Aguardando arquivo';
  $('sheetCount').textContent = state.sheets.length;
  $('sheetDetail').textContent = state.sheets.length ? `${selectedSheet ? `${selectedSheet.name} · ` : ''}${format(config.width)} × ${format(config.height)} mm cada` : 'Configure suas medidas';
  $('sheetArea').textContent = format(config.width * config.height / 1e6, 2);
  $('sheetDimension').textContent = `${format(config.width)} × ${format(config.height)} mm`;
}

function render() { renderMetrics(); renderPreview(); renderPieces(); }

async function importText(text, filename) {
  const result = extractPieces(text, filename);
  state.pieces = result.pieces;
  state.fileName = result.filename;
  state.currentSheet = 0;
  state.zoom = 1;
  if (!result.hasScale) notify('O SVG não informa medidas físicas. Foi assumido 1 unidade = 1 mm. Confira a escala.', true);
  await optimize();
}

function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function exportedSvg() {
  const sheet = state.sheets[state.currentSheet], c = state.settings;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="${SVG_NS}" width="${c.width}mm" height="${c.height}mm" viewBox="0 0 ${c.width} ${c.height}">\n<title>T-Cut - Chapa ${state.currentSheet + 1}</title>\n${sheetContent(sheet, c, true)}\n</svg>`;
}

function createDxf(sheet, config) {
  const rows = [];
  const pair = (code, value) => { rows.push(String(code), String(value)); };
  const number = (value) => Number(value.toFixed(4));
  const polyline = (points, layer, closed) => {
    if (points.length < (closed ? 3 : 2)) return;
    pair(0, 'POLYLINE'); pair(8, layer); pair(66, 1); pair(70, closed ? 1 : 0);
    for (const point of points) {
      pair(0, 'VERTEX'); pair(8, layer); pair(10, number(point.x)); pair(20, number(config.height - point.y)); pair(30, 0);
    }
    pair(0, 'SEQEND');
  };
  pair(0, 'SECTION'); pair(2, 'HEADER'); pair(9, '$ACADVER'); pair(1, 'AC1009'); pair(9, '$INSUNITS'); pair(70, 4); pair(0, 'ENDSEC');
  pair(0, 'SECTION'); pair(2, 'ENTITIES');
  polyline([{ x: 0, y: 0 }, { x: config.width, y: 0 }, { x: config.width, y: config.height }, { x: 0, y: config.height }], 'CHAPA', true);
  const measure = document.createElementNS(SVG_NS, 'svg');
  measure.setAttribute('width', '1'); measure.setAttribute('height', '1'); measure.classList.add('measure-svg');
  document.body.appendChild(measure);
  try {
    for (const placement of sheet.placements) {
      const group = document.createElementNS(SVG_NS, 'g');
      group.setAttribute('transform', placementTransform(placement));
      group.innerHTML = placement.piece.markup;
      measure.appendChild(group);
      for (const shape of group.querySelectorAll('path,polygon,polyline,rect,circle,ellipse,line')) {
        if (!('getTotalLength' in shape)) continue;
        const layer = shape.closest('[data-operation="USINAGEM"]') ? 'USINAGEM' : 'CORTE';
        const matrix = shape.getCTM();
        const length = shape.getTotalLength();
        const scale = Math.max(Math.hypot(matrix.a, matrix.b), Math.hypot(matrix.c, matrix.d));
        const samples = Math.min(160000, Math.max(2, Math.ceil(length * scale / .25)));
        let contour = [], previous = null;
        const flush = () => {
          if (contour.length < 2) { contour = []; return; }
          const first = contour[0], last = contour[contour.length - 1];
          const closeDistance = Math.hypot(first.x - last.x, first.y - last.y);
          const closed = closeDistance < .75 && contour.length > 3;
          if (closed) contour.pop();
          polyline(contour, layer, closed);
          contour = [];
        };
        for (let i = 0; i <= samples; i++) {
          const p = shape.getPointAtLength(length * i / samples).matrixTransform(matrix);
          const point = { x: p.x, y: p.y };
          if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) > Math.max(.85, length * scale / samples * 3)) flush();
          contour.push(point);
          previous = point;
        }
        flush();
      }
      group.remove();
    }
  } finally { measure.remove(); }
  pair(0, 'ENDSEC'); pair(0, 'EOF');
  return rows.join('\n') + '\n';
}

function exportPlan(type) {
  if (!state.sheets.length) { notify('Otimize um plano antes de exportar.', true); return; }
  const name = `t-cut-chapa-${String(state.currentSheet + 1).padStart(2, '0')}`;
  if (type === 'svg') download(`${name}.svg`, exportedSvg(), 'image/svg+xml');
  else if (type === 'dxf') {
    try { download(`${name}.dxf`, createDxf(state.sheets[state.currentSheet], state.settings), 'application/dxf'); }
    catch (error) { notify(`Não foi possível exportar DXF: ${error.message}`, true); return; }
  } else if (type === 'pdf') {
    const svg = exportedSvg().replace(/^<\?xml[^>]*>\s*/, '');
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;width:0;height:0;border:0;';
    const html = `<html><head><title>${name}</title><style>@page{size:${state.settings.width}mm ${state.settings.height}mm;margin:0}html,body{margin:0;padding:0}svg{display:block;width:100%;height:100%}</style></head><body>${svg}</body></html>`;
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    frame.onload = () => { frame.contentWindow.focus(); frame.contentWindow.print(); setTimeout(() => { frame.remove(); URL.revokeObjectURL(url); }, 60000); };
    frame.src = url;
    document.body.appendChild(frame);
    notify('Na janela de impressão, escolha “Salvar como PDF”.');
  }
}

function bindEvents() {
  $('importButton').addEventListener('click', () => $('fileInput').click());
  $('fileInput').addEventListener('change', async (event) => {
    if (state.busy) return;
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = '';
    if (/\.cdr$/i.test(file.name)) { notify('Exporte o CDR como SVG no CorelDRAW para importar as peças.', true); $('helpDialog').showModal(); return; }
    try { await importText(await file.text(), file.name); } catch (error) { notify(error.message, true); }
  });
  $('resetButton').addEventListener('click', resetPlan);
  $('saveSheetButton').addEventListener('click', saveSheetPreset);
  $('sheetPreset').addEventListener('change', () => {
    const sheet = savedSheets.find(item => item.name === $('sheetPreset').value);
    if (!sheet) return;
    $('sheetName').value = sheet.name;
    $('sheetWidth').value = sheet.width;
    $('sheetHeight').value = sheet.height;
    renderMetrics();
    renderPreview();
    $('settingsMessage').textContent = state.pieces.length ? 'Chapa selecionada. Clique em otimizar para aplicar ao plano.' : 'Chapa selecionada. Importe um SVG para começar.';
  });
  $('optimizeButton').addEventListener('click', optimize);
  for (const id of ['sheetWidth', 'sheetHeight', 'gap', 'margin']) $(id).addEventListener('change', () => { if (id === 'sheetWidth' || id === 'sheetHeight') $('sheetPreset').value = ''; try { renderMetrics(); renderPreview(); $('settingsMessage').textContent = state.pieces.length ? 'Parâmetros alterados. Clique em otimizar para aplicar ao plano.' : 'Dimensões atualizadas. Importe um SVG para começar.'; } catch {} });
  $('grain').addEventListener('change', () => { $('rotationText').textContent = $('grain').checked ? '0° · 180°' : 'Livre em 360°'; $('rotationStep').disabled = $('grain').checked; $('settingsMessage').textContent = 'Orientação alterada. Clique em otimizar para aplicar ao plano.'; });
  $('rotationStep').addEventListener('change', () => { $('settingsMessage').textContent = 'Precisão angular alterada. Clique em otimizar para aplicar ao plano.'; });
  $('exportButton').addEventListener('click', (event) => { event.stopPropagation(); $('exportMenu').classList.toggle('hidden'); });
  $('exportMenu').addEventListener('click', (event) => { const button = event.target.closest('button[data-export]'); if (button) { $('exportMenu').classList.add('hidden'); exportPlan(button.dataset.export); } });
  document.addEventListener('click', (event) => { if (!event.target.closest('.heading-actions')) $('exportMenu').classList.add('hidden'); });
  $('helpButton').addEventListener('click', () => $('helpDialog').showModal());
  $('zoomIn').addEventListener('click', () => { state.zoom = Math.min(2, round(state.zoom + .2)); renderPreview(); });
  $('zoomOut').addEventListener('click', () => { state.zoom = Math.max(.6, round(state.zoom - .2)); renderPreview(); });
  $('sheetPrev').addEventListener('click', () => { state.currentSheet = Math.max(0, state.currentSheet - 1); renderPreview(); });
  $('sheetNext').addEventListener('click', () => { state.currentSheet = Math.min(state.sheets.length - 1, state.currentSheet + 1); renderPreview(); });
}

bindEvents();
restoreSheetPresets();
render();
