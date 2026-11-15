// Sidebar controls, the drone list, and the transport bar.

import { isTooClose, speedAt } from './plan.js';
import { BUILTIN_SHAPES } from './shapes.js';
import { FLEET_FIELDS, FORMATION_FIELDS, clampToField } from './state.js';

/**
 * @typedef {object} Actions
 * @property {(key: string, value: number) => void} setFleet
 * @property {(key: string, value: number | string) => void} setFormation
 * @property {(shape: string) => void} setShape
 * @property {() => void} fit
 * @property {(show: boolean) => void} setShowPaths
 * @property {() => void} audienceView
 * @property {() => void} togglePlay
 * @property {(time: number) => void} seek
 * @property {(drone: number) => void} select index of the drone to select, or -1 to clear the selection
 */

/**
 * What the user looks at. This is not part of the project.
 * @typedef {object} View
 * @property {number} time position on the timeline, seconds
 * @property {boolean} playing
 * @property {number} selected index of the selected drone, or -1
 * @property {boolean} showPaths
 */

// A new plan for a large fleet takes a moment. Up to this fleet size, a slider applies
// each step of a drag. Above it, a slider applies its value when the user lets go.
const LIVE_SLIDER_MAX_DRONES = 250;

/**
 * @param {Actions} actions
 */
export function createUi(actions) {
  let droneCount = 0;
  /** @type {LivePredicate} */
  const isLive = (key, value) =>
    Math.max(droneCount, key === 'count' ? value : 0) <= LIVE_SLIDER_MAX_DRONES;

  const fleetFields = buildFields(byId('fleet-fields'), FLEET_FIELDS, actions.setFleet, isLive);
  const formationFields = buildFields(
    byId('formation-fields'),
    FORMATION_FIELDS,
    actions.setFormation,
    isLive,
  );

  const shape = /** @type {HTMLSelectElement} */ (byId('shape'));
  for (const [key, { label }] of Object.entries(BUILTIN_SHAPES)) {
    shape.add(new Option(label, key));
  }
  shape.addEventListener('change', () => actions.setShape(shape.value));

  const color = /** @type {HTMLInputElement} */ (byId('color'));
  color.addEventListener('input', () => actions.setFormation('color', color.value));

  const spacing = byId('spacing');
  const fit = /** @type {HTMLButtonElement} */ (byId('fit'));
  fit.addEventListener('click', actions.fit);

  const duration = byId('duration');
  const approach = byId('approach');
  const peakSpeed = byId('peak-speed');

  const showPaths = /** @type {HTMLInputElement} */ (byId('show-paths'));
  showPaths.addEventListener('change', () => actions.setShowPaths(showPaths.checked));
  byId('audience-view').addEventListener('click', actions.audienceView);

  const play = byId('play');
  const scrub = /** @type {HTMLInputElement} */ (byId('scrub'));
  const time = byId('time');
  play.addEventListener('click', actions.togglePlay);
  scrub.addEventListener('input', () => actions.seek(scrub.valueAsNumber));

  const droneList = buildDroneList(byId('drone-list'), actions.select);

  document.addEventListener('keydown', (event) => {
    if (event.code === 'Escape') actions.select(-1);
    if (event.code !== 'Space' || event.repeat) return;
    // In these controls the Space key already has a job.
    const target = /** @type {HTMLElement} */ (event.target);
    if (target.closest('button, select, summary, textarea, input:not([type="range"])')) return;
    event.preventDefault();
    actions.togglePlay();
  });

  /**
   * Shows the project state and the plan in the controls. Call after each state change.
   * @param {import('./state.js').State} state
   * @param {import('./plan.js').Plan} plan
   * @param {View} view
   */
  function refresh(state, plan, view) {
    const formation = state.formations[0];
    const { minSpacing } = state.fleet;
    droneCount = state.fleet.count;
    fleetFields.show(state.fleet);
    formationFields.show(formation);
    shape.value = formation.source.shape;
    color.value = formation.color;

    spacing.textContent = meters(plan.spacing);
    spacing.classList.toggle('warn', isTooClose(plan.spacing, minSpacing));
    fit.disabled = !Number.isFinite(plan.spacing) || plan.spacing <= 0;

    duration.textContent = `${plan.timing.duration.toFixed(1)} s`;
    approach.textContent = meters(plan.closestApproach);
    approach.classList.toggle('warn', isTooClose(plan.closestApproach, minSpacing));
    peakSpeed.textContent = `${plan.peakSpeed.toFixed(1)} m/s`;

    showPaths.checked = view.showPaths;
    scrub.max = String(plan.total);
  }

  /**
   * Shows the timeline position and the live drone data. Call for each frame.
   * @param {import('./plan.js').Plan} plan
   * @param {View} view
   * @param {Float32Array} positions position of each drone at the view time, xyz
   */
  function showFrame(plan, view, positions) {
    scrub.value = String(view.time);
    time.textContent = `${view.time.toFixed(1)} / ${plan.total.toFixed(1)} s`;
    play.textContent = view.playing ? 'Pause' : 'Play';
    droneList.show(plan, view, positions);
  }

  return { refresh, showFrame, revealDrone: droneList.reveal };
}

const DRONE_ROW_HEIGHT = 22;

/**
 * Builds the drone list. The list draws only the rows that are in view,
 * so a large fleet costs the same as a small one.
 * @param {HTMLElement} container scroll box; its first child is the sticky header row
 * @param {(drone: number) => void} onSelect
 */
