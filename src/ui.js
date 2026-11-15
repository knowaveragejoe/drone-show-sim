// Sidebar tabs and controls, the drone list, and the transport bar.

import { isBelowGround, isTooClose, speedAt } from './plan.js';
import { BUILTIN_SHAPES } from './shapes.js';
import {
  FLEET_FIELDS,
  FORMATION_FIELDS,
  PROJECT_FILE_NAME,
  VOLUME_FIELDS,
  clampToField,
} from './state.js';

/**
 * @typedef {object} Actions
 * @property {(key: string, value: number) => void} setFleet
 * @property {(key: string, value: number) => void} setVolume
 * @property {(key: string, value: number | string) => void} setFormation
 * @property {(shape: string) => void} setShape
 * @property {(fileName: string, text: string) => string | null} importObj returns an error message, or null
 * @property {(upAxis: 'y' | 'z') => void} setUpAxis
 * @property {() => void} fit
 * @property {() => string} projectText contents of the project file
 * @property {(text: string) => string | null} importProject returns an error message, or null
 * @property {(show: boolean) => void} setShowPaths
 * @property {(show: boolean) => void} setShowVolume
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
 * @property {boolean} showVolume
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
  // A new flight volume needs no new assignment, so its slider is live for every fleet size.
  const volumeFields = buildFields(byId('volume-fields'), VOLUME_FIELDS, actions.setVolume, () => true);
  const formationFields = buildFields(
    byId('formation-fields'),
    FORMATION_FIELDS,
    actions.setFormation,
    isLive,
  );

  byId('export-project').addEventListener('click', () => {
    download(PROJECT_FILE_NAME, actions.projectText());
  });
  wireFilePicker(byId('import-project'), byId('project-file'), byId('project-error'), (fileName, text) =>
    actions.importProject(text),
  );

  const shape = /** @type {HTMLSelectElement} */ (byId('shape'));
  for (const [key, { label }] of Object.entries(BUILTIN_SHAPES)) {
    shape.add(new Option(label, key));
  }
  // This option is in the list only while the formation uses an imported model.
  const objOption = new Option('', 'obj');
  shape.addEventListener('change', () => {
    if (shape.value !== 'obj') actions.setShape(shape.value);
  });

  wireFilePicker(byId('import-obj'), byId('obj-file'), byId('obj-error'), actions.importObj);
  const upAxisRow = byId('up-axis-row');
  const upAxis = /** @type {HTMLSelectElement} */ (byId('up-axis'));
  upAxis.addEventListener('change', () => actions.setUpAxis(upAxis.value === 'z' ? 'z' : 'y'));

  const color = /** @type {HTMLInputElement} */ (byId('color'));
  color.addEventListener('input', () => actions.setFormation('color', color.value));

  const spacing = byId('spacing');
  const fit = /** @type {HTMLButtonElement} */ (byId('fit'));
  fit.addEventListener('click', actions.fit);

  const outside = byId('outside');
  const lowest = byId('lowest');
  const duration = byId('duration');
  const approach = byId('approach');
  const peakSpeed = byId('peak-speed');

  const showPaths = /** @type {HTMLInputElement} */ (byId('show-paths'));
  showPaths.addEventListener('change', () => actions.setShowPaths(showPaths.checked));
  const showVolume = /** @type {HTMLInputElement} */ (byId('show-volume'));
  showVolume.addEventListener('change', () => actions.setShowVolume(showVolume.checked));
  byId('audience-view').addEventListener('click', actions.audienceView);

  const play = byId('play');
  const scrub = /** @type {HTMLInputElement} */ (byId('scrub'));
  const time = byId('time');
  play.addEventListener('click', actions.togglePlay);
  scrub.addEventListener('input', () => actions.seek(scrub.valueAsNumber));

  const droneList = buildDroneList(byId('drone-list'), actions.select);
  buildTabs((name) => {
    if (name === 'drones') droneList.opened();
  });

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
    volumeFields.show(state.volume);
    formationFields.show(formation);
    color.value = formation.color;

    const { source } = formation;
    if (source.type === 'obj') {
      objOption.textContent = `OBJ: ${source.fileName}`;
      shape.add(objOption);
      shape.value = 'obj';
      upAxis.value = source.upAxis;
    } else {
      objOption.remove();
      shape.value = source.shape;
    }
    upAxisRow.hidden = source.type !== 'obj';

    spacing.textContent = meters(plan.spacing);
    spacing.classList.toggle('warn', isTooClose(plan.spacing, minSpacing));
    fit.disabled = !Number.isFinite(plan.spacing) || plan.spacing <= 0;

    outside.textContent =
      plan.outsideVolume === 0 ? '0' : `${plan.outsideVolume} of ${plan.count}`;
    outside.classList.toggle('warn', plan.outsideVolume > 0);
    lowest.textContent = `${plan.lowestTarget.toFixed(1)} m`;
    lowest.classList.toggle('warn', isBelowGround(plan.lowestTarget));
    duration.textContent = `${plan.timing.duration.toFixed(1)} s`;
    approach.textContent = meters(plan.closestApproach);
    approach.classList.toggle('warn', isTooClose(plan.closestApproach, minSpacing));
    peakSpeed.textContent = `${plan.peakSpeed.toFixed(1)} m/s`;

    showPaths.checked = view.showPaths;
    showVolume.checked = view.showVolume;
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

