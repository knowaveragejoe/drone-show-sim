// Sidebar tabs and controls, the storyboard, the drone list, the overlays on the 3D view,
// and the transport bar.

import { formationProblems, isBelowGround, isTooClose, speedAt } from './plan.js';
import { BUILTIN_SHAPES } from './shapes.js';
import {
  CHASE_FIELDS,
  CHASE_PATTERNS,
  FLEET_FIELDS,
  FORMATION_FIELDS,
  MAX_FORMATIONS,
  PROJECT_FILE_NAME,
  VOLUME_FIELDS,
  clampToField,
} from './state.js';

/**
 * @typedef {object} Actions
 * @property {(key: string, value: number) => void} setFleet
 * @property {(key: string, value: number) => void} setVolume
 * @property {(index: number) => void} selectFormation makes one formation the formation that the sidebar edits
 * @property {() => void} addFormation
 * @property {() => void} removeFormation
 * @property {(step: number) => void} moveFormation -1 moves the formation earlier, 1 later
 * @property {(land: boolean) => void} setLandAtEnd
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
 * @property {number} formation index of the formation that the sidebar edits
 * @property {boolean} showPaths
 * @property {boolean} showVolume
 */

// A new plan for a large fleet takes a moment. Up to this fleet size, a slider applies
// each step of a drag. Above it, a slider applies its value when the user lets go.
const LIVE_SLIDER_MAX_DRONES = 250;

// The Fleet section of the Fleet tab holds these fields. The Limits section holds the others.
const FLEET_KEYS = ['count', 'gridSpacing'];

// The checks panel lists this many problems. A last line counts the rest.
const MAX_LISTED_PROBLEMS = 4;

const LANDING_PROBLEM = 'Drones come too close in the landing.';
const TAKEOFF_PROBLEM = 'Takeoff grid cells are outside the flight volume.';

/**
 * @param {Actions} actions
 */
