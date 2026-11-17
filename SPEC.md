# Drone show simulator: specification

Status: the simulator plays a show of several formations. `README.md` tells how to run and publish it.

## Purpose

A browser tool that previews a drone light show in 3D.
The drones take off from a ground grid, fly to each formation of a storyboard in turn, and land.

The tool is visual-first.
It uses real units and real drone limits, so a flyable export can come later.

## Terms

The fleet works like a marching band.
A formation is a picture that the band makes on the field.
The storyboard is the list of pictures of the show.
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
| Storyboard | The ordered list of formations in a show. |
| Takeoff grid | The ground positions where the drones start, and where they land. |
| Stop | A place where the fleet rests: the takeoff grid or a formation. |
| Transition | The flight from one stop to the next. |
| Hold | The time that the fleet stays at a stop. |
| Step | One transition and the hold after it. A show is a list of steps. |
| Assignment | The mapping from each drone to one target. The drill chart. |
| Flight volume | The cube that the drones must stay inside. |

Formation, transition, and storyboard are the terms that Skybrush uses.

## Decisions

| Topic | Decision |
|---|---|
| Purpose | Visual-first preview with real units. No flyable export yet. |
| Platform | Desktop browsers with WebGL2. No mobile layout. |
| Rendering | Raw WebGL2. No 3D library. |
| Language | Plain JavaScript, native ES modules, JSDoc types. No build step. |
| Runtime dependencies | None. |
| Fleet size | 1 to 1,000 drones. Default 100. |
| Shape inputs | Built-in shapes and OBJ files. |
| Drone placement | Even spread over the surface of the shape. |
| Show | Takeoff, 1 to 20 formations in storyboard order, and a landing that the user can turn off. |
| Color | One color per formation. The light color blends in the transition between two formations. |
| Drone list | A list with live data, in its own sidebar tab. Select a drone to highlight it and its route. |
| Path display | The paths of the current step, faint. The route of the selected drone, bright. A toggle hides the faint paths. |
| Spacing conflict | Markers and readouts warn. A Fit button sets the smallest safe size. |
| Flight volume | A cube with one size value and a position. The view draws it. A check counts the drones that leave it. |
| Saving | Export and import of a JSON project file. |
| Tests | Node unit tests for the math. One headless browser smoke test. |
| Hosting | GitHub Pages from the repository root. |

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
| Flight volume size | 120 m |
| Flight volume position | Centered on the origin, floor on the ground |
| Storyboard | A 40 m sphere, a 100 m heart, and a 50 m torus. Each has its center at 60 m and a hold of 10 s. |
| Landing | On |

The limits are starting values in the range that show design tools use.
They do not come from one drone model.
The user can edit every value.

The default show passes every check with 100 drones.

### Flight volume

The flight volume is a cube with sides along the world axes.
One size value sets its edge length.

`x` and `y` set the center of the cube. `z` sets the height of its floor.
A larger size grows the cube up and out from the middle of its floor.
A cube that stands on the ground then stays on the ground.

The view draws the 12 edges of the cube.
The edges turn red when a drone leaves the cube.

## How the simulator computes a show

A show is a list of steps.
In each step the fleet flies to a stop and then holds there.
The stops are the formations in storyboard order, and then the takeoff grid again when the show ends with a landing.

Each stage below is a pure function of its inputs.
The planner stores the results of the slow stages and runs a stage again only when one of its inputs changes.

### 1. Shape to candidate cloud

Each shape produces 20,000 points in unit space.
In unit space the shape is centered on the origin and its largest extent is 1.
A seeded random number generator makes the points, so the same project always gives the same result.

Built-in shapes are small generator functions.
There are seven: sphere, cube, torus, disc, ring, helix, and heart.
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

For each formation, the simulator finds the smallest distance between any two targets.
The readout shows this distance in red when it is below the minimum spacing.

Spacing grows in proportion to size.
The Fit button sets the size so that the smallest distance is `√2 × minimum spacing`.
The factor `√2` is the margin that stage 6 needs: with it, the drones also keep the minimum spacing in flight.

### 5. Build the takeoff grid

The grid is close to square: the column count is `ceil(sqrt(N))`.
Drone ids run from 1 to N, row by row.

The default grid spacing of 3 m is more than `√2 × 2 m`, so the grid has the same margin as a fitted formation.

### 6. Assign drones to targets

For each transition, the solver pairs the points of the two stops.
It finds the pairs with the smallest total of squared distances.
It uses the Jonker-Volgenant algorithm, which gives the same result as the Hungarian algorithm in less time.

