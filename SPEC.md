# Drone show simulator: specification

Status: plan agreed on 2026-11-15. No code exists yet.

## Purpose

A browser tool that previews a drone light show in 3D.
Version 1 shows one formation: the drones take off from a ground grid, fly to a shape, and hold it.

The tool is visual-first.
It uses real units and real drone limits, so a flyable export can come later.

## Terms

The fleet works like a marching band.
A formation is a picture that the band makes on the field.
The assignment is the drill chart: it gives each marcher one spot.
A transition is the march between two pictures, and all marchers move on the same count.

| Term | Meaning |
|---|---|
| Drone | One aircraft with one colored light. |
| Fleet | All drones in the show. |
| Shape | The geometry that a formation is made from: a built-in shape or an imported OBJ model. |
| Candidate cloud | A dense set of points on a shape. The sampler picks targets from it. |
| Target | One position in a formation. Each drone gets one target. |
| Formation | One static picture made of drones: a shape plus its size, position, and color. |
| Takeoff grid | The ground positions where the drones start. |
| Assignment | The mapping from each drone to one target. The drill chart. |
| Transition | The flight from one set of positions to the next. |
| Storyboard | Future. The ordered list of formations in a show. |

Formation, transition, and storyboard are the terms that Skybrush uses.

## Decisions

| Topic | Decision |
|---|---|
| Purpose | Visual-first preview with real units. No flyable export in version 1. |
| Platform | Desktop browsers with WebGL2. No mobile layout. |
| Rendering | Raw WebGL2. No 3D library. |
| Language | Plain JavaScript, native ES modules, JSDoc types. No build step. |
| Runtime dependencies | None. |
| Fleet size | 1 to 1,000 drones. Default 100. |
| Shape inputs | Built-in shapes and OBJ files. |
| Drone placement | Even spread over the surface of the shape. |
| Motion | Takeoff grid to one formation, then hold. |
| Color | One color per formation. |
| Fleet panel | A drone list with live data. Select a drone to highlight it and its path. |
| Path display | All paths faint. The selected path bright. A toggle hides all paths. |
| Spacing conflict | The readout warns. A Fit button sets the smallest safe size. |
| Saving | Export and import of a JSON project file. |
| Tests | Node unit tests for the math. One headless browser smoke test. |
| Hosting | GitHub Pages from the repository root, after the repository becomes public. |

## World model

- Units are meters and seconds. The user interface shows angles in degrees.
- Axes are right-handed with Z up. The ground is the plane `z = 0`.
- The audience stands on the negative Y axis and looks toward positive Y. X points to the right of the audience.
- The takeoff grid is centered on the origin.

### Default settings

| Setting | Default |
|---|---|
| Drone count | 100 |
| Maximum horizontal speed | 8 m/s |
| Maximum climb speed | 3 m/s |
| Maximum descent speed | 3 m/s |
| Maximum acceleration | 4 m/s² |
| Minimum spacing | 2 m |
| Takeoff grid spacing | 3 m |
| Shape | Sphere |
| Formation size (largest extent) | 40 m |
| Formation center height | 60 m |
| Formation yaw | 0° |
| Hold time | 10 s |

The limits are starting values in the range that show design tools use.
They do not come from one drone model.
The user can edit every value.

## How the simulator computes a show

Each step is a pure function of its inputs.
The simulator runs a step again only when one of its inputs changes.

### 1. Shape to candidate cloud

Each shape produces 20,000 points in unit space.
In unit space the shape is centered on the origin and its largest extent is 1.
A seeded random number generator makes the points, so the same project always gives the same result.

Built-in shapes are small generator functions.
Version 1 has seven: sphere, cube, torus, disc, ring, helix, and heart.
The disc, ring, and heart are flat. They stand upright and face the audience.

For an OBJ file, the simulator does these steps:

1. Parse the vertices and faces. Split each face with more than three corners into triangles.
2. Convert the up axis to Z. OBJ files usually use Y up, so Y is the default. The user can select Z.
3. Center the model and scale it to unit size.
4. Pick random points on the triangles. A larger triangle gets more points in proportion to its area.

The parser ignores materials, textures, and normals.

### 2. Candidate cloud to targets

The sampler uses farthest point sampling.
It starts with one candidate.
At each step it picks the candidate that is farthest from all picked points.

Think of 20,000 grains of sand on the shape.
The sampler keeps the grains that are as far apart as possible.

The first N picks are the same for every larger N.
The sampler computes the order once for 1,000 picks and stores it.
A change of drone count then needs no new sampling, and existing targets do not move.

### 3. Place the formation

The simulator scales each unit point by the formation size.
It then rotates the point by the yaw angle about the Z axis and moves it to the formation center.

### 4. Check the spacing

