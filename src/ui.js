// Sidebar tabs and controls, the storyboard, the drone list, the overlays on the 3D view,
// and the transport bar.

import {
  formationProblems,
  isBelowGround,
  isTooClose,
  landingProblems,
  showProblems,
  speedAt,
} from './plan.js';
import { DEMOS } from './demos.js';
import { BUILTIN_SHAPES } from './shapes.js';
import { VERSION } from './version.js';
import {
  CHASE_FIELDS,
  CHASE_PATTERNS,
  COLOR_PATTERNS,
  DARK_LEVEL_EFFECTS,
  FLEET_FIELDS,
  FORMATION_FIELDS,
  LANDING_FIELDS,
  MAX_FORMATIONS,
  MOTION_FIELDS,
  PROJECT_FILE_NAME,
  FLIGHT_LIGHT_FIELDS,
  FLIGHT_LIGHTS,
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
 * @property {(key: string, value: number | string) => void} setLanding sets the lights of the landing
 * @property {(spread: boolean) => void} setSpreadToPass
 * @property {(key: string, value: number | string) => void} setFormation
 * @property {(shape: string) => void} setShape
 * @property {(fileName: string, text: string) => string | null} importShape imports an OBJ model or an
 *   SVG drawing as the shape of the formation; returns an error message, or null
 * @property {(upAxis: 'y' | 'z') => void} setUpAxis
 * @property {() => void} fit
 * @property {() => string} projectText contents of the project file
 * @property {() => void} newShow replaces the project with the default show
 * @property {() => void} undo
 * @property {() => void} redo
 * @property {(text: string) => string | null} importProject returns an error message, or null
 * @property {(show: boolean) => void} setShowPaths
 * @property {(show: boolean) => void} setShowVolume
 * @property {() => void} audienceView
 * @property {() => void} startShowtime hides the panels and plays the show from the audience seat
 * @property {() => void} stopShowtime goes back to the editor
 * @property {() => void} togglePlay
 * @property {(time: number) => void} seek
 * @property {(direction: -1 | 1) => void} jump moves the timeline to the previous or the next formation
 * @property {(speed: number) => void} setSpeed sets the playback speed: 1 is real time
 * @property {(drone: number) => void} select index of the drone to select, or -1 to clear the selection
 */

/**
 * What the user looks at. This is not part of the project.
 * @typedef {object} View
 * @property {number} time position on the timeline, seconds
 * @property {boolean} playing
 * @property {number} speed playback speed; 1 is real time
 * @property {number} selected index of the selected drone, or -1
 * @property {number} formation index of the formation that the sidebar edits
 * @property {boolean} showPaths
 * @property {boolean} showVolume
 */

// A change of drone count, formation yaw or tilt, or turn rate needs new assignments, which
// take a moment for a large fleet. Up to this fleet size, their sliders apply each step of a
// drag. Above it, they apply their value when the user lets go. The other sliders need no new
// assignment, so they apply each step at every fleet size.
const LIVE_SLIDER_MAX_DRONES = 250;
const SLOW_FIELDS = ['count', 'yaw', 'tiltForward', 'tiltSide', 'turnRate'];

// The Fleet section of the Fleet tab holds these fields. The Limits section holds the others.
const FLEET_KEYS = ['count', 'gridSpacing', 'hoverHeight', 'rowDelay'];

// The checks panel lists this many problems. A last line counts the rest.
const MAX_LISTED_PROBLEMS = 4;

// The note on the 3D view while a new plan pauses the page.
const PLANNING_NOTE = 'Planning the show…';

// In Showtime, the pointer and the key hint hide after this many milliseconds with no input.
const SHOWTIME_IDLE_MS = 2500;

// A screen this narrow shows the sidebar as a sheet at the bottom. style.css has a media query
// with the same condition; a test checks that the two match.
export const COMPACT_SCREEN = '(max-width: 720px)';
// On a screen this small, the Checks panel starts folded, so it does not cover the view.
const SMALL_VIEW = '(max-width: 1000px), (max-height: 500px)';
// A vertical swipe on the sheet handle or the tab bar of at least this length, CSS pixels,
// changes the height of the sheet.
const SWIPE_LENGTH = 24;

// The browser storage key of the groups that the user folded. A fold is a convenience of one
// viewer, so it is not part of the project.
const FOLDS_KEY = 'drone-show-sim:folded';

/**
 * @param {Actions} actions
 */
export function createUi(actions) {
  let droneCount = 0;
  /** @type {LivePredicate} */
  const isLive = (key, value) =>
    !SLOW_FIELDS.includes(key) ||
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
  const spreadToPass = /** @type {HTMLInputElement} */ (byId('spread-to-pass'));
  spreadToPass.addEventListener('change', () => actions.setSpreadToPass(spreadToPass.checked));
  const formationFields = buildFields(
    byId('formation-fields'),
    FORMATION_FIELDS,
    actions.setFormation,
    isLive,
  );
  const motionFields = buildFields(byId('motion-fields'), MOTION_FIELDS, actions.setFormation, isLive);

  byId('version').textContent = `Version ${VERSION.milestone} · ${VERSION.date}`;

  const undo = /** @type {HTMLButtonElement} */ (byId('undo'));
  const redo = /** @type {HTMLButtonElement} */ (byId('redo'));
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  undo.title = `Undo (${mac ? '⌘Z' : 'Ctrl+Z'})`;
  redo.title = `Redo (${mac ? '⇧⌘Z' : 'Ctrl+Shift+Z'})`;
  undo.addEventListener('click', actions.undo);
  redo.addEventListener('click', actions.redo);

  const projectMenu = /** @type {HTMLDetailsElement} */ (byId('project-menu'));
  // A choice in the menu closes it. So does a click outside it.
  projectMenu.addEventListener('click', (event) => {
    if (/** @type {HTMLElement} */ (event.target).closest('.menu-items button')) projectMenu.open = false;
  });
  document.addEventListener('pointerdown', (event) => {
    if (projectMenu.open && !projectMenu.contains(/** @type {Node} */ (event.target))) projectMenu.open = false;
  });
  byId('new-show').addEventListener('click', actions.newShow);
  byId('export-project').addEventListener('click', () => {
    download(PROJECT_FILE_NAME, actions.projectText());
  });
  const projectError = byId('project-error');
  wireFilePicker(byId('import-project'), byId('project-file'), projectError, (fileName, text) =>
    actions.importProject(text),
  );
  buildDemoList(byId('demo-list'), projectError, actions.importProject);

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
  const landingLightsGroup = byId('landing-lights-group');
  const landingLights = wireLightsChoice(byId('landing-lights'), (effect) =>
    actions.setLanding('landingLights', effect),
  );
  const landingBox = byId('landing-fields');
  const landingFields = buildFields(landingBox, LANDING_FIELDS, actions.setLanding, () => true);

  const formationTitle = byId('formation-title');
  const shape = /** @type {HTMLSelectElement} */ (byId('shape'));
  for (const [key, { label }] of Object.entries(BUILTIN_SHAPES)) {
    shape.add(new Option(label, key));
  }
  // This option is in the list only while the formation uses an imported shape.
  const fileOption = new Option('', 'file');
  shape.addEventListener('change', () => {
    if (shape.value !== 'file') actions.setShape(shape.value);
  });

  wireFilePicker(byId('import-shape'), byId('shape-file'), byId('shape-error'), actions.importShape);
  const upAxisRow = byId('up-axis-row');
  const upAxis = /** @type {HTMLSelectElement} */ (byId('up-axis'));
  upAxis.addEventListener('change', () => actions.setUpAxis(upAxis.value === 'z' ? 'z' : 'y'));

  const color = /** @type {HTMLInputElement} */ (byId('color'));
  color.addEventListener('input', () => actions.setFormation('color', color.value));
  const colorPattern = /** @type {HTMLSelectElement} */ (byId('color-pattern'));
  const patternOptions = Object.entries(COLOR_PATTERNS).map(([key, label]) => new Option(label, key));
  colorPattern.append(...patternOptions);
  // Only an SVG drawing has colors of its own, so this option is in the list only for one.
  const drawingOption = /** @type {HTMLOptionElement} */ (
    patternOptions.find((option) => option.value === 'drawing')
  );
  colorPattern.addEventListener('change', () => actions.setFormation('colorPattern', colorPattern.value));
  const secondColorRow = byId('second-color-row');
  const secondColor = /** @type {HTMLInputElement} */ (byId('second-color'));
  secondColor.addEventListener('input', () => actions.setFormation('secondColor', secondColor.value));

  const flightLights = wireLightsChoice(byId('flight-lights'), (effect) =>
    actions.setFormation('flightLights', effect),
  );
  const flightLightBox = byId('flight-light-fields');
  // Flight lights need no new assignment, so their sliders are live for every fleet size.
  const flightLightFields = buildFields(flightLightBox, FLIGHT_LIGHT_FIELDS, actions.setFormation, () => true);

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
  const showtime = wireShowtime(actions);

  const play = byId('play');
  const playLabel = byId('play-label');
  const scrub = /** @type {HTMLInputElement} */ (byId('scrub'));
  const time = byId('time');
  play.addEventListener('click', actions.togglePlay);
  byId('previous-formation').addEventListener('click', () => actions.jump(-1));
  byId('next-formation').addEventListener('click', () => actions.jump(1));
  const speed = /** @type {HTMLSelectElement} */ (byId('speed'));
  speed.addEventListener('change', () => {
    actions.setSpeed(Number(speed.value));
    showtime.showSpeed(Number(speed.value));
  });
  wireFolds();
  scrub.addEventListener('input', () => actions.seek(scrub.valueAsNumber));
  const timeline = buildTimeline(byId('timeline-blocks'), actions);

  const droneCountBadge = byId('drone-count');
  const droneList = buildDroneList(byId('drone-list'), actions.select);
  const sheet = wireSheet();
  buildTabs((name) => {
    if (name === 'drones') droneList.opened();
    // A tap on a tab of a sheet that shows only its tab bar opens the sheet.
    sheet.open();
  });
  if (matchMedia(SMALL_VIEW).matches) /** @type {HTMLDetailsElement} */ (byId('checks')).open = false;

  document.addEventListener('keydown', (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    // Showtime takes two keys only. The panels are hidden, so no other key has a job.
    if (showtime.isOn()) {
      showtime.wake();
      if (event.code === 'Escape') actions.stopShowtime();
      if (event.code === 'Space' && !event.repeat && !target.closest('button')) {
        event.preventDefault();
        actions.togglePlay();
      }
      return;
    }
    if (event.code === 'Escape') {
      projectMenu.open = false;
      actions.select(-1);
    }

    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && !event.altKey && (key === 'z' || key === 'y')) {
      // In a box that the user types in, the box keeps its own undo for the typing.
      if (target.closest('input[type="number"], input[type="text"], textarea')) return;
      event.preventDefault();
      if (key === 'y' || event.shiftKey) actions.redo();
      else actions.undo();
      return;
    }

    // The arrow keys jump to the previous or the next formation, but not in a control that
    // uses them: a box, a slider, a list, or the tabs.
    if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !event.altKey && !event.ctrlKey && !event.metaKey) {
      if (target.closest('input, select, textarea, [role="tab"]')) return;
      event.preventDefault();
      actions.jump(event.key === 'ArrowLeft' ? -1 : 1);
      return;
    }

    if (event.code !== 'Space' || event.repeat) return;
    // In these controls the Space key already has a job.
    if (target.closest('button, select, summary, textarea, input:not([type="range"])')) return;
    event.preventDefault();
    actions.togglePlay();
  });

  /**
   * Shows if there is a step to undo and a step to redo.
   * @param {boolean} canUndo
   * @param {boolean} canRedo
   */
  function showHistory(canUndo, canRedo) {
    undo.disabled = !canUndo;
    redo.disabled = !canRedo;
  }

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
    spreadToPass.checked = state.spreadToPass;
    volumeFields.show(state.volume);
    droneCountBadge.textContent = String(plan.count);

    storyboard.show(state, plan, view);
    addFormation.disabled = formations.length >= MAX_FORMATIONS;
    removeFormation.disabled = formations.length <= 1;
    moveEarlier.disabled = view.formation === 0;
    moveLater.disabled = view.formation === formations.length - 1;
    landAtEnd.checked = state.landAtEnd;
    landingLightsGroup.hidden = !state.landAtEnd;
    landingLights.value = state.landingLights;
    landingBox.hidden = !DARK_LEVEL_EFFECTS.includes(state.landingLights);
    landingFields.show(state);

    formationTitle.textContent = `Formation ${view.formation + 1} of ${formations.length}`;
    formationFields.show(formation);
    motionFields.show(formation);
    color.value = formation.color;
    if (formation.source.type === 'svg') colorPattern.add(drawingOption);
    else drawingOption.remove();
    colorPattern.value = formation.colorPattern;
    secondColorRow.hidden = !isGradient(formation);
    secondColor.value = formation.secondColor;
    flightLights.value = formation.flightLights;
    flightLightBox.hidden = !DARK_LEVEL_EFFECTS.includes(formation.flightLights);
    flightLightFields.show(formation);
    chase.value = formation.chase;
    chaseBox.hidden = formation.chase === 'off';
    chaseFields.show(formation);

    const { source } = formation;
    if (source.type === 'builtin') {
      fileOption.remove();
      shape.value = source.shape;
    } else {
      fileOption.textContent = `${source.type.toUpperCase()}: ${source.fileName}`;
      shape.add(fileOption);
      shape.value = 'file';
      if (source.type === 'obj') upAxis.value = source.upAxis;
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

  /**
   * Turns Showtime on or off in the page.
   * @param {boolean} on
   */
  function showShowtime(on) {
    if (on) projectMenu.open = false;
    showtime.show(on);
  }

  return {
    refresh,
    showFrame,
    showHistory,
    showShowtime,
    showShowtimeState: showtime.state,
    revealDrone: droneList.reveal,
  };
}

