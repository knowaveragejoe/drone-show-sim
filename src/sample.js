// Picks evenly spread targets from a candidate cloud.

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
    if (count < wanted && !grid) grid = buildGrid(points, total);
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