function buildDroneList(container, onSelect) {
  // An empty box as tall as all rows. It gives the scroll bar the right range.
  const body = element('div', 'drone-list-body');
  container.append(body);
  /** @type {HTMLElement[]} */
  const rows = [];
  /** @type {(() => void) | null} */
  let redraw = null;

  container.addEventListener('scroll', () => redraw?.());
  body.addEventListener('click', (event) => {
    const row = /** @type {HTMLElement} */ (event.target).closest('.drone-row');
    if (row) onSelect(Number(/** @type {HTMLElement} */ (row).dataset.drone));
  });

  /**
   * @param {import('./plan.js').Plan} plan
   * @param {View} view
   * @param {Float32Array} positions
   */
  function show(plan, view, positions) {
    redraw = () => show(plan, view, positions);
    body.style.height = `${plan.count * DRONE_ROW_HEIGHT}px`;

    const first = Math.floor(container.scrollTop / DRONE_ROW_HEIGHT);
    const visible = Math.ceil(container.clientHeight / DRONE_ROW_HEIGHT) + 1;
    const last = Math.min(plan.count, first + visible);
    while (rows.length < last - first) {
      const row = element('div', 'drone-row');
      for (let cell = 0; cell < 5; cell++) row.append(element('span'));
      body.append(row);
      rows.push(row);
    }

    rows.forEach((row, slot) => {
      const drone = first + slot;
      row.hidden = drone >= last;
      if (row.hidden) return;
      row.dataset.drone = String(drone);
      row.style.transform = `translateY(${drone * DRONE_ROW_HEIGHT}px)`;
      row.classList.toggle('selected', drone === view.selected);
      const cells = row.children;
      cells[0].textContent = String(drone + 1);
      cells[1].textContent = positions[drone * 3].toFixed(1);
      cells[2].textContent = positions[drone * 3 + 1].toFixed(1);
      cells[3].textContent = positions[drone * 3 + 2].toFixed(1);
      cells[4].textContent = speedAt(plan, drone, view.time).toFixed(1);
    });
  }

  /**
   * Scrolls the list so that one drone is in view.
   * @param {number} drone index
   */
  function reveal(drone) {
    const top = drone * DRONE_ROW_HEIGHT;
    // The sticky header covers the first row height of the box.
    const room = container.clientHeight - 2 * DRONE_ROW_HEIGHT;
    if (top < container.scrollTop) container.scrollTop = top;
    else if (top > container.scrollTop + room) container.scrollTop = top - room;
  }

  return { show, reveal };
}

/**
 * @param {number} distance meters; Infinity when fewer than two drones exist
 */
function meters(distance) {
  return Number.isFinite(distance) ? `${distance.toFixed(2)} m` : 'n/a';
}

/**
 * Tells if a slider applies each step of a drag.
 * @callback LivePredicate
 * @param {string} key field key
 * @param {number} value the value under the slider thumb
 * @returns {boolean}
 */

/**
 * Builds one labeled number box per field, plus a slider for fields that ask for one.
 * @param {HTMLElement} container
 * @param {import('./state.js').NumberField[]} fields
 * @param {(key: string, value: number) => void} onChange
 * @param {LivePredicate} isLive
 */
function buildFields(container, fields, onChange, isLive) {
  /** @type {Map<string, HTMLInputElement[]>} */
  const inputs = new Map();
  /** @type {Record<string, any>} */
  let shown = {};

  for (const field of fields) {
    const id = `${container.id}-${field.key}`;
    const row = element('div', 'field');

    const label = element('label');
    label.htmlFor = id;
    label.textContent = field.label;

    const box = element('span', 'number-box');
    const number = numberInput(field, 'number');
    number.id = id;
    const unit = element('span', 'unit');
    unit.textContent = field.unit;
    box.append(number, unit);
    row.append(label, box);

    const fieldInputs = [number];
    // A number box reports a change when the user commits the value.
    number.addEventListener('change', () => commit(field, number));

    if (field.slider) {
      const slider = numberInput(field, 'range');
      slider.setAttribute('aria-label', field.label);
      slider.addEventListener('input', () => {
        const value = clampToField(field, slider.valueAsNumber);
        if (value !== null && isLive(field.key, value)) onChange(field.key, value);
        // Not live: the number box shows the value that the slider will apply.
        else number.value = slider.value;
      });
      slider.addEventListener('change', () => commit(field, slider));
      row.append(slider);
      fieldInputs.push(slider);
    }

    inputs.set(field.key, fieldInputs);
    container.append(row);
  }

  /**
   * @param {import('./state.js').NumberField} field
   * @param {HTMLInputElement} input
   */
  function commit(field, input) {
    const value = clampToField(field, input.valueAsNumber);
    if (value === null) {
      show(shown);
      return;
    }
    onChange(field.key, value);
  }

  /** @param {Record<string, any>} values object that holds one number per field key */
  function show(values) {
    shown = values;
    for (const [key, fieldInputs] of inputs) {
      const text = String(Math.round(values[key] * 1000) / 1000);
      for (const input of fieldInputs) input.value = text;
    }
  }

  return { show };
}

/**
 * @param {import('./state.js').NumberField} field
 * @param {'number' | 'range'} type
 */
function numberInput(field, type) {
  const input = element('input');
  input.type = type;
  input.min = String(field.min);
  input.max = String(field.max);
  input.step = String(field.step);
  return input;
}

/**
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {string} [className]
 * @returns {HTMLElementTagNameMap[K]}
 */
function element(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

/**
 * @param {string} id
 * @returns {HTMLElement}
 */
function byId(id) {
  const node = document.getElementById(id);
  if (!node) throw new Error(`The page has no element with id "${id}".`);
  return node;
}