The simulator finds the smallest distance between any two targets.
The readout shows this distance in red when it is below the minimum spacing.

Spacing grows in proportion to size.
The Fit button sets the size to `size × minimum spacing ÷ smallest distance`.
This is the smallest size that passes the check.

### 5. Build the takeoff grid

The grid is close to square: the column count is `ceil(sqrt(N))`.
Drone ids run from 1 to N, row by row.

### 6. Assign drones to targets

The Hungarian algorithm finds the assignment with the smallest total of squared distances.

Squared distance matters.
With this assignment and with all drones on the same count, straight paths stay apart.
If the closest spacing at the start and at the end is `D`, the closest approach in flight is at least `D ÷ √2`.
Skybrush documents the same bound.

The Hungarian algorithm needs time in proportion to N³.
At 1,000 drones the expected time is about one second.
Milestone 3 measures the real time.
If the pause is longer than 0.5 seconds, the assignment moves to a Web Worker.

### 7. Plan the motion

Each drone flies a straight line from its grid position to its target.
All drones share one progress value `s`, which goes from 0 to 1.

```
position(t) = start + s(t) × (target − start)
```

`s(t)` is a trapezoid profile: accelerate, cruise, brake.
The simulator picks the fastest profile that keeps every drone inside every limit.

```
For each drone:
  h    = horizontal length of its path
  up   = height gained (0 if it descends)
  down = height lost   (0 if it climbs)
  len  = full length of its path

V = smallest of (maxHorizontalSpeed ÷ h, maxClimbSpeed ÷ up, maxDescentSpeed ÷ down) over all drones
A = smallest of (maxAcceleration ÷ len) over all drones

If V² ≥ A:  duration = 2 ÷ √A          (no cruise phase)
Otherwise:  duration = 1 ÷ V + V ÷ A
```

A term with a zero divisor sets no limit.

Position is a direct function of time.
The timeline can jump to any time with no simulation steps.

The timeline has two parts: the transition, then the hold.

### 8. Report the checks

| Readout | How it is computed |
|---|---|
| Formation spacing | Smallest distance between two targets. |
| Transition duration | From step 7. |
| Closest approach in flight | Exact. For each pair of drones, the relative position moves along a straight segment. The simulator takes the shortest distance from that segment to zero. |
| Peak speed | Longest path × peak rate of `s`. |

The closest approach readout turns red below the minimum spacing.

## User interface

The 3D view fills the page.
A sidebar sits on the right.
A transport bar sits under the 3D view.

### Sidebar

Each section is a native `<details>` element.

| Section | Contents |
|---|---|
| Project | Export button. Import button. |
| Fleet | Drone count. The five limits. Takeoff grid spacing. |
| Formation | Shape selector. Import OBJ button and up axis selector. Size, center height, yaw, color, hold time. Spacing readout and Fit button. |
| Checks | Transition duration, closest approach in flight, peak speed. |
| View | Show paths toggle. Audience view button. |
| Drones | List of all drones: id, position, and speed at the current time. |

The drone list draws only the rows that are visible, so 1,000 drones stay fast.

### Selection

A click on a list row or on a drone in the 3D view selects that drone.
The selected drone gets a larger light, a bright path, and a highlighted list row.
A click on empty space or the Escape key clears the selection.

### 3D view controls

| Input | Action |
|---|---|
| Drag | Orbit |
| Wheel | Zoom |
| Right-drag or Shift-drag | Pan |

The Audience view button puts the camera 150 m in front of the takeoff grid at eye height.

### Transport bar

Play and pause button, scrubber, and time readout.
The Space key toggles play and pause.

## Rendering

- Background: a dark night sky.
- Ground: a line grid on `z = 0`.
- Drones: one `gl.POINTS` draw call. The fragment shader draws a soft glowing disc. Blending is additive. Point size shrinks with distance but has a minimum, so far drones stay visible.
- Paths: one `gl.LINES` draw call for all paths at low opacity. A second draw call for the selected path at full brightness.
- Camera: a hand-written orbit camera with a perspective projection.
- Picking: on a click, the code projects every drone to screen space and takes the nearest one inside 10 pixels.
- The canvas follows `devicePixelRatio`.

## Project file

The project file is JSON with the extension `.droneshow.json`.

```json
{
  "app": "drone-show-sim",
  "version": 1,
  "fleet": {
    "count": 100,
    "maxHorizontalSpeed": 8,
    "maxClimbSpeed": 3,
    "maxDescentSpeed": 3,
    "maxAcceleration": 4,
    "minSpacing": 2,
    "gridSpacing": 3
  },
  "formations": [
    {
      "name": "Sphere",
      "source": { "type": "builtin", "shape": "sphere" },
      "size": 40,
      "centerHeight": 60,
      "yaw": 0,
      "color": "#66ccff",
      "holdSeconds": 10,
      "seed": 1
    }
  ]
}
```

