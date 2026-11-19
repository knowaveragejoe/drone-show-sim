// Start-up. Connects the state, the plan, the renderer, and the user interface.

import {
  attachCameraControls,
  createCamera,
  pixelsPerMeter,
  setAudienceView,
  viewProjection,
} from './camera.js';
import { createAutosave } from './autosave.js';
import { createHistory } from './history.js';
import { projectToScreen } from './mat4.js';
import {
  brightnessAt,
  createPlanner,
  fitSize,
  holdStart,
  lightColorAt,
  positionsAt,
  retime,
  routeOf,
  stepAt,
} from './plan.js';
import { createRenderer } from './renderer.js';
import {
  FORMATION_FIELDS,
  MAX_DRONES,
  MAX_FORMATIONS,
  clampToField,
  defaultState,
  nextFormation,
  parseProject,
  serializeProject,
} from './state.js';
import { createUi } from './ui.js';

// A click selects the nearest drone inside this distance, CSS pixels.
const PICK_RADIUS = 10;

// A range input rounds its value to about 14 digits. A scrubber at its right end then gives
// a time that is a tiny bit before the end of the show. A seek this close to the end, in
// seconds, goes to the exact end.
const END_SLACK = 1e-6;

// Longest step of the timeline in one frame, seconds. A browser tab in the background
// draws no frames; without the limit the show would jump when the tab comes back.
const MAX_FRAME_STEP = 0.1;

/**
 * Shows an error on the page and marks the page for the smoke test.
 * @param {string} message
 */
function reportFatal(message) {
  document.documentElement.dataset.smoke = 'error';
  document.documentElement.dataset.smokeMessage = message;
  const box = document.getElementById('fatal');
  box.textContent = message;
  box.hidden = false;
}

window.addEventListener('error', (event) => reportFatal(event.message));
window.addEventListener('unhandledrejection', (event) => reportFatal(String(event.reason)));

/**
 * @param {string} hex color as `#rrggbb`
 * @returns {number[]} red, green, blue, each 0 to 1
 */