/**
 * Connects the Showtime controls: the end card, full screen, and the hint that hides when the
 * user does nothing.
 * @param {Actions} actions
 */
function wireShowtime(actions) {
  const { body } = document;
  const end = byId('showtime-end');
  let idleTimer = 0;
  let playing = false;
  let ended = false;

  byId('showtime').addEventListener('click', actions.startShowtime);
  // At the end of the timeline, play starts again from the takeoff grid.
  byId('showtime-again').addEventListener('click', actions.togglePlay);
  byId('showtime-leave').addEventListener('click', actions.stopShowtime);
  byId('showtime-close').addEventListener('click', actions.stopShowtime);

  const isOn = () => body.classList.contains('showtime');
  const speedLabel = byId('showtime-speed');

  /** Shows the pointer and the hint, and hides them again after a time with no input. */
  function wake() {
    body.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => body.classList.add('idle'), SHOWTIME_IDLE_MS);
  }

  // A finger moves no pointer until it touches the screen, so a touch wakes the hint too.
  for (const type of ['pointermove', 'pointerdown']) {
    document.addEventListener(type, () => {
      if (isOn()) wake();
    });
  }
  // The browser leaves full screen on the Escape key and does not pass the key to the page.
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && isOn()) actions.stopShowtime();
  });

  /** @param {boolean} on */
  function show(on) {
    body.classList.toggle('showtime', on);
    // The next frame shows the pause label and the end card again.
    playing = true;
    ended = false;
    end.hidden = true;
    body.classList.remove('paused', 'ended');
    if (on) {
      // A focused button keeps the Space key for itself, and the buttons are now hidden.
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      wake();
      // A page that may not go full screen, for example in a frame, runs Showtime in its window.
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      clearTimeout(idleTimer);
      body.classList.remove('idle');
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    }
  }

  /**
   * Shows the pause label and the end card. Call for each frame in Showtime.
   * @param {boolean} isPlaying
   * @param {boolean} isEnded true at the end of the timeline
   */
  function state(isPlaying, isEnded) {
    if (isPlaying === playing && isEnded === ended) return;
    playing = isPlaying;
    ended = isEnded;
    end.hidden = !ended;
    body.classList.toggle('paused', !playing && !ended);
    body.classList.toggle('ended', ended);
    if (ended) wake();
  }

  /**
   * Shows the playback speed in the hint when it is not real time.
   * @param {number} speed
   */
  function showSpeed(speed) {
    speedLabel.textContent = speed === 1 ? '' : `${speed}× · `;
  }

  return { isOn, wake, show, state, showSpeed };
}

