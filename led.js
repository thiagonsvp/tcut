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
    const paths = state.contours.map(contour => {
      const path = LedGeometry.ledContour(contour, config);
      if (!path) throw new Error(`Não foi possível deslocar o contorno ${contour.contourIndex}. Reduza a distância.`);
      return { ...path, piece: contour.piece, contourIndex: contour.contourIndex, kind: contour.kind };
    });
    state.paths = LedGeometry.mergeClosePaths(paths, Math.max(config.channelWidth, 2));
    render();
    $('ledMessage').textContent = `${state.paths.length} percurso(s) gerado(s) em modo ${config.rebate ? 'traseiro' : 'frontal'}.`;
    notify('Canal LED gerado. Confira a prévia antes de usinar.');
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

  function exportedSvg() {
    const groups = state.paths.map((path, index) => {
      const paths = LedGeometry.visibleSegments(path).map(segment => `<path d="${pathD(segment.points, segment.closed)}"/>`).join('');
      return paths ? `<g id="led_${String(index + 1).padStart(3, '0')}" data-peca="${escapeXml(path.piece.name)}" data-contorno="${path.contourIndex}" data-modo="${state.config.rebate ? 'traseiro' : 'frontal'}"><g data-operation="USINAGEM_LED" fill="none" stroke="#E0A600" stroke-width="${round(state.config.channelWidth)}" stroke-linecap="round">${paths}</g></g>` : '';
    }).join('');
    const bounds = state.paths.flatMap(path => path.points);
    const minX = Math.min(...bounds.map(point => point.x)) - state.config.channelWidth;
    const minY = Math.min(...bounds.map(point => point.y)) - state.config.channelWidth;
    const maxX = Math.max(...bounds.map(point => point.x)) + state.config.channelWidth;
    const maxY = Math.max(...bounds.map(point => point.y)) + state.config.channelWidth;
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="${SVG_NS}" width="${round(maxX - minX)}mm" height="${round(maxY - minY)}mm" viewBox="${round(minX)} ${round(minY)} ${round(maxX - minX)} ${round(maxY - minY)}" data-tcut="led" data-led-mode="${state.config.rebate ? 'traseiro' : 'frontal'}" data-channel-width-mm="${round(state.config.channelWidth)}"><title>T-Cut · canal LED</title>${groups}</svg>`;
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
  for (const id of fieldIds) $(id).addEventListener('change', () => { if (state.contours.length) $('ledMessage').textContent = 'Parâmetros alterados. Clique em Gerar canal LED para atualizar.'; });
  render();
})();