An OBJ formation stores the full OBJ text:

```json
{ "type": "obj", "fileName": "whale.obj", "upAxis": "y", "text": "v 0 0 0\n..." }
```

`formations` holds exactly one entry in version 1.
It is an array because the storyboard feature adds more.

Import checks the `app` name, the `version`, and every value.
It shows a message and changes nothing when a check fails.

## Code layout

```
index.html        page skeleton: canvas, sidebar, transport bar
style.css
package.json      no dependencies; marks the code as ES modules and names the test scripts
src/
  main.js         start-up; connects state, plan, renderer, and user interface
  state.js        default state, updates, project file export and import
  rng.js          seeded random number generator
  shapes.js       built-in shape generators
  obj.js          OBJ parser and triangle sampler
  sample.js       farthest point sampling, smallest spacing
  assign.js       Hungarian algorithm
  motion.js       takeoff grid, trapezoid timing, position at a time, closest approach
  mat4.js         matrix helpers for the camera
  camera.js       orbit camera and mouse input
  renderer.js     WebGL2 shaders, buffers, and draw calls
  ui.js           sidebar controls, drone list, transport bar
test/
  *.test.js       unit tests
tools/
  smoke.js        headless browser smoke test
```

`rng.js`, `shapes.js`, `obj.js`, `sample.js`, `assign.js`, and `motion.js` are pure.
They use no DOM and no WebGL, so Node can run their tests.
The project file functions in `state.js` follow the same rule.

## Tests

The owner tests the visuals by hand.

Unit tests use the Node built-in test runner.
`npm test` runs `node --test test/`.
No `npm install` is necessary.

| Module | What the tests check |
|---|---|
| `sample.js` | Target count. The first N picks stay the same for a larger N. Smallest spacing on a known point set. |
| `assign.js` | Each drone gets one target. The total cost equals a brute-force search on small cases. |
| `motion.js` | Duration for known cases. No limit is exceeded. Positions at the start and the end. Closest approach equals a dense time scan. |
| `obj.js` | Triangles, faces with four corners, negative indices, up axis. |
| `state.js` | Export then import gives the same state. Import rejects bad files. |

The smoke test is `npm run smoke`.
It serves the folder, opens the page in headless Chrome or Chromium, and reads a marker.
The page sets `data-smoke="ok"` on the `<html>` element after the first frame.
It sets `data-smoke="error"` on an uncaught error or a WebGL failure.

The smoke test uses the `--dump-dom` flag of Chrome, so it needs no npm package.
Milestone 1 confirms that this flag waits for the first frame.
If it does not, the fallback is Playwright as a development-only dependency.

## Hosting

GitHub Pages serves the repository root from a branch.
The site needs no build and no workflow file.
All URLs in the code are relative, so the site works under `/drone-show-sim/`.

The owner makes the repository public and turns on Pages when a build is ready to test.
Before that, a local static server runs the site: `uv run python -m http.server 8000`.

## Milestones

The owner tests each milestone in the browser before the next one starts.

| # | Name | Result |
|---|---|---|
| 1 | Lights on | Page layout, WebGL2 renderer, orbit camera, ground grid. Drones glow on the takeoff grid. Drone count control. `package.json` and the smoke test. |
| 2 | Shapes | Built-in shapes, sampler, formation controls. Spacing readout and Fit button. The view shows the drones in the formation. |
| 3 | Flight | Assignment, motion plan, limit controls, transport bar, paths, checks readout. |
| 4 | Fleet | Drone list with live data. Selection from the list and from the 3D view. |
| 5 | Files | OBJ import. Project file export and import. |
| 6 | Publish | GitHub Pages setup and a README. |

## Future features

These are not part of version 1.
The notes record how the version 1 design leaves room for them.

- Slow turn. A formation rotates or sways as one rigid body, so the audience sees its depth. The rotation angle is a direct function of time, so the timeline still jumps to any time. The speed check is `turn rate × largest radius ≤ maximum horizontal speed`.
- Storyboard. A show is an ordered list of formations. Each transition uses steps 6 to 8 again, with the previous formation as the start. If the closest approach readout fails for a transition, that transition needs a better plan, for example staggered starts or waypoints.
- More shape inputs: SVG outlines, point lists, GLB models. Each one is a new source of candidate clouds. The steps after step 1 do not change.
- Edge placement, gradients, and color per drone.
- Export to a show format such as VVIZ.

## Out of scope

- Mobile layout.
- Wind, battery, GPS error, and drone failure.
- Music sync and pyrotechnics.
- Control of real drones.
- Undo and redo.
- A server. The site is static files only.
