// Turns the project state into a plan: where each drone is at each time.
//
// A show is a list of steps. In each step the fleet flies to a stop and then holds there.
// The stops are the formations in storyboard order, and then the takeoff grid again
// when the show ends with a landing. A formation can lean (tilt), and in its hold it can
// turn, sway, rock, and roll, all at the same time, as one rigid body about its center.
// A light chase can run across it. Each drone has its own light color at each stop: one
// color for the whole formation, a gradient, or the colors of an SVG drawing.
//
// A transition is a list of legs. In each leg every drone flies a straight line, and all
// drones start and stop together. Most transitions have one leg. When the drones would
// pass too close in a direct flight, the fleet first spreads out: each formation grows
// about a point on its axis. The fleet then crosses, and closes up at the new formation.
// The formations grow only as much as an exact check of the crossing needs. See
// `spreadCandidates` and `spreadFactors` for the reasons that this keeps the drones apart.

import { assignTargets } from './assign.js';
import {
  angularSpeedBound,
  closestApproach,
  holdAngles,
  isMoving,
  placeBody,
  planSwing,
  planTiming,
  planTurn,
  poseRotation,
  progressAt,
  rateAt,
  takeoffGrid,
} from './motion.js';
import { objCloud } from './obj.js';
import { closestSpacing, curvePicks, farthestPointSampler, relaxPicks } from './sample.js';
import { builtinCloud, isCurve } from './shapes.js';
import { svgCloud } from './svg.js';

/**
 * One step of the show: a transition to a stop, then a hold at that stop.
 * @typedef {object} Step
 * @property {number} formation index of the formation that the fleet flies to, or -1 for the landing
 * @property {number} start time when the transition starts, seconds
 * @property {number} duration length of the transition, seconds
 * @property {Leg[]} legs the legs of the transition, in time order; at least one
 * @property {number} cross index of the leg that crosses from the old stop to the new one;
 *   the light color changes in this leg
 * @property {number} spreadOutside number of drones that are outside the flight volume
 *   when the fleet spreads out; 0 when the transition has one leg
 * @property {number} hold time at the stop after the transition, seconds
 * @property {Float32Array} from position of each drone when the transition starts, xyz
 * @property {Float32Array} to position of each drone when the transition ends, xyz
 * @property {import('./motion.js').HoldMotion | null} motion the pose and the motion of the formation
 *   in the hold; null for the landing
 * @property {Float32Array | null} body position of each drone in the axes of its formation, about
 *   the formation center, xyz; null for the landing
 * @property {number} centerHeight height of the formation center, meters
 * @property {Chase | null} chase the light chase of the formation in the hold, if any
 * @property {Float32Array} end position of each drone when the hold ends, xyz; `to` when the formation does not turn
 * @property {Float32Array} colors light color of each drone at the stop, red, green, blue, each 0 to 1;
 *   the landing keeps the colors of the last formation
 * @property {number} closestApproach smallest distance between two drones in the transition, meters
 * @property {number} peakSpeed speed of the fastest drone in the step, m/s
 */

/**
 * One straight flight of the whole fleet. All drones start and stop together.
 * @typedef {object} Leg
 * @property {number} start time when the leg starts, seconds from the start of its step
 * @property {import('./motion.js').Timing} timing
 * @property {Float32Array} from position of each drone when the leg starts, xyz
 * @property {Float32Array} to position of each drone when the leg ends, xyz
 * @property {Float32Array} pathLengths flight distance of each drone in the leg, meters
 */

/**
 * @typedef {object} FormationChecks
 * @property {number} spacing smallest distance between two targets, meters
 * @property {number} lowestTarget height of the lowest target at any time in the hold, meters;
 *   negative is below the ground
 * @property {number} outsideVolume number of targets that are outside the flight volume at some time in the hold
 * @property {HoldSpeeds} motion the fastest motion of a drone in the hold
 */

/**
 * The fastest motion of any drone in a hold. All values are 0 when the formation is still.
 * @typedef {object} HoldSpeeds
 * @property {number} speed m/s
 * @property {number} horizontalSpeed m/s
 * @property {number} climbSpeed m/s
 * @property {number} descentSpeed m/s
 * @property {number} acceleration m/s²
 */

/**
 * @typedef {object} Plan
 * @property {number} count number of drones
 * @property {Step[]} steps step k flies to formation k; a landing, if any, is the last step
 * @property {FormationChecks[]} formations one entry per formation
 * @property {number} total length of the timeline, seconds
 * @property {number} lowestTarget height of the lowest target of the show, meters
 * @property {number} closestApproach smallest distance between two drones in any transition, meters
 * @property {number} peakSpeed speed of the fastest drone of the show, m/s
 * @property {Bounds} volume corners of the flight volume
 * @property {number} outsideVolume number of drones that leave the flight volume at some time
 * @property {number} takeoffOutsideVolume number of takeoff grid cells outside the flight volume
 */

/**
 * A light chase: bright bands that travel across a formation in its hold.
 * The drones do not move. Only their brightness changes.
 * @typedef {object} Chase
 * @property {Float32Array} u place of each drone along the path of the bands, 0 to 1; one lap is 0 to 1
 * @property {number} bands number of bright bands on the path at one time
 * @property {number} speed laps per second; a negative speed moves the bands the other way
 */

/**
 * A box with sides along the world axes.
 * @typedef {object} Bounds
 * @property {number[]} low corner with the smallest x, y, and z
 * @property {number[]} high corner with the largest x, y, and z
 */

/**
 * A place where the fleet rests. Its points are in a fixed order that does not depend on
 * the drones: grid order for the takeoff grid, the order of the picks for a formation.
 *
 * The best assignment between two stops does not change when a stop grows, shrinks, or
 * moves: the total cost then changes by a positive factor and by a constant. So the
 * planner solves each assignment on canonical copies of the stops (unit size, centered),
 * and the key of a pose names only its shape and its rotation. A change of formation size,
 * formation height, or grid spacing then needs no new assignment.
 * @typedef {object} Stop
 * @property {number} formation index of the formation, or -1 for the takeoff grid
 * @property {string} family the shape of the stop, without its pose
 * @property {number} scale size of the formation, or spacing of the grid, meters
 * @property {string} key shape and rotation of the stop when the fleet arrives
 * @property {Float32Array} points xyz per point when the fleet arrives
 * @property {Float32Array} unit canonical copy of `points`
 * @property {number} spacing smallest distance between two points, meters; Infinity for one drone
 * @property {import('./motion.js').HoldMotion | null} motion the pose and the motion in the hold;
 *   null for the takeoff grid
 * @property {Float32Array | null} body xyz per point in the axes of the formation, about its center;
 *   null for the takeoff grid
 * @property {number} centerHeight height of the formation center, meters; 0 for the takeoff grid
 * @property {HoldCheck} check the results of the checks of the hold
 * @property {string} leaveKey shape and rotation of the stop when the hold ends
 * @property {Float32Array} leavePoints xyz per point when the hold ends
 * @property {Float32Array} leaveUnit canonical copy of `leavePoints`
 * @property {Chase | null} chase the light chase in the hold, with `u` in point order, if any
 * @property {Float32Array | null} colors light color of each point, red, green, blue; null for the takeoff grid
 */

/**
 * What the checks find in the hold of a stop. A check samples the motion of the hold.
 * @typedef {object} HoldCheck
 * @property {Uint8Array} outside one flag per point: 1 when the point leaves the flight volume
 * @property {number} lowest height of the lowest point at any time in the hold, meters
 * @property {HoldSpeeds} speeds
 */

const DEGREE = Math.PI / 180;

// The route of a drone shows the motion in a hold as short straight lines. The pose changes
// by at most this angle from one line to the next.
const ROUTE_STEP = 10 * DEGREE;
// The checks of a hold look at the pose at least this often: the pose changes by at most this
// angle from one look to the next. A point then leaves its true path by at most 0.015 percent
// of its distance from the center.
const CHECK_STEP = 2 * DEGREE;
// The checks look at most this many times in one hold.
const MAX_CHECK_SAMPLES = 4096;
// The route looks at most this many times in one hold.
const MAX_ROUTE_SAMPLES = 360;
// Time step that the checks use to find speed and acceleration from positions, seconds.
const DERIVATIVE_STEP = 1e-3;
// The acceleration check allows this share of rounding error.
const ACCELERATION_SLACK = 1e-3;
// The share of the acceleration limit that the ramps of a turn use when the formation also
// sways, rocks, or rolls.
const TURN_SHARE_WITH_SWINGS = 0.5;

