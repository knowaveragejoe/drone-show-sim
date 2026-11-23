// Project state: the values that the user sets. The state is plain data.
// The project file is the state as JSON, plus the app name and a format version.

import { BUILTIN_SHAPES } from './shapes.js';

/**
 * @typedef {object} NumberField
 * @property {string} key property name in the state
 * @property {string} label
 * @property {string} unit
 * @property {number} min
 * @property {number} max
 * @property {number} step
 * @property {boolean} [integer]
 * @property {boolean} [slider] show a slider next to the number box
 * @property {number} [fallback] value for a project file that does not have the field,
 *   because the file is older than the field
 * @property {string} [dependsOn] the sidebar shows the field only when this other field is not 0
 * @property {string} [title] a longer explanation, for the tooltip
 */

/** @type {NumberField[]} */
export const FLEET_FIELDS = [
  { key: 'count', label: 'Drone count', unit: '', min: 1, max: 1000, step: 1, integer: true, slider: true },
  { key: 'maxHorizontalSpeed', label: 'Max horizontal speed', unit: 'm/s', min: 0.5, max: 30, step: 0.5 },
  { key: 'maxClimbSpeed', label: 'Max climb speed', unit: 'm/s', min: 0.5, max: 30, step: 0.5 },
  { key: 'maxDescentSpeed', label: 'Max descent speed', unit: 'm/s', min: 0.5, max: 30, step: 0.5 },
  { key: 'maxAcceleration', label: 'Max acceleration', unit: 'm/s²', min: 0.5, max: 30, step: 0.5 },
  { key: 'minSpacing', label: 'Minimum spacing', unit: 'm', min: 0.5, max: 20, step: 0.1, title: 'Smallest distance between two drones side by side.' },
  { key: 'minVerticalSpacing', label: 'Vertical spacing', unit: 'm', min: 0.5, max: 40, step: 0.1, title: 'Smallest distance between two drones when one is straight above the other. A drone pushes air down, so a drone under it needs more room. Between side by side and straight above, the limit blends from the minimum spacing to this one.' },
  { key: 'gridSpacing', label: 'Takeoff grid spacing', unit: 'm', min: 0.5, max: 20, step: 0.1 },
];

/** @type {NumberField[]} */
export const FORMATION_FIELDS = [
  { key: 'size', label: 'Size', unit: 'm', min: 1, max: 500, step: 1, slider: true },
  { key: 'centerHeight', label: 'Center height', unit: 'm', min: 0, max: 500, step: 1, slider: true },
  { key: 'yaw', label: 'Yaw', unit: '°', min: -180, max: 180, step: 1, slider: true },
  { key: 'tiltForward', label: 'Tilt forward', unit: '°', min: -90, max: 90, step: 1, slider: true, fallback: 0, title: 'Leans the top of the formation toward the audience. A negative tilt leans it away.' },
  { key: 'tiltSide', label: 'Tilt sideways', unit: '°', min: -90, max: 90, step: 1, slider: true, fallback: 0, title: 'Leans the top of the formation to the right as the audience sees it. A negative tilt leans it to the left.' },
  { key: 'holdSeconds', label: 'Hold time', unit: 's', min: 0, max: 600, step: 1 },
];

/**
 * The motion of a formation in its hold. The turn goes one way. Sway, rock, and roll swing
 * back and forth and end where they started. All of them can run at the same time.
 * @type {NumberField[]}
 */
