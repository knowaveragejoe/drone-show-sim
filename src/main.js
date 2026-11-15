// Start-up. Connects the state, the plan, the renderer, and the user interface.

import { attachCameraControls, createCamera, pixelsPerMeter, viewProjection } from './camera.js';
import { buildPlan, positionsAt } from './plan.js';
import { createRenderer } from './renderer.js';
import { FLEET_FIELDS, defaultState } from './state.js';
import { createUi } from './ui.js';

const MAX_DRONES = FLEET_FIELDS.find((field) => field.key === 'count').max;
const LIGHT_COLOR = [0.4, 0.8, 1];

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

function start() {
  const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('view'));
  const renderer = createRenderer(canvas);
  const camera = createCamera();
  const state = defaultState();
  const view = { time: 0, selected: -1 };
  let plan = buildPlan(state);

  const positions = new Float32Array(MAX_DRONES * 3);
  const viewProj = new Float32Array(16);
  let frameRequested = false;
  let firstFrame = true;

  const ui = createUi({
    setFleet(key, value) {
      state.fleet[key] = value;
      stateChanged();
    },
  });

  function stateChanged() {
    plan = buildPlan(state);
    ui.refresh(state);
    requestFrame();
  }

  function requestFrame() {
    if (frameRequested) return;
    frameRequested = true;
    requestAnimationFrame(drawFrame);
  }

  function drawFrame() {
    frameRequested = false;
    positionsAt(plan, view.time, positions);
    viewProjection(camera, canvas.clientWidth / Math.max(1, canvas.clientHeight), viewProj);
    renderer.draw({
      viewProj,
      pixelsPerMeter: pixelsPerMeter(camera, canvas.clientHeight),
      positions: positions.subarray(0, plan.count * 3),
      count: plan.count,
      color: LIGHT_COLOR,
      selected: view.selected,
    });
    if (firstFrame) {
      firstFrame = false;
      // The smoke test reads this marker.
      if (!document.documentElement.dataset.smoke) document.documentElement.dataset.smoke = 'ok';
    }
  }

  attachCameraControls(canvas, camera, requestFrame, () => {});
  new ResizeObserver(requestFrame).observe(canvas);
  stateChanged();
}

try {
  start();
} catch (error) {
  reportFatal(error instanceof Error ? error.message : String(error));
}