// Brightness of a drone outside the bands of a light chase. The shape stays visible.
export const CHASE_DIM = 0.12;
// A light chase fades in at the start of the hold and out at its end, over this time, seconds.
const CHASE_FADE = 1;
// How fast the tail of a band fades. A larger number gives a shorter tail.
const CHASE_TAIL = 3;

// The planner keeps this many results of its slow stages. Recent results stay, so undo,
// redo, and a value that goes back and forth need no new work.
const CACHE_LIMIT = 256;

/**
 * Makes a function that builds the plan for a state.
 * The function keeps the recent results of the slow stages (sampling, assignment, and the
 * distance checks) and runs a stage again only for inputs that it has not seen.
 *
 * An assignment that is not in the store starts from the last assignment between the same
 * two shapes, if there is one. That warm start makes a change of rotation, turn, or drone
 * count much faster, and gives the same result as a cold start.
 *
 * The function throws when a shape is not usable, for example an OBJ model with no faces
 * or an SVG drawing with no outlines.
 * It then keeps its stored results, so the next call with the old state is still fast.
 * @returns {((state: import('./state.js').State) => Plan) & {
 *   warmStarts: () => WarmStart[],
 *   addWarmStarts: (entries: WarmStart[]) => void,
 * }}
 */
export function createPlanner() {
  /**
   * @typedef {object} Sample
   * @property {string} name names the shape by its contents, so that a name stays the same
   *   from one page load to the next
   * @property {Float32Array} cloud
   * @property {Float32Array | null} colors color of each point of the cloud, from an SVG drawing;
   *   -1 in each channel for a point with no color; null when the shape has no colors
   * @property {boolean} curve true when the shape is curves, so its cloud is in order along them
   * @property {ReturnType<typeof farthestPointSampler>} sampler
   */
  /** Samples of built-in shapes, by name. @type {Map<string, Sample>} */
  const builtinSamples = new Map();
  /**
   * Samples of imported files, by source. A copy of a formation shares its source, and so its sample.
   * @type {WeakMap<import('./state.js').Source, {seed: number, sample: Sample}>}
   */
  const fileSamples = new WeakMap();

  /**
   * @param {string} name
   * @param {Float32Array} cloud
   * @param {boolean} curve
   * @param {Float32Array | null} [colors]
   * @returns {Sample}
   */
  const newSample = (name, cloud, curve, colors = null) => ({
    name,
    cloud,
    colors,
    curve,
    sampler: farthestPointSampler(cloud),
  });

  /** @param {import('./state.js').Formation} formation */
  function sampleOf({ source, seed }) {
    if (source.type === 'builtin') {
      const name = `builtin:${source.shape}:${seed}`;
      let sample = builtinSamples.get(name);
      if (!sample) {
        sample = newSample(name, builtinCloud(source.shape, seed), isCurve(source.shape));
        builtinSamples.set(name, sample);
      }
      return sample;
    }
    const entry = fileSamples.get(source);
    if (entry && entry.seed === seed) return entry.sample;
    const contents = `${textHash(source.text)}:${source.text.length}:${seed}`;
    let sample;
    if (source.type === 'obj') {
      sample = newSample(`obj:${source.upAxis}:${contents}`, objCloud(source.text, source.upAxis, seed), false);
    } else {
      const { points, colors } = svgCloud(source.text, seed);
      sample = newSample(`svg:${contents}`, points, true, colors);
    }
    fileSamples.set(source, { seed, sample });
    return sample;
  }

  /** Results of the slow stages, by a key made from their inputs, oldest use first. @type {Map<string, any>} */
  const cache = new Map();
  /** @param {string} key @param {any} value */
  const store = (key, value) => {
    cache.delete(key);
    cache.set(key, value);
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
    return value;
  };
  /**
   * @template T
   * @param {string} key
   * @param {() => T} compute
   * @returns {T}
   */
  const remember = (key, compute) => store(key, cache.has(key) ? cache.get(key) : compute());

  /** The assignments of the last plan, as warm starts for a later page load. @type {WarmStart[]} */
  let lastWarmStarts = [];

  /** @param {import('./state.js').State} state */
  const plan = (state) => {
    const { count, gridSpacing, maxAcceleration, minSpacing } = state.fleet;
    // Sample every shape first. A shape that fails then leaves the stored results as they were.
    const shapes = state.formations.map(sampleOf);
    /** @type {WarmStart[]} */
    const warmStarts = [];
    // The targets of each shape: an even walk along curves, or farthest point sampling
    // that farthest point optimization then spreads out on a surface.
    const picks = shapes.map(({ name, cloud, curve, sampler }) =>
      remember(`picks|${name}|${count}`, () =>
        curve ? curvePicks(cloud, count) : relaxPicks(cloud, sampler.order(count)),
      ),
    );

    const volume = volumeBounds(state.volume);
    const gridPoints = takeoffGrid(count, gridSpacing);
    const gridUnit = anchored(takeoffGrid(count, 1));
    /** @type {Stop} */
    const grid = {
      formation: -1,
      family: 'grid',
      scale: gridSpacing,
      key: 'grid',
      points: gridPoints,
      unit: gridUnit,
      spacing: count > 1 ? gridSpacing : Infinity,
      motion: null,
      body: null,
      centerHeight: 0,
      check: stillCheck(gridPoints, count, volume),
      leaveKey: 'grid',
      leavePoints: gridPoints,
      leaveUnit: gridUnit,
      chase: null,
      colors: null,
    };
    const stops = [grid];
    state.formations.forEach((formation, index) => {
      const { name, cloud, colors } = shapes[index];
      // The picked points in unit space, and at the size of the formation: both in the axes
      // of the formation, about its center.
      const unitBody = gather(cloud, picks[index]);
      const body = scaled(unitBody, formation.size);
      const { centerHeight } = formation;
      let radius = 0;
      for (let i = 0; i < body.length; i += 3) radius = Math.max(radius, Math.hypot(body[i], body[i + 1]));
      const hold = formation.holdSeconds;
      // A turn ramp uses the whole acceleration limit. With a swing at the same time, it uses
      // part of the limit, so that the swing has room.
      const swings = formation.swayAngle !== 0 || formation.rockAngle !== 0 || formation.rollAngle !== 0;
      const turnAcceleration = swings ? maxAcceleration * TURN_SHARE_WITH_SWINGS : maxAcceleration;
      /** @type {import('./motion.js').HoldMotion} */
      const motion = {
        hold,
        yaw: formation.yaw * DEGREE,
        forward: formation.tiltForward * DEGREE,
        side: formation.tiltSide * DEGREE,
        turn: planTurn(formation.turnRate * DEGREE, hold, radius, turnAcceleration),
        sway: planSwing(formation.swayAngle * DEGREE, formation.swaySeconds, hold),
        rock: planSwing(formation.rockAngle * DEGREE, formation.rockSeconds, hold),
        roll: planSwing(formation.rollAngle * DEGREE, formation.rollSeconds, hold),
      };
      const { turn } = motion;
      const arrive = poseRotation(motion.yaw, motion.forward, motion.side);
      const points = placeBody(body, arrive, centerHeight);
      const unit = placeBody(unitBody, arrive, 0);
      const family = name;
      const pose = `${formation.tiltForward}:${formation.tiltSide}`;
      const key = `${family}:${formation.yaw}:${pose}`;
      // A formation that turns leaves its hold in a new pose: the same shape at a new yaw.
      // A sway, a rock, and a roll end where they started.
      const leave = turn ? poseRotation(motion.yaw + turn.angle, motion.forward, motion.side) : arrive;
      const checkKey = [
        'hold',
        count,
        key,
        formation.size,
        centerHeight,
        hold,
        formation.turnRate,
        maxAcceleration,
        formation.swayAngle,
        formation.swaySeconds,
        formation.rockAngle,
        formation.rockSeconds,
        formation.rollAngle,
        formation.rollSeconds,
        ...volume.low,
        ...volume.high,
      ].join('|');
      stops.push({
        formation: index,
        family,
        scale: formation.size,
        key,
        points,
        unit,
        // A rotation does not change the spacing. The spacing comes from the canonical copy,
        // so that it is exactly the same for every height.
        spacing: remember(`spacing|${count}|${key}|${formation.size}`, () =>
          closestSpacing(scaled(unit, formation.size), count),
        ),
        motion,
        body,
        centerHeight,
        check: remember(checkKey, () =>
          isMoving(motion) ? movingCheck(body, motion, centerHeight, volume) : stillCheck(points, count, volume),
        ),
        leaveKey: turn ? `${family}:${formation.yaw + turn.angle / DEGREE}:${pose}` : key,
        leavePoints: turn ? placeBody(body, leave, centerHeight) : points,
        leaveUnit: turn ? placeBody(unitBody, leave, 0) : unit,
        chase:
          formation.chase === 'off'
            ? null
            : {
                u: patternPath(body, count, formation.size, formation.chase),
                bands: formation.chaseBands,
                speed: formation.chaseSpeed,
              },
        colors: targetColors(body, count, formation, colors, picks[index]),
      });
    });
    if (state.landAtEnd) stops.push(grid);

    const outside = new Uint8Array(count);
    const takeoffOutsideVolume = markOutside(grid.points, count, volume, outside);

    // slots[drone] is the point of the current stop where the drone is.
    let slots = Int32Array.from({ length: count }, (unused, drone) => drone);
    let from = grid.points;
    let start = 0;
    /** @type {Step[]} */
    const steps = [];
    for (let index = 1; index < stops.length; index++) {
      const previous = stops[index - 1];
      const stop = stops[index];

      // The assignment pairs the points of two stops. It does not depend on which drone
      // is at which point, so one result serves every order of the stops before it.
      const linkKey = `${count}|${previous.leaveKey}|${stop.key}`;
      const familyKey = `family|${previous.family}|${stop.family}`;
      const match = remember(`link|${linkKey}`, () =>
        assignTargets(previous.leaveUnit, stop.unit, count, cache.get(familyKey) ?? null),
      );
      store(familyKey, match);
      warmStarts.push({ key: familyKey, ...match });
      // The closest approach depends on the sizes, but not on the heights. The order of the
      // drones does not matter either, so the key needs no drone order. It comes from the
      // canonical copies, so that rounding gives the same result for every height.
      /** @param {number} leaveScale @param {number} arriveScale */
      const approachAt = (leaveScale, arriveScale) =>
        remember(`approach|${linkKey}|${leaveScale}|${arriveScale}`, () =>
          closestApproach(
            scaled(previous.leaveUnit, leaveScale),
            scaled(gather(stop.unit, match.columnOfRow), arriveScale),
            count,
          ),
        );
      const direct = approachAt(previous.scale, stop.scale);

      slots = slots.map((slot) => match.columnOfRow[slot]);
      const to = gather(stop.points, slots);
      // The landing keeps the colors that the drones have. A formation always comes before it.
      const colors = stop.colors ? gather(stop.colors, slots) : steps[steps.length - 1].colors;
      const end = stop.leavePoints !== stop.points ? gather(stop.leavePoints, slots) : to;
      // A drone leaves the flight volume when its point leaves it at some time in the hold.
      for (let drone = 0; drone < count; drone++) outside[drone] |= stop.check.outside[slots[drone]];

      // The poses that the fleet flies through. One leg joins each pose to the next.
      let poses = [from, to];
      let cross = 0;
      let approach = direct;
      let spreadOutside = 0;
      if (state.spreadToPass && isTooClose(direct, minSpacing)) {
        // The new stop in the order of the old one, for the searches of the crossing.
        const arriveUnit = gather(stop.unit, match.columnOfRow);
        // A spread of a formation is the same shape at a larger size, moved up or down.
        // The searches call the exact check directly, so that they do not fill the store.
        /** @param {number} leave @param {number} arrive @param {number} [stopBelow] */
        const crossApproach = (leave, arrive, stopBelow = 0) =>
          closestApproach(
            scaled(previous.leaveUnit, previous.scale * leave),
            scaled(arriveUnit, stop.scale * arrive),
            count,
            stopBelow,
          );
        const canLeave = previous.formation >= 0;
        const canArrive = stop.formation >= 0;
        /** @param {number[] | null} room */
        const spreadsWith = (room) =>
          spreadCandidates(
            crossApproach,
            direct,
            previous.spacing,
            stop.spacing,
            canLeave,
            canArrive,
            minSpacing,
            room,
          );
        const shapeKey = `${linkKey}|${previous.scale}|${stop.scale}|${minSpacing}`;
        const quick = remember(`spreads|${shapeKey}`, () => spreadsWith(null));
        let best = bestSpread(quick);
        // The quick spreads leave the flight volume. Search the spreads that fit in it: these
        // searches take longer, so they only run when they can help.
        if (best && best.leaving > 0) {
          // Rounded down, so that a spread that fits stays inside after rounding too.
          const room = [canLeave ? spreadLimit(from, count, volume) : 1, canArrive ? spreadLimit(to, count, volume) : 1]
            .map((limit) => Math.floor(limit * 1000) / 1000);
          const fitting = remember(`fitting|${shapeKey}|${room}`, () => spreadsWith(room));
          best = bestSpread([...quick, ...fitting]);
        }
        if (best) {
          ({ poses, cross, approach } = best);
          spreadOutside = best.leaving;
          best.flags.forEach((flag, drone) => {
            outside[drone] |= flag;
          });
        }
      }

      /**
       * Of the spreads that make the flight safe, takes the one that keeps the most drones
       * inside the flight volume, and of those the fastest one. A spread costs time, so it is
       * only worth that time when it makes the flight safe, and every spread in the list does.
       * @param {Spread[]} spreads
       */
      function bestSpread(spreads) {
        let best = null;
        for (const spread of spreads) {
          const poses = [from];
          if (spread.leave > 1) poses.push(spreadOut(from, count, spread.leave, volume));
          if (spread.arrive > 1) poses.push(spreadOut(to, count, spread.arrive, volume));
          poses.push(to);
          const flags = new Uint8Array(count);
          for (const pose of poses.slice(1, -1)) markOutside(pose, count, volume, flags);
          const leaving = flags.reduce((sum, flag) => sum + flag, 0);
          let time = 0;
          for (let leg = 1; leg < poses.length; leg++) {
            time += planTiming(poses[leg - 1], poses[leg], count, state.fleet).duration;
          }
          if (!best || leaving < best.leaving || (leaving === best.leaving && time < best.time)) {
            best = { poses, cross: spread.leave > 1 ? 1 : 0, approach: spread.approach, flags, leaving, time };
          }
        }
        return best;
      }

      /** @type {Leg[]} */
      const legs = [];
      let duration = 0;
      let peakSpeed = 0;
      for (let index = 1; index < poses.length; index++) {
        const legFrom = poses[index - 1];
        const legTo = poses[index];
        const pathLengths = new Float32Array(count);
        let longest = 0;
        for (let drone = 0; drone < count; drone++) {
          const o = drone * 3;
          pathLengths[drone] = Math.hypot(
            legTo[o] - legFrom[o],
            legTo[o + 1] - legFrom[o + 1],
            legTo[o + 2] - legFrom[o + 2],
          );
          longest = Math.max(longest, pathLengths[drone]);
        }
        const timing = planTiming(legFrom, legTo, count, state.fleet);
        legs.push({ start: duration, timing, from: legFrom, to: legTo, pathLengths });
        duration += timing.duration;
        peakSpeed = Math.max(peakSpeed, longest * timing.peakRate);
      }

      const hold = stop.formation >= 0 ? state.formations[stop.formation].holdSeconds : 0;
      steps.push({
        formation: stop.formation,
        start,
        duration,
        legs,
        cross,
        spreadOutside,
        hold,
        from,
        to,
        motion: stop.motion,
        body: stop.body && gather(stop.body, slots),
        centerHeight: stop.centerHeight,
        chase: stop.chase && { ...stop.chase, u: gatherValues(stop.chase.u, slots) },
        end,
        colors,
        closestApproach: approach,
        peakSpeed: Math.max(peakSpeed, stop.check.speeds.speed),
      });
      start += duration + hold;
      from = end;
    }

    const formations = state.formations.map((formation, index) => {
      const { spacing, check } = stops[index + 1];
      return {
        spacing,
        lowestTarget: check.lowest,
        outsideVolume: check.outside.reduce((sum, flag) => sum + flag, 0),
        motion: check.speeds,
      };
    });

    lastWarmStarts = warmStarts;
    return {
      count,
      steps,
      formations,
      total: start,
      lowestTarget: Math.min(...formations.map((checks) => checks.lowestTarget)),
      closestApproach: Math.min(...steps.map((step) => step.closestApproach)),
      peakSpeed: Math.max(...steps.map((step) => step.peakSpeed)),
      volume,
      outsideVolume: outside.reduce((sum, flag) => sum + flag, 0),
      takeoffOutsideVolume,
    };
  };

  return Object.assign(plan, {
    /**
     * The assignments of the last plan. A later page load can start from them.
     * @returns {WarmStart[]}
     */
    warmStarts: () => lastWarmStarts,
    /**
     * Adds assignments to start from, for example from an earlier page load. The solver
     * checks each pair it keeps, so a start that does not fit only costs time.
     * @param {WarmStart[]} entries
     */
    addWarmStarts(entries) {
      for (const { key, columnOfRow, price } of entries) {
        const valid =
          key.startsWith('family|') &&
          columnOfRow.length === price.length &&
          columnOfRow.every((column) => column >= 0 && column < columnOfRow.length) &&
          price.every(Number.isFinite);
        if (valid) store(key, { columnOfRow, price });
      }
    },
  });
}

