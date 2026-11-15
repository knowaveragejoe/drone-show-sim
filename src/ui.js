// Sidebar controls.

import { isTooClose } from './plan.js';
import { BUILTIN_SHAPES } from './shapes.js';
import { FLEET_FIELDS, FORMATION_FIELDS, clampToField } from './state.js';

/**
 * @typedef {object} Actions
 * @property {(key: string, value: number) => void} setFleet
 * @property {(key: string, value: number | string) => void} setFormation
 * @property {(shape: string) => void} setShape
 * @property {() => void} fit
 */

/**
 * @param {Actions} actions
 */
export function createUi(actions) {
  const fleetFields = buildFields(byId('fleet-fields'), FLEET_FIELDS, actions.setFleet);
  const formationFields = buildFields(byId('formation-fields'), FORMATION_FIELDS, actions.setFormation);

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

  /**
   * Shows the project state and the plan in the controls. Call after each state change.
   * @param {import('./state.js').State} state
   * @param {import('./plan.js').Plan} plan
   */
  function refresh(state, plan) {
    const formation = state.formations[0];
    fleetFields.show(state.fleet);
    formationFields.show(formation);
    shape.value = formation.source.shape;
    color.value = formation.color;

    const hasSpacing = Number.isFinite(plan.spacing);
    spacing.textContent = hasSpacing ? `${plan.spacing.toFixed(2)} m` : 'n/a';
    spacing.classList.toggle('warn', isTooClose(plan.spacing, state.fleet.minSpacing));
    fit.disabled = !hasSpacing || plan.spacing <= 0;
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
