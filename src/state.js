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
  { key: 'gridSpacing', label: 'Takeoff grid spacing', unit: 'm', min: 0.5, max: 20, step: 0.1 },
];

/**
 * @typedef {object} Fleet
 * @property {number} count
 * @property {number} gridSpacing meters
 */

/**
 * @typedef {object} State
 * @property {Fleet} fleet
 */

/** @returns {State} */
export function defaultState() {
  return {
    fleet: {
      count: 100,
      gridSpacing: 3,
    },
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