/**
 * An assignment between two shapes, for a warm start.
 * @typedef {object} WarmStart
 * @property {string} key names the two shapes
 * @property {Int32Array} columnOfRow
 * @property {Float64Array} price
 */

/**
 * A 53-bit hash of a text (cyrb53). It names an imported file by its contents.
 * @param {string} text
 * @returns {string}
 */
function textHash(text) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * Moves points so that the first one is at the origin. The canonical copy of the takeoff
 * grid uses this. A change of drone count moves the centered grid by half a cell, but in
 * this copy each drone keeps its place, so a warm start from the old count stays good.
 * A move of a whole stop does not change the best assignment.
 * @param {Float32Array} points xyz per point; the function changes them
 * @returns {Float32Array} `points`
 */
function anchored(points) {
  const [x, y, z] = points.slice(0, 3);
  for (let i = 0; i < points.length; i += 3) {
    points[i] -= x;
    points[i + 1] -= y;
    points[i + 2] -= z;
  }
  return points;
}

/**
 * A copy of points, each multiplied by one factor.
 * @param {Float32Array} points xyz per point
 * @param {number} factor
 * @returns {Float32Array}
 */
function scaled(points, factor) {
  return points.map((value) => value * factor);
}

/**
 * Picks points from a list.
 * @param {Float32Array} points xyz per point
 * @param {Int32Array} indices index of the point to take, per output position
 * @returns {Float32Array} xyz per output position
 */
