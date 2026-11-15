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
 */

/** @type {NumberField[]} */
export const FLEET_FIELDS = [
  { key: 'count', label: 'Drone count', unit: '', min: 1, max: 1000, step: 1, integer: true, slider: true },
  { key: 'maxHorizontalSpeed', label: 'Max horizontal speed', unit: 'm/s', min: 0.5, max: 30, step: 0.5 },
  { key: 'maxClimbSpeed', label: 'Max climb speed', unit: 'm/s', min: 0.5, max: 30, step: 0.5 },
  { key: 'maxDescentSpeed', label: 'Max descent speed', unit: 'm/s', min: 0.5, max: 30, step: 0.5 },
  { key: 'maxAcceleration', label: 'Max acceleration', unit: 'm/s²', min: 0.5, max: 30, step: 0.5 },
  { key: 'minSpacing', label: 'Minimum spacing', unit: 'm', min: 0.5, max: 20, step: 0.1 },
  { key: 'gridSpacing', label: 'Takeoff grid spacing', unit: 'm', min: 0.5, max: 20, step: 0.1 },
];

/** @type {NumberField[]} */
export const FORMATION_FIELDS = [
  { key: 'size', label: 'Size', unit: 'm', min: 1, max: 500, step: 1, slider: true },
  { key: 'centerHeight', label: 'Center height', unit: 'm', min: 0, max: 500, step: 1, slider: true },
  { key: 'yaw', label: 'Yaw', unit: '°', min: -180, max: 180, step: 1, slider: true },
  { key: 'holdSeconds', label: 'Hold time', unit: 's', min: 0, max: 600, step: 1 },
];

export const MAX_DRONES = FLEET_FIELDS[0].max;

export const PROJECT_APP = 'drone-show-sim';
export const PROJECT_VERSION = 1;
export const PROJECT_FILE_NAME = 'show.droneshow.json';

/**
 * @typedef {object} Fleet
 * @property {number} count
 * @property {number} maxHorizontalSpeed m/s
 * @property {number} maxClimbSpeed m/s
 * @property {number} maxDescentSpeed m/s
 * @property {number} maxAcceleration m/s²
 * @property {number} minSpacing meters
 * @property {number} gridSpacing meters
 */

/**
 * Where the shape of a formation comes from: a built-in shape, or the text of an OBJ file.
 * Treat a source as read-only: to change it, put a new object in its place.
 * The planner uses the object identity to know when it must sample the shape again.
 * @typedef {{type: 'builtin', shape: string}
 *   | {type: 'obj', fileName: string, upAxis: 'y' | 'z', text: string}} Source
 */

/**
 * @typedef {object} Formation
 * @property {Source} source
 * @property {number} size largest extent, meters
 * @property {number} centerHeight meters above the ground
 * @property {number} yaw rotation about the vertical axis, degrees
 * @property {string} color light color, `#rrggbb`
 * @property {number} holdSeconds time that the drones hold the formation
 * @property {number} seed seed of the random sampler
 */

/**
 * @typedef {object} State
 * @property {Fleet} fleet
 * @property {Formation[]} formations exactly one entry in version 1
 */

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
      gridSpacing: 3,
    },
    formations: [
      {
        source: { type: 'builtin', shape: 'sphere' },
        size: 40,
        centerHeight: 60,
        yaw: 0,
        color: '#66ccff',
        holdSeconds: 10,
        seed: 1,
      },
    ],
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
  if (data.version !== PROJECT_VERSION) {
    throw new Error(
      `The project file has version ${data.version}. This simulator reads version ${PROJECT_VERSION}.`,
    );
  }
  if (!isObject(data.fleet)) throw new Error('The project file has no fleet.');
  if (!Array.isArray(data.formations) || data.formations.length !== 1 || !isObject(data.formations[0])) {
    throw new Error('The project file must have exactly one formation.');
  }

  const saved = data.formations[0];
  if (typeof saved.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(saved.color)) {
    throw new Error('formation.color must be a color such as #66ccff.');
  }
  if (!Number.isInteger(saved.seed)) throw new Error('formation.seed must be a whole number.');

  return {
    fleet: /** @type {Fleet} */ (readFields('fleet', data.fleet, FLEET_FIELDS)),
    formations: [
      /** @type {Formation} */ ({
        ...readFields('formation', saved, FORMATION_FIELDS),
        source: readSource(saved.source),
        color: saved.color,
        seed: saved.seed,
      }),
    ],
  };
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
    const value = data[field.key];
    const valid =
      typeof value === 'number' &&
      value >= field.min &&
      value <= field.max &&
      (!field.integer || Number.isInteger(value));
    if (!valid) {
      const kind = field.integer ? 'a whole number' : 'a number';
      throw new Error(`${name}.${field.key} must be ${kind} from ${field.min} to ${field.max}.`);
    }
    values[field.key] = value;
  }
  return values;
}

/**
 * @param {unknown} source
 * @returns {Source}
 */
function readSource(source) {
  if (isObject(source) && source.type === 'builtin') {
    if (!Object.hasOwn(BUILTIN_SHAPES, source.shape)) {
      throw new Error(`The project file uses the unknown shape "${source.shape}".`);
    }
    return { type: 'builtin', shape: source.shape };
  }
  if (isObject(source) && source.type === 'obj') {
    const valid =
      typeof source.fileName === 'string' &&
      typeof source.text === 'string' &&
      (source.upAxis === 'y' || source.upAxis === 'z');
    if (!valid) throw new Error('The OBJ model in the project file is not complete.');
    return { type: 'obj', fileName: source.fileName, upAxis: source.upAxis, text: source.text };
  }
  throw new Error('formation.source must be a built-in shape or an OBJ model.');
}
