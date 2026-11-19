// Assignment: which drone flies to which target.

import { farthestPointOrder } from './sample.js';

// From this many drones up, a cold assignment starts with a coarse solve of a spread
// sample. Below it, a direct solve is fast enough.
const COARSE_TO_FINE_MIN = 400;
// The coarse solve uses this share of the drones.
const COARSE_SHARE = 0.25;
// A warm start from a much smaller problem is a poor start: its rows are the first rows of
// the lists, and those need not be spread. Below this share of the drones, a coarse to fine
// solve starts instead.
const WARM_MIN_SHARE = 0.75;

/**
 * An optimal assignment, with the column prices that prove it optimal.
 * @typedef {object} Solution
 * @property {Int32Array} columnOfRow the column of each row
 * @property {Float64Array} price the price of each column. Each row's own column has the
 *   smallest reduced cost (cost minus price) of its row.
 */

// A kept pair of a warm start must be the cheapest of its row by more than this share of its
// reduced cost. A row that fails the test only by rounding error starts again, which is safe.
const WARM_TOLERANCE = 1e-10;

/**
 * Finds the assignment of rows to columns with the smallest total cost.
 *
 * This is the Jonker-Volgenant algorithm (1987). It gives the same result as the Hungarian
 * algorithm, but it is much faster in practice. Three cheap steps assign most rows.
 * Only the rows that are still free need the slow step, a shortest-path search.
 *
 * A warm start begins from an earlier solution of a similar problem instead of the three
 * cheap steps. It keeps each earlier pair whose column is still the cheapest of its row,
 * and the shortest-path search assigns the other rows. The result is optimal for any warm
 * start; a good one only makes it faster. The earlier problem can have a different size.
 * @param {Float64Array} cost n × n values; the cost of row r with column c is at `r × n + c`
 * @param {number} n
 * @param {Solution | null} [warm] an earlier solution to start from
 * @returns {Solution}
 */
