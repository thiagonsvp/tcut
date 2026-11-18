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
  // Intersecting the adjacent parallel offsets keeps the complete line at the requested
  // clearance from the original contour, including at a sharp corner.
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
      const alignment = Math.max(.0001, Math.abs(x * b.x + y * b.y));
      const miter = distanceMm / alignment;
      result.push({ x: round(current.x + x * miter), y: round(current.y + y * miter) });
    }
    return contourFromPoints([...result, result[0]]);
  }

  function ledContour(contour, options) {
    const toOutside = options.rebate ? contour.kind === 'externo' : contour.kind === 'interno';
    return offsetContour(contour, toOutside ? -options.offset : options.offset);
  }

  function nearestPointOnSegment(point, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const denominator = dx * dx + dy * dy;
    const ratio = denominator ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / denominator)) : 0;
    const x = a.x + dx * ratio, y = a.y + dy * ratio;
    return { x, y, distance: Math.hypot(point.x - x, point.y - y) };
  }

  function nearestPointOnPath(point, path) {
    let closest = null;
    for (let index = 0; index < path.points.length; index++) {
      const candidate = nearestPointOnSegment(point, path.points[index], path.points[(index + 1) % path.points.length]);
      if (!closest || candidate.distance < closest.distance) closest = candidate;
    }
    return closest;
  }

  // When two channels overlap, retain the lower-index path and move it to the
  // midpoint. The second path is removed only on the overlapping stretch, yielding
  // one physical LED route instead of two nearly coincident routes.
  function mergeClosePaths(paths, clearance) {
    const merged = paths.map(path => ({ ...path, points: path.points.map(point => ({ ...point })), suppressed: new Array(path.points.length).fill(false) }));
    for (let first = 0; first < merged.length; first++) for (let second = first + 1; second < merged.length; second++) {
      const primary = merged[first], secondary = merged[second];
      for (let index = 0; index < primary.points.length; index++) {
        const point = primary.points[index], closest = nearestPointOnPath(point, secondary);
        if (closest.distance > clearance) continue;
        primary.points[index] = { x: round((point.x + closest.x) / 2), y: round((point.y + closest.y) / 2) };
      }
      for (let index = 0; index < secondary.points.length; index++) {
        if (nearestPointOnPath(secondary.points[index], primary).distance <= clearance) secondary.suppressed[index] = true;
      }
    }
    return merged;
  }

  function visibleSegments(path) {
    if (!path.suppressed?.some(Boolean)) return path.points.length > 2 ? [{ points: path.points, closed: true }] : [];
    const result = [], total = path.points.length;
    let start = path.suppressed.findIndex(Boolean);
    for (let step = 1; step <= total; step++) {
      const index = (start + step) % total;
      if (path.suppressed[index]) continue;
      const points = [];
      while (step <= total && !path.suppressed[(start + step) % total]) {
        points.push(path.points[(start + step) % total]);
        step++;
      }
      if (points.length > 1) result.push({ points, closed: false });
    }
    return result;
  }

  function visibleLength(path) {
    return visibleSegments(path).reduce((total, segment) => total + segment.points.reduce((sum, point, index) => sum + (index ? distance(point, segment.points[index - 1]) : 0), segment.closed ? distance(segment.points[0], segment.points.at(-1)) : 0), 0);
  }

  return { contourFromPoints, classifyContours, offsetContour, ledContour, mergeClosePaths, visibleSegments, visibleLength };
})();

if (typeof module !== 'undefined') module.exports = LedGeometry;
