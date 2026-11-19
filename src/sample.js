// Picks evenly spread targets from a candidate cloud.

/**
 * Farthest point sampling. The first pick is the first point. Each next pick is the point
 * that is farthest from all picks so far.
 *
 * The first N picks are the same for every larger count, so the sampler picks only as many
 * points as a caller asks for, and picks more when a caller asks for more.
 * @param {Float32Array} points xyz per point
 */
export function farthestPointSampler(points) {
  const total = points.length / 3;
  // Squared distance from each point to its nearest pick.
  const nearest = new Float32Array(total).fill(Infinity);
  let picks = new Uint32Array(0);
  let count = 0;
  let current = 0;

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
    while (count < wanted) {
      picks[count++] = current;
      const cx = points[current * 3];
      const cy = points[current * 3 + 1];
      const cz = points[current * 3 + 2];
      let farthest = -1;
      let next = 0;
      for (let i = 0; i < total; i++) {
        const dx = points[i * 3] - cx;
        const dy = points[i * 3 + 1] - cy;
        const dz = points[i * 3 + 2] - cz;
        const distance = dx * dx + dy * dy + dz * dz;
        if (distance < nearest[i]) nearest[i] = distance;
        if (nearest[i] > farthest) {
          farthest = nearest[i];
          next = i;
        }
      }
      current = next;
    }
    return picks.subarray(0, wanted);
  }

  return { order };
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