/**
 * Connects the sheet that the sidebar becomes on a narrow screen. The sheet has three heights:
 * `peek` shows the tab bar only, `half` shares the screen with the 3D view, and `full` leaves a
 * strip of the view. A tap on the handle opens and closes the sheet. A swipe up or down on the
 * handle or the tab bar makes it taller or shorter. On a wide screen the sheet is the sidebar,
 * and its height does nothing.
 * @returns {{open: () => void}} `open` makes a sheet that shows its tab bar only half high
 */
function wireSheet() {
  const heights = ['peek', 'half', 'full'];
  const { body } = document;
  const sidebar = byId('sidebar');
  const handle = byId('sheet-handle');
  /** @param {string} height */
  const set = (height) => {
    body.dataset.sheet = height;
  };
  const step = (/** @type {number} */ by) => {
    const index = heights.indexOf(body.dataset.sheet ?? 'peek');
    set(heights[Math.max(0, Math.min(heights.length - 1, index + by))]);
  };
  set('peek');

  const toggle = () => set(body.dataset.sheet === 'peek' ? 'half' : 'peek');

  // The handle and the tab bar act when the finger lifts. A click can follow; the sheet takes
  // it, so a swipe on a tab changes the height only. A browser can also leave the click out,
  // for example when a tap stops the glide of a fast swipe, so the next press clears the flag.
  let startY = 0;
  let handled = false;
  sidebar.addEventListener(
    'pointerdown',
    (event) => {
      startY = event.clientY;
      handled = false;
    },
    true,
  );
  for (const area of [handle, byId('tabs')]) {
    area.addEventListener('pointerup', (event) => {
      if (!matchMedia(COMPACT_SCREEN).matches) return;
      const dy = event.clientY - startY;
      if (Math.abs(dy) >= SWIPE_LENGTH) step(dy < 0 ? 1 : -1);
      else if (area === handle) toggle();
      else return;
      handled = true;
    });
  }
  sidebar.addEventListener(
    'click',
    (event) => {
      if (!handled) return;
      handled = false;
      event.stopPropagation();
      event.preventDefault();
    },
    true,
  );
  // The Enter and Space keys click the handle with no pointer.
  handle.addEventListener('click', (event) => {
    if (event.detail === 0) toggle();
  });

  // A message in the sheet must not hide under a sheet that shows its tab bar only.
  const open = () => {
    if (body.dataset.sheet === 'peek') set('half');
  };
  const messages = new MutationObserver(() => {
    if (!byId('project-error').hidden || !byId('autosave-error').hidden) open();
  });
  for (const id of ['project-error', 'autosave-error']) {
    messages.observe(byId(id), { attributes: true, attributeFilter: ['hidden'] });
  }
  return { open };
}