export function createUi(actions) {
  let droneCount = 0;
  /** @type {LivePredicate} */
  const isLive = (key, value) =>
    Math.max(droneCount, key === 'count' ? value : 0) <= LIVE_SLIDER_MAX_DRONES;

  const fleetFields = buildFields(
    byId('fleet-fields'),
    FLEET_FIELDS.filter((field) => FLEET_KEYS.includes(field.key)),
    actions.setFleet,
    isLive,
  );
  const limitFields = buildFields(
    byId('limit-fields'),
    FLEET_FIELDS.filter((field) => !FLEET_KEYS.includes(field.key)),
    actions.setFleet,
    isLive,
  );
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

  const storyboard = buildStoryboard(byId('formation-list'), actions.selectFormation);
  const addFormation = /** @type {HTMLButtonElement} */ (byId('add-formation'));
  const removeFormation = /** @type {HTMLButtonElement} */ (byId('remove-formation'));
  const moveEarlier = /** @type {HTMLButtonElement} */ (byId('move-formation-earlier'));
  const moveLater = /** @type {HTMLButtonElement} */ (byId('move-formation-later'));
  addFormation.addEventListener('click', actions.addFormation);
  removeFormation.addEventListener('click', actions.removeFormation);
  moveEarlier.addEventListener('click', () => actions.moveFormation(-1));
  moveLater.addEventListener('click', () => actions.moveFormation(1));
  const landAtEnd = /** @type {HTMLInputElement} */ (byId('land-at-end'));
  landAtEnd.addEventListener('change', () => actions.setLandAtEnd(landAtEnd.checked));

  const formationTitle = byId('formation-title');
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

  const chase = /** @type {HTMLSelectElement} */ (byId('chase'));
  for (const [key, label] of Object.entries(CHASE_PATTERNS)) chase.add(new Option(label, key));
  chase.addEventListener('change', () => actions.setFormation('chase', chase.value));
  const chaseBox = byId('chase-fields');
  // A light chase needs no new assignment, so its sliders are live for every fleet size.
  const chaseFields = buildFields(chaseBox, CHASE_FIELDS, actions.setFormation, () => true);

  const spacing = byId('spacing');
  const fit = /** @type {HTMLButtonElement} */ (byId('fit'));
  fit.addEventListener('click', actions.fit);

  const checksStatus = byId('checks-status');
  const checksSummary = byId('checks-summary');
  const checksProblems = byId('checks-problems');
  const duration = byId('duration');
  const outside = byId('outside');
  const lowest = byId('lowest');
  const approach = byId('approach');
  const peakSpeed = byId('peak-speed');

  const showPaths = wireToggle(byId('show-paths'), actions.setShowPaths);
  const showVolume = wireToggle(byId('show-volume'), actions.setShowVolume);
  byId('audience-view').addEventListener('click', actions.audienceView);

  const play = byId('play');
  const playLabel = byId('play-label');
  const scrub = /** @type {HTMLInputElement} */ (byId('scrub'));
  const time = byId('time');
  play.addEventListener('click', actions.togglePlay);
  scrub.addEventListener('input', () => actions.seek(scrub.valueAsNumber));
  const timeline = buildTimeline(byId('timeline-blocks'), actions);

  const droneCountBadge = byId('drone-count');
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
    const { formations } = state;
    const formation = formations[view.formation];
    const { minSpacing } = state.fleet;
    droneCount = state.fleet.count;
    fleetFields.show(state.fleet);
    limitFields.show(state.fleet);
    volumeFields.show(state.volume);
    droneCountBadge.textContent = String(plan.count);

    storyboard.show(state, plan, view);
    addFormation.disabled = formations.length >= MAX_FORMATIONS;
    removeFormation.disabled = formations.length <= 1;
    moveEarlier.disabled = view.formation === 0;
    moveLater.disabled = view.formation === formations.length - 1;
    landAtEnd.checked = state.landAtEnd;

    formationTitle.textContent = `Formation ${view.formation + 1} of ${formations.length}`;
    formationFields.show(formation);
    color.value = formation.color;
    chase.value = formation.chase;
    chaseBox.hidden = formation.chase === 'off';
    chaseFields.show(formation);

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

    const formationSpacing = plan.formations[view.formation].spacing;
    spacing.textContent = meters(formationSpacing);
    spacing.classList.toggle('warn', isTooClose(formationSpacing, minSpacing));
    fit.disabled = !Number.isFinite(formationSpacing) || formationSpacing <= 0;

    const problems = showProblems(state, plan);
    checksStatus.classList.toggle('warn', problems.length > 0);
    checksSummary.textContent =
      problems.length === 0
        ? 'All checks pass'
        : `${problems.length} ${problems.length === 1 ? 'problem' : 'problems'}`;
    const listed = problems.slice(0, MAX_LISTED_PROBLEMS);
    if (problems.length > listed.length) listed.push(`${problems.length - listed.length} more`);
    checksProblems.replaceChildren(
      ...listed.map((problem) => {
        const item = element('li');
        item.textContent = problem;
        item.title = problem;
        return item;
      }),
    );
    checksProblems.hidden = problems.length === 0;

    duration.textContent = clock(plan.total);
    outside.textContent =
      plan.outsideVolume === 0 ? '0' : `${plan.outsideVolume} of ${plan.count}`;
    outside.classList.toggle('warn', plan.outsideVolume > 0);
    lowest.textContent = `${plan.lowestTarget.toFixed(1)} m`;
    lowest.classList.toggle('warn', isBelowGround(plan.lowestTarget));
    approach.textContent = meters(plan.closestApproach);
    approach.classList.toggle('warn', isTooClose(plan.closestApproach, minSpacing));
    peakSpeed.textContent = `${plan.peakSpeed.toFixed(1)} m/s`;

    showPaths.show(view.showPaths);
    showVolume.show(view.showVolume);
    scrub.max = String(plan.total);
    timeline.show(state, plan, view);
  }

  /**
   * Shows the timeline position and the live drone data. Call for each frame.
   * @param {import('./plan.js').Plan} plan
   * @param {View} view
   * @param {Float32Array} positions position of each drone at the view time, xyz
   */
  function showFrame(plan, view, positions) {
    scrub.value = String(view.time);
    time.textContent = `${clock(view.time)} / ${clock(plan.total)}`;
    play.dataset.playing = String(view.playing);
    playLabel.textContent = view.playing ? 'Pause' : 'Play';
    droneList.show(plan, view, positions);
  }

  return { refresh, showFrame, revealDrone: droneList.reveal };
}

