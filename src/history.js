// Undo and redo history. The history holds snapshots; it does not know what they contain.
//
// Quick edits of the same field merge into one step: a slider drag sends many changes,
// and one undo takes back the whole drag.

/** Number of steps that the history keeps. Older steps drop off. */
export const HISTORY_LIMIT = 200;

/** Two changes of the same field merge when the second comes this soon after the first, milliseconds. */
export const MERGE_WINDOW = 1000;

/**
 * @template T
 * @typedef {object} History
 * @property {(before: T, key: string | null, now: number) => void} record call after each change,
 *   with the snapshot from before the change. `key` names the changed field; changes with
 *   the same key in quick succession merge. A null key never merges.
 * @property {(current: T) => T | null} undo gives the snapshot to go back to, or null
 * @property {(current: T) => T | null} redo gives the snapshot to go forward to, or null
 * @property {() => boolean} canUndo
 * @property {() => boolean} canRedo
 */

/**
 * @template T
 * @param {number} [limit] number of steps to keep
 * @returns {History<T>}
 */
export function createHistory(limit = HISTORY_LIMIT) {
  /** @type {T[]} */
  const past = [];
  /** @type {T[]} */
  const future = [];
  /** @type {string | null} */
  let lastKey = null;
  let lastTime = -Infinity;

  return {
    record(before, key, now) {
      future.length = 0;
      const merge = key !== null && key === lastKey && now - lastTime <= MERGE_WINDOW;
      lastKey = key;
      lastTime = now;
      // A merged change keeps the snapshot from before the first change of the run.
      if (merge) return;
      past.push(before);
      if (past.length > limit) past.shift();
    },
    undo(current) {
      const snapshot = past.pop();
      if (snapshot === undefined) return null;
      future.push(current);
      // The next change starts a new step, also when it changes the same field.
      lastKey = null;
      return snapshot;
    },
    redo(current) {
      const snapshot = future.pop();
      if (snapshot === undefined) return null;
      past.push(current);
      lastKey = null;
      return snapshot;
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
  };
}