/**
 * Makes the title of each group with a `data-fold` key a button that folds the group. The
 * browser storage keeps the folded groups, so they stay folded after a reload.
 */
function wireFolds() {
  /** @type {Set<string>} */
  let folded = new Set();
  try {
    const saved = JSON.parse(localStorage.getItem(FOLDS_KEY) ?? '[]');
    if (Array.isArray(saved)) folded = new Set(saved.filter((key) => typeof key === 'string'));
  } catch {
    // No storage, or text that is not valid: every group starts open.
  }
  for (const group of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('.group[data-fold]'))) {
    const key = /** @type {string} */ (group.dataset.fold);
    const button = /** @type {HTMLElement} */ (group.querySelector('button.fold'));
    const show = () => {
      group.classList.toggle('folded', folded.has(key));
      button.setAttribute('aria-expanded', String(!folded.has(key)));
    };
    show();
    button.addEventListener('click', () => {
      if (folded.has(key)) folded.delete(key);
      else folded.add(key);
      show();
      try {
        localStorage.setItem(FOLDS_KEY, JSON.stringify([...folded]));
      } catch {
        // The folds then last until the page closes.
      }
    });
  }
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
 * @param {import('./state.js').Formation} formation
 * @returns {boolean} true when the formation blends two colors
 */