export const MOTION_FIELDS = [
  { key: 'turnRate', label: 'Turn rate', unit: '°/s', min: -45, max: 45, step: 0.5, slider: true, fallback: 0, title: 'Turns the formation about its own axis, one way, in its hold.' },
  { key: 'swayAngle', label: 'Sway', unit: '°', min: 0, max: 60, step: 1, slider: true, fallback: 0, title: 'Turns the formation back and forth about its own axis, by this angle each way.' },
  { key: 'swaySeconds', label: 'Sway time', unit: 's', min: 1, max: 60, step: 0.5, fallback: 8, dependsOn: 'swayAngle', title: 'Time of one full sway, back and forth. The hold fits a whole number of sways.' },
  { key: 'rockAngle', label: 'Rock', unit: '°', min: 0, max: 45, step: 1, slider: true, fallback: 0, title: 'Leans the formation toward the audience and back, by this angle each way.' },
  { key: 'rockSeconds', label: 'Rock time', unit: 's', min: 1, max: 60, step: 0.5, fallback: 8, dependsOn: 'rockAngle', title: 'Time of one full rock, toward the audience and back. The hold fits a whole number of rocks.' },
  { key: 'rollAngle', label: 'Roll', unit: '°', min: 0, max: 45, step: 1, slider: true, fallback: 0, title: 'Leans the formation to the left and to the right, by this angle each way.' },
  { key: 'rollSeconds', label: 'Roll time', unit: 's', min: 1, max: 60, step: 0.5, fallback: 8, dependsOn: 'rollAngle', title: 'Time of one full roll, to one side and back. The hold fits a whole number of rolls.' },
];

/** The patterns of a light chase. The first one turns the chase off. */
export const CHASE_PATTERNS = {
  off: 'Off',
  around: 'Around',
  rising: 'Rising',
  across: 'Across',
};

/**
 * How the drones of a formation get their colors. A gradient blends from the formation color
 * to the second color. Drawing colors are the colors of an SVG drawing.
 */
export const COLOR_PATTERNS = {
  solid: 'Solid',
  rising: 'Rising gradient',
  across: 'Across gradient',
  outward: 'Outward gradient',
  drawing: 'Drawing colors',
};

// The second color of a gradient, for a formation that does not give one.
const DEFAULT_SECOND_COLOR = '#ffffff';

/**
 * Fields of the light chase. The sidebar shows them only when the chase is on.
 * @type {NumberField[]}
 */
export const CHASE_FIELDS = [
  { key: 'chaseBands', label: 'Chase bands', unit: '', min: 1, max: 12, step: 1, integer: true, slider: true, fallback: 4 },
  { key: 'chaseSpeed', label: 'Chase speed', unit: 'laps/s', min: -2, max: 2, step: 0.05, slider: true, fallback: 0.5 },
];

/** @type {NumberField[]} */
export const VOLUME_FIELDS = [
  { key: 'size', label: 'Size', unit: 'm', min: 10, max: 1000, step: 1, slider: true },
  { key: 'x', label: 'Center X', unit: 'm', min: -500, max: 500, step: 1 },
  { key: 'y', label: 'Center Y', unit: 'm', min: -500, max: 500, step: 1 },
  { key: 'z', label: 'Floor height', unit: 'm', min: 0, max: 500, step: 1 },
];

export const MAX_DRONES = FLEET_FIELDS[0].max;
export const MAX_FORMATIONS = 20;

// A new formation gets the next color of this list.
const FORMATION_COLORS = ['#66ccff', '#ff5c8a', '#ffb347', '#7dff9b', '#c69bff', '#fff27a'];

export const PROJECT_APP = 'drone-show-sim';
// Version 2 adds the storyboard: more than one formation, and the landing.
export const PROJECT_VERSION = 2;
const READABLE_VERSIONS = [1, 2];
export const PROJECT_FILE_NAME = 'show.droneshow.json';

/**
 * @typedef {object} Fleet
 * @property {number} count
 * @property {number} maxHorizontalSpeed m/s
 * @property {number} maxClimbSpeed m/s
 * @property {number} maxDescentSpeed m/s
 * @property {number} maxAcceleration m/s²
 * @property {number} minSpacing smallest distance between two drones side by side, meters
 * @property {number} minVerticalSpacing smallest distance between two drones when one is
 *   straight above the other, meters
 * @property {number} gridSpacing meters
 */

/**
 * The flight volume: a cube that the drones must stay inside.
 * A larger size grows the cube up and out from the middle of its floor.
 * @typedef {object} Volume
 * @property {number} size edge length, meters
 * @property {number} x center of the cube, meters
 * @property {number} y center of the cube, meters
 * @property {number} z height of the cube floor above the ground, meters
 */