Squared distance matters.
With this assignment and with all drones on the same count, straight paths stay apart.
If the closest spacing at both stops is `D`, the closest approach in flight is at least `D ÷ √2`.
Skybrush documents the same bound.

The drones are interchangeable.
A drone goes to the target that the pairs give for the point where it is now.
The landing uses the same rule, so a drone can land on a grid cell that is not the one it started from.

The pairs of a transition depend only on the shapes of its two stops:

- They do not depend on which drone is at which point.
- They do not change when a whole stop moves. A shift changes every total by the same amount.

The planner stores the pairs under a key made from the two shapes and the drone count.
A change to one formation then needs new pairs for two transitions only: the one before it and the one after it.
A change of formation height or color needs none.

The solver is the slowest stage.
Measured on a slow cloud CPU: under 30 ms per transition at 300 drones, and 0.2 to 0.5 seconds per transition at 1,000 drones.
Above 250 drones, a slider applies its value when the user lets go, not at each step of the drag.

### 7. Plan the motion

In a transition each drone flies a straight line between its two positions.
All drones share one progress value `s`, which goes from 0 to 1.

```
position(t) = from + s(t) × (to − from)
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

Each step starts when the step before it ends: after that step's transition and hold.
The landing has no hold.

Position is a direct function of time.
The timeline can jump to any time with no simulation steps.

### 8. Report the checks

The Checks section shows the worst value of the whole show.

| Readout | How it is computed |
|---|---|
| Show duration | The end of the last step. |
| Drones outside volume | Number of drones that leave the flight volume at some time. A drone flies straight lines and the volume is a box, so the drone stays inside exactly when each of its stops is inside. A position on a face of the box is inside. |
| Lowest target | Height of the lowest target of any formation. Red when it is below the ground. |
| Closest approach in flight | The smallest value of any transition. The value of a transition is exact: for each pair of drones, the relative position moves along a straight segment, and the simulator takes the shortest distance from that segment to zero. Red below the minimum spacing. |
| Peak speed | The largest value of any transition: longest path × peak rate of `s`. |

A formation has a problem when one of these is true:

- Its targets are closer than the minimum spacing.
- A target is below the ground.
- A target is outside the flight volume.
- Drones come closer than the minimum spacing in the transition to it.

The storyboard list and the timeline mark each formation that has a problem.
The timeline also marks a landing in which drones come too close.

## User interface

The 3D view fills the page.
A sidebar sits on the right. It has two tabs: Settings and Drones.
A transport bar sits under the 3D view.

### Settings tab

The Settings tab holds the sections. Each section is a native `<details>` element.

| Section | Contents |
|---|---|
| Project | Export button. Import button. |
| Fleet | Drone count. The five limits. Takeoff grid spacing. |
| Flight volume | Size. Center X and Y. Floor height. |
| Storyboard | One row per formation: color, number, shape name, and a problem marker. Add, Remove, Earlier, and Later buttons. Land at the end toggle. |
| Formation | The settings of the formation that is selected in the storyboard: shape selector, Import OBJ button and up axis selector, size, center height, yaw, color, hold time. Spacing readout and Fit button. |
| Checks | Show duration, drones outside volume, lowest target, closest approach in flight, peak speed. |
| View | Show paths toggle. Show flight volume toggle. Audience view button. |

### Storyboard

A click on a storyboard row selects that formation.
The Formation section then shows its settings, and the timeline moves to the start of its hold, so the 3D view shows the formation.

Add puts a new formation after the selected one.
The new formation keeps the size and place of the selected one, and gets the next built-in shape and the next color.
Remove takes the selected formation out. The last formation stays.
Earlier and Later swap the selected formation with its neighbor.

### Drones tab

The Drones tab holds the drone list: the id, position, and speed of each drone at the current time.
The list fills the height of the sidebar.
It draws only the rows that are visible, so 1,000 drones stay fast.

When the Drones tab opens, the list scrolls to the selected drone.
The left and right arrow keys move between the tabs.

### Selection

A click on a list row or on a drone in the 3D view selects that drone.
The selected drone gets a larger light, a bright route, and a highlighted list row.
A click on empty space or the Escape key clears the selection.

### 3D view controls

| Input | Action |
|---|---|
| Drag | Orbit |
| Wheel | Zoom |
| Right-drag or Shift-drag | Pan |

The Audience view button puts the camera 150 m in front of the takeoff grid at eye height.
It aims the camera at the center of the selected formation.

### Transport bar

Play and pause button, timeline strip, scrubber, and time readout.
The Space key toggles play and pause.

The timeline strip shows the whole show.
Each transition and each hold is one block, and the width of a block shows how long it takes.
A hold block has the number and the color of its formation.
A white line shows the current time.
A click on a block selects its formation. A click on the landing block moves the timeline to the start of the landing.

The page opens on the first formation.
Play at the end of the timeline starts again from the takeoff grid.
When the plan changes, the timeline keeps the same moment: the end stays the end, a time in a hold stays in that hold, and a time in a transition keeps its share of that transition.

## Rendering

- Background: a dark night sky.
- Ground: a line grid on `z = 0`.
- Audience: a short line on the ground marks where the audience stands.
- Flight volume: one `gl.LINES` draw call for the edges of the cube.
- Drones: one `gl.POINTS` draw call. The fragment shader draws a soft glowing disc. Blending is additive. Point size shrinks with distance but has a minimum, so far drones stay visible.
- Light color: the color of the formation of the current step. In a transition between two formations the color blends from one to the other. Takeoff uses the color of the first formation. The landing keeps the color of the last one.
- Paths: one buffer holds one line per drone per step. The view draws the lines of the current step at low opacity. In a hold, the current step is the one that led to the hold.
- Route: for the selected drone, the view draws its line in every step. The line of the current step is brightest.
- Long lines are split into short segments. A software WebGL renderer drops a whole line when one end is behind the camera.
- Camera: a hand-written orbit camera with a perspective projection.
- Picking: on a click, the code projects every drone to screen space and takes the nearest one inside 10 pixels.
- The canvas follows `devicePixelRatio`.

## Project file

The project file is JSON with the extension `.droneshow.json`.

```json
{
  "app": "drone-show-sim",
  "version": 2,
  "fleet": {
    "count": 100,
    "maxHorizontalSpeed": 8,
    "maxClimbSpeed": 3,
    "maxDescentSpeed": 3,
    "maxAcceleration": 4,
    "minSpacing": 2,
    "gridSpacing": 3
  },
  "volume": {
    "size": 120,
    "x": 0,
    "y": 0,
    "z": 0
  },
  "formations": [
    {
      "source": { "type": "builtin", "shape": "sphere" },
      "size": 40,
      "centerHeight": 60,
      "yaw": 0,
      "color": "#66ccff",
      "holdSeconds": 10,
      "seed": 1
    }
  ],
  "landAtEnd": true
}
```

An OBJ formation stores the full OBJ text:

```json
{ "type": "obj", "fileName": "whale.obj", "upAxis": "y", "text": "v 0 0 0\n..." }
```

`formations` is the storyboard. It holds 1 to 20 entries, in show order.

The simulator writes version 2 and reads versions 1 and 2.
Version 1 had exactly one formation and no landing.
A file with no `landAtEnd` gets no landing, and a file with no `volume` gets the default flight volume. Older files then load with their old meaning.

Import checks the `app` name, the `version`, and every value.
It shows a message and changes nothing when a check fails.

## Code layout

```
index.html        page skeleton: canvas, sidebar, transport bar
style.css
package.json      no dependencies; marks the code as ES modules and names the test scripts
README.md         how to run, use, test, and publish the simulator
.nojekyll         tells GitHub Pages to serve the files as they are
docs/
  screenshot.png  picture for the README
