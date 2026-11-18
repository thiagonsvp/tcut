const LedGeometry = (() => {
  const round = value => Number(value.toFixed(3));
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  function contourFromPoints(input) {
    const points = [];
    for (const point of input) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
      if (!points.length || distance(point, points.at(-1)) > .05) points.push({ x: point.x, y: point.y });
    }
    if (points.length < 3 || distance(points[0], points.at(-1)) > 2.5) return null;
    if (distance(points[0], points.at(-1)) <= .05) points.pop();
    if (points.length < 3) return null;
    let perimeter = 0, signedArea = 0;
    for (let index = 0; index < points.length; index++) {
      const next = points[(index + 1) % points.length];
      perimeter += distance(points[index], next);
      signedArea += points[index].x * next.y - next.x * points[index].y;
    }
    return perimeter >= 5 ? { points, perimeter, signedArea: signedArea / 2 } : null;
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
      const nesting = contours.filter((other, otherIndex) => otherIndex !== index && Math.abs(other.signedArea) > Math.abs(contour.signedArea) && containsPoint(other, contour.points[0])).length;
      return { ...contour, kind: nesting % 2 ? 'interno' : 'externo' };
    });
  }

  function normal(from, to, orientation) {
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (!length) return { x: 0, y: 0 };
    // In SVG coordinates, the left normal of a positive-area contour points inward.
    return { x: orientation * -(to.y - from.y) / length, y: orientation * (to.x - from.x) / length };
  }

  // Positive distance moves toward the material interior; negative distance moves outward.
  function offsetContour(contour, distanceMm) {
    const { points, signedArea } = contour;
    const orientation = signedArea >= 0 ? 1 : -1;
    const result = [];
    for (let index = 0; index < points.length; index++) {
      const previous = points[(index - 1 + points.length) % points.length];
      const current = points[index];
      const next = points[(index + 1) % points.length];
      const a = normal(previous, current, orientation);
      const b = normal(current, next, orientation);
      let x = a.x + b.x, y = a.y + b.y;
      const length = Math.hypot(x, y);
      if (length < .0001) { x = b.x; y = b.y; }
      else { x /= length; y /= length; }
      const alignment = Math.max(.2, Math.abs(x * b.x + y * b.y));
      // A limit avoids an excessively long miter at very acute corners.
      const miter = Math.min(Math.abs(distanceMm) / alignment, Math.abs(distanceMm) * 4) * Math.sign(distanceMm || 1);
      result.push({ x: round(current.x + x * miter), y: round(current.y + y * miter) });
    }
    return contourFromPoints([...result, result[0]]);
  }

  function ledContour(contour, options) {
    const toOutside = options.rebate ? contour.kind === 'externo' : contour.kind === 'interno';
    return offsetContour(contour, toOutside ? -options.offset : options.offset);
  }

  return { contourFromPoints, classifyContours, offsetContour, ledContour };
})();

if (typeof module !== 'undefined') module.exports = LedGeometry;
