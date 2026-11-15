// Picks evenly spread targets from a candidate cloud.

/**
 * Farthest point sampling. The first pick is the first point. Each next pick is the point
 * that is farthest from all picks so far.
 *
 * The first N picks are the same for every larger count, so a caller can compute the
 * order once and use any prefix of it.
 * @param {Float32Array} points xyz per point
 * @param {number} count number of picks
 * @returns {Uint32Array} point indices in pick order
 */
export function farthestPointOrder(points, count) {
  const total = points.length / 3;
  const picks = new Uint32Array(Math.min(count, total));
  // Squared distance from each point to its nearest pick.
  const nearest = new Float32Array(total).fill(Infinity);
  let current = 0;
  for (let pick = 0; pick < picks.length; pick++) {
    picks[pick] = current;
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
  return picks;
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
