// Seeded random numbers. The same seed always gives the same sequence,
// so the same project always gives the same formation.

/**
 * Makes a random number generator (the mulberry32 algorithm).
 * @param {number} seed integer
 * @returns {() => number} each call returns a number from 0 (included) to 1 (not included)
 */
export function createRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