function hexToRgb(hex) {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

/**
 * Shows a message about autosave in the sidebar.
 * @param {string | null} message null hides the message
 */
function showAutosaveProblem(message) {
  const box = document.getElementById('autosave-error');
  box.textContent = message ?? '';
  box.hidden = message === null;
}

/** @returns {Storage | null} the browser storage, or null when the browser gives none */
function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * A snapshot for undo and redo: the project, and the formation that the sidebar edited.
 * @typedef {object} Snapshot
 * @property {import('./state.js').State} state
 * @property {number} formation
 */

function start() {
  const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('view'));
  const renderer = createRenderer(canvas);
  const camera = createCamera();
  const planner = createPlanner();
  /** @type {import('./history.js').History<Snapshot>} */
  const history = createHistory();
  const autosave = createAutosave(browserStorage(), showAutosaveProblem);

  // The state is never changed in place. Each change makes a new state object,
  // so a change that the planner rejects leaves the old state as it was, and an old
  // state can serve as an undo snapshot.
  let state = defaultState();
  let plan = planner(state);
  const saved = autosave.load();
  if (saved) {
    try {
      plan = planner(saved);
      state = saved;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      showAutosaveProblem(`The saved show could not be loaded, so the default show is open. ${reason}`);
    }
  }
  let colors = state.formations.map((formation) => hexToRgb(formation.color));
  // The page opens on the first formation. Play runs the show from there.
  /** @type {import('./ui.js').View} */
  const view = {
    time: holdStart(plan, 0),
    playing: false,
    selected: -1,
    formation: 0,
    showPaths: true,
    showVolume: true,
  };

  const positions = new Float32Array(MAX_DRONES * 3);
  const brightness = new Float32Array(MAX_DRONES);
  const viewProj = new Float32Array(16);
  let frameRequested = false;
  let firstFrame = true;
  let lastFrameTime = 0;

  /**
   * Makes `next` the project state and shows its plan. Use `change` for a change that
   * the user can undo.
   * @param {import('./state.js').State} next
   * @param {() => void} [adjustView] runs after the new plan is in place and before the page shows it
   * @returns {string | null} an error message when the planner rejects the state, or null
   */
  function apply(next, adjustView) {
    let nextPlan;
    try {
      nextPlan = planner(next);
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
    view.time = retime(plan, nextPlan, view.time);
    state = next;
    plan = nextPlan;
    view.formation = Math.min(view.formation, state.formations.length - 1);
    if (view.selected >= plan.count) view.selected = -1;
    adjustView?.();
    showPlan();
    return null;
  }

  /**
   * Makes `next` the project state, and records the change for undo and for autosave.
   * @param {import('./state.js').State} next
   * @param {string | null} key names the changed field, so that quick changes of one field
   *   make one undo step; null for a change that is a step of its own
   * @param {() => void} [adjustView] as for `apply`
   * @returns {string | null} an error message when the planner rejects the state, or null
   */
  function change(next, key, adjustView) {
    /** @type {Snapshot} */
    const before = { state, formation: view.formation };
    const error = apply(next, adjustView);
    if (error === null) {
      history.record(before, key, performance.now());
      changed();
    }
    return error;
  }

  /** Saves the project and updates the undo and redo buttons. Call after each change. */
  function changed() {
    autosave.schedule(state);
    ui.showHistory(history.canUndo(), history.canRedo());
  }

  /**
   * Goes back or forward one step in the history. The sidebar shows the formation that
   * the user edited in that step.
   * @param {'undo' | 'redo'} direction
   */
  function travel(direction) {
    /** @type {Snapshot} */
    const current = { state, formation: view.formation };
    const snapshot = direction === 'undo' ? history.undo(current) : history.redo(current);
    if (!snapshot) return;
    const error = apply(snapshot.state, () => {
      const formation = Math.min(snapshot.formation, state.formations.length - 1);
      if (formation !== view.formation) showFormation(formation);
    });
    // A snapshot was a valid state before, so this does not happen. If it does, the
    // history goes back to where it was.
    if (error !== null) {
      if (direction === 'undo') history.redo(snapshot);
      else history.undo(snapshot);
    }
    changed();
  }

  /**
   * Makes one formation the formation that the sidebar edits, and moves the timeline
   * to the start of its hold, so that the 3D view shows it.
   * @param {number} index place in the storyboard
   */
  function showFormation(index) {
    view.formation = index;
    view.time = holdStart(plan, index);
    view.playing = false;
  }

  /**
   * @param {Partial<import('./state.js').Formation>} changes changes to the formation that the sidebar edits
   * @param {string | null} [field] the changed field, so that quick changes of it make one undo step
   */
  function changeFormation(changes, field = null) {
    const formation = { ...state.formations[view.formation], ...changes };
    const key = field === null ? null : `formation.${view.formation}.${field}`;
    return change({ ...state, formations: state.formations.with(view.formation, formation) }, key);
  }

  const ui = createUi({
    setFleet(key, value) {
      change({ ...state, fleet: { ...state.fleet, [key]: value } }, `fleet.${key}`);
    },
    setVolume(key, value) {
      change({ ...state, volume: { ...state.volume, [key]: value } }, `volume.${key}`);
    },
    selectFormation(index) {
      showFormation(index);
      ui.refresh(state, plan, view);
      requestFrame();
    },
    addFormation() {
      const { formations } = state;
      if (formations.length >= MAX_FORMATIONS) return;
      const index = view.formation;
      const added = formations.toSpliced(index + 1, 0, nextFormation(formations, index));
      change({ ...state, formations: added }, null, () => showFormation(index + 1));
    },
    removeFormation() {
      const { formations } = state;
      if (formations.length <= 1) return;
      const index = view.formation;
      change({ ...state, formations: formations.toSpliced(index, 1) }, null, () =>
        showFormation(Math.min(index, formations.length - 2)),
      );
    },
    moveFormation(step) {
      const { formations } = state;
      const index = view.formation;
      const target = index + step;
      if (target < 0 || target >= formations.length) return;
      const moved = formations.with(index, formations[target]).with(target, formations[index]);
      change({ ...state, formations: moved }, null, () => showFormation(target));
    },
    setLandAtEnd(landAtEnd) {
      change({ ...state, landAtEnd }, null);
    },
    setFormation(key, value) {
      changeFormation({ [key]: value }, key);
    },
    setShape(shape) {
      changeFormation({ source: { type: 'builtin', shape } });
    },
    importShape(fileName, text) {
      const source = /\.svg$/i.test(fileName)
        ? { type: 'svg', fileName, text }
        : { type: 'obj', fileName, upAxis: 'y', text };
      return changeFormation({ source });
    },
    setUpAxis(upAxis) {
      const { source } = state.formations[view.formation];
      if (source.type === 'obj') changeFormation({ source: { ...source, upAxis } });
    },
    fit() {
      const { size } = state.formations[view.formation];
      const { spacing } = plan.formations[view.formation];
      const fitted = fitSize(size, spacing, state.fleet.minSpacing);
      if (fitted === null) return;
      const sizeField = FORMATION_FIELDS.find((field) => field.key === 'size');
      changeFormation({ size: clampToField(sizeField, fitted) });
    },
    projectText() {
      return serializeProject(state);
    },
    importProject(text) {
      let next;
      try {
        next = parseProject(text);
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
      // A loaded project opens like the page does: on the first formation.
      return change(next, null, () => {
        showFormation(0);
        view.selected = -1;
      });
    },
    newShow() {
      change(defaultState(), null, () => {
        showFormation(0);
        view.selected = -1;
      });
    },
    undo() {
      travel('undo');
    },
    redo() {
      travel('redo');
    },
    setShowPaths(show) {
      view.showPaths = show;
      requestFrame();
    },
    setShowVolume(show) {
      view.showVolume = show;
      requestFrame();
    },
    audienceView() {
      setAudienceView(camera, state.formations[view.formation].centerHeight);
      requestFrame();
    },
    togglePlay() {
      if (!view.playing && view.time >= plan.total) view.time = 0;
      view.playing = !view.playing;
      lastFrameTime = performance.now();
      requestFrame();
    },
    seek(time) {
      view.playing = false;
      view.time = time >= plan.total - END_SLACK ? plan.total : Math.max(0, time);
      requestFrame();
    },
    select(drone) {
      view.selected = drone;
      showRoute();
    },
  });

  function showPlan() {
    colors = state.formations.map((formation) => hexToRgb(formation.color));
    renderer.setPaths(plan.steps, plan.count);
    renderer.setVolume(plan.volume);
    ui.refresh(state, plan, view);
    showRoute();
  }

  /** Shows the route of the selected drone in the 3D view. */
  function showRoute() {
    renderer.setRoute(view.selected >= 0 ? routeOf(plan, view.selected) : []);
    requestFrame();
  }

  /**
   * Selects the drone under a click in the 3D view. A click on empty space clears the selection.
   * @param {number} x CSS pixels from the left edge of the canvas
   * @param {number} y CSS pixels from the top edge of the canvas
   */
  function pick(x, y) {
    let nearest = -1;
    let nearestDistance = PICK_RADIUS;
    for (let drone = 0; drone < plan.count; drone++) {
      const point = projectToScreen(
        viewProj,
        positions[drone * 3],
        positions[drone * 3 + 1],
        positions[drone * 3 + 2],
        canvas.clientWidth,
        canvas.clientHeight,
      );
      if (!point) continue;
      const distance = Math.hypot(point[0] - x, point[1] - y);
      if (distance < nearestDistance) {
        nearest = drone;
        nearestDistance = distance;
      }
    }
    view.selected = nearest;
    if (nearest >= 0) ui.revealDrone(nearest);
    showRoute();
  }

  function requestFrame() {
    if (frameRequested) return;
    frameRequested = true;
    requestAnimationFrame(drawFrame);
  }

  /** @param {number} now time of this frame, milliseconds */
  function drawFrame(now) {
    frameRequested = false;
    if (view.playing) {
      view.time += Math.min(MAX_FRAME_STEP, Math.max(0, (now - lastFrameTime) / 1000));
      if (view.time >= plan.total) {
        view.time = plan.total;
        view.playing = false;
      } else {
        requestFrame();
      }
    }
    lastFrameTime = now;

    positionsAt(plan, view.time, positions);
    brightnessAt(plan, view.time, brightness);
    viewProjection(camera, canvas.clientWidth / Math.max(1, canvas.clientHeight), viewProj);
    renderer.draw({
      viewProj,
      pixelsPerMeter: pixelsPerMeter(camera, canvas.clientHeight),
      positions: positions.subarray(0, plan.count * 3),
      brightness: brightness.subarray(0, plan.count),
      count: plan.count,
      color: lightColorAt(plan, colors, view.time),
      selected: view.selected,
      pathStep: stepAt(plan, view.time),
      showPaths: view.showPaths,
      showVolume: view.showVolume,
      volumeBroken: plan.outsideVolume > 0,
    });
    ui.showFrame(plan, view, positions);

    if (firstFrame) {
      firstFrame = false;
      // The smoke test reads this marker.
      if (!document.documentElement.dataset.smoke) document.documentElement.dataset.smoke = 'ok';
    }
  }

  attachCameraControls(canvas, camera, requestFrame, pick);
  new ResizeObserver(requestFrame).observe(canvas);
  // Save a change that waits when the user leaves the page or hides it.
  window.addEventListener('pagehide', autosave.flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') autosave.flush();
  });
  ui.showHistory(false, false);
  showPlan();
}

try {
  start();
} catch (error) {
  reportFatal(error instanceof Error ? error.message : String(error));
}
