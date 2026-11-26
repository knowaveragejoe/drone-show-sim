// Turns the project state into a plan: where each drone is at each time.
//
// A show is a list of steps. In each step the fleet flies to a stop and then holds there.
// The stops are the formations in storyboard order, and then the takeoff grid again
// when the show ends with a landing. A formation can lean (tilt), and in its hold it can
// turn, sway, rock, and roll, all at the same time, as one rigid body about its center.
// A light chase can run across it. Each drone has its own light color at each stop: one
// color for the whole formation, a gradient, or the colors of an SVG drawing. In a
// transition the lights blend from the old colors to the new ones, or they show an effect:
// see `lightsAt`.
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
  closestPair,
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
  timeOfProgress,
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
 * @property {StepLights} lights what the lights do in the transition
 * @property {Float32Array} end position of each drone when the hold ends, xyz; `to` when the formation does not turn
 * @property {Float32Array} colors light color of each drone at the stop, red, green, blue, each 0 to 1;
 *   the landing keeps the colors of the last formation
 * @property {number} closestApproach smallest distance between two drones in the transition, meters
 * @property {number} peakSpeed speed of the fastest drone in the step, m/s
 */

/**
 * One straight flight of the whole fleet. In most legs all drones start and stop together.
 * In the lift-off and the touchdown, the rows of the takeoff grid go one after another: each
 * drone then starts after its own delay.
 * @typedef {object} Leg
 * @property {number} start time when the leg starts, seconds from the start of its step
 * @property {number} duration length of the leg, seconds: the timing plus the longest delay
 * @property {import('./motion.js').Timing} timing the flight of each drone, from its own start
 * @property {Float32Array | null} delays time from the start of the leg to the start of each
 *   drone, seconds; null when all drones start together
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
 * @property {number} hoverOutsideVolume number of points of the hover layer outside the flight volume
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
 * What the drone lights do in a transition: the flight lights of the project, and the values
 * that the planner finds for them. See `lightsAt`.
 * @typedef {object} StepLights
 * @property {keyof typeof import('./state.js').FLIGHT_EFFECTS} effect
 * @property {import('./state.js').FlightLights} settings the flight lights as the user sets them
 * @property {number} level brightness of the lights in the flight, for an effect that turns
 *   them down, 0 to 1
 * @property {number[]} spark the spark color, red, green, blue, each 0 to 1
 * @property {Float32Array | null} ripple for a starburst: the place of each drone on the way of
 *   the flash, 0 where the flash starts and 1 where it ends; null for the other effects
 * @property {number} size the size of the larger formation of the flight, meters; the bands
 *   of a color wave span it
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
 * @property {number} formation index of the formation, or -1 for the takeoff grid and the hover layer
 * @property {boolean} canSpread true when the stop can grow to let the fleet pass: a formation or
 *   the hover layer, but not the takeoff grid on the ground
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
// A flight light effect uses at most this share of the transition to come in, and the same
// share to go out.
const FADE_SHARE = 1 / 4;
// Glimmer: a twinkle lasts at most this long, seconds. At a fast rate a twinkle is shorter,
// so that at most `GLIMMER_BUSY` of the time of a drone has a twinkle.
export const GLIMMER_SLOT = 0.3;
const GLIMMER_BUSY = 0.8;
// How far the light moves to the spark color at the peak of a twinkle: 0 keeps the color,
// 1 is the spark color.
const GLIMMER_SPARK = 0.7;
// Starburst: the flash uses at most this share of the transition to cross the fleet, and the
// embers fade with a time constant of at most `BURST_EMBER_SHARE` of it.
const BURST_REACH_SHARE = 1 / 4;
const BURST_EMBER_SHARE = 1 / 6;
// The flash cools from the spark color to the color of the drone with this time constant, seconds.
const BURST_HEAT = 0.3;
// At its peak the flash is this much brighter than a light at full brightness.
export const BURST_FLASH = 1.6;
// The embers flicker to a new level this many times per second.
const BURST_FLICKER = 15;
// Pulse: a strobe flash lasts this share of a beat.
const STROBE_SHARE = 0.12;
// The two beats of a heartbeat: their places in the beat, their width, and the height of the
// second one.
const HEART_BEATS = [0.08, 0.3];
const HEART_BEAT_WIDTH = 0.06;
const HEART_SECOND_BEAT = 0.75;
// Dissolve: each drone changes its color at a random time in this part of the transition.
const DISSOLVE_FROM = 0.15;
const DISSOLVE_TO = 0.85;
// The spark of a dissolve lasts about this long, seconds, and is this much brighter than a
// light at full brightness at its peak.
const DISSOLVE_SPARK_TIME = 0.1;
const DISSOLVE_SPARK = 0.6;
// Speed glow: at full speed, the light moves this far to the spark color.
const SPEED_SPARK = 0.5;

// A preview of a flight starts this long before the flight and ends this long after it, seconds.
export const PREVIEW_LEAD = 1;
export const PREVIEW_TAIL = 1.5;

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
    if (cache.size > CACHE_LIMIT) cache.delete(/** @type {string} */ (cache.keys().next().value));
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
    const { count, gridSpacing, hoverHeight, rowDelay, maxAcceleration, minSpacing, minVerticalSpacing } =
      state.fleet;
    // Distances for the spacing checks count heights times this factor (see `spacingCopy`).
    const heightScale = minSpacing / minVerticalSpacing;
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
      canSpread: false,
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
        canSpread: true,
        family,
        scale: formation.size,
        key,
        points,
        unit,
        // The spacing comes from the canonical copy, so that it is exactly the same for every
        // height. A tilt or a swing changes the heights of the points, so with a vertical
        // spacing the hold needs a look at more poses.
        spacing: remember(`spacing|${checkKey}|${heightScale}`, () =>
          holdSpacing(unit, body, motion, formation.size, heightScale),
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

    // The hover layer: the takeoff grid, lifted straight up. The rows lift off to it one after
    // another, and the fleet flies on from it as from a stop. In the air it can spread out.
    // It has the canonical copy and the key of the grid, so the assignments are the same.
    /** @type {Stop | null} */
    let hover = null;
    let hoverOutsideVolume = 0;
    if (hoverHeight > 0) {
      const points = gridPoints.map((value, i) => (i % 3 === 2 ? value + hoverHeight : value));
      hover = {
        ...grid,
        canSpread: true,
        points,
        centerHeight: hoverHeight,
        check: stillCheck(points, count, volume),
        leavePoints: points,
      };
      hoverOutsideVolume = markOutside(points, count, volume, outside);
    }
    // The row of each point of the takeoff grid. Row 0 is the row nearest the audience.
    const columns = Math.ceil(Math.sqrt(count));
    /** @param {Int32Array} gridSlots the grid point of each drone */
    const rowDelays = (gridSlots) => Float32Array.from(gridSlots, (slot) => Math.floor(slot / columns) * rowDelay);

    // slots[drone] is the point of the current stop where the drone is.
    let slots = Int32Array.from({ length: count }, (unused, drone) => drone);
    let from = grid.points;
    let start = 0;
    /** @type {Step[]} */
    const steps = [];
    for (let index = 1; index < stops.length; index++) {
      // With a hover layer, the takeoff flies on from it after the lift-off, and the landing
      // flies to it before the touchdown.
      const liftOff = hover !== null && index === 1;
      const touchdown = hover !== null && state.landAtEnd && index === stops.length - 1;
      const previous = liftOff ? /** @type {Stop} */ (hover) : stops[index - 1];
      const stop = touchdown ? /** @type {Stop} */ (hover) : stops[index];
      const ground = from;
      // Each drone lifts off in the row of the grid cell that it starts from.
      const liftDelays = liftOff ? rowDelays(slots) : null;
      if (liftOff) from = gather(previous.points, slots);

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
        remember(`approach|${linkKey}|${leaveScale}|${arriveScale}|${heightScale}`, () =>
          closestApproach(
            spacingCopy(previous.leaveUnit, leaveScale, heightScale),
            spacingCopy(gather(stop.unit, match.columnOfRow), arriveScale, heightScale),
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
            spacingCopy(previous.leaveUnit, previous.scale * leave, heightScale),
            spacingCopy(arriveUnit, stop.scale * arrive, heightScale),
            count,
            stopBelow,
          );
        const canLeave = previous.canSpread;
        const canArrive = stop.canSpread;
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
        const shapeKey = `${linkKey}|${previous.scale}|${stop.scale}|${minSpacing}|${heightScale}|${canLeave}|${canArrive}`;
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

      // The lift-off and the touchdown: the rows climb or descend straight, one after
      // another. Each drone keeps its distance across to every other drone, so no two drones
      // come closer than the grid spacing.
      /** @type {{from: Float32Array, to: Float32Array, delays: Float32Array | null}[]} */
      const flights = [];
      if (liftOff) flights.push({ from: ground, to: from, delays: liftDelays });
      for (let pose = 1; pose < poses.length; pose++) {
        flights.push({ from: poses[pose - 1], to: poses[pose], delays: null });
      }
      /** @type {Float32Array} */
      let arrival = to;
      if (touchdown) {
        // Each drone lands in the row of the grid cell that it lands on.
        arrival = gather(grid.points, slots);
        flights.push({ from: to, to: arrival, delays: rowDelays(slots) });
      }
      if (liftOff) cross++;
      if (liftOff || touchdown) approach = Math.min(approach, grid.spacing);

      /** @type {Leg[]} */
      const legs = [];
      let duration = 0;
      let peakSpeed = 0;
      for (const { from: legFrom, to: legTo, delays } of flights) {
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
        const legDuration = timing.duration + (delays ? Math.max(0, ...delays) : 0);
        legs.push({ start: duration, duration: legDuration, timing, delays, from: legFrom, to: legTo, pathLengths });
        duration += legDuration;
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
        from: ground,
        to: arrival,
        motion: stop.motion,
        body: stop.body && gather(stop.body, slots),
        centerHeight: stop.centerHeight,
        chase: stop.chase && { ...stop.chase, u: gatherValues(stop.chase.u, slots) },
        lights: stepLights(state, previous.formation, stop.formation, ground, count),
        end: touchdown ? arrival : end,
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
      hoverOutsideVolume,
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
 * A copy of points for the spacing checks: at a new size, with each height times
 * `heightScale`. A drone pushes air down, so the drone under it needs more room than a drone
 * beside it. The checks model this with an ellipsoid around each drone: the minimum spacing
 * across, and the vertical spacing up and down. With `heightScale` = minimum spacing ÷
 * vertical spacing, the ellipsoid becomes a sphere, and a plain distance between two points
 * of the copy compares with the minimum spacing. The scale is linear, so a straight flight
 * stays straight, and all checks of a straight flight work on the copy as they are.
 * @param {Float32Array} points xyz per point
 * @param {number} factor size factor
 * @param {number} heightScale factor for the heights after the size factor
 * @returns {Float32Array}
 */
function spacingCopy(points, factor, heightScale) {
  const out = new Float32Array(points.length);
  for (let i = 0; i < points.length; i += 3) {
    out[i] = points[i] * factor;
    out[i + 1] = points[i + 1] * factor;
    out[i + 2] = points[i + 2] * factor * heightScale;
  }
  return out;
}

// With a vertical spacing, the spacing of a formation that leans in its hold is the smallest
// spacing at up to this many poses, about one for each step of this angle.
const SPACING_STEP = 5 * DEGREE;
const MAX_SPACING_POSES = 24;

/**
 * The smallest spacing of a formation in its hold, for the spacing checks (see
 * `spacingCopy`). A turn about the vertical axis does not change the distances of the
 * checks, because it does not change any height difference. A rock, a roll, or a turn of a
 * tilted formation does, so the function then looks at several poses of the hold.
 * @param {Float32Array} unit the points at unit size, in the pose at the start of the hold, about the center
 * @param {Float32Array} body the points at their size, in the axes of the formation
 * @param {import('./motion.js').HoldMotion} motion
 * @param {number} size meters
 * @param {number} heightScale
 * @returns {number} meters; Infinity for one point
 */
function holdSpacing(unit, body, motion, size, heightScale) {
  const count = body.length / 3;
  let smallest = closestSpacing(spacingCopy(unit, size, heightScale), count);
  const tilted = motion.forward !== 0 || motion.side !== 0;
  const leans = motion.rock !== null || motion.roll !== null || (tilted && (motion.turn !== null || motion.sway !== null));
  if (heightScale === 1 || !leans) return smallest;
  for (const time of holdTimes(motion, SPACING_STEP, MAX_SPACING_POSES)) {
    const points = placeBody(body, poseRotation(...holdAngles(motion, time)), 0);
    smallest = Math.min(smallest, closestSpacing(spacingCopy(points, 1, heightScale), count));
  }
  return smallest;
}

/**
 * Picks points from a list.
 * @param {Float32Array} points xyz per point
 * @param {ArrayLike<number>} indices index of the point to take, per output position
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
 * @param {ArrayLike<number>} indices index of the value to take, per output position
 */
function gatherValues(values, indices) {
  return Float32Array.from(indices, (index) => values[index]);
}

/**
 * The lights of a transition: the flight lights of the formation that the fleet flies to, or
 * the landing lights.
 * @param {import('./state.js').State} state
 * @param {number} leaving index of the formation that the fleet leaves, or -1 for the takeoff grid
 * @param {number} arriving index of the formation that the fleet flies to, or -1 for the landing
 * @param {Float32Array} start position of each drone when the flight starts, xyz
 * @param {number} count number of drones
 * @returns {StepLights}
 */
function stepLights(state, leaving, arriving, start, count) {
  const settings = arriving >= 0 ? state.formations[arriving].flightLights : state.landingLights;
  const { effect } = settings;
  const sizes = [leaving, arriving].filter((index) => index >= 0).map((index) => state.formations[index].size);
  let ripple = null;
  if (effect === 'starburst') {
    ripple = rippleOf(start, count);
    // An inward flash starts at the edge and ends in the middle.
    if (settings.burstDirection === 'in') ripple = ripple.map((place) => 1 - place);
  }
  return {
    effect,
    settings,
    level: settings.darkLevel / 100,
    spark: hexToRgb(settings.sparkColor),
    ripple,
    size: Math.max(...sizes),
  };
}

/**
 * The distance of each point from the middle of all points as the audience sees them: across
 * and up, with no depth. The distance is a share of the largest distance. Without the depth,
 * the flash of a starburst spreads out over the picture that the audience sees: on a sphere it
 * starts in the middle of the disk, not on the whole shell at once.
 * @param {Float32Array} points xyz per point
 * @param {number} count
 * @returns {Float32Array} 0 to 1 per point; all 0 when every point is at the middle
 */
function rippleOf(points, count) {
  let middleX = 0;
  let middleZ = 0;
  for (let i = 0; i < count * 3; i += 3) {
    middleX += points[i] / count;
    middleZ += points[i + 2] / count;
  }
  const ripple = new Float32Array(count);
  let largest = 0;
  for (let drone = 0; drone < count; drone++) {
    const o = drone * 3;
    ripple[drone] = Math.hypot(points[o] - middleX, points[o + 2] - middleZ);
    largest = Math.max(largest, ripple[drone]);
  }
  if (largest > 0) for (let drone = 0; drone < count; drone++) ripple[drone] /= largest;
  else ripple.fill(0);
  return ripple;
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
 * A problem of the show: the words for the user, and the part of the show that it concerns.
 * @typedef {object} Problem
 * @property {string} text the problem in words for the user
 * @property {'takeoff' | 'hover' | 'spacing' | 'below' | 'outside' | 'approach' | 'spread' | 'motion'} kind
 *   takeoff grid cells or the hover layer outside the flight volume; targets too close, below
 *   the ground, or outside the flight volume; drones too close in a flight, or outside the
 *   flight volume in a spread; a motion in the hold that breaks a limit
 * @property {number} step index of the step that the problem concerns: the flight to the
 *   formation and its hold, or the landing
 */

/**
 * Lists what is wrong with one formation, with the kind of each problem.
 * @param {Plan} plan
 * @param {number} formation index of the formation
 * @param {import('./state.js').Fleet} limits the fleet limits
 * @returns {{kind: Problem['kind'], text: string}[]} empty when the formation passes every check
 */
function formationProblemList(plan, formation, limits) {
  const checks = plan.formations[formation];
  const step = plan.steps[formation];
  /** @type {{kind: Problem['kind'], text: string}[]} */
  const problems = [];
  if (isTooClose(checks.spacing, limits.minSpacing)) {
    problems.push({ kind: 'spacing', text: 'Targets are too close together.' });
  }
  if (isBelowGround(checks.lowestTarget)) problems.push({ kind: 'below', text: 'Targets are below the ground.' });
  if (checks.outsideVolume > 0) problems.push({ kind: 'outside', text: 'Targets are outside the flight volume.' });
  if (isTooClose(step.closestApproach, limits.minSpacing)) {
    problems.push({ kind: 'approach', text: 'Drones come too close in the transition to this formation.' });
  }
  if (step.spreadOutside > 0) {
    problems.push({ kind: 'spread', text: 'Drones leave the flight volume when they spread out to pass.' });
  }
  const { motion } = checks;
  if (motion.horizontalSpeed > limits.maxHorizontalSpeed + ROUNDING_SLACK) {
    problems.push({ kind: 'motion', text: 'The motion in the hold is faster than the maximum horizontal speed.' });
  }
  if (
    motion.climbSpeed > limits.maxClimbSpeed + ROUNDING_SLACK ||
    motion.descentSpeed > limits.maxDescentSpeed + ROUNDING_SLACK
  ) {
    problems.push({ kind: 'motion', text: 'The motion in the hold climbs or descends faster than the limits.' });
  }
  if (motion.acceleration > limits.maxAcceleration * (1 + ACCELERATION_SLACK)) {
    problems.push({ kind: 'motion', text: 'The motion in the hold accelerates more than the maximum acceleration.' });
  }
  return problems;
}

/**
 * Lists what is wrong with one formation, in words for the user.
 * @param {Plan} plan
 * @param {number} formation index of the formation
 * @param {import('./state.js').Fleet} limits the fleet limits
 * @returns {string[]} empty when the formation passes every check
 */
export function formationProblems(plan, formation, limits) {
  return formationProblemList(plan, formation, limits).map(({ text }) => text);
}

const LANDING_PROBLEM = 'Drones come too close in the landing.';
const LANDING_SPREAD_PROBLEM = 'Drones leave the flight volume when they spread out before the landing.';
const TAKEOFF_PROBLEM = 'Takeoff grid cells are outside the flight volume.';
const HOVER_PROBLEM = 'The hover layer is outside the flight volume.';

/**
 * Lists every problem of the show, with the part of the show that each one concerns.
 * @param {import('./state.js').State} state
 * @param {Plan} plan
 * @returns {Problem[]}
 */
export function findProblems(state, plan) {
  /** @type {Problem[]} */
  const problems = [];
  if (plan.takeoffOutsideVolume > 0) problems.push({ text: TAKEOFF_PROBLEM, kind: 'takeoff', step: 0 });
  if (plan.hoverOutsideVolume > 0) problems.push({ text: HOVER_PROBLEM, kind: 'hover', step: 0 });
  state.formations.forEach((formation, index) => {
    for (const { kind, text } of formationProblemList(plan, index, state.fleet)) {
      problems.push({ text: `Formation ${index + 1}: ${text}`, kind, step: index });
    }
  });
  const landing = plan.steps.length - 1;
  const last = plan.steps[landing];
  if (last.formation < 0) {
    if (isTooClose(last.closestApproach, state.fleet.minSpacing)) {
      problems.push({ text: LANDING_PROBLEM, kind: 'approach', step: landing });
    }
    if (last.spreadOutside > 0) problems.push({ text: LANDING_SPREAD_PROBLEM, kind: 'spread', step: landing });
  }
  return problems;
}

/**
 * Lists every problem of the show, in words for the user.
 * @param {import('./state.js').State} state
 * @param {Plan} plan
 * @returns {string[]}
 */
export function showProblems(state, plan) {
  return findProblems(state, plan).map(({ text }) => text);
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

// A click on a problem looks at the hold at up to this many poses, about one for each step
// of the route angle.
const MAX_FOCUS_POSES = 24;

/**
 * Where a problem shows in the show: the time to look at, and the drones that cause it. A click
 * on a problem moves the timeline to that time and marks the drones.
 *
 * Two drones that come too close: the pair and the moment of their closest approach, from an
 * exact search of each flight with all drones together, or of the poses of the hold. Drones
 * outside the flight volume or below the ground: each drone that is, and the pose where the
 * most drones are, or where the lowest drone is lowest. A motion that breaks a limit: the
 * start of the hold, with no drones.
 * @param {Plan} plan
 * @param {Problem} problem
 * @param {import('./state.js').Fleet} fleet the minimum spacing and the vertical spacing
 * @returns {{time: number, drones: number[]}} seconds from the start of the timeline; indices of
 *   the drones, the closest pair first for a spacing problem
 */
export function problemFocus(plan, problem, fleet) {
  const { count, volume } = plan;
  const step = plan.steps[problem.step];
  const heightScale = fleet.minSpacing / fleet.minVerticalSpacing;
  const holdTime = step.start + step.duration;
  const outsideOf = (/** @type {Float32Array} */ points) => {
    const flags = new Uint8Array(count);
    markOutside(points, count, volume, flags);
    return flags;
  };
  const indices = (/** @type {Uint8Array} */ flags) => {
    const list = [];
    for (let drone = 0; drone < count; drone++) if (flags[drone]) list.push(drone);
    return list;
  };

  if (problem.kind === 'takeoff') return { time: 0, drones: indices(outsideOf(step.from)) };
  if (problem.kind === 'hover') {
    const lift = step.legs[0];
    return { time: step.start + lift.duration, drones: indices(outsideOf(lift.to)) };
  }

  if (problem.kind === 'approach') {
    // The lift-off and the touchdown climb and descend straight, so they keep the grid spacing.
    let best = null;
    for (const leg of step.legs) {
      if (leg.delays) continue;
      const pair = closestPair(spacingCopy(leg.from, 1, heightScale), spacingCopy(leg.to, 1, heightScale), count);
      if (!best || pair.distance < best.pair.distance) best = { leg, pair };
    }
    if (!best || best.pair.first < 0) return { time: step.start, drones: [] };
    const { leg, pair } = best;
    return { time: step.start + leg.start + timeOfProgress(leg.timing, pair.progress), drones: [pair.first, pair.second] };
  }

  if (problem.kind === 'spread') {
    // The poses where the fleet has spread out: the ends of the legs before the last one.
    let best = { time: step.start, flags: new Uint8Array(count), outside: -1 };
    for (const leg of step.legs.slice(0, -1)) {
      if (leg.delays) continue;
      const flags = outsideOf(leg.to);
      const outside = flags.reduce((sum, flag) => sum + flag, 0);
      if (outside > best.outside) best = { time: step.start + leg.start + leg.duration, flags, outside };
    }
    return { time: best.time, drones: indices(best.flags) };
  }

  // The rest concern the hold: its poses at sampled times, or its one pose.
  const { motion } = step;
  const poses =
    motion && isMoving(motion)
      ? holdTimes(motion, ROUTE_STEP, MAX_FOCUS_POSES).map((time) => ({
          time: holdTime + Math.min(time, step.hold),
          points: placeBody(/** @type {Float32Array} */ (step.body), poseRotation(...holdAngles(motion, time)), step.centerHeight),
        }))
      : [{ time: holdTime, points: step.to }];

  if (problem.kind === 'spacing') {
    let best = null;
    for (const pose of poses) {
      const copy = spacingCopy(pose.points, 1, heightScale);
      const pair = closestPair(copy, copy, count);
      if (!best || pair.distance < best.pair.distance) best = { pose, pair };
    }
    const { pose, pair } = /** @type {{pose: {time: number}, pair: {first: number, second: number}}} */ (best);
    return { time: pose.time, drones: pair.first < 0 ? [] : [pair.first, pair.second] };
  }

  if (problem.kind === 'below' || problem.kind === 'outside') {
    const flags = new Uint8Array(count);
    let time = holdTime;
    let worst = -Infinity;
    for (const pose of poses) {
      let score = 0;
      for (let drone = 0; drone < count; drone++) {
        const o = drone * 3;
        const off =
          problem.kind === 'below'
            ? isBelowGround(pose.points[o + 2])
            : !isInside(pose.points[o], pose.points[o + 1], pose.points[o + 2], volume);
        if (!off) continue;
        flags[drone] = 1;
        // Outside: the pose with the most drones out. Below: the pose with the lowest drone.
        score = problem.kind === 'below' ? Math.max(score, -pose.points[o + 2]) : score + 1;
      }
      if (score > worst) {
        worst = score;
        time = pose.time;
      }
    }
    return { time, drones: indices(flags) };
  }

  return { time: holdTime, drones: [] };
}

/**
 * The part of the timeline that a preview of one flight loops over: the flight, with a little
 * of the hold before it and of the hold after it, so the change of picture shows.
 * @param {Plan} plan
 * @param {number} stepIndex index of the step whose flight the preview shows
 * @returns {number[]} start and end, seconds from the start of the timeline
 */
export function previewSpan(plan, stepIndex) {
  const step = plan.steps[stepIndex];
  const start = Math.max(0, step.start - PREVIEW_LEAD);
  const end = Math.min(plan.total, step.start + step.duration + PREVIEW_TAIL);
  return [start, end];
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

// Previous, from a time this close after a mark, goes on to the mark before it, as in a music
// player: one press goes back to the start of the current formation, two presses go further.
export const JUMP_SLACK = 1;

/**
 * Where the Previous and Next buttons move the timeline: to the start of the hold of a
 * formation, or to the start or the end of the show.
 * @param {Plan} plan
 * @param {number} time seconds from the start of the timeline
 * @param {-1 | 1} direction -1 for the previous mark, 1 for the next one
 * @returns {{time: number, formation: number}} the time of the mark; the index of the formation
 *   whose hold starts there, or -1 for the start and the end of the show
 */
export function jumpTarget(plan, time, direction) {
  const marks = [{ time: 0, formation: -1 }];
  for (const step of plan.steps) {
    if (step.formation >= 0) marks.push({ time: step.start + step.duration, formation: step.formation });
  }
  marks.push({ time: plan.total, formation: -1 });
  if (direction < 0) return marks.findLast((mark) => mark.time < time - JUMP_SLACK) ?? marks[0];
  return marks.find((mark) => mark.time > time + 1e-6) ?? marks[marks.length - 1];
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
      placeBody(/** @type {Float32Array} */ (step.body), poseRotation(...holdAngles(step.motion, held)), step.centerHeight, out);
    } else {
      out.set(held < step.hold ? step.to : step.end);
    }
    return;
  }
  const { start, timing, delays, from, to } = legAt(step, offset);
  if (delays) {
    for (let drone = 0; drone < plan.count; drone++) {
      const progress = progressAt(timing, offset - start - delays[drone]);
      for (let i = drone * 3; i < drone * 3 + 3; i++) out[i] = from[i] + progress * (to[i] - from[i]);
    }
    return;
  }
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
    const delay = leg.delays ? leg.delays[drone] : 0;
    return rateAt(leg.timing, offset - leg.start - delay) * leg.pathLengths[drone];
  }
  const { motion, body } = step;
  // The motion starts and ends at rest.
  if (!motion || !isMoving(motion) || held <= 0 || held >= step.hold) return 0;
  // The distance that the drone moves in a short time before and after.
  const before = Math.max(0, held - DERIVATIVE_STEP);
  const after = Math.min(step.hold, held + DERIVATIVE_STEP);
  // A step that moves in its hold always has a body.
  const point = /** @type {Float32Array} */ (body).subarray(drone * 3, drone * 3 + 3);
  // 64-bit positions: 32-bit ones would lose the small move in rounding.
  const p0 = placeBody(point, poseRotation(...holdAngles(motion, before)), 0, new Float64Array(3));
  const p1 = placeBody(point, poseRotation(...holdAngles(motion, after)), 0, new Float64Array(3));
  return Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]) / (after - before);
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
        placeBody(point, poseRotation(...holdAngles(/** @type {import('./motion.js').HoldMotion} */ (motion), time)), centerHeight, out);
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
 * Writes the light color and the brightness of every drone at one time.
 *
 * The colors: in a transition each drone blends from its color at the old stop to its color
 * at the new stop, in the leg that crosses. Takeoff uses the colors of the first formation,
 * and the landing keeps the colors of the last one.
 *
 * The brightness: in a hold with a light chase, bands travel across the formation (see
 * `chaseBrightness`). Otherwise every light is at full brightness.
 *
 * In a transition, the flight lights of the step can then change both: Dark, Glimmer,
 * Starburst, Color wave, Bands, Pulse, Dissolve, and Speed glow. An effect comes in at the
 * start of the flight and goes out at its end (see `effectShare`), so the fleet leaves the old
 * stop and arrives at the new one with its lights on. A dissolve keeps the lights on and needs
 * no fade. The random parts of an effect come from the drone, the step, and the
 * time only, so the show looks the same each time it plays.
 * @param {Plan} plan
 * @param {number} time seconds from the start of the timeline
 * @param {Float32Array} positions position of each drone at this time, xyz, from `positionsAt`;
 *   the color wave uses them
 * @param {Float32Array} colors out: red, green, blue per drone, each 0 to 1; length at least
 *   `plan.count × 3`
 * @param {Float32Array} brightness out: one value per drone; 1 is full brightness, and the flash
 *   of a starburst and the spark of a dissolve go above it; length at least `plan.count`
 */
export function lightsAt(plan, time, positions, colors, brightness) {
  const { count } = plan;
  const index = stepAt(plan, time);
  const step = plan.steps[index];
  const offset = time - step.start;

  const before = index === 0 ? step.colors : plan.steps[index - 1].colors;
  const after = step.colors;
  const leg = step.legs[step.cross];
  const progress = progressAt(leg.timing, offset - leg.start);
  if (before === after || progress >= 1) {
    colors.set(after.subarray(0, count * 3));
  } else {
    for (let i = 0; i < count * 3; i++) colors[i] = before[i] + progress * (after[i] - before[i]);
  }

  const held = offset - step.duration;
  if (held >= 0) {
    chaseBrightness(step, held, count, brightness);
    return;
  }
  brightness.fill(1, 0, count);
  const { lights, duration } = step;
  const { effect, level, settings, spark } = lights;
  if (effect === 'starburst') {
    starburstLights(lights, index, offset, duration, count, colors, brightness);
    return;
  }
  if (effect === 'dissolve') {
    dissolveLights(spark, index, offset, duration, count, before, after, colors, brightness);
    return;
  }
  const share = effectShare(duration, offset, settings.fadeTime);
  if (effect === 'blend' || share <= 0) return;
  if (effect === 'dark') {
    brightness.fill(1 - share * (1 - level), 0, count);
  } else if (effect === 'glimmer') {
    for (let drone = 0; drone < count; drone++) {
      const twinkle = twinkleAt(index, drone, offset, settings.twinkleRate);
      const mix = GLIMMER_SPARK * twinkle;
      const glow = level + (1 - level) * twinkle;
      mixLight(colors, brightness, drone, share, spark[0] * mix, spark[1] * mix, spark[2] * mix, 1 - mix, glow);
    }
  } else if (effect === 'wave') {
    const places = bandPlaces(settings.bandDirection, positions, count, lights.size);
    const bands = settings.bandDirection === 'spin' ? Math.max(1, Math.round(settings.bandCount)) : settings.bandCount;
    const shift = settings.bandSpeed * offset;
    for (let drone = 0; drone < count; drone++) {
      const hue = places[drone] * bands - shift;
      const [red, green, blue] = rainbow(hue - Math.floor(hue));
      mixLight(colors, brightness, drone, share, red, green, blue, 0, 1);
    }
  } else if (effect === 'bands') {
    const places = bandPlaces(settings.bandDirection, positions, count, lights.size);
    const bands = settings.bandDirection === 'spin' ? Math.max(1, Math.round(settings.bandCount)) : settings.bandCount;
    const shift = settings.bandSpeed * offset;
    const width = settings.bandWidth / 100;
    for (let drone = 0; drone < count; drone++) {
      let phase = places[drone] * bands - shift;
      phase -= Math.floor(phase);
      // A drone sees its phase fall: a band reaches it at the width, with its bright head,
      // and leaves it at 0, with the end of its tail.
      const glow = phase < width ? phase / width : 0;
      mixLight(colors, brightness, drone, share, 0, 0, 0, 1, level + (1 - level) * glow);
    }
  } else if (effect === 'pulse') {
    const beat = pulseAt(settings.pulseStyle, (settings.pulseRate / 60) * offset);
    const glow = level + (1 - level) * beat;
    // A strobe flashes in the spark color; a breath and a heartbeat keep the drone colors.
    const mix = settings.pulseStyle === 'strobe' ? beat : 0;
    for (let drone = 0; drone < count; drone++) {
      mixLight(colors, brightness, drone, share, spark[0] * mix, spark[1] * mix, spark[2] * mix, 1 - mix, glow);
    }
  } else if (effect === 'speed') {
    const now = legAt(step, offset);
    let longest = 0;
    for (let drone = 0; drone < count; drone++) longest = Math.max(longest, now.pathLengths[drone]);
    const top = now.timing.peakRate * longest;
    for (let drone = 0; drone < count; drone++) {
      const delay = now.delays ? now.delays[drone] : 0;
      const speed = rateAt(now.timing, offset - now.start - delay) * now.pathLengths[drone];
      const ratio = top > 0 ? Math.min(1, speed / top) : 0;
      const mix = SPEED_SPARK * ratio * ratio;
      const glow = level + (1 - level) * ratio;
      mixLight(colors, brightness, drone, share, spark[0] * mix, spark[1] * mix, spark[2] * mix, 1 - mix, glow);
    }
  }
}

/**
 * The beat of a pulse at one time: 0 for the low point, 1 for the peak.
 * @param {keyof typeof import('./state.js').PULSE_STYLES} style
 * @param {number} beats the number of beats since the start of the transition
 * @returns {number}
 */
export function pulseAt(style, beats) {
  const place = beats - Math.floor(beats);
  // A breath starts at its peak, so the fleet leaves the old picture lit.
  if (style === 'breathe') return 0.5 + 0.5 * Math.cos(2 * Math.PI * place);
  if (style === 'strobe') return place < STROBE_SHARE ? 1 : 0;
  const bump = (/** @type {number} */ middle) => Math.exp(-(((place - middle) / HEART_BEAT_WIDTH) ** 2));
  return Math.max(bump(HEART_BEATS[0]), HEART_SECOND_BEAT * bump(HEART_BEATS[1]));
}

/**
 * The time in a transition when a drone of a dissolve changes its color: a random time in the
 * middle part of the transition, the same each time the show plays.
 * @param {number} index index of the step
 * @param {number} drone index
 * @param {number} duration length of the transition, seconds
 * @returns {number} seconds from the start of the transition
 */
export function dissolveTime(index, drone, duration) {
  return duration * (DISSOLVE_FROM + (DISSOLVE_TO - DISSOLVE_FROM) * hash01(index, drone, -2));
}

/**
 * The lights of a dissolve. The lights stay on. Each drone keeps its old color until its own
 * moment, then shows its new color at once, with a short spark. So the old picture dissolves
 * into the new one, drone by drone.
 * @param {number[]} spark the spark color, red, green, blue
 * @param {number} index index of the step
 * @param {number} offset seconds from the start of the transition
 * @param {number} duration length of the transition, seconds
 * @param {number} count number of drones
 * @param {Float32Array} before the colors at the old stop
 * @param {Float32Array} after the colors at the new stop
 * @param {Float32Array} colors out
 * @param {Float32Array} brightness out
 */
function dissolveLights(spark, index, offset, duration, count, before, after, colors, brightness) {
  for (let drone = 0; drone < count; drone++) {
    const moment = dissolveTime(index, drone, duration);
    const o = drone * 3;
    const color = offset < moment ? before : after;
    const flash = Math.exp(-(((offset - moment) / DISSOLVE_SPARK_TIME) ** 2));
    for (let channel = 0; channel < 3; channel++) {
      colors[o + channel] = color[o + channel] + flash * (spark[channel] - color[o + channel]);
    }
    brightness[drone] = 1 + DISSOLVE_SPARK * flash;
  }
}

/**
 * The place of each drone across the fleet, for bands that travel in a direction. A band with
 * a fixed place value travels the way of the direction. The places use the side and the height
 * of each drone, as the audience sees the fleet, about the middle of the fleet at this time.
 * Across the fleet, the places span about 1: from left to right or from bottom to top over the
 * size, from the middle to the edge over half the size, or once around the middle.
 * @param {keyof typeof import('./state.js').BAND_DIRECTIONS} direction
 * @param {Float32Array} positions xyz per drone
 * @param {number} count number of drones
 * @param {number} size the size of the fleet, meters
 * @returns {Float32Array} one place per drone
 */
export function bandPlaces(direction, positions, count, size) {
  const places = new Float32Array(count);
  if (direction === 'together' || count === 0) return places;
  let middleX = 0;
  let middleZ = 0;
  for (let i = 0; i < count * 3; i += 3) {
    middleX += positions[i] / count;
    middleZ += positions[i + 2] / count;
  }
  const scale = size > 0 ? size : 1;
  for (let drone = 0; drone < count; drone++) {
    const x = positions[drone * 3] - middleX;
    const z = positions[drone * 3 + 2] - middleZ;
    if (direction === 'right') places[drone] = x / scale;
    else if (direction === 'left') places[drone] = -x / scale;
    else if (direction === 'up') places[drone] = z / scale;
    else if (direction === 'down') places[drone] = -z / scale;
    else if (direction === 'out') places[drone] = Math.hypot(x, z) / (scale / 2);
    else if (direction === 'in') places[drone] = -Math.hypot(x, z) / (scale / 2);
    // Spin: clockwise, as the audience sees it, from the top.
    else places[drone] = Math.atan2(x, z) / (2 * Math.PI);
  }
  return places;
}

/**
 * The lights of a starburst. A flash in the spark color travels across the fleet: outward from
 * the middle, or inward from the edge. Each drone flashes when the flash reaches it, then cools
 * to its own color and fades like the ember of a firework, with a flicker, down to the dark
 * level. Before the flash reaches a drone, the drone keeps its light. The lights come back as
 * the fleet arrives.
 * @param {StepLights} lights
 * @param {number} index index of the step, for the flicker
 * @param {number} offset seconds from the start of the transition
 * @param {number} duration length of the transition, seconds
 * @param {number} count number of drones
 * @param {Float32Array} colors in: the blended colors; out: the colors of the starburst
 * @param {Float32Array} brightness out
 */
function starburstLights(lights, index, offset, duration, count, colors, brightness) {
  const { level, settings, spark } = lights;
  const ripple = /** @type {Float32Array} */ (lights.ripple);
  const reach = Math.min(settings.flashTime, duration * BURST_REACH_SHARE);
  const ember = Math.min(settings.emberTime, duration * BURST_EMBER_SHARE);
  // The effect goes out as the fleet arrives, but it starts at once: the flash is its start.
  const fade = Math.min(settings.fadeTime, duration * FADE_SHARE);
  const share = fade > 0 ? smooth(Math.min(1, (duration - offset) / fade)) : 0;
  if (share <= 0) return;
  const tick = Math.floor(offset * BURST_FLICKER);
  for (let drone = 0; drone < count; drone++) {
    const age = offset - ripple[drone] * reach;
    if (age < 0) continue;
    const heat = Math.exp(-age / BURST_HEAT);
    const glow = Math.exp(-age / ember);
    // The flicker grows as the ember cools.
    const flicker = 0.4 + 0.6 * hash01(index, drone, tick);
    const sparkle = flicker + heat * (1 - flicker);
    const peak = 1 + (BURST_FLASH - 1) * heat;
    const glowLevel = level + (peak - level) * glow * sparkle;
    mixLight(colors, brightness, drone, share, spark[0] * heat, spark[1] * heat, spark[2] * heat, 1 - heat, glowLevel);
  }
}

/**
 * Moves the light of one drone toward the light of an effect. The color of the effect is a
 * part of white plus a part of the blended color of the drone.
 * @param {Float32Array} colors in: the blended color; out
 * @param {Float32Array} brightness in: the brightness without the effect; out
 * @param {number} drone index
 * @param {number} share how far the effect is in, 0 to 1
 * @param {number} red the added part of the color of the effect, 0 to 1
 * @param {number} green
 * @param {number} blue
 * @param {number} keep the part of the blended color in the color of the effect, 0 to 1
 * @param {number} level the brightness of the effect
 */
function mixLight(colors, brightness, drone, share, red, green, blue, keep, level) {
  const o = drone * 3;
  colors[o] += share * (red + keep * colors[o] - colors[o]);
  colors[o + 1] += share * (green + keep * colors[o + 1] - colors[o + 1]);
  colors[o + 2] += share * (blue + keep * colors[o + 2] - colors[o + 2]);
  brightness[drone] += share * (level - brightness[drone]);
}

/**
 * The twinkle of one drone in a glimmer: 0 between twinkles, up to 1 at the peak of a strong
 * one. The time is cut into slots, and each drone starts its slots at its own time. In some of
 * its slots, a drone twinkles: its light rises and falls smoothly once, to a peak of its own.
 * A slot lasts `GLIMMER_SLOT`, or less at a fast rate, and the share of slots with a twinkle
 * gives the rate.
 * @param {number} index index of the step
 * @param {number} drone index
 * @param {number} offset seconds from the start of the transition
 * @param {number} rate twinkles of each drone per second
 * @returns {number}
 */
export function twinkleAt(index, drone, offset, rate) {
  const slotTime = Math.min(GLIMMER_SLOT, GLIMMER_BUSY / rate);
  const chanceShare = rate * slotTime;
  const place = offset / slotTime + hash01(index, drone, -1);
  const slot = Math.floor(place);
  const chance = hash01(index, drone, slot);
  if (chance >= chanceShare) return 0;
  const peak = 0.4 + (0.6 * chance) / chanceShare;
  return peak * Math.sin(Math.PI * (place - slot)) ** 4;
}

/**
 * A bright color of the rainbow.
 * @param {number} hue 0 to 1: red, yellow, green, cyan, blue, magenta, and back to red
 * @returns {number[]} red, green, blue, each 0 to 1; the strongest channel is 1
 */
export function rainbow(hue) {
  const channel = (/** @type {number} */ shift) => {
    const k = (hue * 6 + shift) % 6;
    return 1 - Math.max(0, Math.min(1, k, 4 - k));
  };
  return [channel(5), channel(3), channel(1)];
}

/**
 * A random number from 0 to 1 that depends only on three whole numbers. The same numbers
 * always give the same result, so an effect looks the same each time the show plays.
 * @param {number} a
 * @param {number} b
 * @param {number} c
 * @returns {number}
 */
export function hash01(a, b, c) {
  let h = mix32(a + 0x9e3779b9);
  h = mix32(h ^ b);
  h = mix32(h ^ c);
  return (h >>> 0) / 4294967296;
}

/**
 * Mixes the bits of a 32-bit number well: the last step of MurmurHash3.
 * @param {number} value
 * @returns {number}
 */
function mix32(value) {
  let h = value | 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return h ^ (h >>> 16);
}

/**
 * How far the effect of a transition is in, at one time of the transition. The effect comes
 * in over the fade time at the start of the flight and goes out over the same time at its end,
 * so the lights show the old stop when the fleet leaves it and the new stop when the fleet
 * arrives. A short flight uses at most a quarter of its time for each fade.
 * @param {number} duration length of the transition, seconds
 * @param {number} offset seconds from the start of the transition
 * @param {number} fadeTime seconds
 * @returns {number} 0 when the effect is out, up to 1 when it is fully in
 */
export function effectShare(duration, offset, fadeTime) {
  const fade = Math.min(fadeTime, duration * FADE_SHARE);
  if (!(fade > 0)) return 0;
  return smooth(Math.max(0, Math.min(1, offset / fade, (duration - offset) / fade)));
}

/**
 * A smooth step from 0 to 1: slow at both ends.
 * @param {number} x 0 to 1
 * @returns {number}
 */
function smooth(x) {
  return x * x * (3 - 2 * x);
}

/**
 * Writes the brightness of every drone light at one time of a hold: 1 for full, down to
 * `CHASE_DIM` in a light chase. A hold with no light chase has every light at full brightness.
 *
 * Each band has a bright head and a tail that fades behind it. The head leads in the
 * direction that the band moves.
 * @param {Step} step
 * @param {number} held seconds from the start of the hold
 * @param {number} count number of drones
 * @param {Float32Array} out one value per drone
 */
function chaseBrightness(step, held, count, out) {
  const { chase } = step;
  if (!chase || held >= step.hold) {
    out.fill(1, 0, count);
    return;
  }
  const fade = Math.min(1, held / CHASE_FADE, (step.hold - held) / CHASE_FADE);
  const shift = chase.speed * held;
  for (let drone = 0; drone < count; drone++) {
    // 0 just ahead of a head, rising to 1 at the head.
    let phase = (chase.u[drone] - shift) * chase.bands;
    phase -= Math.floor(phase);
    const glow = (chase.speed >= 0 ? phase : 1 - phase) ** CHASE_TAIL;
    const level = CHASE_DIM + (1 - CHASE_DIM) * glow;
    out[drone] = 1 - fade * (1 - level);
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
