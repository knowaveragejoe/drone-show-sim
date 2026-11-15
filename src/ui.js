// Sidebar controls.

import { FLEET_FIELDS, clampToField } from './state.js';

/**
 * @typedef {object} Actions
 * @property {(key: string, value: number) => void} setFleet
 */

/**
 * @param {Actions} actions
 */
export function createUi(actions) {
  const fleetFields = buildFields(byId('fleet-fields'), FLEET_FIELDS, actions.setFleet);

  /**
   * Shows the project state in the controls. Call after each state change.
   * @param {import('./state.js').State} state
   */
  function refresh(state) {
    fleetFields.show(state.fleet);
  }

  return { refresh };
}

/**
 * Builds one labeled number box per field, plus a slider for fields that ask for one.
 * @param {HTMLElement} container
 * @param {import('./state.js').NumberField[]} fields
 * @param {(key: string, value: number) => void} onChange
 */
function buildFields(container, fields, onChange) {
  /** @type {Map<string, HTMLInputElement[]>} */
  const inputs = new Map();
  /** @type {Record<string, number>} */
  let shown = {};

  for (const field of fields) {
    const id = `field-${container.id}-${field.key}`;
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
      // A slider reports each step of a drag.
      slider.addEventListener('input', () => commit(field, slider));
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

  /** @param {Record<string, number>} values */
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
