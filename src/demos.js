// The demo shows. Each one is a project file in the demos folder. The Project menu lists them.

/**
 * @typedef {object} Demo
 * @property {string} name
 * @property {string} summary one line for the menu
 * @property {string} file URL of the project file, relative to the page
 */

/** @type {Demo[]} */
export const DEMOS = [
  {
    name: 'First light',
    summary: '120 drones: a sphere, a helix, a ring, and a heart',
    file: 'demos/first-light.droneshow.json',
  },
  {
    name: 'The works',
    summary: '400 drones: tilts, swings, gradients, drawings, and models',
    file: 'demos/the-works.droneshow.json',
  },
];
