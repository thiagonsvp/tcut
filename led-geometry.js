const LedGeometry = (() => {
  const round = value => Number(value.toFixed(3));
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const clip = typeof module === 'undefined' ? ClipperLib : require('./clipper.js');

  // Offset the whole filled region, so holes, narrow strokes and intersections
  // are resolved together. Coordinates use integer micrometres during clipping.
  function pieceRoutes(contours, config) {
    const scale = 1000;
    const rings = contours.map(contour => {
      const ring = contour.points.map(p => ({ X: Math.round(p.x * scale), Y: Math.round(p.y * scale) }));
      if (clip.Clipper.Orientation(ring) !== (contour.kind === 'externo')) ring.reverse();
      return ring;
    });
    const offsetter = new clip.ClipperOffset(4);
    offsetter.AddPaths(rings, clip.JoinType.jtMiter, clip.EndType.etClosedPolygon);
    const solution = [];
    const clearance = config.offset + config.channelWidth / 2;
    offsetter.Execute(solution, (config.rebate ? 1 : -1) * clearance * scale);
    return solution.map((ring, index) => ({
      points: ring.map(p => ({ x: p.X / scale, y: p.Y / scale })),
      kind: clip.Clipper.Orientation(ring) ? 'externo' : 'interno',
      piece: contours[0].piece, contourIndex: index + 1
    }));
  }

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

  // Both sides of a narrow rectangular inset can be machined in a single pass.
  function narrowAxis(route, width) {
    if (route.points.length !== 4) return route;
    const [a,b,c,d] = route.points;
    const ab = distance(a,b), bc = distance(b,c);
    if (Math.min(ab,bc) > width || Math.max(ab,bc) <= width) return route;
    const dot = (b.x-a.x)*(c.x-b.x) + (b.y-a.y)*(c.y-b.y);
    if (Math.abs(dot) > 0.001*ab*bc || Math.abs(ab-distance(c,d)) > .002 || Math.abs(bc-distance(d,a)) > .002) return route;
    const mid = (u,v) => ({ x: round((u.x+v.x)/2), y: round((u.y+v.y)/2) });
    return { ...route, open: true, points: ab < bc ? [mid(a,b),mid(c,d)] : [mid(b,c),mid(d,a)] };
  }

  function channelsForPiece(contours, config) {
    const routes = pieceRoutes(contours, config);
    if (routes.length < 2) return routes.map(route => narrowAxis(route, config.channelWidth));
    const merged = mergeClosePaths(routes, config.channelWidth);
    // A midpoint between two rings can lie in a hole or in a thin wall.
    // Accept a merge only if every new segment stays clear of every original edge.
    const limit = config.offset + config.channelWidth/2 - .002;
    for (const route of merged) for (const segment of visibleSegments(route)) {
      const points = segment.points;
      for (let i = segment.closed ? 0 : 1; i < points.length; i++) {
        const a = points[(i+points.length-1)%points.length], b = points[i];
        for (const ring of contours) for (let j=0; j<ring.points.length; j++) {
          const c=ring.points[j], d=ring.points[(j+1)%ring.points.length];
          if (Math.min(a.x,b.x)-Math.max(c.x,d.x)>=limit || Math.min(c.x,d.x)-Math.max(a.x,b.x)>=limit ||
              Math.min(a.y,b.y)-Math.max(c.y,d.y)>=limit || Math.min(c.y,d.y)-Math.max(a.y,b.y)>=limit) continue;
          const side = (u,v,w) => (v.x-u.x)*(w.y-u.y)-(v.y-u.y)*(w.x-u.x);
          if ((side(a,b,c)*side(a,b,d)<0 && side(c,d,a)*side(c,d,b)<0) ||
              Math.min(nearestPointOnSegment(a,c,d).distance, nearestPointOnSegment(b,c,d).distance,
                       nearestPointOnSegment(c,a,b).distance, nearestPointOnSegment(d,a,b).distance)<limit) return routes;
        }
      }
    }
    return merged.filter(route => visibleSegments(route).length);
  }

  function visibleSegments(path) {
    if (path.open) return [{ points: path.points, closed: false }];
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

  return { contourFromPoints, classifyContours, mergeClosePaths, visibleSegments, visibleLength, pieceRoutes, channelsForPiece };
})();

if (typeof module !== 'undefined') module.exports = LedGeometry;
