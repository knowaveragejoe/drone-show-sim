// Drone motion: where the drones start and how they fly.

/**
 * Ground positions where the drones start: a grid that is close to square, centered on the origin.
 * Drone 0 is in the corner nearest the audience. The order is row by row.
 * @param {number} count number of drones
 * @param {number} spacing distance between neighbors, meters
 * @returns {Float32Array} xyz per drone
 */
export function takeoffGrid(count, spacing) {
  const columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const column = i % columns;
    const row = Math.floor(i / columns);
    positions[i * 3] = (column - (columns - 1) / 2) * spacing;
    positions[i * 3 + 1] = (row - (rows - 1) / 2) * spacing;
  }
  return positions;
}