/**
 * Where the shape of a formation comes from: a built-in shape, the text of an OBJ model,
 * or the text of an SVG drawing.
 * Treat a source as read-only: to change it, put a new object in its place.
 * The planner uses the object identity to know when it must sample the shape again.
 * @typedef {{type: 'builtin', shape: string}
 *   | {type: 'obj', fileName: string, upAxis: 'y' | 'z', text: string}
 *   | {type: 'svg', fileName: string, text: string}} Source
 */

/**
 * @typedef {object} Formation
 * @property {Source} source
 * @property {number} size largest extent, meters
 * @property {number} centerHeight meters above the ground
 * @property {number} yaw rotation about the vertical axis, degrees
 * @property {string} color light color, `#rrggbb`
 * @property {keyof typeof COLOR_PATTERNS} colorPattern how the drones get their colors; `drawing`
 *   only for an SVG drawing
 * @property {string} secondColor the color at the other end of a gradient, `#rrggbb`
 * @property {number} holdSeconds time that the drones hold the formation
 * @property {number} tiltForward fixed lean toward the audience, degrees; negative leans away
 * @property {number} tiltSide fixed lean to the right as the audience sees it, degrees; negative leans left
 * @property {number} turnRate how fast the formation turns about its own axis in its hold,
 *   degrees per second; positive is counterclockwise seen from above
 * @property {number} swayAngle largest angle of the sway each way, degrees; 0 for no sway
 * @property {number} swaySeconds asked time of one full sway, seconds
 * @property {number} rockAngle largest angle of the rock each way, degrees; 0 for no rock
 * @property {number} rockSeconds asked time of one full rock, seconds
 * @property {number} rollAngle largest angle of the roll each way, degrees; 0 for no roll
 * @property {number} rollSeconds asked time of one full roll, seconds
 * @property {keyof typeof CHASE_PATTERNS} chase the pattern of the light chase in the hold
 * @property {number} chaseBands number of bright bands of the light chase
 * @property {number} chaseSpeed laps per second of the light chase; negative runs the other way
 * @property {number} seed seed of the random sampler
 */

/**
 * @typedef {object} State
 * @property {Fleet} fleet
 * @property {Volume} volume
 * @property {Formation[]} formations the storyboard: the formations of the show, in order
 * @property {boolean} landAtEnd true when the show ends with a flight back to the takeoff grid
 * @property {boolean} spreadToPass true when the fleet spreads out before it crosses, in a
 *   transition where a direct flight brings drones too close
 */

// A formation with no tilt and no motion in its hold.
const STILL = {
  tiltForward: 0,
  tiltSide: 0,
  turnRate: 0,
  swayAngle: 0,
  swaySeconds: 8,
  rockAngle: 0,
  rockSeconds: 8,
  rollAngle: 0,
  rollSeconds: 8,
};

/** @returns {State} */
export function defaultState() {
  return {
    fleet: {
      count: 100,
      maxHorizontalSpeed: 8,
      maxClimbSpeed: 3,
      maxDescentSpeed: 3,
      maxAcceleration: 4,
      minSpacing: 2,
      minVerticalSpacing: 3,
      gridSpacing: 3,
    },
    volume: {
      size: 120,
      x: 0,
      y: 0,
      z: 0,
    },
    formations: [
      {
        ...STILL,
        source: { type: 'builtin', shape: 'sphere' },
        size: 40,
        centerHeight: 60,
        yaw: 0,
        color: FORMATION_COLORS[0],
        colorPattern: 'solid',
        secondColor: DEFAULT_SECOND_COLOR,
        holdSeconds: 10,
        turnRate: 6,
        chase: 'off',
        chaseBands: 4,
        chaseSpeed: 0.5,
        seed: 1,
      },
      {
        ...STILL,
        source: { type: 'builtin', shape: 'heart' },
        size: 100,
        centerHeight: 60,
        yaw: 0,
        color: FORMATION_COLORS[1],
        colorPattern: 'solid',
        secondColor: DEFAULT_SECOND_COLOR,
        holdSeconds: 10,
        rockAngle: 5,
        chase: 'around',
        chaseBands: 5,
        chaseSpeed: 0.25,
        seed: 1,
      },
      {
        ...STILL,
        source: { type: 'builtin', shape: 'torus' },
        size: 50,
        centerHeight: 60,
        yaw: 30,
        tiltForward: 20,
        color: FORMATION_COLORS[2],
        colorPattern: 'outward',
        secondColor: FORMATION_COLORS[1],
        holdSeconds: 10,
        turnRate: -6,
        chase: 'off',
        chaseBands: 4,
        chaseSpeed: 0.5,
        seed: 1,
      },
    ],
    landAtEnd: true,
    spreadToPass: true,
  };
}

