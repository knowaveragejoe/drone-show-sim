// Picks evenly spread targets from a candidate cloud.
//
// A surface gets farthest point sampling, and then farthest point optimization moves the
// picks apart. A curve gets a walk along it that keeps a fixed spacing (`curvePicks`).
// Each pick is a point of the cloud, so it lies on the shape.

// The sampler puts the points in cells of a grid, about this many points per cell.
const POINTS_PER_CELL = 8;

/**
 * Farthest point sampling. The first pick is the first point. Each next pick is the point
 * that is farthest from all picks so far. Of points at the same distance, the one with the
 * lowest index wins.
 *
 * The first N picks are the same for every larger count, so the sampler picks only as many
 * points as a caller asks for, and picks more when a caller asks for more.
 *
 * Each point keeps its squared distance to its nearest pick. After a pick, no point is
 * farther from its nearest pick than the farthest point, so a new pick can only change the
 * points within that distance of it. The sampler puts the points in the cells of a grid,
 * and visits only the cells within that distance. Each cell keeps its farthest point, so
 * the search for the next pick visits one value per cell, not one per point. The result is
 * the same as a plain search of every point.
 * @param {Float32Array} points xyz per point
 */
export function farthestPointSampler(points) {
  const total = points.length / 3;
  // Squared distance from each point to its nearest pick.
  const nearest = new Float32Array(total).fill(Infinity);
  let picks = new Uint32Array(0);
  let count = 0;
  let current = 0;
  // No point is farther than this from its nearest pick, squared.
  let limit = Infinity;
  /** @type {ReturnType<typeof buildGrid> | null} */
  let grid = null;

  /**
   * @param {number} wanted number of picks
   * @returns {Uint32Array} point indices in pick order; fewer when the points run out
   */
  function order(wanted) {
    wanted = Math.min(wanted, total);
    if (wanted > picks.length) {
      const grown = new Uint32Array(wanted);
      grown.set(picks.subarray(0, count));
      picks = grown;
    }
    if (count >= wanted) return picks.subarray(0, wanted);
    grid ??= buildGrid(points, total);
    while (count < wanted) {
      picks[count++] = current;
      grid.update(current, limit, nearest);
      const [farthest, next] = grid.farthest();
      limit = farthest;
      current = next;
    }
    return picks.subarray(0, wanted);
  }

  return { order };
}

/**
 * Puts points in the cells of a grid, for the farthest point sampler.
 * @param {Float32Array} points xyz per point
 * @param {number} total number of points
 */