function isGradient({ colorPattern }) {
  return colorPattern === 'rising' || colorPattern === 'across' || colorPattern === 'outward';
}

/**
 * The background of a storyboard swatch: the gradient of the formation, in its direction.
 * @param {import('./state.js').Formation} formation
 * @returns {string} empty for a formation that is not a gradient; the swatch then has one color
 */
function swatchGradient(formation) {
  const { color, secondColor, colorPattern } = formation;
  if (colorPattern === 'rising') return `linear-gradient(to top, ${color}, ${secondColor})`;
  if (colorPattern === 'across') return `linear-gradient(to right, ${color}, ${secondColor})`;
  if (colorPattern === 'outward') return `radial-gradient(${color}, ${secondColor})`;
  return '';
}

/**
 * Name of the shape of a formation, for the storyboard.
 * @param {import('./state.js').Formation} formation
 */
function shapeLabel({ source }) {
  return source.type === 'builtin' ? BUILTIN_SHAPES[source.shape].label : source.fileName;
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
      swatch.style.background = swatchGradient(formation);
      number.textContent = String(index + 1);
      name.textContent = shapeLabel(formation);
      const turn = formation.turnRate === 0 ? '' : ` · ${formation.turnRate}°/s`;
      const swings = ['sway', 'rock', 'roll'].filter((swing) => formation[`${swing}Angle`] !== 0);
      const motion = swings.length === 0 ? '' : ` · ${swings.join('/')}`;
      const effect = formation.flightLights === 'blend' ? '' : ` · ${FLIGHT_LIGHTS[formation.flightLights].toLowerCase()}`;
      const lights = formation.chase === 'off' ? '' : ' · chase';
      meta.textContent = `${formation.holdSeconds} s${turn}${motion}${effect}${lights}`;
      problem.textContent = problems.length > 0 ? '!' : '';
      row.title = problems.join(' ');
    });
  }

  return { show };
}

