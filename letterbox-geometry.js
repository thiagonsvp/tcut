const LetterboxGeometry = (() => {
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const round = value => Number(value.toFixed(3));

  function contourFromPoints(input) {
    const points = [];
    for (const point of input) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
      if (!points.length || distance(point, points.at(-1)) > .05) points.push({ x: point.x, y: point.y });
    }
    if (points.length < 3 || distance(points[0], points.at(-1)) > 2.5) return null;
    if (distance(points[0], points.at(-1)) <= .05) points.pop();
    if (points.length < 3) return null;
    const lengths = [0];
    for (let i = 0; i < points.length; i++) lengths.push(lengths.at(-1) + distance(points[i], points[(i + 1) % points.length]));
    const perimeter = lengths.at(-1);
    if (perimeter < 10) return null;
    let signedArea = 0;
    for (let i = 0; i < points.length; i++) {
      const next = points[(i + 1) % points.length];
      signedArea += points[i].x * next.y - next.x * points[i].y;
    }
    return { points, lengths, perimeter, signedArea: signedArea / 2 };
  }

  function pointAt(contour, position) {
    const s = ((position % contour.perimeter) + contour.perimeter) % contour.perimeter;
    let low = 0, high = contour.points.length;
    while (low + 1 < high) {
      const middle = (low + high) >> 1;
      if (contour.lengths[middle] <= s) low = middle;
      else high = middle;
    }
    const a = contour.points[low], b = contour.points[(low + 1) % contour.points.length];
    const segment = contour.lengths[low + 1] - contour.lengths[low];
    const t = segment ? (s - contour.lengths[low]) / segment : 0;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }

  function turnAt(contour, position, window = 4) {
    const before = pointAt(contour, position - window);
    const center = pointAt(contour, position);
    const after = pointAt(contour, position + window);
    const ax = center.x - before.x, ay = center.y - before.y;
    const bx = after.x - center.x, by = after.y - center.y;
    const product = Math.hypot(ax, ay) * Math.hypot(bx, by);
    if (product < .001) return 0;
    return Math.atan2(ax * by - ay * bx, ax * bx + ay * by) * 180 / Math.PI;
  }

  function arcDistance(a, b, perimeter) {
    const direct = Math.abs(a - b);
    return Math.min(direct, perimeter - direct);
  }

  function bendMarks(contour, minAngle, curveSpacing) {
    const window = Math.min(4, contour.perimeter / 30);
    const candidates = contour.points.map((_, i) => ({ at: contour.lengths[i], angle: turnAt(contour, contour.lengths[i], window) }))
      .filter(mark => Math.abs(mark.angle) >= minAngle)
      .sort((a, b) => Math.abs(b.angle) - Math.abs(a.angle));
    const corners = [];
    for (const mark of candidates) {
      if (corners.every(other => arcDistance(mark.at, other.at, contour.perimeter) > window * 2)) corners.push({ ...mark, type: 'corner' });
    }
    const marks = [...corners];
    if (curveSpacing > 0) {
      for (let at = curveSpacing / 2; at < contour.perimeter; at += curveSpacing) {
        const angle = turnAt(contour, at, window);
        if (Math.abs(angle) < 1 || Math.abs(angle) >= minAngle) continue;
        if (corners.some(other => arcDistance(at, other.at, contour.perimeter) < Math.max(window * 2, curveSpacing / 2))) continue;
        marks.push({ at, angle, type: 'curve' });
      }
    }
    return marks.sort((a, b) => a.at - b.at);
  }

  function containsPoint(contour, point) {
    let inside = false;
    for (let i = 0, j = contour.points.length - 1; i < contour.points.length; j = i++) {
      const a = contour.points[i], b = contour.points[j];
      if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }

  function classifyContours(contours) {
    return contours.map((contour, index) => {
      const inside = contours.filter((other, otherIndex) => otherIndex !== index && Math.abs(other.signedArea) > Math.abs(contour.signedArea) && containsPoint(other, contour.points[0])).length;
      return { ...contour, kind: inside % 2 ? 'interno' : 'externo' };
    });
  }

  function makeStrips(contour, options) {
    const { maxLength, overlap, minAngle, curveSpacing } = options;
    if (!(maxLength > 0) || !(overlap >= 0) || maxLength <= overlap) throw new Error('O comprimento máximo deve superar a emenda.');
    const marks = bendMarks(contour, minAngle, curveSpacing);
    const strips = [];
    const count = Math.max(1, Math.ceil((contour.perimeter - overlap) / (maxLength - overlap)));
    for (let index = 0; index < count; index++) {
      const start = contour.perimeter * index / count;
      const end = contour.perimeter * (index + 1) / count;
      const tail = index < count - 1 ? overlap : 0;
      strips.push({ start: round(start), end: round(end), contourLength: round(end - start), length: round(end - start + tail), overlap: tail, marks: marks.filter(mark => mark.at > start + .1 && mark.at < end - .1).map(mark => ({ ...mark, x: round(mark.at - start) })) });
    }
    return strips;
  }

  return { contourFromPoints, pointAt, turnAt, bendMarks, classifyContours, makeStrips };
})();

if (typeof module !== 'undefined') module.exports = LetterboxGeometry;