function buildGrid(points, total) {
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < total * 3; i++) {
    low[i % 3] = Math.min(low[i % 3], points[i]);
    high[i % 3] = Math.max(high[i % 3], points[i]);
  }
  const extent = low.map((value, axis) => high[axis] - value);
  const largest = Math.max(...extent) || 1;
  // A flat cloud has a thickness of zero on one axis, and needs only one cell on it.
  const flat = extent.map((value) => value <= largest * 1e-6);
  const activeAxes = flat.filter((isFlat) => !isFlat).length || 1;
  const perAxis = Math.max(1, Math.round((total / POINTS_PER_CELL) ** (1 / activeAxes)));
  const edge = largest / perAxis;
  const cells = extent.map((value, axis) => (flat[axis] ? 1 : Math.max(1, Math.ceil(value / edge))));
  const [cellsX, cellsY, cellsZ] = cells;

  /** @param {number} value @param {number} axis */
  const cellIndex = (value, axis) => Math.min(cells[axis] - 1, Math.max(0, Math.floor((value - low[axis]) / edge)));

  // Sort the points by cell. Inside a cell, the points stay in index order.
  const cellCount = cellsX * cellsY * cellsZ;
  const cellOfPoint = new Int32Array(total);
  const start = new Int32Array(cellCount + 1);
  for (let i = 0; i < total; i++) {
    const cell =
      (cellIndex(points[i * 3], 0) * cellsY + cellIndex(points[i * 3 + 1], 1)) * cellsZ +
      cellIndex(points[i * 3 + 2], 2);
    cellOfPoint[i] = cell;
    start[cell + 1]++;
  }
  for (let cell = 0; cell < cellCount; cell++) start[cell + 1] += start[cell];
  const sorted = new Int32Array(total);
  const fill = start.slice(0, cellCount);
  for (let i = 0; i < total; i++) sorted[fill[cellOfPoint[i]]++] = i;
  /** @type {number[]} */
  const used = [];
  for (let cell = 0; cell < cellCount; cell++) if (start[cell + 1] > start[cell]) used.push(cell);

  // The farthest point of each cell: its squared distance, and its index.
  const cellFarthest = new Float32Array(cellCount).fill(Infinity);
  const cellPoint = new Int32Array(cellCount);
  for (const cell of used) cellPoint[cell] = sorted[start[cell]];
  // A cell box grows by this much, so that rounding cannot hide a point that is inside it.
  const slack = edge * 1e-9;

  /**
   * Updates the distances to the nearest pick for a new pick.
   * @param {number} pick index of the new pick
   * @param {number} limit no point is farther than this from its nearest pick, squared
   * @param {Float32Array} nearest
   */
  function update(pick, limit, nearest) {
    const cx = points[pick * 3];
    const cy = points[pick * 3 + 1];
    const cz = points[pick * 3 + 2];
    if (limit === Infinity) {
      for (const cell of used) visit(cell, cx, cy, cz, nearest);
      return;
    }
    // A point changes only if it is nearer to the new pick than to its nearest pick.
    const reach = Math.sqrt(limit) * (1 + 1e-6);
    const from = [cx - reach, cy - reach, cz - reach].map((value, axis) => cellIndex(value, axis));
    const to = [cx + reach, cy + reach, cz + reach].map((value, axis) => cellIndex(value, axis));
    const bound = limit * (1 + 1e-6);
    for (let x = from[0]; x <= to[0]; x++) {
      const gx = gap(cx, low[0] + x * edge);
      for (let y = from[1]; y <= to[1]; y++) {
        const gy = gap(cy, low[1] + y * edge);
        for (let z = from[2]; z <= to[2]; z++) {
          const cell = (x * cellsY + y) * cellsZ + z;
          if (start[cell + 1] === start[cell]) continue;
          const gz = gap(cz, low[2] + z * edge);
          if (gx * gx + gy * gy + gz * gz > bound) continue;
          visit(cell, cx, cy, cz, nearest);
        }
      }
    }
  }

  /**
   * Distance from a coordinate to the span of one cell on one axis; 0 inside the span.
   * @param {number} value
   * @param {number} cellLow
   */
  function gap(value, cellLow) {
    if (value < cellLow - slack) return cellLow - slack - value;
    const cellHigh = cellLow + edge + slack;
    return value > cellHigh ? value - cellHigh : 0;
  }

  /**
   * Updates the points of one cell, and finds its farthest point again.
   * @param {number} cell
   * @param {number} cx
   * @param {number} cy
   * @param {number} cz
   * @param {Float32Array} nearest
   */
  function visit(cell, cx, cy, cz, nearest) {
    let farthest = -1;
    let farthestPoint = 0;
    for (let k = start[cell]; k < start[cell + 1]; k++) {
      const i = sorted[k];
      const dx = points[i * 3] - cx;
      const dy = points[i * 3 + 1] - cy;
      const dz = points[i * 3 + 2] - cz;
      const distance = dx * dx + dy * dy + dz * dz;
      if (distance < nearest[i]) nearest[i] = distance;
      if (nearest[i] > farthest) {
        farthest = nearest[i];
        farthestPoint = i;
      }
    }
    cellFarthest[cell] = farthest;
    cellPoint[cell] = farthestPoint;
  }

  /** @returns {[number, number]} the largest distance to a nearest pick, squared, and its point */
  function farthest() {
    let best = -1;
    let point = 0;
    for (const cell of used) {
      const value = cellFarthest[cell];
      if (value > best || (value === best && cellPoint[cell] < point)) {
        best = value;
        point = cellPoint[cell];
      }
    }
    return [best, point];
  }

  return { update, farthest };
}