/**
 * Lists every problem of the show, in words for the user.
 * @param {import('./state.js').State} state
 * @param {import('./plan.js').Plan} plan
 * @returns {string[]}
 */
function showProblems(state, plan) {
  const problems = [];
  if (plan.takeoffOutsideVolume > 0) problems.push(TAKEOFF_PROBLEM);
  state.formations.forEach((formation, index) => {
    for (const problem of formationProblems(plan, index, state.fleet)) {
      problems.push(`Formation ${index + 1}: ${problem}`);
    }
  });
  const last = plan.steps.at(-1);
  if (last.formation < 0 && isTooClose(last.closestApproach, state.fleet.minSpacing)) {
    problems.push(LANDING_PROBLEM);
  }
  return problems;
}

/**
 * Formats a time for the transport bar and the checks panel.
 * @param {number} seconds
 * @returns {string} minutes, seconds, and tenths, for example "1:05.3"
 */
function clock(seconds) {
  const tenths = Math.round(seconds * 10);
  const minutes = Math.floor(tenths / 600);
  const rest = ((tenths % 600) / 10).toFixed(1).padStart(4, '0');
  return `${minutes}:${rest}`;
}

/**
 * Makes a button an on and off switch. The button shows its state in `aria-pressed`.
 * @param {HTMLElement} button
 * @param {(on: boolean) => void} onChange
 */
function wireToggle(button, onChange) {
  /** @param {boolean} on */
  const show = (on) => button.setAttribute('aria-pressed', String(on));
  button.addEventListener('click', () => {
    const on = button.getAttribute('aria-pressed') !== 'true';
    show(on);
    onChange(on);
  });
  return { show };
}

/**
 * Name of the shape of a formation, for the storyboard.
 * @param {import('./state.js').Formation} formation
 */
function shapeLabel({ source }) {
  return source.type === 'obj' ? source.fileName : BUILTIN_SHAPES[source.shape].label;
}

/**
 * Builds the storyboard list: one row per formation, in show order.
 * @param {HTMLElement} list
 * @param {(index: number) => void} onSelect
 */
function buildStoryboard(list, onSelect) {
  /** @type {HTMLButtonElement[]} */
  const rows = [];

  /**
   * @param {import('./state.js').State} state
   * @param {import('./plan.js').Plan} plan
   * @param {View} view
   */
  function show(state, plan, view) {
    // The rows stay in the page and only their contents change. A row that the user
    // tabbed to then keeps the keyboard focus.
    while (rows.length < state.formations.length) {
      const index = rows.length;
      const row = element('button', 'formation-row');
      row.type = 'button';
      row.append(element('span', 'swatch'), element('span', 'number'), element('span', 'name'));
      row.append(element('span', 'meta'), element('span', 'problem'));
      row.addEventListener('click', () => onSelect(index));
      const item = element('li');
      item.append(row);
      list.append(item);
      rows.push(row);
    }
    while (rows.length > state.formations.length) rows.pop().parentElement.remove();

    state.formations.forEach((formation, index) => {
      const row = rows[index];
      const [swatch, number, name, meta, problem] = /** @type {HTMLElement[]} */ ([...row.children]);
      const problems = formationProblems(plan, index, state.fleet);
      row.setAttribute('aria-current', String(index === view.formation));
      swatch.style.color = formation.color;
      number.textContent = String(index + 1);
      name.textContent = shapeLabel(formation);
      const turn = formation.turnRate === 0 ? '' : ` · ${formation.turnRate}°/s`;
      const lights = formation.chase === 'off' ? '' : ' · chase';
      meta.textContent = `${formation.holdSeconds} s${turn}${lights}`;
      problem.textContent = problems.length > 0 ? '!' : '';
      row.title = problems.join(' ');
    });
  }

  return { show };
}

/**
 * Builds the timeline strip: one block per transition and one per hold.
 * The width of a block shows how long it takes.
 * @param {HTMLElement} strip
 * @param {Actions} actions
 */