const TAB_NAMES = ['settings', 'drones'];

/**
 * Connects the sidebar tabs. A click on a tab shows its panel and hides the other panel.
 * The left and right arrow keys move between tabs.
 * @param {(name: string) => void} onShow called after a panel comes into view
 */
function buildTabs(onShow) {
  const tabs = TAB_NAMES.map((name) => byId(`tab-${name}`));
  const panels = TAB_NAMES.map((name) => byId(`panel-${name}`));

  /** @param {number} selected index in `TAB_NAMES` */
  function select(selected) {
    tabs.forEach((tab, index) => {
      tab.setAttribute('aria-selected', String(index === selected));
      // Only the selected tab is a Tab key stop. The arrow keys reach the other tab.
      tab.tabIndex = index === selected ? 0 : -1;
      panels[index].hidden = index !== selected;
    });
    onShow(TAB_NAMES[selected]);
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => select(index));
    tab.addEventListener('keydown', (event) => {
      const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (step === 0) return;
      const next = (index + step + tabs.length) % tabs.length;
      select(next);
      tabs[next].focus();
    });
  });
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
  let selected = -1;

  container.addEventListener('scroll', () => redraw?.());
  // The number of rows in view changes with the height of the box.
  new ResizeObserver(() => redraw?.()).observe(container);
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
    selected = view.selected;
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
    // A hidden box has no height and cannot scroll. `opened` does the scroll later.
    if (container.clientHeight === 0) return;
    const top = drone * DRONE_ROW_HEIGHT;
    // The sticky header covers the first row height of the box.
    const room = container.clientHeight - 2 * DRONE_ROW_HEIGHT;
    if (top < container.scrollTop) container.scrollTop = top;
    else if (top > container.scrollTop + room) container.scrollTop = top - room;
  }

  /** Call when the list comes into view. Draws the rows and scrolls to the selected drone. */
  function opened() {
    redraw?.();
    if (selected >= 0) reveal(selected);
  }

  return { show, reveal, opened };
}

/**
 * Makes a button open a file picker, and imports the picked file as text.
 * @param {HTMLElement} button
 * @param {HTMLElement} input a hidden file input
 * @param {HTMLElement} errorBox shows the error message of a failed import
 * @param {(fileName: string, text: string) => string | null} importText returns an error message, or null
 */
function wireFilePicker(button, input, errorBox, importText) {
  const picker = /** @type {HTMLInputElement} */ (input);
  button.addEventListener('click', () => picker.click());
  picker.addEventListener('change', async () => {
    const file = picker.files?.[0];
    // Empty the picker, so the same file can be picked again.
    picker.value = '';
    if (!file) return;
    let message;
    try {
      const text = await file.text();
      message = importText(file.name, text);
    } catch (error) {
      // Only a failed read is expected here. Any other error is a bug and must stay visible.
      if (!(error instanceof DOMException)) throw error;
      message = 'The browser could not read the file.';
    }
    errorBox.textContent = message ?? '';
    errorBox.hidden = message === null;
  });
}

/**
 * Saves text as a file on the user's computer.
 * @param {string} fileName
 * @param {string} text
 */
function download(fileName, text) {
  const link = element('a');
  link.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(link.href);
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