export function solveAssignment(cost, n, warm = null) {
  const columnOfRow = new Int32Array(n).fill(-1);
  const rowOfColumn = new Int32Array(n).fill(-1);
  // Column prices. The reduced cost of a cell is its cost minus the price of its column.
  const price = new Float64Array(n);
  const free = new Int32Array(n);
  let freeCount = 0;

  if (warm) {
    freeCount = warmStart(cost, n, warm, price, columnOfRow, rowOfColumn, free);
  } else {
    // Step 1, column reduction. Each column picks its cheapest row.
    // A row that several columns pick keeps one of them.
    const cheapestRow = new Int32Array(n);
    price.fill(Infinity);
    for (let row = 0; row < n; row++) {
      const offset = row * n;
      for (let column = 0; column < n; column++) {
        if (cost[offset + column] < price[column]) {
          price[column] = cost[offset + column];
          cheapestRow[column] = row;
        }
      }
    }
    const picks = new Int32Array(n);
    for (let column = n - 1; column >= 0; column--) {
      const row = cheapestRow[column];
      if (++picks[row] === 1) {
        columnOfRow[row] = column;
        rowOfColumn[column] = row;
      }
    }

    // Step 2, reduction transfer. A row that exactly one column picked lowers the price of
    // that column as far as it can and still prefer it.
    for (let row = 0; row < n; row++) {
      if (picks[row] === 0) {
        free[freeCount++] = row;
      } else if (picks[row] === 1) {
        const own = columnOfRow[row];
        const offset = row * n;
        let smallest = Infinity;
        for (let column = 0; column < n; column++) {
          if (column === own) continue;
          const reduced = cost[offset + column] - price[column];
          if (reduced < smallest) smallest = reduced;
        }
        if (smallest < Infinity) price[own] -= smallest;
      }
    }

    // Step 3, augmenting row reduction, two passes. Each free row takes its best column
    // and lowers the price of that column to the level of its second-best column.
    // The row that had the column before becomes free.
    for (let pass = 0; pass < 2; pass++) {
      const previousCount = freeCount;
      freeCount = 0;
      let next = 0;
      // A row that loses its column can go back in the queue of this pass.
      // The budget stops endless back and forth when costs differ only by rounding error.
      let budget = previousCount * 16;
      while (next < previousCount) {
        const row = free[next++];
        const offset = row * n;
        let best = cost[offset] - price[0];
        let bestColumn = 0;
        let second = Infinity;
        let secondColumn = -1;
        for (let column = 1; column < n; column++) {
          const reduced = cost[offset + column] - price[column];
          if (reduced < second) {
            if (reduced >= best) {
              second = reduced;
              secondColumn = column;
            } else {
              second = best;
              secondColumn = bestColumn;
              best = reduced;
              bestColumn = column;
            }
          }
        }

        let column = bestColumn;
        let previousRow = rowOfColumn[column];
        const lowered = price[column] - (second - best);
        const lowers = lowered < price[column];
        if (lowers) {
          price[column] = lowered;
        } else if (previousRow >= 0 && secondColumn >= 0) {
          // The two best columns tie, and the best one is taken. Use the second one.
          column = secondColumn;
          previousRow = rowOfColumn[column];
        }
        columnOfRow[row] = column;
        rowOfColumn[column] = row;
        if (previousRow >= 0) {
          if (lowers && budget-- > 0) free[--next] = previousRow;
          else free[freeCount++] = previousRow;
        }
      }
    }
  }

  // Step 4, augmentation. For each row that is still free, find the cheapest chain of swaps
  // that ends at a free column (a shortest-path search), then apply the chain.
  const distance = new Float64Array(n);
  const previousRowOf = new Int32Array(n);
  // Columns in three groups: [0, low) are done, [low, up) are at the current smallest
  // distance and wait for a scan, [up, n) are not reached yet.
  const columns = new Int32Array(n);
  for (let f = 0; f < freeCount; f++) {
    const freeRow = free[f];
    const freeOffset = freeRow * n;
    for (let column = 0; column < n; column++) {
      distance[column] = cost[freeOffset + column] - price[column];
      previousRowOf[column] = freeRow;
      columns[column] = column;
    }

    let low = 0;
    let up = 0;
    let lastDone = -1;
    let smallest = 0;
    let end = -1;
    while (end < 0) {
      if (up === low) {
        // No column waits. Collect the columns with the smallest distance.
        lastDone = low - 1;
        smallest = distance[columns[up++]];
        for (let k = up; k < n; k++) {
          const column = columns[k];
          const value = distance[column];
          if (value <= smallest) {
            if (value < smallest) {
              up = low;
              smallest = value;
            }
            columns[k] = columns[up];
            columns[up++] = column;
          }
        }
        for (let k = low; k < up; k++) {
          if (rowOfColumn[columns[k]] < 0) {
            end = columns[k];
            break;
          }
        }
      }
      if (end < 0) {
        // Scan one waiting column: look at the row that owns it.
        const scanned = columns[low++];
        const row = rowOfColumn[scanned];
        const offset = row * n;
        const base = cost[offset + scanned] - price[scanned] - smallest;
        for (let k = up; k < n; k++) {
          const column = columns[k];
          const through = cost[offset + column] - price[column] - base;
          if (through < distance[column]) {
            previousRowOf[column] = row;
            if (through === smallest) {
              if (rowOfColumn[column] < 0) {
                end = column;
                break;
              }
              columns[k] = columns[up];
              columns[up++] = column;
            }
            distance[column] = through;
          }
        }
      }
    }

    for (let k = 0; k <= lastDone; k++) {
      const column = columns[k];
      price[column] += distance[column] - smallest;
    }

    // Walk the chain back to the free row and swap the columns along it.
    let row;
    do {
      row = previousRowOf[end];
      rowOfColumn[end] = row;
      const taken = end;
      end = columnOfRow[row];
      columnOfRow[row] = taken;
    } while (row !== freeRow);
  }

  return { columnOfRow, price };
}

/**
 * Sets up a warm start: the pairs, prices, and free rows from an earlier solution.
 * @param {Float64Array} cost
 * @param {number} n
 * @param {Solution} warm
 * @param {Float64Array} price filled by this function
 * @param {Int32Array} columnOfRow filled by this function; -1 for a free row
 * @param {Int32Array} rowOfColumn filled by this function; -1 for a free column
 * @param {Int32Array} free filled by this function with the free rows
 * @returns {number} number of free rows
 */
function warmStart(cost, n, warm, price, columnOfRow, rowOfColumn, free) {
  const earlierColumns = warm.price.length;
  // Keep each earlier pair whose row and column still exist.
  /** @type {number[]} */
  const kept = [];
  for (let row = 0; row < Math.min(n, warm.columnOfRow.length); row++) {
    const column = warm.columnOfRow[row];
    if (column >= 0 && column < n) {
      columnOfRow[row] = column;
      rowOfColumn[column] = row;
      kept.push(row);
    }
  }
  // An earlier column keeps its price. A new column gets the highest price at which each
  // kept row still prefers its own column, so the kept rows stay valid.
  for (let column = 0; column < n; column++) {
    if (column < earlierColumns) {
      price[column] = warm.price[column];
      continue;
    }
    let best = Infinity;
    for (const row of kept) {
      const own = columnOfRow[row];
      const value = cost[row * n + column] - (cost[row * n + own] - warm.price[own]);
      if (value < best) best = value;
    }
    price[column] = best === Infinity ? 0 : best;
  }
  // The costs changed, so a kept pair stays only if its column is still the cheapest of its row.
  let freeCount = 0;
  for (let row = 0; row < n; row++) {
    const own = columnOfRow[row];
    if (own < 0) {
      free[freeCount++] = row;
      continue;
    }
    const offset = row * n;
    const reduced = cost[offset + own] - price[own];
    const floor = reduced - WARM_TOLERANCE * (Math.abs(reduced) + 1);
    for (let column = 0; column < n; column++) {
      if (cost[offset + column] - price[column] < floor) {
        rowOfColumn[own] = -1;
        columnOfRow[row] = -1;
        free[freeCount++] = row;
        break;
      }
    }
  }
  return freeCount;
}