function buildTimeline(strip, actions) {
  /** What a click on each block does. @type {(() => void)[]} */
  let clicks = [];
  strip.addEventListener('click', (event) => {
    const block = /** @type {HTMLElement} */ (event.target).closest('.block');
    if (block) clicks[Number(/** @type {HTMLElement} */ (block).dataset.block)]();
  });

  /**
   * @param {import('./state.js').State} state
   * @param {import('./plan.js').Plan} plan
   * @param {View} view
   */
  function show(state, plan, view) {
    const { formations } = state;
    const { minSpacing } = state.fleet;
    const blocks = [];
    clicks = [];
    plan.steps.forEach((step, index) => {
      const landing = step.formation < 0;
      const select = landing
        ? () => actions.seek(step.start)
        : () => actions.selectFormation(step.formation);
      const colorBefore = formations[index === 0 ? 0 : plan.steps[index - 1].formation].color;
      const colorAfter = landing ? colorBefore : formations[step.formation].color;
      const current = !landing && step.formation === view.formation;
      const problems = landing
        ? isTooClose(step.closestApproach, minSpacing)
          ? [LANDING_PROBLEM]
          : []
        : formationProblems(plan, step.formation, state.fleet);

      const flight = element('div', 'block flight');
      flight.style.flexGrow = String(step.timing.duration);
      flight.style.setProperty('--from', colorBefore);
      flight.style.setProperty('--to', colorAfter);
      flight.title = [landing ? 'Landing' : `Flight to formation ${step.formation + 1}`]
        .concat(`${step.timing.duration.toFixed(1)} s`, problems)
        .join('. ');
      flight.classList.toggle('problem', problems.length > 0);
      flight.dataset.block = String(clicks.push(select) - 1);
      blocks.push(flight);

      if (!landing) {
        const hold = element('div', 'block hold');
        hold.style.flexGrow = String(step.hold);
        hold.style.setProperty('--to', colorAfter);
        hold.textContent = String(step.formation + 1);
        hold.title = `Formation ${step.formation + 1}: ${shapeLabel(formations[step.formation])}. Hold ${step.hold} s`;
        hold.classList.toggle('current', current);
        hold.classList.toggle('problem', problems.length > 0);
        hold.dataset.block = String(clicks.push(select) - 1);
        blocks.push(hold);
      }
    });
    strip.replaceChildren(...blocks);
  }

  return { show };
}

const TAB_NAMES = ['show', 'fleet', 'drones'];

/**
 * Connects the sidebar tabs. A click on a tab shows its panel and hides the other panels.
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
      // Only the selected tab is a Tab key stop. The arrow keys reach the other tabs.
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
  const header = /** @type {HTMLElement} */ (container.firstElementChild);
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

    // The sticky header covers the top of the box, and the body starts below the header,
    // so the first row in view is at the scroll offset.
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
    const room = container.clientHeight - header.offsetHeight - DRONE_ROW_HEIGHT;
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
 * Builds one row per field: a label, a slider for fields that ask for one, and a number box.
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
    const row = element('div', field.slider ? 'field with-slider' : 'field');

    const label = element('label');
    label.htmlFor = id;
    label.textContent = field.label;
    row.append(label);

    const box = element('span', 'number-box');
    const number = numberInput(field, 'number');
    number.id = id;
    const unit = element('span', 'unit');
    unit.textContent = field.unit;
    box.append(number, unit);

    const fieldInputs = [number];
    // A number box reports a change when the user commits the value.
    number.addEventListener('change', () => commit(field, number));

    if (field.slider) {
      const slider = numberInput(field, 'range');
      slider.className = 'slider';
      slider.setAttribute('aria-label', field.label);
      slider.addEventListener('input', () => {
        setFill(slider);
        const value = clampToField(field, slider.valueAsNumber);
        if (value !== null && isLive(field.key, value)) onChange(field.key, value);
        // Not live: the number box shows the value that the slider will apply.
        else number.value = slider.value;
      });
      slider.addEventListener('change', () => commit(field, slider));
      row.append(slider);
      fieldInputs.push(slider);
    }

    row.append(box);
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
      for (const input of fieldInputs) {
        input.value = text;
        if (input.type === 'range') setFill(input);
      }
    }
  }

  return { show };
}

/**
 * Colors the track of a slider up to its thumb.
 * @param {HTMLInputElement} slider
 */
function setFill(slider) {
  const min = Number(slider.min);
  const max = Number(slider.max);
  const share = Math.min(1, Math.max(0, (slider.valueAsNumber - min) / (max - min)));
  slider.style.setProperty('--fill', `${share * 100}%`);
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
