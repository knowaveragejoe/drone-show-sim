// Project state: the values that the user sets. The state is plain data.

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
 * Where the shape of a formation comes from. Treat a source as read-only:
 * to change it, put a new object in its place. The planner uses the object identity
 * to know when it must sample the shape again.
 * @typedef {{type: 'builtin', shape: string}} Source
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