function gather(points, indices) {
  const out = new Float32Array(indices.length * 3);
  for (let i = 0; i < indices.length; i++) {
    out[i * 3] = points[indices[i] * 3];
    out[i * 3 + 1] = points[indices[i] * 3 + 1];
    out[i * 3 + 2] = points[indices[i] * 3 + 2];
  }
  return out;
}

/**
 * Picks one value per output position from a list.
 * @param {Float32Array} values one value per point
 * @param {Int32Array} indices index of the value to take, per output position
 */
function gatherValues(values, indices) {
  return Float32Array.from(indices, (index) => values[index]);
}

/**
 * Places each target of a formation on the path of a pattern: a light chase or a gradient.
 * The path uses the axes of the formation itself, before its yaw and its tilt, so a turned,
 * tilted, or moving formation keeps its pattern, like paint.
 *
 * - Around: the angle around the formation center, in the plane that faces the audience.
 *   0 is at the top, and the angle grows clockwise as the audience sees it.
 * - Rising: the height, from the lowest target (0) to the highest (1).
 * - Across: the side position, from the left end as the audience sees it (0) to the right (1).
 * - Outward: the distance from the formation center, from the nearest target (0) to the
 *   farthest (1).
 *
 * When all targets are at the same place on the path, for example the height of a flat
 * shape on the ground plane, each target gets 0.
 * @param {Float32Array} body xyz per target, in the axes of the formation, about its center
 * @param {number} count
 * @param {number} size size of the formation, meters
 * @param {'around' | 'rising' | 'across' | 'outward'} pattern
 * @returns {Float32Array} one value per target, 0 to 1
 */
function patternPath(body, count, size, pattern) {
  const side = new Float32Array(count);
  const up = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    side[i] = body[i * 3];
    up[i] = body[i * 3 + 2];
  }
  if (pattern === 'around') {
    return side.map((x, i) => {
      const turn = Math.atan2(x, up[i]) / (2 * Math.PI);
      return turn < 0 ? turn + 1 : turn;
    });
  }
  const values =
    pattern === 'rising'
      ? up
      : pattern === 'across'
        ? side
        : Float32Array.from({ length: count }, (unused, i) => Math.hypot(body[i * 3], body[i * 3 + 1], body[i * 3 + 2]));
  let low = Infinity;
  let high = -Infinity;
  for (const value of values) {
    low = Math.min(low, value);
    high = Math.max(high, value);
  }
  // A range this small is only rounding error, for example on the surface of a sphere.
  const range = high - low > size * PATTERN_FLAT ? high - low : 0;
  return values.map((value) => (range > 0 ? (value - low) / range : 0));
}

// A pattern whose range is less than this share of the formation size has no range.
const PATTERN_FLAT = 1e-4;

/**
 * Converts a color.
 * @param {string} hex color as `#rrggbb`
 * @returns {number[]} red, green, blue, each 0 to 1
 */