/**
 * The first `count` picks of farthest point sampling.
 * @param {Float32Array} points xyz per point
 * @param {number} count number of picks
 * @returns {Uint32Array} point indices in pick order
 */
export function farthestPointOrder(points, count) {
  return farthestPointSampler(points).order(count);
}

// The walk of `curvePicks` finds its spacing to this share of the spacing.
const WALK_PRECISION = 1e-3;
// Farthest point optimization stops after this many passes over the picks, or earlier when
// no pick moves.
const RELAX_PASSES = 30;

/**
 * A hash of the cells of a grid in space. Each cell keeps a list of items, for example
 * the indices of points. Two cells can share a list: a search then checks a few more items,
 * so it stays exact.
 * @param {number} cellSize edge length of a cell
 * @param {number} capacity largest number of items
 */
function cellHash(cellSize, capacity) {
  let size = 64;
  while (size < capacity * 2) size *= 2;
  const mask = size - 1;
  const head = new Int32Array(size).fill(-1);
  const next = new Int32Array(capacity).fill(-1);
  const previous = new Int32Array(capacity).fill(-1);
  const bucketOf = new Int32Array(capacity).fill(-1);

  /** @param {number} cx @param {number} cy @param {number} cz */
  const bucket = (cx, cy, cz) =>
    (Math.imul(cx, 73856093) ^ Math.imul(cy, 19349663) ^ Math.imul(cz, 83492791)) & mask;
  /** @param {number} value */
  const cell = (value) => Math.floor(value / cellSize);

  return {
    /** Adds an item at a position. @param {number} item @param {number} x @param {number} y @param {number} z */
    add(item, x, y, z) {
      const b = bucket(cell(x), cell(y), cell(z));
      bucketOf[item] = b;
      previous[item] = -1;
      next[item] = head[b];
      if (head[b] >= 0) previous[head[b]] = item;
      head[b] = item;
    },
    /** Removes an item. @param {number} item */
    remove(item) {
      const b = bucketOf[item];
      if (previous[item] >= 0) next[previous[item]] = next[item];
      else head[b] = next[item];
      if (next[item] >= 0) previous[next[item]] = previous[item];
      bucketOf[item] = -1;
    },
    /** Removes every item. */
    clear() {
      head.fill(-1);
    },
    /**
     * Calls a function for each item in the 27 cells around a position. It visits at least
     * every item within one cell size of the position. It stops when the function returns true.
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @param {(item: number) => boolean | void} visit
     */
    near(x, y, z, visit) {
      const cx = cell(x);
      const cy = cell(y);
      const cz = cell(z);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            for (let item = head[bucket(cx + dx, cy + dy, cz + dz)]; item >= 0; item = next[item]) {
              if (visit(item)) return;
            }
          }
        }
      }
    },
  };
}

/**
 * Picks points on curves with an even spacing. The cloud must be in order along the curves,
 * as the clouds of curves are. The walk goes through the points in order and keeps each
 * point that is at least a spacing `s` away from every point that it kept before. This
 * keeps the spacing along each curve, and also where a curve comes back near itself, at a
 * cusp, or near another curve. A bisection finds the largest `s` that keeps `count` points.
 *
 * Every two picks are at least `s` apart, and neighbors along a curve are close to `s` apart.
 * @param {Float32Array} points xyz per point, in order along the curves
 * @param {number} count number of picks
 * @returns {Uint32Array} point indices, in order along the curves
 */
