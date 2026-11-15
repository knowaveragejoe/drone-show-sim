// Start-up. Connects the state, the plan, the renderer, and the user interface.

import {
  attachCameraControls,
  createCamera,
  pixelsPerMeter,
  setAudienceView,
  viewProjection,
} from './camera.js';
import { projectToScreen } from './mat4.js';
import { createPlanner, fitSize, positionsAt, retime } from './plan.js';
import { createRenderer } from './renderer.js';
import {
  FORMATION_FIELDS,
  MAX_DRONES,
  clampToField,
  defaultState,
  parseProject,
  serializeProject,
} from './state.js';
import { createUi } from './ui.js';

// A click selects the nearest drone inside this distance, CSS pixels.
const PICK_RADIUS = 10;

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

function start() {
  const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('view'));
  const renderer = createRenderer(canvas);
  const camera = createCamera();
  const planner = createPlanner();
  // The state is never changed in place. Each change makes a new state object,
  // so a change that the planner rejects leaves the old state as it was.
  let state = defaultState();
  let plan = planner(state);
  // The page opens on the finished formation. Play then starts from the takeoff grid.
  /** @type {import('./ui.js').View} */
  const view = {
    time: plan.total,
    playing: false,
    selected: -1,
    showPaths: true,
    showVolume: true,
  };

  const positions = new Float32Array(MAX_DRONES * 3);
  const viewProj = new Float32Array(16);
  let frameRequested = false;
  let firstFrame = true;
  let lastFrameTime = 0;

  /**
   * Makes `next` the project state and shows its plan.
   * @param {import('./state.js').State} next
   * @returns {string | null} an error message when the planner rejects the state, or null
   */
  function commit(next) {
    let nextPlan;
    try {
      nextPlan = planner(next);
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
    view.time = retime(plan, nextPlan, view.time);
    state = next;
    plan = nextPlan;
    if (view.selected >= plan.count) view.selected = -1;
    showPlan();
    return null;
  }

  /** @param {Partial<import('./state.js').Formation>} changes */
  function changeFormation(changes) {
    return commit({ ...state, formations: [{ ...state.formations[0], ...changes }] });
  }

  const ui = createUi({
    setFleet(key, value) {
      commit({ ...state, fleet: { ...state.fleet, [key]: value } });
    },
    setVolume(key, value) {
      commit({ ...state, volume: { ...state.volume, [key]: value } });
    },
    setFormation(key, value) {
      changeFormation({ [key]: value });
    },
    setShape(shape) {
      changeFormation({ source: { type: 'builtin', shape } });
    },
    importObj(fileName, text) {
      return changeFormation({ source: { type: 'obj', fileName, upAxis: 'y', text } });
    },
    setUpAxis(upAxis) {
      const { source } = state.formations[0];
      if (source.type === 'obj') changeFormation({ source: { ...source, upAxis } });
    },
    fit() {
      const size = fitSize(state.formations[0].size, plan.spacing, state.fleet.minSpacing);
      if (size === null) return;
      const sizeField = FORMATION_FIELDS.find((field) => field.key === 'size');
      changeFormation({ size: clampToField(sizeField, size) });
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
      const error = commit(next);
      if (error === null) {
        // A loaded project opens like the page does: on the finished formation.
        view.time = plan.total;
        view.playing = false;
        view.selected = -1;
      }
      return error;
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
      setAudienceView(camera, state.formations[0].centerHeight);
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
      view.time = Math.min(plan.total, Math.max(0, time));
      requestFrame();
    },
    select(drone) {
      view.selected = drone;
      requestFrame();
    },
  });

  function showPlan() {
    renderer.setPaths(plan.starts, plan.targets, plan.count);
    renderer.setVolume(plan.volume);
    ui.refresh(state, plan, view);
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
    requestFrame();
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
    viewProjection(camera, canvas.clientWidth / Math.max(1, canvas.clientHeight), viewProj);
    renderer.draw({
      viewProj,
      pixelsPerMeter: pixelsPerMeter(camera, canvas.clientHeight),
      positions: positions.subarray(0, plan.count * 3),
      count: plan.count,
      color: hexToRgb(state.formations[0].color),
      selected: view.selected,
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
  showPlan();
}

try {
  start();
} catch (error) {
  reportFatal(error instanceof Error ? error.message : String(error));
}
