// Autosave. Keeps the project in browser storage, so a page reload does not lose it.
// The stored text is the project file, so the same checks apply as for an import.
//
// Autosave also keeps the assignments of the last plan. On the next page load, the planner
// starts from them and only checks them, which is much faster than a new solve. The solver
// checks each pair that it keeps, so a stored assignment can never give a wrong plan.

import { parseProject, serializeProject } from './state.js';

export const AUTOSAVE_KEY = 'drone-show-sim:project';
export const PAIRINGS_KEY = 'drone-show-sim:pairings';
const PAIRINGS_VERSION = 1;
// Assignments that need more text than this are not stored. They are only a speed-up.
const PAIRINGS_MAX_LENGTH = 2_000_000;

/** Time from the last change to the save, milliseconds. A slider drag then saves one time. */
export const AUTOSAVE_DELAY = 400;

/**
 * The part of the browser storage that autosave uses. `localStorage` has it.
 * @typedef {object} TextStore
 * @property {(key: string) => string | null} getItem
 * @property {(key: string, value: string) => void} setItem
 * @property {(key: string) => void} [removeItem]
 */

/**
 * @param {TextStore | null} store null when the browser gives no storage
 * @param {(message: string | null) => void} onProblem shows a message for the user; null clears it
 * @param {() => import('./plan.js').WarmStart[]} [pairings] gives the assignments to keep with the project
 */
export function createAutosave(store, onProblem, pairings = () => []) {
  /** @type {import('./state.js').State | null} */
  let pending = null;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;

  /**
   * Reads the saved project.
   * @returns {import('./state.js').State | null} null when nothing is saved or the saved text is not valid
   */
  function load() {
    if (!store) return null;
    let text;
    try {
      text = store.getItem(AUTOSAVE_KEY);
    } catch {
      return null;
    }
    if (text === null) return null;
    try {
      return parseProject(text);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      onProblem(`The saved show could not be loaded, so the default show is open. ${reason}`);
      return null;
    }
  }

  /** Saves the last scheduled project now. */
  function flush() {
    clearTimeout(timer);
    timer = undefined;
    if (!pending || !store) return;
    const text = serializeProject(pending);
    pending = null;
    try {
      store.setItem(AUTOSAVE_KEY, text);
      onProblem(null);
    } catch {
      onProblem('The browser did not save the show, for example because it is too large. Use Export to keep a copy.');
      return;
    }
    // The assignments are only a speed-up, so a failure here shows no message.
    try {
      const encoded = encodePairings(pairings());
      if (encoded.length <= PAIRINGS_MAX_LENGTH) store.setItem(PAIRINGS_KEY, encoded);
      else store.removeItem?.(PAIRINGS_KEY);
    } catch {
      // Nothing to do: the next page load solves the assignments again.
    }
  }

  /**
   * Reads the stored assignments.
   * @returns {import('./plan.js').WarmStart[]} empty when nothing is stored or the stored text is not valid
   */
  function loadPairings() {
    if (!store) return [];
    try {
      const text = store.getItem(PAIRINGS_KEY);
      return text === null ? [] : decodePairings(text);
    } catch {
      return [];
    }
  }

  /**
   * Saves a project after a short delay. A newer project replaces one that waits.
   * @param {import('./state.js').State} state
   */
  function schedule(state) {
    pending = state;
    clearTimeout(timer);
    timer = setTimeout(flush, AUTOSAVE_DELAY);
  }

  return { load, loadPairings, schedule, flush };
}

/**
 * @param {import('./plan.js').WarmStart[]} entries
 * @returns {string}
 */
export function encodePairings(entries) {
  return JSON.stringify({
    version: PAIRINGS_VERSION,
    entries: entries.map(({ key, columnOfRow, price }) => ({
      key,
      columnOfRow: toBase64(columnOfRow),
      price: toBase64(price),
    })),
  });
}

/**
 * Reads stored assignments. Drops an entry that is not complete.
 * @param {string} text
 * @returns {import('./plan.js').WarmStart[]}
 */
export function decodePairings(text) {
  const data = JSON.parse(text);
  if (!data || data.version !== PAIRINGS_VERSION || !Array.isArray(data.entries)) return [];
  /** @type {import('./plan.js').WarmStart[]} */
  const entries = [];
  for (const entry of data.entries) {
    if (typeof entry?.key !== 'string' || typeof entry.columnOfRow !== 'string' || typeof entry.price !== 'string') continue;
    const columnOfRow = fromBase64(entry.columnOfRow, Int32Array);
    const price = fromBase64(entry.price, Float64Array);
    if (columnOfRow && price && columnOfRow.length === price.length) entries.push({ key: entry.key, columnOfRow, price });
  }
  return entries;
}

/**
 * @param {Int32Array | Float64Array} array
 * @returns {string} the bytes of the array in Base64
 */
function toBase64(array) {
  const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  let binary = '';
  // In chunks: one call with every byte as an argument would overflow the call stack.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/**
 * @template {Int32ArrayConstructor | Float64ArrayConstructor} T
 * @param {string} text Base64
 * @param {T} Type
 * @returns {InstanceType<T> | null} null when the bytes do not fill whole elements
 */
function fromBase64(text, Type) {
  const binary = atob(text);
  if (binary.length % Type.BYTES_PER_ELEMENT !== 0) return null;
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return /** @type {InstanceType<T>} */ (new Type(bytes.buffer));
}