export function hexToRgb(hex) {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

/**
 * The light color of each target of a formation.
 *
 * - Solid: the formation color.
 * - A gradient: a blend from the formation color to the second color, along the path of the
 *   pattern (see `patternPath`).
 * - Drawing colors: the color of the outline that the target comes from. A drone light is
 *   brightest at full power, and a drawing is made for paper or a screen, so each color is
 *   scaled up until its strongest channel is full. Black and gray become white. A target on
 *   an outline with no color gets the formation color.
 * @param {Float32Array} body xyz per target, in the axes of the formation, about its center
 * @param {number} count
 * @param {import('./state.js').Formation} formation
 * @param {Float32Array | null} cloudColors color of each point of the candidate cloud, if any
 * @param {Uint32Array} picks the point of the cloud that each target comes from
 * @returns {Float32Array} red, green, blue per target
 */
function targetColors(body, count, formation, cloudColors, picks) {
  const first = hexToRgb(formation.color);
  const colors = new Float32Array(count * 3);
  const pattern = formation.colorPattern;
  if (pattern === 'rising' || pattern === 'across' || pattern === 'outward') {
    const second = hexToRgb(formation.secondColor);
    const path = patternPath(body, count, formation.size, pattern);
    for (let i = 0; i < count; i++) {
      for (let channel = 0; channel < 3; channel++) {
        colors[i * 3 + channel] = first[channel] + path[i] * (second[channel] - first[channel]);
      }
    }
    return colors;
  }
  for (let i = 0; i < count; i++) {
    const o = picks[i] * 3;
    if (pattern !== 'drawing' || !cloudColors || cloudColors[o] < 0) {
      colors.set(first, i * 3);
      continue;
    }
    const strongest = Math.max(cloudColors[o], cloudColors[o + 1], cloudColors[o + 2]);
    for (let channel = 0; channel < 3; channel++) {
      colors[i * 3 + channel] = strongest > 0 ? cloudColors[o + channel] / strongest : 1;
    }
  }
  return colors;
}

/**
 * @param {import('./state.js').Volume} volume
 * @returns {Bounds}
 */
export function volumeBounds(volume) {
  const half = volume.size / 2;
  return {
    low: [volume.x - half, volume.y - half, volume.z],
    high: [volume.x + half, volume.y + half, volume.z + volume.size],
  };
}

/**
 * Tells whether a position is inside a box. A position on a face of the box is inside.
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {Bounds} bounds
 */
function isInside(x, y, z, { low, high }) {
  return (
    x >= low[0] - ROUNDING_SLACK &&
    x <= high[0] + ROUNDING_SLACK &&
    y >= low[1] - ROUNDING_SLACK &&
    y <= high[1] + ROUNDING_SLACK &&
    z >= low[2] - ROUNDING_SLACK &&
    z <= high[2] + ROUNDING_SLACK
  );
}

/**
 * Sets the flag of each drone that is outside a box.
 * @param {Float32Array} positions xyz per drone
 * @param {number} count
 * @param {Bounds} bounds
 * @param {Uint8Array} flags one flag per drone; the function only sets flags
 * @returns {number} number of drones outside the box
 */
function markOutside(positions, count, bounds, flags) {
  let outside = 0;
  for (let drone = 0; drone < count; drone++) {
    if (!isInside(positions[drone * 3], positions[drone * 3 + 1], positions[drone * 3 + 2], bounds)) {
      flags[drone] = 1;
      outside++;
    }
  }
  return outside;
}

/**
 * Counts the drones that leave a box at some time.
 * A drone flies straight lines from pose to pose, so it stays in the box exactly when
 * each of its poses is in the box.
 * @param {Float32Array[]} stops the positions of all drones at each stop, xyz per drone
 * @param {number} count
 * @param {Bounds} bounds
 */
export function countOutside(stops, count, bounds) {
  const flags = new Uint8Array(count);
  for (const positions of stops) markOutside(positions, count, bounds, flags);
  return flags.reduce((sum, flag) => sum + flag, 0);
}

/** @type {HoldSpeeds} */
const NO_SPEEDS = { speed: 0, horizontalSpeed: 0, climbSpeed: 0, descentSpeed: 0, acceleration: 0 };

/**
 * The checks of a hold in which the points do not move.
 * @param {Float32Array} points xyz per point
 * @param {number} count
 * @param {Bounds} bounds the flight volume
 * @returns {HoldCheck}
 */
function stillCheck(points, count, bounds) {
  const outside = new Uint8Array(count);
  markOutside(points, count, bounds, outside);
  let lowest = Infinity;
  for (let i = 0; i < count; i++) lowest = Math.min(lowest, points[i * 3 + 2]);
  return { outside, lowest, speeds: NO_SPEEDS };
}

/**
 * Times in a hold at which to look at the pose. From one time to the next the pose changes
 * by at most one angle, and each swing gets at least `SWING_SAMPLES` looks. The times also
 * include the ends of the ramps of a turn, where the turn is fastest, and times just inside
 * the ramps, where its acceleration is largest.
 * @param {import('./motion.js').HoldMotion} motion
 * @param {number} step largest change of the pose, radians
 * @param {number} limit largest number of intervals
 * @returns {number[]} seconds from the start of the hold, in order, from 0 to the end of the hold
 */
function holdTimes(motion, step, limit) {
  const { hold, turn } = motion;
  const cycles = Math.max(...[motion.sway, motion.rock, motion.roll].map((swing) => swing?.cycles ?? 0));
  const wanted = Math.max(Math.ceil((angularSpeedBound(motion) * hold) / step), cycles * SWING_SAMPLES);
  const intervals = Math.min(limit, Math.max(1, wanted));
  const times = Array.from({ length: intervals + 1 }, (unused, k) => (k / intervals) * hold);
  if (turn) {
    const ramp = turn.timing.rampTime;
    // The ends of the ramps, where the turn is fastest, and just inside them, where the
    // acceleration is largest.
    const inside = Math.max(0, ramp - 2 * DERIVATIVE_STEP);
    times.push(ramp, hold - ramp, inside, hold - inside);
  }
  return [...new Set(times)].sort((a, b) => a - b);
}

// A look at the pose at least this many times in each swing finds the fastest motion of the
// swing to about 0.5 percent.
const SWING_SAMPLES = 32;

/**
 * The checks of a hold in which the formation moves. The check looks at the pose many
 * times (see `CHECK_STEP`). At each time it finds the position of each point, and from the
 * positions a short time before and after, its velocity and its acceleration.
 * @param {Float32Array} body xyz per point, in the axes of the formation, about its center
 * @param {import('./motion.js').HoldMotion} motion
 * @param {number} centerHeight meters
 * @param {Bounds} bounds the flight volume
 * @returns {HoldCheck}
 */
function movingCheck(body, motion, centerHeight, bounds) {
  const count = body.length / 3;
  const outside = new Uint8Array(count);
  let lowest = Infinity;
  const speeds = { ...NO_SPEEDS };
  const { hold } = motion;
  /** @param {number} time */
  const rotationAt = (time) => poseRotation(...holdAngles(motion, Math.min(hold, Math.max(0, time))));
  for (const time of holdTimes(motion, CHECK_STEP, MAX_CHECK_SAMPLES)) {
    const before = Math.max(0, time - DERIVATIVE_STEP);
    const after = Math.min(hold, time + DERIVATIVE_STEP);
    const [a, b, c, d, e, f, g, h, k] = rotationAt(time);
    const r0 = rotationAt(before);
    const r1 = rotationAt(after);
    for (let i = 0; i < count; i++) {
      const bx = body[i * 3];
      const by = body[i * 3 + 1];
      const bz = body[i * 3 + 2];
      const x = a * bx + b * by + c * bz;
      const y = d * bx + e * by + f * bz;
      const z = g * bx + h * by + k * bz + centerHeight;
      if (!isInside(x, y, z, bounds)) outside[i] = 1;
      lowest = Math.min(lowest, z);
      // Positions a short time before and after.
      const x0 = r0[0] * bx + r0[1] * by + r0[2] * bz;
      const y0 = r0[3] * bx + r0[4] * by + r0[5] * bz;
      const z0 = r0[6] * bx + r0[7] * by + r0[8] * bz + centerHeight;
      const x1 = r1[0] * bx + r1[1] * by + r1[2] * bz;
      const y1 = r1[3] * bx + r1[4] * by + r1[5] * bz;
      const z1 = r1[6] * bx + r1[7] * by + r1[8] * bz + centerHeight;
      const span = after - before;
      const vx = (x1 - x0) / span;
      const vy = (y1 - y0) / span;
      const vz = (z1 - z0) / span;
      speeds.speed = Math.max(speeds.speed, Math.hypot(vx, vy, vz));
      speeds.horizontalSpeed = Math.max(speeds.horizontalSpeed, Math.hypot(vx, vy));
      speeds.climbSpeed = Math.max(speeds.climbSpeed, vz);
      speeds.descentSpeed = Math.max(speeds.descentSpeed, -vz);
      if (time > before && time < after) {
        // The change of velocity from the first half of the span to the second half.
        const ax = ((x1 - x) / (after - time) - (x - x0) / (time - before)) / (span / 2);
        const ay = ((y1 - y) / (after - time) - (y - y0) / (time - before)) / (span / 2);
        const az = ((z1 - z) / (after - time) - (z - z0) / (time - before)) / (span / 2);
        speeds.acceleration = Math.max(speeds.acceleration, Math.hypot(ax, ay, az));
      }
    }
  }
  return { outside, lowest, speeds };
}

// If the closest spacing at both ends of a direct flight is D, the closest approach in
// flight is at least D ÷ √2 (see `spreadFactors`). Without a spread, a stop needs this much
// more than the minimum spacing, so that the drones also keep the minimum spacing in flight.
export const FLIGHT_MARGIN = Math.SQRT2;

/**
 * Smallest formation size that keeps the minimum spacing, also in the flights to and
 * from the formation. The targets end up `margin` × the minimum spacing apart.
 *
 * - When the fleet spreads out to pass, the targets only need the minimum spacing, so the
 *   margin is 1.
 * - Without a spread, the margin is `FLIGHT_MARGIN`. The flights are then safe when the
 *   stops before and after the formation have the same margin.
 *
 * Spacing grows in proportion to size.
 * @param {number} size current size, meters
 * @param {number} spacing current smallest distance between two targets, meters
 * @param {number} minSpacing meters
 * @param {number} [margin] share of the minimum spacing that the targets get
 * @returns {number | null} null when the spacing gives no answer, for example with one drone
 */
export function fitSize(size, spacing, minSpacing, margin = FLIGHT_MARGIN) {
  if (!Number.isFinite(spacing) || spacing <= 0) return null;
  // Round up to the next centimeter, so the result is on the safe side.
  return Math.ceil((size * minSpacing * margin * 100) / spacing) / 100;
}

// A spread aims this much above the minimum spacing, so that rounding cannot break it.
const SPREAD_MARGIN = 1.01;
// A formation never spreads to more than this many times its size.
export const MAX_SPREAD = 3;

/**
 * How much each end of a transition spreads out, so that the drones keep the minimum
 * spacing when they cross from one stop to the next.
 *
 * Take two drones. Let a be the offset from one to the other at the start of the flight,
 * and b the offset at the end. The assignment is the best one, so a swap of the two targets
 * gives no shorter total. From this, a · b ≥ 0. In flight the offset is (1 − t) a + t b, and
 * its length is at least |a| |b| ÷ √(|a|² + |b|²). So if the spacing is A at the start and
 * B at the end, the drones stay at least A B ÷ √(A² + B²) apart.
 *
 * A spread does not change the assignment: the best assignment stays the best when a stop
 * grows or moves. The function finds spacings A and B with 1 ÷ A² + 1 ÷ B² ≤ 1 ÷ m², where m is
 * the minimum spacing plus a small margin. It grows the ends as little as it can, and grows
 * both ends evenly when both must grow. Only a formation can spread; the takeoff grid stays
 * on the ground. When a spread of `MAX_SPREAD` is not sufficient, the factor stops there, and
 * the checks of the plan show the problem.
 * @param {number} leaveSpacing spacing of the stop that the fleet leaves, meters
 * @param {number} arriveSpacing spacing of the stop that the fleet flies to, meters
 * @param {boolean} canLeave true when the stop that the fleet leaves is a formation
 * @param {boolean} canArrive true when the stop that the fleet flies to is a formation
 * @param {number} minSpacing meters
 * @returns {number[]} spread factor of the stop that the fleet leaves, and of the stop that
 *   it flies to; 1 for no spread
 */
export function spreadFactors(leaveSpacing, arriveSpacing, canLeave, canArrive, minSpacing) {
  const m = minSpacing * SPREAD_MARGIN;
  /** Spacing that one end needs when the other end has spacing `other`. @param {number} other */
  const needs = (other) => (other > m ? 1 / Math.sqrt(1 / (m * m) - 1 / (other * other)) : Infinity);
  // Both ends at this spacing are just safe.
  const even = Math.SQRT2 * m;
  let leave = leaveSpacing;
  let arrive = arriveSpacing;
  if (!canArrive) leave = Math.max(leave, needs(arrive));
  else if (!canLeave) arrive = Math.max(arrive, needs(leave));
  else if (leave >= even) arrive = Math.max(arrive, needs(leave));
  else if (arrive >= even) leave = Math.max(leave, needs(arrive));
  else leave = arrive = even;
  /** @param {number} spacing @param {number} target @param {boolean} can */
  const factor = (spacing, target, can) =>
    can && spacing > 0 && Number.isFinite(spacing) ? Math.min(MAX_SPREAD, Math.max(1, target / spacing)) : 1;
  return [factor(leaveSpacing, leave, canLeave), factor(arriveSpacing, arrive, canArrive)];
}

// A search for the smallest spread stops when it knows the factor this closely.
const SPREAD_PRECISION = 0.01;

/**
 * @typedef {object} Spread
 * @property {number} leave spread factor of the stop that the fleet leaves; 1 for no spread
 * @property {number} arrive spread factor of the stop that the fleet flies to; 1 for no spread
 * @property {number} approach closest approach in all legs of the spread flight, meters
 */

/**
 * Lists the spreads that make a flight safe. Each one has been checked: its closest approach
 * comes from an exact search of the crossing, and the legs that only spread out or close up
 * are closest at their small end.
 *
 * - Between two formations, both grow by the same factor f. Every offset between two drones
 *   in the crossing is then f times the offset in the direct flight, because the moves of
 *   the two spread points cancel out. So the closest approach is f times that of the direct
 *   flight, and f = m ÷ (closest approach of the direct flight) is just enough, where m is
 *   the minimum spacing plus a small margin.
 * - In a takeoff or a landing, only the formation grows. The closest approach then has no
 *   simple formula, so a bisection finds the smallest factor that a check passes.
 * - The spread of `spreadFactors` is also in the list. It comes from a bound that holds for
 *   every pair of stops, so it is often larger than necessary, but it can be the faster
 *   flight when only one end needs to grow.
 *
 * With `room`, the list holds spreads that fit in the flight volume instead, found by
 * bisection: one stop grows alone, or one stop grows as far as the volume lets it and the
 * other as far as it must. These searches take longer, so the planner only runs them when
 * every quick spread leaves the volume.
 *
 * A spread cannot help when a stop has crowded points itself. The list is then empty.
 * @param {(leave: number, arrive: number, stopBelow?: number) => number} crossApproach closest
 *   approach, meters, of the flight from the old stop grown by `leave` to the new stop grown
 *   by `arrive`; with `stopBelow`, any value below it when some pair comes closer than it
 * @param {number} direct closest approach of the direct flight, meters
 * @param {number} leaveSpacing spacing of the stop that the fleet leaves, meters
 * @param {number} arriveSpacing spacing of the stop that the fleet flies to, meters
 * @param {boolean} canLeave true when the stop that the fleet leaves is a formation
 * @param {boolean} canArrive true when the stop that the fleet flies to is a formation
 * @param {number} minSpacing meters
 * @param {number[] | null} [room] the largest factors that keep each stop inside the flight
 *   volume (see `spreadLimit`); null for the quick spreads
 * @returns {Spread[]}
 */
export function spreadCandidates(
  crossApproach,
  direct,
  leaveSpacing,
  arriveSpacing,
  canLeave,
  canArrive,
  minSpacing,
  room = null,
) {
  const target = minSpacing * SPREAD_MARGIN;
  // A stop with crowded points cannot grow: its spread leg would be too close at its small
  // end. So no search tries it.
  canLeave = canLeave && !isTooClose(leaveSpacing, minSpacing);
  canArrive = canArrive && !isTooClose(arriveSpacing, minSpacing);
  // A search only needs to know if the crossing keeps the distance, so its checks stop at
  // the first pair that comes too close. A spread in the list gets one full check.
  /** @param {number} leave @param {number} arrive */
  const passes = (leave, arrive) => crossApproach(leave, arrive, target) >= target;

  /** @type {number[][]} */
  const factors = [];
  if (room) {
    const [leaveRoom, arriveRoom] = room.map((limit) => Math.min(MAX_SPREAD, limit));
    if (canLeave) factors.push([smallestFactor((factor) => passes(factor, 1), leaveRoom), 1]);
    if (canArrive) factors.push([1, smallestFactor((factor) => passes(1, factor), arriveRoom)]);
    if (canLeave && canArrive) {
      factors.push([leaveRoom, smallestFactor((factor) => passes(leaveRoom, factor), arriveRoom)]);
      factors.push([smallestFactor((factor) => passes(factor, arriveRoom), leaveRoom), arriveRoom]);
    }
  } else {
    if (canLeave && canArrive) {
      if (direct > 0) {
        const even = Math.min(MAX_SPREAD, Math.max(1, target / direct));
        factors.push([even, even]);
      }
    } else if (canLeave) {
      factors.push([smallestFactor((factor) => passes(factor, 1)), 1]);
    } else if (canArrive) {
      factors.push([1, smallestFactor((factor) => passes(1, factor))]);
    }
    factors.push(spreadFactors(leaveSpacing, arriveSpacing, canLeave, canArrive, minSpacing));
  }

  /** @type {Spread[]} */
  const safe = [];
  for (const [leave, arrive] of factors) {
    if (!Number.isFinite(leave) || !Number.isFinite(arrive) || (leave === 1 && arrive === 1)) continue;
    if (safe.some((spread) => spread.leave === leave && spread.arrive === arrive)) continue;
    // A leg that only spreads out or closes up moves each drone straight away from one
    // point. The drones then only get farther apart, so the leg is closest at its small end.
    // A stop with crowded points fails here, before the long check of the crossing.
    const legs = Math.min(leave > 1 ? leaveSpacing : Infinity, arrive > 1 ? arriveSpacing : Infinity);
    if (isTooClose(legs, minSpacing)) continue;
    const approach = Math.min(crossApproach(leave, arrive), legs);
    if (!isTooClose(approach, minSpacing)) safe.push({ leave, arrive, approach });
  }
  return safe;
}

/**
 * The smallest spread factor that passes a check, by bisection. The upper end of the search
 * always passes the check, so the result passes even where the closest approach does not
 * grow steadily with the factor.
 * @param {(factor: number) => boolean} passes true when the flight keeps the distance at a factor
 * @param {number} [largest] the largest factor to try
 * @returns {number} the factor, or NaN when even the largest factor does not pass
 */
function smallestFactor(passes, largest = MAX_SPREAD) {
  let low = 1;
  let high = largest;
  if (high <= low || !passes(high)) return NaN;
  while (high - low > SPREAD_PRECISION) {
    const middle = (low + high) / 2;
    if (passes(middle)) high = middle;
    else low = middle;
  }
  return high;
}

/**
 * The largest spread factor that keeps a fleet inside the flight volume, as `spreadOut`
 * grows it. Across, each drone moves straight away from the vertical axis, so each one
 * limits the factor by its room to the side of the volume. Up and down, `spreadOut` moves
 * the spread point to fit, so only the height of the fleet against the height of the
 * volume limits it.
 * @param {Float32Array} positions xyz per drone
 * @param {number} count
 * @param {Bounds} bounds the flight volume
 * @returns {number} at least 1; 1 when the fleet cannot grow at all, also when it is outside already
 */
export function spreadLimit(positions, count, { low, high }) {
  let limit = MAX_SPREAD;
  let lowest = Infinity;
  let highest = -Infinity;
  for (let drone = 0; drone < count; drone++) {
    for (let axis = 0; axis < 2; axis++) {
      const value = positions[drone * 3 + axis];
      if (value > 0) limit = Math.min(limit, high[axis] / value);
      else if (value < 0) limit = Math.min(limit, low[axis] / value);
    }
    lowest = Math.min(lowest, positions[drone * 3 + 2]);
    highest = Math.max(highest, positions[drone * 3 + 2]);
  }
  if (highest > lowest) limit = Math.min(limit, (high[2] - low[2]) / (highest - lowest));
  return Math.max(1, limit);
}

/**
 * Grows the fleet about a point on the vertical axis through the origin. That axis is the
 * axis of every formation. Each drone moves straight away from the point, so the drones
 * only get farther apart.
 *
 * The point is at the middle height of the fleet, so the fleet grows evenly up and down.
 * The point moves up or down when the grown fleet would otherwise go below the floor of the
 * flight volume or above its top. When it cannot fit, the floor wins: no drone goes lower
 * than both the floor and the lowest drone before the spread.
 * @param {Float32Array} positions xyz per drone
 * @param {number} count
 * @param {number} factor 1 for no change
 * @param {Bounds} bounds the flight volume
 * @returns {Float32Array} a new list, xyz per drone
 */
export function spreadOut(positions, count, factor, bounds) {
  let lowest = Infinity;
  let highest = -Infinity;
  for (let drone = 0; drone < count; drone++) {
    lowest = Math.min(lowest, positions[drone * 3 + 2]);
    highest = Math.max(highest, positions[drone * 3 + 2]);
  }
  let pivot = (lowest + highest) / 2;
  if (factor > 1) {
    // A height z goes to pivot + (z − pivot) × factor. A higher pivot moves every drone lower.
    const floor = Math.min(lowest, bounds.low[2]);
    const top = Math.max(highest, bounds.high[2]);
    pivot = Math.max(pivot, (highest * factor - top) / (factor - 1));
    pivot = Math.min(pivot, (lowest * factor - floor) / (factor - 1));
  }
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count * 3; i += 3) {
    out[i] = positions[i] * factor;
    out[i + 1] = positions[i + 1] * factor;
    out[i + 2] = pivot + (positions[i + 2] - pivot) * factor;
  }
  return out;
}