/**
 * Gives each drone one target. The total of the squared flight distances is the smallest possible.
 *
 * Squared distance matters. With this assignment, and with all drones moving on the same count,
 * straight paths stay apart: if the closest spacing at the start and at the end is D,
 * the closest approach in flight is at least D ÷ √2.
 * Uniform scaling and moving of either point set do not change the best assignment: the
 * total cost then changes by a positive factor and by a constant. The planner uses this.
 * A tie-break term makes the best assignment unique, so a warm start gives the same result
 * as a cold start.
 *
 * A cold start of a large fleet goes from coarse to fine: it solves a spread sample of the
 * drones and the targets first, and that solution is the warm start of the full solve.
 * @param {Float32Array} starts xyz per drone
 * @param {Float32Array} targets xyz per target
 * @param {number} count number of drones and of targets
 * @param {Solution | null} [warm] an earlier solution to start from
 * @returns {Solution} `columnOfRow` is the target index of each drone
 */
export function assignTargets(starts, targets, count, warm = null) {
  if (warm && warm.columnOfRow.length < count * WARM_MIN_SHARE) warm = null;
  if (warm || count < COARSE_TO_FINE_MIN) {
    return solveAssignment(costMatrix(starts, targets, count, null, null), count, warm);
  }
  // In farthest point order, the first drones and the first targets of the lists are a
  // spread sample of all of them.
  const rows = farthestPointOrder(starts, count);
  const columns = farthestPointOrder(targets, count);
  const sample = Math.round(count * COARSE_SHARE);
  const coarse = solveAssignment(costMatrix(starts, targets, sample, rows, columns), sample);
  const fine = solveAssignment(costMatrix(starts, targets, count, rows, columns), count, coarse);
  // Back from the sample order to the order of the inputs.
  const columnOfRow = new Int32Array(count);
  const price = new Float64Array(count);
  for (let row = 0; row < count; row++) columnOfRow[rows[row]] = columns[fine.columnOfRow[row]];
  for (let column = 0; column < count; column++) price[columns[column]] = fine.price[column];
  return { columnOfRow, price };
}

/**
 * Squared distances between drones and targets, plus the tie-break term.
 * @param {Float32Array} starts xyz per drone
 * @param {Float32Array} targets xyz per target
 * @param {number} size number of rows and of columns
 * @param {Uint32Array | null} rows the drone of each row, or null for drone r in row r
 * @param {Uint32Array | null} columns the target of each column, or null for target c in column c
 * @returns {Float64Array} size × size values
 */
function costMatrix(starts, targets, size, rows, columns) {
  const cost = new Float64Array(size * size);
  let largest = 0;
  for (let row = 0; row < size; row++) {
    const drone = rows ? rows[row] : row;
    const x = starts[drone * 3];
    const y = starts[drone * 3 + 1];
    const z = starts[drone * 3 + 2];
    for (let column = 0; column < size; column++) {
      const target = columns ? columns[column] : column;
      const dx = targets[target * 3] - x;
      const dy = targets[target * 3 + 1] - y;
      const dz = targets[target * 3 + 2] - z;
      const value = dx * dx + dy * dy + dz * dz;
      cost[row * size + column] = value;
      if (value > largest) largest = value;
    }
  }
  // The tie-break uses the drone and the target, not the row and the column, so that the
  // order of the lists does not change the result. Its size follows the size of the costs.
  const scale = TIE_BREAK * largest;
  for (let row = 0; row < size; row++) {
    const drone = rows ? rows[row] : row;
    for (let column = 0; column < size; column++) {
      cost[row * size + column] += scale * tieBreak(drone, columns ? columns[column] : column);
    }
  }
  return cost;
}

// Size of the tie-break term, as a share of the largest cost. Rounding errors of the solver
// stay far below it, and it is far below any cost difference that matters: less than a
// millionth of a square meter for a drone of a real show.
export const TIE_BREAK = 1e-8;

/**
 * A number from 0 to 1 that differs per pair; the cost matrix adds a tiny share of it. Geometry often gives many assignments with the same
 * total, for example from a flat grid to a flat shape. With this term, one of them is the
 * only best one, so the result does not depend on how the solver starts.
 * The term must not split into a part per row plus a part per column: such a sum adds the
 * same amount to every assignment and breaks no tie.
 * @param {number} row
 * @param {number} column
 */
function tieBreak(row, column) {
  return ((Math.imul(row + 1, 0x9e3779b1) ^ Math.imul(column + 1, 0x85ebca6b)) >>> 0) / 4294967296;
}