src/
  main.js         start-up; connects state, plan, renderer, and user interface
  state.js        default state, field limits, project file export and import
  plan.js         runs the stages from state to plan and stores results that did not change
  rng.js          seeded random number generator
  shapes.js       built-in shape generators
  obj.js          OBJ parser and triangle sampler
  sample.js       farthest point sampling, smallest spacing
  assign.js       assignment solver (Jonker-Volgenant algorithm)
  motion.js       takeoff grid, trapezoid timing, closest approach
  mat4.js         matrix helpers for the camera
  camera.js       orbit camera and mouse input
  renderer.js     WebGL2 shaders, buffers, and draw calls
  ui.js           sidebar tabs and controls, storyboard, drone list, transport bar
test/
  *.test.js       unit tests
tools/
  smoke.js        headless browser smoke test
```

`state.js`, `plan.js`, `rng.js`, `shapes.js`, `obj.js`, `sample.js`, `assign.js`, and `motion.js` are pure.
They use no DOM and no WebGL, so Node can run their tests.

## Tests

Claude builds and checks every change without help from the owner.
The checks have three levels:

1. Unit tests, after each change to a math module.
2. The smoke test, after each change to the page.
3. Screenshots from a headless browser, only when a change needs a visual check. The screenshot scripts are not part of the repository.

Unit tests use the Node built-in test runner.
`npm test` runs `node --test`.
No `npm install` is necessary.

| Module | What the tests check |
|---|---|
| `sample.js` | Target count. The first N picks stay the same for a larger N. Smallest spacing on a known point set. |
| `assign.js` | Each drone gets one target. The total cost equals a brute-force search on small cases, and the plain Hungarian algorithm on larger cases. |
| `motion.js` | Duration for known cases. No limit is exceeded. Positions at the start and the end. Closest approach equals a dense time scan. |
| `obj.js` | Triangles, faces with four corners, negative indices, up axis. |
| `state.js` | Export then import gives the same state. Import rejects bad files. Version 1 files load. |
| `plan.js` | One formation: targets, timeline, checks. Storyboard: one step per formation, no jump between steps, each stop holds every target one time, the closest approach bound, stored results equal fresh results. |

The smoke test is `npm run smoke`.
It serves the folder, opens the page in headless Chrome or Chromium, and reads a marker.
The page sets `data-smoke="ok"` on the `<html>` element after the first frame.
It sets `data-smoke="error"` on an uncaught error or a WebGL failure.

The smoke test uses the `--dump-dom` flag of Chrome, so it needs no npm package.
It also sets `--virtual-time-budget`. Without that flag, Chrome prints the page before the first frame.
The `CHROME_PATH` environment variable selects the browser binary.

## Hosting

GitHub Pages serves the repository root from a branch.
The site needs no build and no workflow file.
All URLs in the code are relative, so the site works under `/drone-show-sim/`.
`README.md` lists the steps to turn Pages on.

A local static server also runs the site: `uv run python -m http.server 8000`.

## Milestones

Claude checks each milestone before the next one starts. Each milestone is one or more commits.

| # | Name | Result | Status |
|---|---|---|---|
| 1 | Lights on | Page layout, WebGL2 renderer, orbit camera, ground grid. Drones glow on the takeoff grid. | Done |
| 2 | Shapes | Built-in shapes, sampler, formation controls. Spacing readout and Fit button. | Done |
| 3 | Flight | Assignment, motion plan, limit controls, transport bar, paths, checks readout. | Done |
| 4 | Fleet | Drone list with live data. Selection from the list and from the 3D view. | Done |
| 5 | Files | OBJ import. Project file export and import. | Done |
| 6 | Publish | README and GitHub Pages. | Done |
| 7 | Flight volume | A cube that shows where the drones can fly, with a check. | Done |
| 8 | Storyboard | Several formations in one show, a timeline strip, and a landing. | Done |

## Known limits

- Farthest point sampling is greedy. On a surface, the closest pair of targets is about 0.9 of the typical neighbor distance. On an outline with sharp corners, it can be 0.6. Fit then makes the shape larger than a perfect spacing needs. A relaxation step after sampling would improve this.
- Each transition needs its own assignment. A change of drone count or grid spacing needs all of them again. At 1,000 drones this pauses the page for 0.2 to 0.5 seconds per transition on a slow CPU. If this is a problem, the next step is to run the planner in a Web Worker.
- Drones fly straight lines. The closest approach bound needs the spacing margin at both stops of a transition. The simulator does not plan a path around a conflict; it reports the conflict.
- A drone can land on a grid cell that is not the one it started from.
- The OBJ importer puts drones on every surface of the model, also on surfaces inside it.
- The flight volume is a cube. It has no rotation and no separate width, depth, and height.
- Fit changes the size only. A large shape with a low center reaches the ground; the Lowest target check shows this.

## Future features

- Slow turn. A formation rotates or sways as one rigid body in its hold, so the audience sees its depth. The rotation angle is a direct function of time, so the timeline still jumps to any time. The speed check is `turn rate × largest radius ≤ maximum horizontal speed`.
- Motion inside a formation, for example drones that move along an outline like marquee lights.
- More shape inputs: SVG outlines, point lists, GLB models. Each one is a new source of candidate clouds. The stages after stage 1 do not change.
- Edge placement, gradients, and color per drone.
- Export to a show format such as VVIZ.

## Out of scope

- Mobile layout.
- Wind, battery, GPS error, and drone failure.
- Music sync and pyrotechnics.
- Control of real drones.
- Undo and redo.
- A server. The site is static files only.