// Positions are 32-bit numbers, so the checks allow half a millimeter of rounding error.
const ROUNDING_SLACK = 0.0005;

/**
 * True when a distance breaks the minimum spacing.
 * @param {number} distance meters
 * @param {number} minSpacing meters
 */
export function isTooClose(distance, minSpacing) {
  return distance < minSpacing - ROUNDING_SLACK;
}

/**
 * True when a height is below the ground.
 * @param {number} height meters
 */
export function isBelowGround(height) {
  return height < -ROUNDING_SLACK;
}

/**
 * Lists what is wrong with one formation, in words for the user.
 * @param {Plan} plan
 * @param {number} formation index of the formation
 * @param {import('./state.js').Fleet} limits the fleet limits
 * @returns {string[]} empty when the formation passes every check
 */
export function formationProblems(plan, formation, limits) {
  const checks = plan.formations[formation];
  const step = plan.steps[formation];
  const problems = [];
  if (isTooClose(checks.spacing, limits.minSpacing)) {
    problems.push('Targets are closer than the minimum spacing.');
  }
  if (isBelowGround(checks.lowestTarget)) problems.push('Targets are below the ground.');
  if (checks.outsideVolume > 0) problems.push('Targets are outside the flight volume.');
  if (isTooClose(step.closestApproach, limits.minSpacing)) {
    problems.push('Drones come too close in the transition to this formation.');
  }
  if (step.spreadOutside > 0) {
    problems.push('Drones leave the flight volume when they spread out to pass.');
  }
  const { motion } = checks;
  if (motion.horizontalSpeed > limits.maxHorizontalSpeed + ROUNDING_SLACK) {
    problems.push('The motion in the hold is faster than the maximum horizontal speed.');
  }
  if (
    motion.climbSpeed > limits.maxClimbSpeed + ROUNDING_SLACK ||
    motion.descentSpeed > limits.maxDescentSpeed + ROUNDING_SLACK
  ) {
    problems.push('The motion in the hold climbs or descends faster than the limits.');
  }
  if (motion.acceleration > limits.maxAcceleration * (1 + ACCELERATION_SLACK)) {
    problems.push('The motion in the hold accelerates more than the maximum acceleration.');
  }
  return problems;
}

