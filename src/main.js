// Start-up. Connects the state, the plan, the renderer, and the user interface.

import {
  SHOWTIME_MAX_FOV,
  SHOWTIME_MIN_FOV,
  aimFromSeat,
  attachCameraControls,
  audienceShot,
  cameraAxes,
  createCamera,
  easeShot,
  frameShow,
  pixelsPerMeter,
  setAudienceView,
  viewProjection,
} from './camera.js';
import { createAutosave } from './autosave.js';
import { createHistory } from './history.js';
import { projectToScreen } from './mat4.js';
import {
  createPlanner,
  FLIGHT_MARGIN,
  fitSize,
  hexToRgb,
  holdStart,
  lightColorAt,
  lightsAt,
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

// Longest step of the Showtime camera in one frame, seconds. It is longer than the step of the
// timeline, so the camera keeps up on a slow computer that draws few frames.
const MAX_CAMERA_STEP = 1;

// In Showtime the orbit target is this far along the line of sight, meters. Only the
// direction of the camera matters, so any distance works.
const SHOWTIME_AIM_DISTANCE = 200;

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
  const autosave = createAutosave(browserStorage(), showAutosaveProblem, () => planner.warmStarts());

  // The state is never changed in place. Each change makes a new state object,
  // so a change that the planner rejects leaves the old state as it was, and an old
  // state can serve as an undo snapshot.
  let state = defaultState();
  /** @type {import('./plan.js').Plan | null} */
  let firstPlan = null;
  const saved = autosave.load();
  if (saved) {
    // The assignments of the saved show make its first plan fast. Plan the saved show
    // before any other: another plan would replace the stored starts with its own.
    planner.addWarmStarts(autosave.loadPairings());
    try {
      firstPlan = planner(saved);
      state = saved;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      showAutosaveProblem(`The saved show could not be loaded, so the default show is open. ${reason}`);
    }
  }
  let plan = firstPlan ?? planner(state);
  // The color of each formation, for the flight paths.
  let colors = state.formations.map((formation) => hexToRgb(formation.color));
  frameShow(camera, state.formations);
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

  /**
   * Showtime: the page hides its panels and plays the show from the audience seat. It keeps
   * the camera of the editor, to put it back after Showtime. Null when Showtime is off.
   * @type {{camera: import('./camera.js').Camera, shot: import('./camera.js').Shot | null} | null}
   */
  let showtime = null;

  const positions = new Float32Array(MAX_DRONES * 3);
  const brightness = new Float32Array(MAX_DRONES);
  const lightColors = new Float32Array(MAX_DRONES * 3);
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
   * Shows a project that the user opens: a project file, a demo, or the default show. The
   * view starts like a page open: on the first formation, with the camera on the show.
   */
  function openedShow() {
    showFormation(0);
    view.selected = -1;
    frameShow(camera, state.formations);
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
  /**
   * The color pattern of the edited formation, for a shape that is not an SVG drawing.
   * @returns {import('./state.js').Formation['colorPattern']}
   */
  function withoutDrawing() {
    const { colorPattern } = state.formations[view.formation];
    return colorPattern === 'drawing' ? 'solid' : colorPattern;
  }

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
    setSpreadToPass(spreadToPass) {
      change({ ...state, spreadToPass }, null);
    },
    setLanding(key, value) {
      change({ ...state, [key]: value }, key);
    },
    setFormation(key, value) {
      changeFormation({ [key]: value }, key);
    },
    setShape(shape) {
      changeFormation({ source: { type: 'builtin', shape }, colorPattern: withoutDrawing() });
    },
    importShape(fileName, text) {
      // An SVG drawing starts with its own colors.
      if (/\.svg$/i.test(fileName)) {
        return changeFormation({ source: { type: 'svg', fileName, text }, colorPattern: 'drawing' });
      }
      return changeFormation({
        source: { type: 'obj', fileName, upAxis: 'y', text },
        colorPattern: withoutDrawing(),
      });
    },
    setUpAxis(upAxis) {
      const { source } = state.formations[view.formation];
      if (source.type === 'obj') changeFormation({ source: { ...source, upAxis } });
    },
    fit() {
      const { size } = state.formations[view.formation];
      const { spacing } = plan.formations[view.formation];
      // With the spread, the targets only need the minimum spacing. Without it, they also
      // need room for the flights to and from the formation.
      const margin = state.spreadToPass ? 1 : FLIGHT_MARGIN;
      const fitted = fitSize(size, spacing, state.fleet.minSpacing, margin);
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
      return change(next, null, openedShow);
    },
    newShow() {
      change(defaultState(), null, openedShow);
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
      // Step k flies to formation k, so its end is the formation as the hold starts.
      setAudienceView(camera, plan.steps[view.formation].to, aspect());
      requestFrame();
    },
    startShowtime() {
      if (showtime) return;
      showtime = { camera: { ...camera, target: [...camera.target] }, shot: null };
      view.time = 0;
      view.playing = true;
      lastFrameTime = performance.now();
      renderer.setRoute([]);
      ui.showShowtime(true);
      requestFrame();
    },
    stopShowtime() {
      if (!showtime) return;
      Object.assign(camera, showtime.camera);
      showtime = null;
      view.playing = false;
      ui.showShowtime(false);
      showRoute();
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
    if (showtime) return;
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

  /** @returns {number} width ÷ height of the 3D view */
  function aspect() {
    return canvas.clientWidth / Math.max(1, canvas.clientHeight);
  }

  /**
   * Moves the Showtime camera toward a shot of the drones and of the place that they fly to.
   * @param {number} seconds time since the last frame
   */
  function followShow(seconds) {
    if (!showtime) return;
    const step = plan.steps[stepAt(plan, view.time)];
    const target = audienceShot(
      [positions.subarray(0, plan.count * 3), step.to],
      aspect(),
      SHOWTIME_MIN_FOV,
      SHOWTIME_MAX_FOV,
    );
    showtime.shot = showtime.shot ? easeShot(showtime.shot, target, seconds) : target;
    aimFromSeat(camera, showtime.shot, SHOWTIME_AIM_DISTANCE);
  }

  /** @param {number} now time of this frame, milliseconds */
  function drawFrame(now) {
    frameRequested = false;
    const elapsed = Math.max(0, (now - lastFrameTime) / 1000);
    if (view.playing) {
      view.time += Math.min(MAX_FRAME_STEP, elapsed);
      if (view.time >= plan.total) {
        view.time = plan.total;
        view.playing = false;
      } else {
        requestFrame();
      }
    }
    lastFrameTime = now;

    positionsAt(plan, view.time, positions);
    lightsAt(plan, view.time, positions, lightColors, brightness);
    followShow(Math.min(MAX_CAMERA_STEP, elapsed));
    viewProjection(camera, aspect(), viewProj);
    renderer.draw({
      viewProj,
      camera: cameraAxes(camera),
      time: now / 1000,
      pixelsPerMeter: pixelsPerMeter(camera, canvas.clientHeight),
      positions: positions.subarray(0, plan.count * 3),
      brightness: brightness.subarray(0, plan.count),
      colors: lightColors.subarray(0, plan.count * 3),
      count: plan.count,
      pathColor: lightColorAt(plan, colors, view.time),
      // Showtime shows the show only: no selection, grid, volume, or paths.
      selected: showtime ? -1 : view.selected,
      pathStep: stepAt(plan, view.time),
      showGrid: !showtime,
      // The editor marks the drones whose lights are off. The audience does not see them.
      showUnlit: !showtime,
      showPaths: !showtime && view.showPaths,
      showVolume: !showtime && view.showVolume,
      volumeBroken: plan.outsideVolume > 0,
    });
    ui.showFrame(plan, view, positions);
    if (showtime) {
      ui.showShowtimeState(view.playing, view.time >= plan.total);
      // The camera eases and the stars twinkle, also while the show pauses.
      requestFrame();
    }

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