/**
 * Makes the formation that the Add button puts after one formation of the storyboard.
 * The new formation keeps the size and place of that formation, so the next transition is short.
 * It gets the next built-in shape and the next color, so the two are easy to tell apart.
 * @param {Formation[]} formations the storyboard
 * @param {number} index the formation that the new one comes after
 * @returns {Formation}
 */
export function nextFormation(formations, index) {
  const before = formations[index];
  const shapes = Object.keys(BUILTIN_SHAPES);
  const shape = before.source.type === 'builtin' ? shapes.indexOf(before.source.shape) : -1;
  const color = FORMATION_COLORS.indexOf(before.color.toLowerCase());
  return {
    ...before,
    source: { type: 'builtin', shape: shapes[(shape + 1) % shapes.length] },
    color: FORMATION_COLORS[(color + 1) % FORMATION_COLORS.length],
  };
}

/**
 * Converts user input to a value that the field accepts.
 * @param {NumberField} field
 * @param {number} value
 * @returns {number | null} null when the input is not a number
 */
export function clampToField(field, value) {
  if (!Number.isFinite(value)) return null;
  const clamped = Math.min(field.max, Math.max(field.min, value));
  return field.integer ? Math.round(clamped) : clamped;
}

/**
 * @param {State} state
 * @returns {string} contents of a project file
 */
export function serializeProject(state) {
  return JSON.stringify({ app: PROJECT_APP, version: PROJECT_VERSION, ...state }, null, 2);
}

/**
 * Reads a project file. Checks every value, because the file comes from outside the app.
 * @param {string} text contents of a project file
 * @returns {State}
 * @throws {Error} with a message for the user when the file is not a valid project
 */
export function parseProject(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('The file is not valid JSON.');
  }
  if (!isObject(data) || data.app !== PROJECT_APP) {
    throw new Error('The file is not a drone show project.');
  }
  if (!READABLE_VERSIONS.includes(data.version)) {
    throw new Error(
      `The project file has version ${data.version}. This simulator reads versions 1 and 2.`,
    );
  }
  if (!isObject(data.fleet)) throw new Error('The project file has no fleet.');
  const count = Array.isArray(data.formations) ? data.formations.length : 0;
  if (count < 1 || count > MAX_FORMATIONS) {
    throw new Error(`The project file must have 1 to ${MAX_FORMATIONS} formations.`);
  }

  // A project file from before the flight volume existed has no volume. It gets the default one.
  let volume = defaultState().volume;
  if (data.volume !== undefined) {
    if (!isObject(data.volume)) throw new Error('The flight volume in the project file is not valid.');
    volume = /** @type {Volume} */ (readFields('volume', data.volume, VOLUME_FIELDS));
  }

  // A project file from before the storyboard existed has no landing.
  if (data.landAtEnd !== undefined && typeof data.landAtEnd !== 'boolean') {
    throw new Error('landAtEnd must be true or false.');
  }
  // A project file from before the spread existed gets it. The spread only changes a
  // transition that is not safe without it.
  if (data.spreadToPass !== undefined && typeof data.spreadToPass !== 'boolean') {
    throw new Error('spreadToPass must be true or false.');
  }

  // A project file from before the vertical spacing existed has one spacing in all directions.
  const fleet = { minVerticalSpacing: data.fleet.minSpacing, ...data.fleet };
  return {
    fleet: /** @type {Fleet} */ (readFields('fleet', fleet, FLEET_FIELDS)),
    volume,
    formations: data.formations.map(readFormation),
    landAtEnd: data.landAtEnd === true,
    spreadToPass: data.spreadToPass !== false,
  };
}