/**
 * Fills a list with the flight light effects and reports a choice.
 * @param {HTMLElement} list a select element
 * @param {(effect: string) => void} onChange
 * @returns {HTMLSelectElement}
 */
function wireLightsChoice(list, onChange) {
  const select = /** @type {HTMLSelectElement} */ (list);
  for (const [key, label] of Object.entries(FLIGHT_LIGHTS)) select.add(new Option(label, key));
  select.addEventListener('change', () => onChange(select.value));
  return select;
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
        ? landingProblems(step, minSpacing)
        : formationProblems(plan, step.formation, state.fleet);

      const flight = element('div', 'block flight');
      flight.style.flexGrow = String(step.duration);
      flight.style.setProperty('--from', colorBefore);
      flight.style.setProperty('--to', colorAfter);
      flight.dataset.lights = step.lights.effect;
      flight.title = [landing ? 'Landing' : `Flight to formation ${step.formation + 1}`]
        .concat(
          `${step.duration.toFixed(1)} s`,
          step.lights.effect === 'blend' ? [] : `Lights: ${FLIGHT_LIGHTS[step.lights.effect]}`,
          step.legs.length > 1 ? 'The drones spread out to pass' : [],
          problems,
        )
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

// The row height of the drone list when the style sheet does not give one, CSS pixels.
const DRONE_ROW_HEIGHT = 22;

/**
 * Builds the drone list. The list draws only the rows that are in view,
 * so a large fleet costs the same as a small one.
 * @param {HTMLElement} container scroll box; its first child is the sticky header row
 * @param {(drone: number) => void} onSelect
 */
function buildDroneList(container, onSelect) {
  const header = /** @type {HTMLElement} */ (container.firstElementChild);
  // The style sheet sets the row height: a touch screen has taller rows.
  const rowHeight = parseFloat(getComputedStyle(container).getPropertyValue('--drone-row-height')) || DRONE_ROW_HEIGHT;
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
    body.style.height = `${plan.count * rowHeight}px`;

    // The sticky header covers the top of the box, and the body starts below the header,
    // so the first row in view is at the scroll offset.
    const first = Math.floor(container.scrollTop / rowHeight);
    const visible = Math.ceil(container.clientHeight / rowHeight) + 1;
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
      row.style.transform = `translateY(${drone * rowHeight}px)`;
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
    const top = drone * rowHeight;
    const room = container.clientHeight - header.offsetHeight - rowHeight;
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
    let text;
    try {
      text = await file.text();
    } catch (error) {
      // Only a failed read is expected here. Any other error is a bug and must stay visible.
      if (!(error instanceof DOMException)) throw error;
      showMessage(errorBox, 'The browser could not read the file.');
      return;
    }
    showMessage(errorBox, await withNote(PLANNING_NOTE, () => importText(file.name, text)));
  });
}

