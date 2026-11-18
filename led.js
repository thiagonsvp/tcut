(() => {
  const state = { filename: '', pieces: [], contours: [], paths: [], config: null };
  const fieldIds = ['ledOffset', 'ledChannelWidth', 'ledRebate'];
  const round = value => Number(value.toFixed(3));

  function switchTab(name) {
    const led = name === 'led';
    $('nestingView').classList.toggle('hidden', led);
    $('letterboxView').classList.toggle('hidden', led);
    $('ledView').classList.toggle('hidden', !led);
    $('nestingTab').classList.toggle('active', !led);
    $('letterboxTab').classList.toggle('active', false);
    $('ledTab').classList.toggle('active', led);
    $('currentSection').textContent = led ? 'ILUMINAÇÃO LED' : 'PLANO DE CORTE';
  }

  function readConfig() {
    const offset = Number($('ledOffset').value), channelWidth = Number($('ledChannelWidth').value);
    if (!Number.isFinite(offset) || !Number.isFinite(channelWidth) || offset < .5 || channelWidth < .5) throw new Error('Confira a distância do contorno e a largura do canal.');
    return { offset, channelWidth, rebate: $('ledRebate').checked };
  }

  function contoursFromPiece(piece) {
    if (!piece.operations.cut) return [];
    const measure = document.createElementNS(SVG_NS, 'svg');
    measure.setAttribute('width', '1'); measure.setAttribute('height', '1'); measure.classList.add('measure-svg');
    const group = document.createElementNS(SVG_NS, 'g');
    // Keep the document coordinates in millimetres so "Aplicar no Corel"
    // imports each channel around the original selected letter.
    group.setAttribute('transform', `scale(${piece.sx} ${piece.sy})`);
    group.innerHTML = piece.cutMarkup; measure.appendChild(group); document.body.appendChild(measure);
    const contours = [];
    try {
      const base = measure.getCTM().inverse();
      for (const shape of group.querySelectorAll('path,polygon,polyline,rect,circle,ellipse')) {
        if (!('getTotalLength' in shape)) continue;
        const length = shape.getTotalLength();
        if (!Number.isFinite(length) || length <= 0) continue;
        const matrix = base.multiply(shape.getCTM());
        if (shape.localName === 'polygon') {
          const vertices = Array.from(shape.points, p => p.matrixTransform(matrix));
          if (vertices.length >= 3) {
            const contour = LedGeometry.contourFromPoints([...vertices, vertices[0]]);
            if (contour) contours.push(contour);
          }
          continue;
        }
        const scale = Math.max(Math.hypot(matrix.a, matrix.b), Math.hypot(matrix.c, matrix.d));
        const samples = Math.min(100000, Math.max(24, Math.ceil(length * scale)));
        const maxJump = Math.max(3, length * scale / samples * 4);
        let points = [], previous = null;
        const flush = () => {
          const contour = LedGeometry.contourFromPoints(points);
          if (contour) contours.push(contour);
          points = [];
        };
        for (let i = 0; i <= samples; i++) {
          const point = shape.getPointAtLength(length * i / samples).matrixTransform(matrix);
          if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) > maxJump) flush();
          points.push(point); previous = point;
        }
        flush();
      }
    } finally { measure.remove(); }
    return LedGeometry.classifyContours(contours);
  }

  function importSvg(text, filename) {
    const result = extractPieces(text, filename);
    if (!result.hasScale) throw new Error('Exporte o SVG com largura e altura físicas em milímetros para gerar o canal de LED.');
    const contours = result.pieces.flatMap(piece => contoursFromPiece(piece).map((contour, index) => ({ ...contour, piece, contourIndex: index + 1 })));
    if (!contours.length) throw new Error('O SVG não contém contornos de corte fechados para gerar o canal LED.');
    state.filename = filename; state.pieces = result.pieces; state.contours = contours; generate();
  }

  function generate() {
    if (!state.contours.length) { notify('Importe um SVG para gerar o canal LED.', true); return; }
    let config;
    try { config = readConfig(); } catch (error) { notify(error.message, true); return; }
    state.config = config;
    let omitted = 0;
    state.paths = state.pieces.flatMap(piece => {
      const rings = state.contours.filter(contour => contour.piece === piece);
      const routes = LedGeometry.channelsForPiece(rings, config);
      if (!routes.length) omitted++;
      return routes;
    });
    render();
    $('ledMessage').textContent = `${state.paths.length} percurso(s) gerado(s) em modo ${config.rebate ? 'traseiro' : 'frontal'}.`;
    if (omitted) $('ledMessage').textContent += ` ${omitted} peça(s) sem espaço para a folga e a largura escolhidas.`;
    notify($('ledMessage').textContent, !state.paths.length);
  }

  function pathD(points, closed = true) { return `M ${points.map(point => `${round(point.x)} ${round(point.y)}`).join(' L ')}${closed ? ' Z' : ''}`; }
  function pathMarkup(path, transform = '') {
    return LedGeometry.visibleSegments(path).map(segment => `<path d="${pathD(segment.points, segment.closed)}"${transform} fill="none" stroke="#E0A600" stroke-width="${round(state.config.channelWidth)}" stroke-linejoin="round" stroke-linecap="round"/>`).join('');
  }

  function renderPreview() {
    const preview = $('ledPreviewSvg');
    $('ledEmpty').classList.toggle('hidden', !!state.paths.length); preview.classList.toggle('hidden', !state.paths.length);
    if (!state.paths.length) { preview.replaceChildren(); return; }
    const width = Math.max(...state.pieces.map(piece => piece.width), 100) + 80;
    let x = 40, y = 55, rowHeight = 0;
    const rows = [];
    for (const piece of state.pieces) {
      if (x > 40 && x + piece.width > width - 40) { x = 40; y += rowHeight + 60; rowHeight = 0; }
      rows.push({ piece, x, y }); x += piece.width + 45; rowHeight = Math.max(rowHeight, piece.height);
    }
    const height = y + rowHeight + 55;
    const source = rows.map(row => `<g transform="translate(${round(row.x)} ${round(row.y)}) scale(${round(row.piece.sx)} ${round(row.piece.sy)}) translate(${-round(row.piece.bbox.x)} ${-round(row.piece.bbox.y)})" fill="none" stroke="#EC268F" stroke-width="${round(1.4 / Math.min(row.piece.sx, row.piece.sy))}">${row.piece.cutMarkup}</g>`).join('');
    const channels = state.paths.map(path => {
      const row = rows.find(item => item.piece === path.piece);
      return pathMarkup(path, ` transform="translate(${round(row.x - path.piece.bbox.x * path.piece.sx)} ${round(row.y - path.piece.bbox.y * path.piece.sy)})"`);
    }).join('');
    preview.setAttribute('viewBox', `0 0 ${round(width)} ${round(height)}`);
    preview.innerHTML = `<rect width="100%" height="100%" fill="#fff"/><text x="20" y="27" fill="#56715e" font-size="18" font-family="Arial">${state.config.rebate ? 'LED TRASEIRO · percurso externo' : 'LED FRONTAL · percurso interno'}</text>${source}${channels}`;
  }

  function render() {
    const length = state.paths.reduce((sum, path) => sum + LedGeometry.visibleLength(path), 0);
    $('ledFileName').textContent = state.filename || 'Nenhum arquivo';
    $('ledFileDetail').textContent = state.filename ? `${state.pieces.length} peça(s), ${state.contours.length} contorno(s)` : 'Importe um SVG com contornos fechados.';
    $('ledPieceCount').textContent = state.pieces.length; $('ledContourCount').textContent = state.paths.length;
    $('ledLength').textContent = format(length / 1000, 2); $('ledModeMetric').textContent = state.config?.rebate ? 'Traseiro' : 'Frente';
    $('ledResultsCount').textContent = state.paths.length; $('ledExportSvg').disabled = !state.paths.length;
    const list = $('ledResultsList'); list.replaceChildren();
    if (!state.paths.length) { const item = document.createElement('p'); item.textContent = 'Importe um SVG para listar os percursos.'; list.appendChild(item); }
    else for (const path of state.paths) {
      const card = document.createElement('div'); card.className = 'lb-result-card';
      card.innerHTML = `<strong>${escapeXml(path.piece.name)} · contorno ${path.contourIndex} ${path.kind}</strong><span>${format(LedGeometry.visibleLength(path), 1)} mm · canal ${format(state.config.channelWidth, 1)} mm</span><span>${state.config.rebate ? 'LED atrás da peça' : 'LED dentro da peça'}</span>`;
      list.appendChild(card);
    }
    renderPreview();
  }

  const box = () => ({ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
  const grow = (target, x, y) => { target.minX = Math.min(target.minX, x); target.minY = Math.min(target.minY, y); target.maxX = Math.max(target.maxX, x); target.maxY = Math.max(target.maxY, y); };
  const boxAttr = b => `${round(b.minX)} ${round(b.minY)} ${round(b.maxX - b.minX)} ${round(b.maxY - b.minY)}`;

  // One group per source piece. The panel uses data-ref-bbox (the selected
  // pieces, in this SVG's millimetre frame) and data-led-bbox (the channel
  // geometry, without stroke) to place the import exactly over the originals.
  function exportedSvg() {
    const mode = state.config.rebate ? 'traseiro' : 'frontal';
    const led = box(), ref = box();
    for (const piece of state.pieces) {
      grow(ref, piece.bbox.x * piece.sx, piece.bbox.y * piece.sy);
      grow(ref, piece.bbox.x * piece.sx + piece.width, piece.bbox.y * piece.sy + piece.height);
    }
    let pieceCount = 0;
    const groups = state.pieces.map(piece => {
      const paths = state.paths.filter(path => path.piece === piece).flatMap(path => LedGeometry.visibleSegments(path).map(segment => {
        for (const point of segment.points) grow(led, point.x, point.y);
        return `<path data-contorno="${path.contourIndex}" d="${pathD(segment.points, segment.closed)}"/>`;
      })).join('');
      if (!paths) return '';
      pieceCount++;
      return `<g id="LED_${escapeXml(piece.name.replace(/\s+/g, '_'))}" data-peca="${escapeXml(piece.name)}" data-modo="${mode}" data-operation="USINAGEM_LED" fill="none" stroke="#E0A600" stroke-width="${round(state.config.channelWidth)}" stroke-linejoin="round" stroke-linecap="round">${paths}</g>`;
    }).join('');
    const pad = state.config.channelWidth;
    const frame = { minX: led.minX - pad, minY: led.minY - pad, maxX: led.maxX + pad, maxY: led.maxY + pad };
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="${SVG_NS}" width="${round(frame.maxX - frame.minX)}mm" height="${round(frame.maxY - frame.minY)}mm" viewBox="${boxAttr(frame)}" data-tcut="led" data-led-mode="${mode}" data-channel-width-mm="${round(state.config.channelWidth)}" data-pieces="${pieceCount}" data-ref-bbox="${boxAttr(ref)}" data-led-bbox="${boxAttr(led)}"><title>T-Cut · canal LED</title>${groups}</svg>`;
  }

  function reset() {
    state.filename = ''; state.pieces = []; state.contours = []; state.paths = []; state.config = null;
    $('ledFileInput').value = ''; $('ledOffset').value = '20'; $('ledChannelWidth').value = '8'; $('ledRebate').checked = false;
    $('ledMessage').textContent = 'Importe um SVG para começar.'; render(); notify('Plano LED resetado.');
  }

  window.TCutLedBridge = { importSvg, exportSvg() { if (!state.paths.length) throw new Error('Gere o canal LED antes de enviar ao CorelDRAW.'); return exportedSvg(); } };
  $('ledTab').addEventListener('click', () => switchTab('led'));
  $('ledImportButton').addEventListener('click', () => $('ledFileInput').click());
  $('ledFileInput').addEventListener('change', async event => { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; try { importSvg(await file.text(), file.name); } catch (error) { notify(error.message, true); } });
  $('ledGenerateButton').addEventListener('click', generate); $('ledResetButton').addEventListener('click', reset); $('ledExportSvg').addEventListener('click', () => download('t-cut-canal-led.svg', exportedSvg(), 'image/svg+xml'));
  for (const id of fieldIds) $(id).addEventListener('change', () => {
    if (!state.contours.length) return;
    state.paths = [];
    render();
    $('ledMessage').textContent = 'Parâmetros alterados. Clique em Gerar canal LED para atualizar.';
  });
  render();
})();