const LANDING_PROBLEM = 'Drones come too close in the landing.';
const LANDING_SPREAD_PROBLEM = 'Drones leave the flight volume when they spread out before the landing.';
const TAKEOFF_PROBLEM = 'Takeoff grid cells are outside the flight volume.';

/**
 * Lists every problem of the show, in words for the user.
 * @param {import('./state.js').State} state
 * @param {Plan} plan
 * @returns {string[]}
 */
export function showProblems(state, plan) {
  const problems = [];
  if (plan.takeoffOutsideVolume > 0) problems.push(TAKEOFF_PROBLEM);
  state.formations.forEach((formation, index) => {
    for (const problem of formationProblems(plan, index, state.fleet)) {
      problems.push(`Formation ${index + 1}: ${problem}`);
    }
  });
  const last = plan.steps.at(-1);
  if (last.formation < 0) problems.push(...landingProblems(last, state.fleet.minSpacing));
  return problems;
}

/**
 * Lists what is wrong with the landing, in words for the user.
 * @param {Step} step the landing step
 * @param {number} minSpacing meters
 * @returns {string[]}
 */
export function landingProblems(step, minSpacing) {
  const problems = [];
  if (isTooClose(step.closestApproach, minSpacing)) problems.push(LANDING_PROBLEM);
  if (step.spreadOutside > 0) problems.push(LANDING_SPREAD_PROBLEM);
  return problems;
}

/**
 * Finds the step that a time is in.
 * @param {Plan} plan
 * @param {number} time seconds from the start of the timeline
 * @returns {number} index in `plan.steps`
 */