export function curvePicks(points, count) {
  const total = points.length / 3;
  if (count >= total) return Uint32Array.from({ length: total }, (unused, i) => i);
  if (count <= 0) return new Uint32Array(0);
  // Every spacing keeps the first point, so one pick needs no search.
  if (count === 1) return new Uint32Array(1);
  const kept = new Uint32Array(count);

  /**
   * Walks the points with one spacing.
   * @param {number} spacing
   * @returns {number} number of points kept, up to `count`
   */
  function walk(spacing) {
    const limit = spacing * spacing;
    const hash = cellHash(spacing, count);
    let found = 0;
    for (let i = 0; i < total && found < count; i++) {
      const x = points[i * 3];
      const y = points[i * 3 + 1];
      const z = points[i * 3 + 2];
      // Most points are near the point that the walk kept last. That check is fast.
      if (found > 0) {
        const p = kept[found - 1] * 3;
        const dx = points[p] - x;
        const dy = points[p + 1] - y;
        const dz = points[p + 2] - z;
        if (dx * dx + dy * dy + dz * dz < limit) continue;
      }
      let free = true;
      hash.near(x, y, z, (k) => {
        const p = kept[k] * 3;
        const dx = points[p] - x;
        const dy = points[p + 1] - y;
        const dz = points[p + 2] - z;
        free = dx * dx + dy * dy + dz * dz >= limit;
        return !free;
      });
      if (!free) continue;
      kept[found] = i;
      hash.add(found, x, y, z);
      found++;
    }
    return found;
  }

  // The length of the walk is an upper bound for the spacing times the count.
  let length = 0;
  for (let i = 1; i < total; i++) {
    const o = i * 3;
    length += Math.hypot(points[o] - points[o - 3], points[o + 1] - points[o - 2], points[o + 2] - points[o - 1]);
  }
  let low = 0;
  let high = (2 * length) / count;
  while (high > 0 && walk(high) >= count) {
    low = high;
    high *= 2;
  }
  while (high - low > high * WALK_PRECISION) {
    const middle = (low + high) / 2;
    if (walk(middle) >= count) low = middle;
    else high = middle;
  }
  // All points at one place: any points will do.
  if (!(low > 0)) return Uint32Array.from({ length: count }, (unused, i) => i);
  walk(low);
  return kept.slice();
}

/**
 * Moves picks on a surface apart: farthest point optimization on the cloud. Each pick in
 * turn moves to the point near it that is farthest from all other picks, if that point is
 * farther than its place now. A move never brings two picks closer than the smallest
 * spacing before it, so the smallest spacing can only grow.
 *
 * The picks stay points of the cloud, and no two picks share a point.
 * @param {Float32Array} points xyz per point of the cloud
 * @param {ArrayLike<number>} picks point indices, for example from farthest point sampling
 * @returns {Uint32Array} point indices; pick k of the result comes from pick k of the input
 */
export function relaxPicks(points, picks) {
  const result = Uint32Array.from(picks);
  const count = result.length;
  const total = points.length / 3;
  if (count < 2) return result;

  const spacing = typicalSpacing(points, result);
  if (!(spacing > 0)) return result;
  // A pick looks for a better place within this distance of where it is.
  const reach = spacing / 2;
  const reachSquared = reach * reach;
  // The search for the nearest other pick sees every pick within this distance.
  const sight = spacing * 2;
  const sightSquared = sight * sight;

  const cloud = cellHash(reach, total);
  for (let i = 0; i < total; i++) cloud.add(i, points[i * 3], points[i * 3 + 1], points[i * 3 + 2]);

  // The picks near the pick that moves: every pick that can be the nearest pick of a place
  // that the moving pick looks at. Positions, xyz per pick.
  const local = new Float64Array(count * 3);
  // Picks within this distance of a pick are near it.
  const gatherSquared = (sight + reach) ** 2;
  const gather = cellHash(sight + reach, count);
  for (let k = 0; k < count; k++) {
    const p = result[k] * 3;
    gather.add(k, points[p], points[p + 1], points[p + 2]);
  }

  for (let pass = 0; pass < RELAX_PASSES; pass++) {
    let moved = 0;
    for (let k = 0; k < count; k++) {
      const here = result[k];
      const hx = points[here * 3];
      const hy = points[here * 3 + 1];
      const hz = points[here * 3 + 2];
      let near = 0;
      gather.near(hx, hy, hz, (j) => {
        if (j === k) return;
        const p = result[j] * 3;
        const dx = points[p] - hx;
        const dy = points[p + 1] - hy;
        const dz = points[p + 2] - hz;
        if (dx * dx + dy * dy + dz * dz > gatherSquared) return;
        local[near * 3] = points[p];
        local[near * 3 + 1] = points[p + 1];
        local[near * 3 + 2] = points[p + 2];
        near++;
      });

      /**
       * Squared distance from a place to the nearest other pick, up to `sightSquared`.
       * The search stops early when the distance is not more than `floor`.
       * @param {number} x @param {number} y @param {number} z @param {number} floor
       */
      const nearestPick = (x, y, z, floor) => {
        let nearest = sightSquared;
        for (let j = 0; j < near * 3; j += 3) {
          const dx = local[j] - x;
          const dy = local[j + 1] - y;
          const dz = local[j + 2] - z;
          const distance = dx * dx + dy * dy + dz * dz;
          if (distance < nearest) {
            nearest = distance;
            if (nearest <= floor) break;
          }
        }
        return nearest;
      };

      let best = nearestPick(hx, hy, hz, -1);
      let bestPoint = here;
      cloud.near(hx, hy, hz, (i) => {
        const x = points[i * 3];
        const y = points[i * 3 + 1];
        const z = points[i * 3 + 2];
        const dx = x - hx;
        const dy = y - hy;
        const dz = z - hz;
        if (dx * dx + dy * dy + dz * dz > reachSquared) return;
        const distance = nearestPick(x, y, z, best);
        // A tie keeps the place, or the point with the lower index.
        if (distance > best || (distance === best && bestPoint !== here && i < bestPoint)) {
          best = distance;
          bestPoint = i;
        }
      });
      if (bestPoint === here) continue;
      result[k] = bestPoint;
      gather.remove(k);
      gather.add(k, points[bestPoint * 3], points[bestPoint * 3 + 1], points[bestPoint * 3 + 2]);
      moved++;
    }
    if (moved === 0) break;
  }
  return result;
}

