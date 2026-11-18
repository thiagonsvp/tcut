(() => {
  const state = { filename: '', pieces: [], contours: [], strips: [], config: null };
  const fieldIds = ['lbDepth', 'lbThickness', 'lbMaxLength', 'lbOverlap', 'lbCurveSpacing', 'lbMinAngle'];
  const round = value => Number(value.toFixed(3));

  function switchTab(name) {
    const letterbox = name === 'letterbox';
    $('nestingView').classList.toggle('hidden', letterbox);
    $('letterboxView').classList.toggle('hidden', !letterbox);
    $('ledView').classList.add('hidden');
    $('nestingTab').classList.toggle('active', !letterbox);
    $('letterboxTab').classList.toggle('active', letterbox);
    $('ledTab').classList.remove('active');
    $('currentSection').textContent = letterbox ? 'LETRA CAIXA' : 'PLANO DE CORTE';
  }

  function readConfig() {
    const depth = Number($('lbDepth').value), thickness = Number($('lbThickness').value);
    const maxLength = Number($('lbMaxLength').value), overlap = Number($('lbOverlap').value);
    const curveSpacing = Number($('lbCurveSpacing').value), minAngle = Number($('lbMinAngle').value);
    if (![depth, thickness, maxLength, overlap, curveSpacing, minAngle].every(Number.isFinite) || depth <= 0 || thickness <= 0 || maxLength < 50 || overlap < 0 || curveSpacing < 0 || minAngle < 5 || minAngle > 175 || maxLength <= overlap + 10) throw new Error('Confira profundidade, espessura, comprimento, emenda e ângulo mínimo.');
    return { depth, thickness, maxLength, overlap, curveSpacing, minAngle };
  }

  function contoursFromPiece(piece) {
    if (!piece.operations.cut) return [];
    const measure = document.createElementNS(SVG_NS, 'svg');
    measure.setAttribute('width', '1');
    measure.setAttribute('height', '1');
    measure.classList.add('measure-svg');
    const group = document.createElementNS(SVG_NS, 'g');
    group.setAttribute('transform', `scale(${piece.sx} ${piece.sy}) translate(${-piece.bbox.x} ${-piece.bbox.y})`);
    group.innerHTML = piece.cutMarkup;
    measure.appendChild(group);
    document.body.appendChild(measure);
    const contours = [];
    try {
      const base = measure.getCTM().inverse();
      for (const shape of group.querySelectorAll('path,polygon,polyline,rect,circle,ellipse,line')) {
        if (!('getTotalLength' in shape)) continue;
        const length = shape.getTotalLength();
        if (!Number.isFinite(length) || length <= 0) continue;
        const matrix = base.multiply(shape.getCTM());
        const scale = Math.max(Math.hypot(matrix.a, matrix.b), Math.hypot(matrix.c, matrix.d));
        const samples = Math.min(100000, Math.max(12, Math.ceil(length * scale)));
        const maxJump = Math.max(3, length * scale / samples * 4);
        let points = [], previous = null;
        const flush = () => {
          const contour = LetterboxGeometry.contourFromPoints(points);
          if (contour) contours.push(contour);
          points = [];
        };
        for (let i = 0; i <= samples; i++) {
          const p = shape.getPointAtLength(length * i / samples).matrixTransform(matrix);
          const point = { x: p.x, y: p.y };
          if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) > maxJump) flush();
          points.push(point);
          previous = point;
        }
        flush();
      }
    } finally { measure.remove(); }
    return LetterboxGeometry.classifyContours(contours);
  }

  function importSvg(text, filename) {
    const result = extractPieces(text, filename);
    if (!result.hasScale) throw new Error('Exporte o SVG com largura e altura físicas em milímetros para planificar as laterais.');
    const contours = result.pieces.flatMap(piece => contoursFromPiece(piece).map((contour, index) => ({ ...contour, piece, contourIndex: index + 1 })));
    if (!contours.length) throw new Error('O SVG não contém contornos de corte fechados para gerar tiras.');
    state.filename = filename;
    state.pieces = result.pieces;
    state.contours = contours;
    generate();
  }

  function generate() {
    if (!state.contours.length) { notify('Importe um SVG para gerar as tiras.', true); return; }
    let config;
    try { config = readConfig(); } catch (error) { notify(error.message, true); return; }
    state.config = config;
    state.strips = state.contours.flatMap(contour => {
      const segments = LetterboxGeometry.makeStrips(contour, config);
      return segments.map((segment, index) => ({ ...segment, piece: contour.piece, contourIndex: contour.contourIndex, kind: contour.kind, segmentIndex: index + 1, segmentCount: segments.length }));
    });
    render();
    $('lbMessage').textContent = `${state.strips.length} tira(s) gerada(s) a partir de ${state.contours.length} contorno(s). Confira as dobras no CAM.`;
    notify('Tiras de letra caixa geradas.');
  }

  function stripLayout() {
    const gap = 15, pad = 20;
    const width = Math.max(200, ...state.strips.map(strip => strip.length)) + 2 * pad;
    const rows = state.strips.map((strip, index) => ({ ...strip, x: pad, y: pad + index * (state.config.depth + gap) }));
    const height = pad * 2 + rows.length * state.config.depth + Math.max(0, rows.length - 1) * gap;
    return { rows, width, height };
  }

  function stripMarkup(rows, depth, preview = false) {
    const cuts = [], grooves = [], seam = [];
    for (const row of rows) {
      cuts.push(`<rect x="${round(row.x)}" y="${round(row.y)}" width="${round(row.length)}" height="${round(depth)}"/>`);
      for (const mark of row.marks) grooves.push(`<line x1="${round(row.x + mark.x)}" y1="${round(row.y)}" x2="${round(row.x + mark.x)}" y2="${round(row.y + depth)}"/>`);
      if (preview && row.overlap) seam.push(`<line x1="${round(row.x + row.contourLength)}" y1="${round(row.y)}" x2="${round(row.x + row.contourLength)}" y2="${round(row.y + depth)}"/>`);
    }
    return `<g id="CORTE" fill="none" stroke="#EC268F" stroke-width="1.2">${cuts.join('')}</g><g id="USINAGEM" fill="none" stroke="#67BD50" stroke-width="1.2">${grooves.join('')}</g>${preview ? `<g fill="none" stroke="#aebdb2" stroke-width="1" stroke-dasharray="5 4">${seam.join('')}</g>` : ''}`;
  }

  function renderPreview() {
    const preview = $('lbPreviewSvg');
    $('lbEmpty').classList.toggle('hidden', !!state.strips.length);
    preview.classList.toggle('hidden', !state.strips.length);
    if (!state.strips.length) { preview.replaceChildren(); return; }
    const layout = stripLayout();
    const width = Math.max(layout.width, ...state.pieces.map(piece => piece.width + 40));
    let faceX = 20, faceY = 48, rowHeight = 0;
    const faces = [];
    for (const piece of state.pieces) {
      if (faceX > 20 && faceX + piece.width > width - 20) { faceX = 20; faceY += rowHeight + 30; rowHeight = 0; }
      faces.push(`<g transform="translate(${round(faceX)} ${round(faceY)}) scale(${round(piece.sx)} ${round(piece.sy)}) translate(${-round(piece.bbox.x)} ${-round(piece.bbox.y)})" fill="none" stroke="#EC268F" stroke-width="${round(1.4 / Math.min(piece.sx, piece.sy))}">${piece.cutMarkup}</g>`);
      faceX += piece.width + 24;
      rowHeight = Math.max(rowHeight, piece.height);
    }
    const faceBottom = faceY + rowHeight;
    const stripOffset = faceBottom + 55;
    const rows = layout.rows.map(row => ({ ...row, y: row.y + stripOffset }));
    const labels = rows.map(row => `<text x="${round(row.x)}" y="${round(row.y - 4)}" fill="#56715e" font-size="15" font-family="Arial">${escapeXml(row.piece.name)} · ${row.kind} ${row.contourIndex} · tira ${row.segmentIndex}/${row.segmentCount}</text>`).join('');
    preview.setAttribute('viewBox', `0 0 ${round(width)} ${round(stripOffset + layout.height)}`);
    preview.setAttribute('aria-label', `${state.pieces.length} faces e ${state.strips.length} tiras planificadas`);
    preview.innerHTML = `<rect width="100%" height="100%" fill="#fff"/><text x="20" y="28" fill="#56715e" font-size="19" font-family="Arial">FACES · referência</text>${faces.join('')}<text x="20" y="${round(faceBottom + 38)}" fill="#56715e" font-size="19" font-family="Arial">TIRAS · corte e usinagem</text>${stripMarkup(rows, state.config.depth, true)}${labels}`;
  }

  function render() {
    $('lbFileName').textContent = state.filename || 'Nenhum arquivo';
    $('lbFileDetail').textContent = state.filename ? `${state.pieces.length} letra(s), ${state.contours.length} contorno(s)` : 'Importe um SVG com contornos fechados.';
    $('lbContourCount').textContent = state.contours.length;
    $('lbStripCount').textContent = state.strips.length;
    $('lbTotalLength').textContent = format(state.strips.reduce((total, strip) => total + strip.length, 0) / 1000, 2);
    $('lbMarkCount').textContent = state.strips.reduce((total, strip) => total + strip.marks.length, 0);
    $('lbResultsCount').textContent = state.strips.length;
    $('lbExportSvg').disabled = !state.strips.length;
    $('lbExportDxf').disabled = !state.strips.length;
    const list = $('lbResultsList');
    list.replaceChildren();
    if (!state.strips.length) { const p = document.createElement('p'); p.textContent = 'Importe um SVG para listar as tiras.'; list.appendChild(p); }
    else for (const strip of state.strips) {
      const card = document.createElement('div'); card.className = 'lb-result-card';
      const title = document.createElement('strong'); title.textContent = `${strip.piece.name} · contorno ${strip.contourIndex} ${strip.kind}`;
      const detail = document.createElement('span'); detail.textContent = `Tira ${strip.segmentIndex}/${strip.segmentCount} · ${format(strip.length, 1)} × ${format(state.config.depth, 1)} mm`;
      const marks = document.createElement('span'); marks.textContent = `${strip.marks.length} marcas de usinagem${strip.overlap ? ` · ${format(strip.overlap, 1)} mm de emenda` : ''}`;
      card.append(title, detail, marks); list.appendChild(card);
    }
    renderPreview();
  }

  function exportedSvg() {
    const layout = stripLayout();
    const groups = layout.rows.map((row, index) => {
      const grooves = row.marks.map(mark => `<line x1="${round(row.x + mark.x)}" y1="${round(row.y)}" x2="${round(row.x + mark.x)}" y2="${round(row.y + state.config.depth)}"/>`).join('');
      return `<g id="tira_${String(index + 1).padStart(3, '0')}" data-contorno="${row.contourIndex}" data-segmento="${row.segmentIndex}" data-sobreposicao-mm="${row.overlap}"><g data-operation="CORTE" fill="none" stroke="#EC268F" stroke-width="0.1"><rect x="${round(row.x)}" y="${round(row.y)}" width="${round(row.length)}" height="${round(state.config.depth)}"/></g><g data-operation="USINAGEM" fill="none" stroke="#67BD50" stroke-width="0.1">${grooves}</g></g>`;
    }).join('');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="${SVG_NS}" width="${round(layout.width)}mm" height="${round(layout.height)}mm" viewBox="0 0 ${round(layout.width)} ${round(layout.height)}" data-acm-thickness-mm="${round(state.config.thickness)}"><title>T-Cut · tiras de letra caixa</title>${groups}</svg>`;
  }

  function exportSvg() {
    download('t-cut-letra-caixa-tiras.svg', exportedSvg(), 'image/svg+xml');
  }

  function exportDxf() {
    const layout = stripLayout(), rows = [];
    const pair = (code, value) => rows.push(String(code), String(value));
    const vertex = (x, y, layer) => { pair(0, 'VERTEX'); pair(8, layer); pair(10, round(x)); pair(20, round(layout.height - y)); pair(30, 0); };
    pair(0, 'SECTION'); pair(2, 'HEADER'); pair(9, '$ACADVER'); pair(1, 'AC1009'); pair(9, '$INSUNITS'); pair(70, 4); pair(0, 'ENDSEC');
    pair(0, 'SECTION'); pair(2, 'ENTITIES');
    for (const strip of layout.rows) {
      pair(0, 'POLYLINE'); pair(8, 'CORTE'); pair(66, 1); pair(70, 1);
      vertex(strip.x, strip.y, 'CORTE'); vertex(strip.x + strip.length, strip.y, 'CORTE'); vertex(strip.x + strip.length, strip.y + state.config.depth, 'CORTE'); vertex(strip.x, strip.y + state.config.depth, 'CORTE'); pair(0, 'SEQEND');
      for (const mark of strip.marks) {
        pair(0, 'LINE'); pair(8, 'USINAGEM'); pair(10, round(strip.x + mark.x)); pair(20, round(layout.height - strip.y)); pair(30, 0); pair(11, round(strip.x + mark.x)); pair(21, round(layout.height - strip.y - state.config.depth)); pair(31, 0);
      }
    }
    pair(0, 'ENDSEC'); pair(0, 'EOF');
    download('t-cut-letra-caixa-tiras.dxf', rows.join('\n') + '\n', 'application/dxf');
  }

  function reset() {
    state.filename = ''; state.pieces = []; state.contours = []; state.strips = []; state.config = null;
    $('lbFileInput').value = '';
    $('lbDepth').value = '100'; $('lbThickness').value = '3'; $('lbMaxLength').value = '2440'; $('lbOverlap').value = '20'; $('lbCurveSpacing').value = '20'; $('lbMinAngle').value = '30';
    $('lbMessage').textContent = 'Importe um SVG para começar.';
    render();
    notify('Plano de letra caixa resetado.');
  }

  window.TCutLetterboxBridge = {
    importSvg,
    exportSvg() {
      if (!state.strips.length) throw new Error('Gere as tiras antes de enviar ao CorelDRAW.');
      return exportedSvg();
    },
  };

  $('nestingTab').addEventListener('click', () => switchTab('nesting'));
  $('letterboxTab').addEventListener('click', () => switchTab('letterbox'));
  $('lbImportButton').addEventListener('click', () => $('lbFileInput').click());
  $('lbFileInput').addEventListener('change', async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try { importSvg(await file.text(), file.name); }
    catch (error) { notify(error.message, true); }
  });
  $('lbGenerateButton').addEventListener('click', generate);
  $('lbResetButton').addEventListener('click', reset);
  $('lbExportSvg').addEventListener('click', exportSvg);
  $('lbExportDxf').addEventListener('click', exportDxf);
  for (const id of fieldIds) $(id).addEventListener('change', () => { if (state.contours.length) $('lbMessage').textContent = 'Parâmetros alterados. Clique em Gerar tiras para atualizar.'; });
  render();
})();