export function stepAt(plan, time) {
  let index = 0;
  while (index + 1 < plan.steps.length && time >= plan.steps[index + 1].start) index++;
  return index;
}

/**
 * Time when the fleet arrives at a formation and the hold starts.
 * @param {Plan} plan
 * @param {number} formation index of the formation
 * @returns {number} seconds from the start of the timeline
 */
export function holdStart(plan, formation) {
  const step = plan.steps[formation];
  return step.start + step.duration;
}

/**
 * Finds the leg of a transition that a time is in.
 * @param {Step} step
 * @param {number} offset seconds from the start of the step
 * @returns {Leg}
 */
function legAt(step, offset) {
  let index = 0;
  while (index + 1 < step.legs.length && offset >= step.legs[index + 1].start) index++;
  return step.legs[index];
}

/**
 * Writes the position of every drone at one time.
 * @param {Plan} plan
 * @param {number} time seconds from the start of the timeline
 * @param {Float32Array} out xyz per drone; length at least `plan.count × 3`
 */
export function positionsAt(plan, time, out) {
  const step = plan.steps[stepAt(plan, time)];
  const offset = time - step.start;
  const held = offset - step.duration;
  if (held >= 0) {
    // In the hold a drone is exactly on its target, or on its path as the formation moves.
    if (held < step.hold && step.motion && isMoving(step.motion)) {
      placeBody(step.body, poseRotation(...holdAngles(step.motion, held)), step.centerHeight, out);
    } else {
      out.set(held < step.hold ? step.to : step.end);
    }
    return;
  }
  const { start, timing, from, to } = legAt(step, offset);
  const progress = progressAt(timing, offset - start);
  for (let i = 0; i < plan.count * 3; i++) {
    out[i] = from[i] + progress * (to[i] - from[i]);
  }
}

/**
 * Speed of one drone at one time.
 * @param {Plan} plan
 * @param {number} drone index
 * @param {number} time seconds from the start of the timeline
 * @returns {number} m/s
 */
export function speedAt(plan, drone, time) {
  const step = plan.steps[stepAt(plan, time)];
  const offset = time - step.start;
  const held = offset - step.duration;
  if (held < 0) {
    const leg = legAt(step, offset);
    return rateAt(leg.timing, offset - leg.start) * leg.pathLengths[drone];
  }
  const { motion, body } = step;
  // The motion starts and ends at rest.
  if (!motion || !isMoving(motion) || held <= 0 || held >= step.hold) return 0;
  // The distance that the drone moves in a short time before and after.
  const before = Math.max(0, held - DERIVATIVE_STEP);
  const after = Math.min(step.hold, held + DERIVATIVE_STEP);
  const point = body.subarray(drone * 3, drone * 3 + 3);
  // 64-bit positions: 32-bit ones would lose the small move in rounding.
  const p0 = placeBody(point, poseRotation(...holdAngles(motion, before)), 0, new Float64Array(3));
  const p1 = placeBody(point, poseRotation(...holdAngles(motion, after)), 0, new Float64Array(3));
  return Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]) / (after - before);
}

/**
 * Writes the brightness of every drone light at one time: 1 for full, down to `CHASE_DIM`.
 * Outside a hold with a light chase, every light is at full brightness.
 *
 * Each band has a bright head and a tail that fades behind it. The head leads in the
 * direction that the band moves.
 * @param {Plan} plan
 * @param {number} time seconds from the start of the timeline
 * @param {Float32Array} out one value per drone; length at least `plan.count`
 */
export function brightnessAt(plan, time, out) {
  const step = plan.steps[stepAt(plan, time)];
  const held = time - step.start - step.duration;
  const { chase } = step;
  if (!chase || held < 0 || held >= step.hold) {
    out.fill(1, 0, plan.count);
    return;
  }
  const fade = Math.min(1, held / CHASE_FADE, (step.hold - held) / CHASE_FADE);
  const shift = chase.speed * held;
  for (let drone = 0; drone < plan.count; drone++) {
    // 0 just ahead of a head, rising to 1 at the head.
    let phase = (chase.u[drone] - shift) * chase.bands;
    phase -= Math.floor(phase);
    const glow = (chase.speed >= 0 ? phase : 1 - phase) ** CHASE_TAIL;
    const level = CHASE_DIM + (1 - CHASE_DIM) * glow;
    out[drone] = 1 - fade * (1 - level);
  }
}

/**
 * The route of one drone through the show: for each step, the points that it passes.
 * The first points are the ends of the legs of the flight, so the last of them is the target.
 * More points follow when the formation moves in the hold; they trace the path of the drone.
 * @param {Plan} plan
 * @param {number} drone index
 * @returns {Float32Array[]} xyz per point, one list per step
 */
export function routeOf(plan, drone) {
  return plan.steps.map(({ legs, motion, body, centerHeight }) => {
    const times = motion && isMoving(motion) ? holdTimes(motion, ROUTE_STEP, MAX_ROUTE_SAMPLES).slice(1) : [];
    const corners = legs.length + 1;
    const route = new Float32Array((corners + times.length) * 3);
    route.set(legs[0].from.subarray(drone * 3, drone * 3 + 3), 0);
    legs.forEach((leg, index) => route.set(leg.to.subarray(drone * 3, drone * 3 + 3), (index + 1) * 3));
    if (body) {
      const point = body.subarray(drone * 3, drone * 3 + 3);
      times.forEach((time, k) => {
        const out = route.subarray((corners + k) * 3, (corners + k + 1) * 3);
        placeBody(point, poseRotation(...holdAngles(motion, time)), centerHeight, out);
      });
    }
    return route;
  });
}

/**
 * Light color of the fleet at one time. In a transition between two formations the color
 * blends from one to the other, in the leg that crosses. Takeoff uses the color of the
 * first formation, and the landing keeps the color of the last one.
 * @param {Plan} plan
 * @param {number[][]} colors red, green, blue of each formation, each 0 to 1
 * @param {number} time seconds from the start of the timeline
 * @returns {number[]} red, green, blue, each 0 to 1
 */
export function lightColorAt(plan, colors, time) {
  const index = stepAt(plan, time);
  const step = plan.steps[index];
  const before = colors[index === 0 ? step.formation : plan.steps[index - 1].formation];
  const after = step.formation >= 0 ? colors[step.formation] : before;
  const leg = step.legs[step.cross];
  const progress = progressAt(leg.timing, time - step.start - leg.start);
  return before.map((channel, i) => channel + progress * (after[i] - channel));
}

/**
 * Writes the light color of every drone at one time. In a transition each drone blends from
 * its color at the old stop to its color at the new stop, in the leg that crosses. Takeoff
 * uses the colors of the first formation, and the landing keeps the colors of the last one.
 * @param {Plan} plan
 * @param {number} time seconds from the start of the timeline
 * @param {Float32Array} out red, green, blue per drone; length at least `plan.count × 3`
 */
export function lightColorsAt(plan, time, out) {
  const index = stepAt(plan, time);
  const step = plan.steps[index];
  const before = index === 0 ? step.colors : plan.steps[index - 1].colors;
  const after = step.colors;
  const leg = step.legs[step.cross];
  const progress = progressAt(leg.timing, time - step.start - leg.start);
  if (before === after || progress >= 1) {
    out.set(after);
    return;
  }
  for (let i = 0; i < plan.count * 3; i++) {
    out[i] = before[i] + progress * (after[i] - before[i]);
  }
}

/**
 * Finds the time in a new plan that shows the same moment as a time in the old plan.
 * The end stays the end, a time in a hold stays in that hold, and a time in a transition
 * keeps its share of that transition.
 * @param {Plan} oldPlan
 * @param {Plan} newPlan
 * @param {number} time seconds in the old plan
 * @returns {number} seconds in the new plan
 */
export function retime(oldPlan, newPlan, time) {
  if (time >= oldPlan.total) return newPlan.total;
  const index = stepAt(oldPlan, time);
  if (index >= newPlan.steps.length) return newPlan.total;
  const before = oldPlan.steps[index];
  const after = newPlan.steps[index];
  const offset = time - before.start;
  if (offset >= before.duration) {
    const held = Math.min(after.hold, offset - before.duration);
    return after.start + after.duration + held;
  }
  return after.start + (offset / before.duration) * after.duration;
}
