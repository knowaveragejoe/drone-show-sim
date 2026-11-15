// Assignment: which drone flies to which target.

/**
 * Finds the assignment of rows to columns with the smallest total cost.
 *
 * This is the Jonker-Volgenant algorithm (1987). It gives the same result as the Hungarian
 * algorithm, but it is much faster in practice. Three cheap steps assign most rows.
 * Only the rows that are still free need the slow step, a shortest-path search.
 * @param {Float64Array} cost n × n values; the cost of row r with column c is at `r × n + c`
 * @param {number} n
 * @returns {Int32Array} the column of each row
 */
export function solveAssignment(cost, n) {
  const columnOfRow = new Int32Array(n).fill(-1);
  const rowOfColumn = new Int32Array(n).fill(-1);
  // Column prices. The reduced cost of a cell is its cost minus the price of its column.
  const price = new Float64Array(n);
  const free = new Int32Array(n);
  let freeCount = 0;

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

  return columnOfRow;
}

/**
 * Gives each drone one target. The total of the squared flight distances is the smallest possible.
 *
 * Squared distance matters. With this assignment, and with all drones moving on the same count,
 * straight paths stay apart: if the closest spacing at the start and at the end is D,
 * the closest approach in flight is at least D ÷ √2.
 * @param {Float32Array} starts xyz per drone
 * @param {Float32Array} targets xyz per target
 * @param {number} count number of drones and of targets
 * @returns {Int32Array} the target index of each drone
 */
export function assignTargets(starts, targets, count) {
  const cost = new Float64Array(count * count);
  for (let drone = 0; drone < count; drone++) {
    const x = starts[drone * 3];
    const y = starts[drone * 3 + 1];
    const z = starts[drone * 3 + 2];
    for (let target = 0; target < count; target++) {
      const dx = targets[target * 3] - x;
      const dy = targets[target * 3 + 1] - y;
      const dz = targets[target * 3 + 2] - z;
      cost[drone * count + target] = dx * dx + dy * dy + dz * dz;
    }
  }
  return solveAssignment(cost, count);
}