/**
 * The median distance from a pick to its nearest other pick.
 * @param {Float32Array} points xyz per point of the cloud
 * @param {Uint32Array} picks point indices
 * @returns {number} 0 when the picks are all at one place
 */
function typicalSpacing(points, picks) {
  const count = picks.length;
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (const pick of picks) {
    for (let axis = 0; axis < 3; axis++) {
      low[axis] = Math.min(low[axis], points[pick * 3 + axis]);
      high[axis] = Math.max(high[axis], points[pick * 3 + axis]);
    }
  }
  const diagonal = Math.hypot(...high.map((value, axis) => value - low[axis]));
  if (!(diagonal > 0)) return 0;
  // A first guess for a surface. The cell size doubles until most picks see a neighbor.
  let cellSize = diagonal / Math.sqrt(count);
  for (;;) {
    const hash = cellHash(cellSize, count);
    picks.forEach((pick, k) => hash.add(k, points[pick * 3], points[pick * 3 + 1], points[pick * 3 + 2]));
    const nearest = new Float64Array(count);
    picks.forEach((pick, k) => {
      const x = points[pick * 3];
      const y = points[pick * 3 + 1];
      const z = points[pick * 3 + 2];
      let best = Infinity;
      hash.near(x, y, z, (j) => {
        if (j === k) return;
        const p = picks[j] * 3;
        best = Math.min(best, (points[p] - x) ** 2 + (points[p + 1] - y) ** 2 + (points[p + 2] - z) ** 2);
      });
      // A neighbor outside the cells is at least one cell size away.
      nearest[k] = Math.min(best, cellSize * cellSize);
    });
    nearest.sort();
    const median = Math.sqrt(nearest[count >> 1]);
    if (median < cellSize || cellSize >= diagonal) return median;
    cellSize *= 2;
  }
}

/**
 * Smallest distance between any two points.
 * @param {Float32Array} points xyz per point
 * @param {number} count number of points to check, from the start of the array
 * @returns {number} Infinity when there are fewer than two points
 */
export function closestSpacing(points, count) {
  let smallest = Infinity;
  for (let i = 0; i < count; i++) {
    const x = points[i * 3];
    const y = points[i * 3 + 1];
    const z = points[i * 3 + 2];
    for (let j = i + 1; j < count; j++) {
      const dx = points[j * 3] - x;
      const dy = points[j * 3 + 1] - y;
      const dz = points[j * 3 + 2] - z;
      const distance = dx * dx + dy * dy + dz * dz;
      if (distance < smallest) smallest = distance;
    }
  }
  return Math.sqrt(smallest);
}