/**
 * @param {unknown} saved
 * @param {number} index place in the storyboard
 * @returns {Formation}
 */
function readFormation(saved, index) {
  const name = `formation ${index + 1}`;
  if (!isObject(saved)) throw new Error(`${name} is not valid.`);
  if (!isHexColor(saved.color)) throw new Error(`${name}: color must be a color such as #66ccff.`);
  // A project file from before color patterns existed has one color per formation.
  const secondColor = saved.secondColor ?? DEFAULT_SECOND_COLOR;
  if (!isHexColor(secondColor)) throw new Error(`${name}: secondColor must be a color such as #66ccff.`);
  let colorPattern = saved.colorPattern ?? 'solid';
  if (!Object.hasOwn(COLOR_PATTERNS, colorPattern)) {
    throw new Error(`${name}: colorPattern must be one of ${Object.keys(COLOR_PATTERNS).join(', ')}.`);
  }
  if (!Number.isInteger(saved.seed)) throw new Error(`${name}: seed must be a whole number.`);
  // A project file from before the light chase existed has no chase.
  const chase = saved.chase ?? 'off';
  if (!Object.hasOwn(CHASE_PATTERNS, chase)) {
    throw new Error(`${name}: chase must be one of ${Object.keys(CHASE_PATTERNS).join(', ')}.`);
  }
  const source = readSource(name, saved.source);
  // Only an SVG drawing has colors of its own.
  if (colorPattern === 'drawing' && source.type !== 'svg') colorPattern = 'solid';
  return /** @type {Formation} */ ({
    ...readFields(name, saved, FORMATION_FIELDS),
    ...readFields(name, saved, MOTION_FIELDS),
    ...readFields(name, saved, CHASE_FIELDS),
    source,
    color: saved.color,
    colorPattern,
    secondColor,
    chase,
    seed: saved.seed,
  });
}

/**
 * @param {unknown} value
 * @returns {boolean} true for a color such as `#66ccff`
 */
function isHexColor(value) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads one number per field and checks its range.
 * @param {string} name name of the object, for error messages
 * @param {Record<string, any>} data
 * @param {NumberField[]} fields
 * @returns {Record<string, number>}
 */
function readFields(name, data, fields) {
  /** @type {Record<string, number>} */
  const values = {};
  for (const field of fields) {
    const value = data[field.key] ?? field.fallback;
    const valid =
      typeof value === 'number' &&
      value >= field.min &&
      value <= field.max &&
      (!field.integer || Number.isInteger(value));
    if (!valid) {
      const kind = field.integer ? 'a whole number' : 'a number';
      throw new Error(`${name}: ${field.key} must be ${kind} from ${field.min} to ${field.max}.`);
    }
    values[field.key] = value;
  }
  return values;
}

/**
 * @param {string} name name of the formation, for error messages
 * @param {unknown} source
 * @returns {Source}
 */
function readSource(name, source) {
  if (isObject(source) && source.type === 'builtin') {
    if (!Object.hasOwn(BUILTIN_SHAPES, source.shape)) {
      throw new Error(`${name}: the shape "${source.shape}" is unknown.`);
    }
    return { type: 'builtin', shape: source.shape };
  }
  if (isObject(source) && source.type === 'obj') {
    const valid =
      typeof source.fileName === 'string' &&
      typeof source.text === 'string' &&
      (source.upAxis === 'y' || source.upAxis === 'z');
    if (!valid) throw new Error(`${name}: the OBJ model is not complete.`);
    return { type: 'obj', fileName: source.fileName, upAxis: source.upAxis, text: source.text };
  }
  if (isObject(source) && source.type === 'svg') {
    if (typeof source.fileName !== 'string' || typeof source.text !== 'string') {
      throw new Error(`${name}: the SVG drawing is not complete.`);
    }
    return { type: 'svg', fileName: source.fileName, text: source.text };
  }
  throw new Error(`${name}: source must be a built-in shape, an OBJ model, or an SVG drawing.`);
}
