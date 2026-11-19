// Autosave. Keeps the project in browser storage, so a page reload does not lose it.
// The stored text is the project file, so the same checks apply as for an import.

import { parseProject, serializeProject } from './state.js';

export const AUTOSAVE_KEY = 'drone-show-sim:project';

/** Time from the last change to the save, milliseconds. A slider drag then saves one time. */
export const AUTOSAVE_DELAY = 400;

/**
 * The part of the browser storage that autosave uses. `localStorage` has it.
 * @typedef {object} TextStore
 * @property {(key: string) => string | null} getItem
 * @property {(key: string, value: string) => void} setItem
 */

/**
 * @param {TextStore | null} store null when the browser gives no storage
 * @param {(message: string | null) => void} onProblem shows a message for the user; null clears it
 */
export function createAutosave(store, onProblem) {
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

  return { load, schedule, flush };
}