/**
 * Fills the demo list of the Project menu. A demo opens like an imported project file, so
 * Undo brings the old show back.
 * @param {HTMLElement} list
 * @param {HTMLElement} errorBox shows the error message of a demo that does not load
 * @param {(text: string) => string | null} importProject returns an error message, or null
 */
function buildDemoList(list, errorBox, importProject) {
  for (const demo of DEMOS) {
    const button = element('button', 'demo');
    button.type = 'button';
    button.title = 'Open this demo show. Undo brings the old show back.';
    const name = element('span', 'demo-name');
    name.textContent = demo.name;
    const summary = element('span', 'demo-summary');
    summary.textContent = demo.summary;
    button.append(name, summary);
    button.addEventListener('click', async () => {
      showMessage(errorBox, await withNote(`Loading ${demo.name}…`, () => loadDemo(demo, importProject)));
    });
    list.append(button);
  }
}

/**
 * Fetches the project file of a demo and opens it.
 * @param {import('./demos.js').Demo} demo
 * @param {(text: string) => string | null} importProject returns an error message, or null
 * @returns {Promise<string | null>} an error message, or null
 */
async function loadDemo(demo, importProject) {
  let text;
  try {
    const response = await fetch(demo.file);
    if (!response.ok) {
      return `The demo "${demo.name}" did not load. The server answered ${response.status}.`;
    }
    text = await response.text();
  } catch (error) {
    // Only a failed fetch is expected here. Any other error is a bug and must stay visible.
    if (!(error instanceof TypeError)) throw error;
    return `The demo "${demo.name}" did not load. Check the network connection.`;
  }
  return importProject(text);
}

/**
 * Runs work that can pause the page, such as the plan of a large show. A note on the 3D view
 * says what happens. The work starts after the browser has drawn the note.
 * @template T
 * @param {string} note
 * @param {() => T | Promise<T>} work
 * @returns {Promise<T>}
 */
async function withNote(note, work) {
  const box = byId('view-busy');
  box.textContent = note;
  box.hidden = false;
  // A frame callback runs before the browser draws the frame. A timer that it starts runs after.
  await new Promise((done) => requestAnimationFrame(() => setTimeout(done, 0)));
  try {
    return await work();
  } finally {
    box.hidden = true;
  }
}

/**
 * @param {HTMLElement} box
 * @param {string | null} message null hides the box
 */
function showMessage(box, message) {
  box.textContent = message ?? '';
  box.hidden = message === null;
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

  /** Rows that the sidebar shows only when another field is not 0. @type {[HTMLElement, string][]} */
  const dependent = [];

  for (const field of fields) {
    const id = `${container.id}-${field.key}`;
    const row = element('div', field.slider ? 'field with-slider' : 'field');
    if (field.title) row.title = field.title;
    if (field.dependsOn) dependent.push([row, field.dependsOn]);

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
    for (const [row, key] of dependent) row.hidden = values[key] === 0;
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
