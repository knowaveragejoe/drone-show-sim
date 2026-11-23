# Drone show simulator: specification

Status: the simulator plays a show of several formations. A formation can tilt, turn, sway, rock, and roll, its drones can have their own colors, and a light chase can run across it. The Project menu opens two demo shows. The 3D view shows a night sky, a field, hills, and a crowd, and Showtime plays the show full screen from the crowd. `README.md` tells how to run and publish it.

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
When the march would bring two marchers too close, the band first opens its ranks, then crosses, then closes its ranks at the new picture.

| Term | Meaning |
|---|---|
| Drone | One aircraft with one colored light. |
| Fleet | All drones in the show. |
| Shape | The geometry that a formation is made from: a built-in shape, an imported OBJ model, or an imported SVG drawing. |
| Candidate cloud | A dense set of points on a shape. The sampler picks targets from it. |
| Target | One position in a formation. Each drone gets one target. |
| Formation | One static picture made of drones: a shape plus its size, position, and color. |
| Storyboard | The ordered list of formations in a show. |
| Takeoff grid | The ground positions where the drones start, and where they land. |
| Stop | A place where the fleet rests: the takeoff grid or a formation. |
| Transition | The flight from one stop to the next. It has one leg, or more when the fleet spreads out. |
| Leg | One straight flight of the whole fleet. All drones start and stop together. |
| Spread | A grown copy of a stop. When a direct flight brings drones too close, the fleet spreads out, crosses, and closes up. |
| Hold | The time that the fleet stays at a stop. |
| Tilt | A fixed lean of a formation: forward, toward the audience, and sideways, to the right as the audience sees it. Part of its pose, like the yaw. |
| Turn | A slow rotation of a formation about its own axis during its hold, one way. The formation turns as one rigid body. |
| Swing | A rotation back and forth during the hold that ends where it started. There are three swings: sway, rock, and roll. |
| Sway | A swing about the formation's own axis, like a slow head shake. |
| Rock | A swing toward the audience and back, like a nod. |
| Roll | A swing to the left and to the right as the audience sees it. |
| Light chase | Bright bands that travel across a formation during its hold, like the bulbs of a theater marquee. The drones do not move; only their brightness changes. |
| Audience seat | The place in the crowd where the Audience view and Showtime put the camera: at eye height, 10 m behind the front row of the crowd. |
| Showtime | A mode that hides the panels and plays the whole show full screen, from the audience seat. |
| Color pattern | How the drones of a formation get their light colors: one solid color, a gradient, or the drawing colors of an SVG drawing. |
| Gradient | A blend from the formation color to a second color across the formation: rising, across, or outward. |
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
| Shape inputs | Built-in shapes, OBJ models, and SVG drawings. |
| Drone placement | Even spread over the surface of a 3D shape, or along the outlines of a flat shape and of an SVG drawing. |
| Show | Takeoff, 1 to 20 formations in storyboard order, and a landing that the user can turn off. |
| Color | Each drone has its own light color. A formation has a color pattern: one solid color, a gradient of two colors (Rising, Across, or Outward), or, for an SVG drawing, the colors of the drawing. In a transition each drone blends from its old color to its new color. |
| Hold motion | Each formation can have a fixed tilt, forward and sideways. In its hold it can turn, sway, rock, and roll, all at the same time. The turn lets the audience see the depth of the shape. Each swing ends where it started. |
| Light chase | Each formation can run a light chase in its hold: Around, Rising, or Across, with a number of bands and a speed. |
| Scenery | A night sky with stars, a field, hills on the horizon, and a crowd at the audience line. They show the place and the scale of the show. The editor shows them too, with a faint grid on the field. |
| Showtime | A Showtime button plays the whole show full screen from the audience seat. The camera follows the show. |
| Drone list | A list with live data, in its own sidebar tab. Select a drone to highlight it and its route. |
| Path display | The paths of the current step, faint. The route of the selected drone, bright. A toggle hides the faint paths. |
| Spacing conflict | Markers and readouts warn. A Fit button sets the smallest safe size. |
| Crossing conflict | When a direct flight brings drones too close, the fleet spreads out, crosses, and closes up. A setting turns this off. |
| Flight volume | A cube with one size value and a position. The view draws it. A check counts the drones that leave it. |
| Saving | Autosave in browser storage. Export and import of a JSON project file. |
| Demos | Demo shows as project files in the `demos` folder. The Project menu opens them. Each one passes every check. |
| Undo | Undo and redo of every change to the project. Quick changes of one field make one step. |
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
| Storyboard | A 40 m sphere, a 100 m heart, and a 50 m torus. Each has its center at 60 m and a hold of 10 s. The sphere turns at 6°/s, the torus at −6°/s. The heart is flat, so it does not turn; it runs a light chase around its outline instead, with 5 bands at 0.25 laps/s, and it rocks 5° toward the audience and back. The torus leans 20° toward the audience, and it has an outward gradient from orange on its inner ring to pink on its outer ring. |
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

Each shape produces 40,000 points in unit space.
In unit space the shape is centered on the origin and its largest extent is 1.
A seeded random number generator makes the points, so the same project always gives the same result.

A shape is a surface or a curve:

- The points of a surface are random and spread evenly over its area.
- The points of a curve are in order along the curve, one curve after the other. The curves are cut into 40,000 slices of equal length, and each slice gets one point at a random place in it. Points that are fully random would leave gaps of about ten times the mean gap. Stage 2 needs points with no large gaps, because each target is one of the points.

Built-in shapes are small generator functions.
There are seven: sphere, cube, torus, disc, ring, helix, and heart.
The sphere, cube, torus, and disc are surfaces. The ring, helix, and heart are curves. A curve finds places of equal length on it from a table of 4,096 straight pieces.
The disc, ring, and heart are flat. They stand upright and face the audience.
An OBJ model is a surface. An SVG drawing is curves.

For an OBJ file, the simulator does these steps:

1. Parse the vertices and faces. Split each face with more than three corners into triangles.
2. Convert the up axis to Z. OBJ files usually use Y up, so Y is the default. The user can select Z.
3. Center the model and scale it to unit size.
4. Pick random points on the triangles. A larger triangle gets more points in proportion to its area.

The parser ignores materials, textures, and normals.

For an SVG file, the simulator does these steps:

1. Read the elements with a small tag reader in plain JavaScript. The reader needs no DOM, so Node can test it.
2. Read the outlines of `path`, `rect` (also with round corners), `circle`, `ellipse`, `line`, `polyline`, and `polygon`.
3. Read all path commands, also arcs and the short forms. Curves and arcs become short straight segments.
4. Apply the `transform` of each element and of its groups.
5. Skip the contents of elements that the browser does not draw where they stand, such as `defs`, `clipPath`, and `mask`, and elements with `display: none`.
6. Give each outline a color: its stroke color, or its fill color when it has no stroke. The reader takes `stroke`, `fill`, and `color` (for `currentColor`) from attributes, from the `style` attribute, and from the groups around the element. The `style` attribute wins over an attribute. It reads `#rgb`, `#rrggbb` (also with alpha), `rgb()`, `rgba()`, and the basic CSS color names. An outline with `none`, a gradient, or an unknown value has no color.
7. Center the drawing and scale it to unit size. It stands upright in the XZ plane and faces the audience. SVG y points down, so the reader turns it to point up.
8. Pick points along the outlines, in order, one in each slice of equal length. A longer outline gets more points in proportion to its length. Each point gets the color of its outline.

Like a browser, the path reader stops at the first error in path data and keeps what it read before it.
The drones go on the outlines only, also for a filled shape.

### 2. Candidate cloud to targets

Each target is one point of the cloud, so it is on the shape, and it has the color of that point.
The aim is an even spacing: the closest pair of targets should be as far apart as the shape allows. Fit sizes a formation by its closest pair, so a more even spacing gives a smaller formation, shorter flights, and a shorter show.

Think of 40,000 grains of sand on the shape.
The sampler keeps the grains that are as far apart as possible.

**A surface** gets two steps:

1. Farthest point sampling. The sampler starts with one point. At each step it picks the point that is farthest from all picked points.
2. Farthest point optimization. Each pick in turn moves to the point within half the median spacing of it that is farthest from all other picks, when that point is farther than its place now. This repeats until no pick moves, or for 30 passes. It usually stops after about 10 passes.

A move never brings two picks closer than the smallest spacing before it, so the smallest spacing can only grow.
Farthest point sampling alone gives a closest pair of about 0.7 of a perfect hexagonal spacing. The optimization adds 7 to 18 percent. A larger cloud would let it add more, but it would take more time.

**A curve** gets a walk. The walk goes through the points in order and keeps each point that is at least a spacing `s` from every point that it kept before. A bisection finds the largest `s` that keeps one point per drone, to 0.1 percent.
Along a curve, neighbors are then close to `s` apart. Where a curve comes back near itself, at a cusp such as the top and the bottom of the heart, or near another outline, the walk skips the points that are too close. The closest pair of targets is at least `s`. On a ring, a helix, or the heart this is 0.97 to 1.0 of the ideal spacing (the length divided by the drone count). Farthest point sampling alone gave 0.5 to 0.9 on curves: it halves some gaps and leaves the others.

The targets depend on the drone count. A change of count gives new, evenly spread targets.
The planner stores the targets of each shape and drone count.

The farthest point sampler uses a grid of cells, about 8 candidates per cell.
Each candidate keeps its squared distance to its nearest pick. After a pick, no candidate is farther from its nearest pick than the farthest candidate, so a new pick can only change the candidates within that distance of it.
A pick visits only the cells within that distance. Each cell keeps its farthest candidate, so the search for the next pick visits one value per cell.
The picks are the same as those of a plain search of every candidate, also for ties: of candidates at the same distance, the one with the lowest index wins.
The first N picks are the same for every larger N, so the sampler picks only as many as it needs, and picks more from where it stopped.

The optimization and the walk use hashes of grid cells. The walk first checks the point that it kept last, which rejects most points with one distance check.
At 1,000 drones the optimization takes about 50 to 120 ms per surface, and the walk about 20 to 35 ms per curve.

### 3. Place the formation

The simulator scales each unit point by the formation size. This gives the body of the formation: its points in its own axes, about its center.
It then rotates each point about the center and moves it to the formation center, which is above the origin at the center height.

The rotation has three parts, in this order:

1. The yaw turns the formation about its own vertical axis.
2. The sideways tilt leans its top to the right as the audience sees it: a rotation about the Y axis.
3. The forward tilt leans its top toward the audience: a rotation about the X axis.

So a tilted formation keeps leaning toward the audience while it turns about its own tilted axis.
A rotation keeps every distance between two points, so the tilt does not change the spacing.
The assignment key names the yaw and both tilts, so a tilt change needs new assignments for the transitions before and after the formation.

### 4. Check the spacing

For each formation, the simulator finds the smallest distance between any two targets.
The readout shows this distance in red when it is below the minimum spacing.

Spacing grows in proportion to size.
The Fit button sets the size so that the smallest distance is the minimum spacing.
When the spread is off, Fit adds a margin: the smallest distance is then `√2 × minimum spacing`.
That margin is what stage 6 needs: with it, a direct flight also keeps the minimum spacing.
With the spread on, the margin is not necessary, so Fit makes shapes about 30% smaller.

### 5. Build the takeoff grid

The grid is close to square: the column count is `ceil(sqrt(N))`.
Drone ids run from 1 to N, row by row.

The default grid spacing of 3 m is more than `√2 × 2 m`, so the grid has the same margin as a formation that Fit sets with the spread off.

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

The pairs of a transition depend only on the shapes and the rotations of its two stops:

- They do not depend on which drone is at which point.
- They do not change when a whole stop moves. A shift adds the same amount to the total of every pairing.
- They do not change when a whole stop grows or shrinks. The squared distances expand to `|a|² + |b|² − 2 a·b`, so the best pairing has the largest sum of `a·b`. A uniform scale multiplies that sum by the same positive factor for every pairing.

So the solver works on canonical copies of the two stops: a formation at unit size with its center at the origin, and the takeoff grid at unit spacing with its first cell at the origin.
The planner stores the pairs under a key made from the two shapes, their rotations, and the drone count.
A change of formation size, formation height, grid spacing, or color then needs no new pairs.
A change to one formation's shape or yaw needs new pairs for two transitions only: the one before it and the one after it.
A turning formation is the one exception for size: its turn angle depends on its radius, so a size change moves the pose that the next transition starts from.

Several measures make the solver fast:

| Measure | Effect |
|---|---|
| Canonical copies | A size, height, or spacing change needs no solve. |
| A store of the last 256 results | Undo, redo, and a value set back need no solve. |
| Warm start | A solve that is not in the store starts from the last solution between the same two shapes. It keeps each earlier pair that is still the cheapest of its row, and the solver assigns only the other drones. A small change of drone count then frees only the drones that changed, and a yaw change gets 2 to 5 times faster. The canonical grid keeps each drone at the same cell for every drone count with the same grid width, so the warm start stays good. A warm start from a solution with fewer than 75% of the drones is not used. |
| Coarse to fine | A cold solve of 400 drones or more first solves a spread sample of a quarter of the drones and targets, in farthest point order. That solution is the warm start of the full solve. This halves the time of a cold solve. |
| Lazy sampling | The farthest point sampler picks only as many targets as there are drones, and picks more when the count grows. |
| Stored pairings | Autosave keeps the pairings of the last plan with the project. On the next page load, they are the warm starts of the first plan, so each solve only checks them. |

The result does not depend on which measures ran.
A tie-break term makes the best pairing unique: each drone and target pair gets an extra cost of up to one part in 100 million of the largest cost, from a fixed hash of the pair.
Geometry often has many pairings with the same total, for example from the flat takeoff grid to a flat shape. Without the term, rounding errors would choose among them, and a warm start could give another pairing than a cold start.
The term is far below any cost difference that matters: less than a millionth of a square meter for a drone of a real show.

Measured on a slow cloud CPU at 1,000 drones:

| Change | Time |
|---|---|
| Size, height, grid spacing, color, chase, undo, redo | 3 to 30 ms |
| A swing angle or swing time | 5 to 40 ms: a new check of the hold |
| Turn rate of a turning formation, size of a turning formation | about 50 ms |
| Drone count by a few drones | 0.5 to 0.8 seconds: new targets for each shape, and warm solves |
| A new shape, a yaw change, or a tilt change | 0.2 to 0.7 seconds |
| A cold plan of the default show | about 1 second |
| A page open with stored pairings | about 0.35 seconds of planning |

A slider for drone count, yaw, tilt, or turn rate applies each step of a drag up to 250 drones. Above 250 drones, it applies its value when the user lets go. The other sliders apply each step at every fleet size.

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

A transition with a spread has more than one leg.
Each leg is a straight flight with its own trapezoid profile, and the next leg starts when the last one ends.

Each step starts when the step before it ends: after that step's transition and hold.
The landing has no hold.

Position is a direct function of time.
The timeline can jump to any time with no simulation steps.

### 7a. Spread out to pass

A direct flight between two stops can bring drones closer than the minimum spacing.
Stage 6 gives the reason: the bound `D ÷ √2` is less than `D`.
When this happens and the spread setting is on, the fleet flies the transition in three legs:

1. Spread out: the stop that the fleet leaves grows by a factor.
2. Cross: the fleet flies from the spread of the old stop to the spread of the new stop.
3. Close up: the new stop shrinks to its real size.

A stop that does not need to grow has no spread leg.
The takeoff grid never grows, so a takeoff or a landing has two legs.

Why this keeps the drones apart:

- A spread is the same shape at a larger size, moved up or down. Stage 6 shows that this does not change the best pairing. So the pairing of the cross is still the best one for its two ends.
- Take two drones. Let `a` be the offset from one to the other at the start of the cross, and `b` at its end. The pairing is the best one, so `a·b ≥ 0`. In flight, the offset is `(1 − s) a + s b`, and its length is at least `|a| |b| ÷ √(|a|² + |b|²)`. So if the spacing is `A` at the start and `B` at the end, the drones stay at least `A B ÷ √(A² + B²)` apart.
- In a spread leg, each drone moves straight away from one point, so the drones only get farther apart. The closest approach of that leg is the spacing of the stop before the spread, and the planner needs no search for it.

How much the stops grow. Let `m` be the minimum spacing plus 1%. The planner tries several spreads, and checks each one: an exact search finds the closest approach of the crossing. Only a spread that keeps `m` in every leg is a candidate.

- Between two formations, both grow by the same factor `f`. The spread points move, but a move is the same for two drones, so it cancels in the offset between them. Every offset in the crossing is then `f` times the offset of the direct flight, and so is the closest approach. So `f = m ÷ (closest approach of the direct flight)` is just enough. In a stress test of random shows, the median unsafe direct flight came to 1.82 m against a minimum spacing of 2 m, so `f` is 1.11.
- In a takeoff or a landing, only the formation grows. Its closest approach then has no simple formula, so a bisection finds the smallest factor that passes the check, to 1% of the size. The upper end of the search always passed the check, so the result passes, even where the closest approach does not grow steadily with the factor.
- The spread of a bound is also a candidate. With spacing `A` at one end of the crossing and `B` at the other, the drones stay at least `A B ÷ √(A² + B²)` apart (see above). So spacings with `1 ÷ A² + 1 ÷ B² ≤ 1 ÷ m²` are always safe. When one stop is wide already, only the other one grows. This spread is often larger than necessary, but it can be faster when only one end must grow.
- Of the candidates, the planner takes the one that keeps the most drones inside the flight volume, and of those the fastest one.
- When every candidate leaves the flight volume, the planner searches spreads that fit in it: one stop grows alone, or one stop grows as far as the volume lets it and the other as far as it must. The room of a stop is the largest factor that keeps it inside the volume. Across, each drone moves straight away from the vertical axis, so each drone limits the factor by its room to the side of the volume. Up and down, the spread point moves to fit, so only the height of the stop against the height of the volume limits it. These searches take longer, so they run only when they can help.
- A stop with crowded points cannot grow, because its spread leg would start too close. The planner does not try it.
- A check in a search only needs to know if the crossing keeps the distance. It stops at the first pair that comes too close, so a check that fails is often fast.

Measured on 60 random shows at tight sizes, against the spread of the bound only:

| Measure | Bound only | Just enough |
|---|---|---|
| Time that the spreads add to the transitions | 1,369 s | 1,015 s |
| Slowest spread flight, against its direct flight | 3.8 × | 2.6 × |
| Spreads that leave the flight volume | 21 | 9 |

A cold plan of a tight show of 1,000 drones takes 10 to 15% longer, for the searches of the takeoff and the landing. The other shows plan in the same time.

The spread point is on the vertical axis through the origin, which is the axis of every formation.
It is at the middle height of the fleet, so the fleet grows evenly up and down.
It moves up or down when the grown fleet would otherwise go below the floor of the flight volume or above its top.
When the grown fleet cannot fit, the floor wins: no drone goes lower than both the floor and the lowest drone before the spread.

The planner uses a spread only when the spread makes the flight safe.
A spread cannot help when a stop has targets that are too close together, or when the takeoff grid spacing is too small.
The planner then keeps the direct flight, and the checks report the problem.
No stop grows to more than 3 times its size.

A spread makes the transition longer, because the fleet flies farther.
The light color blends in the cross leg only: the fleet spreads out in the old color and closes up in the new one.

### 8. Plan the motion in the hold

In its hold a formation can turn, sway, rock, and roll, all at the same time.
Each motion changes one angle of the pose (stage 3): the turn and the sway add to the yaw, the rock adds to the forward tilt, and the roll adds to the sideways tilt.
The formation moves as one rigid body about its center, so the formation spacing holds through the whole hold.

**Turn.** The turn goes one way. It starts and ends at rest.
It uses the same trapezoid profile as a transition: speed up, keep the rate, slow down.
The ramps use the acceleration limit at the target that is farthest from the axis. That target also has the centripetal acceleration `ω² r` of the turn, so the ramps leave room for it: at the end of a ramp the total acceleration is the limit.
When the formation also sways, rocks, or rolls, the turn ramps use half of the limit, so that the swings have room.
A short hold has no time to reach the turn rate. The turn then speeds up to the middle of the hold and slows down.

**Swings.** A sway, a rock, or a roll has an angle (the largest angle each way) and a swing time (one full swing, back and forth).
The hold fits a whole number of swings, as near to the swing time as it can, and at least one. So each swing ends where it started.
A swing fades in over its first half swing and fades out over its last half swing:

```
angle(t) = A × sin(2π n t ÷ H) × fade(t)
fade(t)  = smooth(t ÷ R) × smooth((H − t) ÷ R)       R = H ÷ (2n)
smooth(x) = 3x² − 2x³, for x from 0 to 1
```

`A` is the angle, `n` the number of swings, and `H` the hold time. The swing starts and ends at rest.

A formation that turns leaves its hold in a new pose: the same shape at a new yaw.
The next transition starts from that pose.
The assignment key of the next transition names the new yaw, so a change of turn rate needs a new assignment for that transition only.
A sway, a rock, or a roll does not change the pose at the end of the hold, so it needs no new assignment.

### 9. Plan the light chase

A light chase gives each drone a place `u` on the path of the bands, from 0 to 1. One lap of the path is 0 to 1.
The path uses the axes of the formation itself, before its yaw and its tilt, so a turned, tilted, or moving formation keeps its pattern.

| Pattern | Path |
|---|---|
| Around | The angle around the formation center, in the plane that faces the audience. 0 is at the top, and the angle grows clockwise as the audience sees it. On an outline such as the heart or the ring, the bands circle the outline. |
| Rising | The height, from the lowest target (0) to the highest (1). |
| Across | The side position, from the left end as the audience sees it (0) to the right end (1). |

At `held` seconds into the hold, with `bands` bands and a speed of `speed` laps per second:

```
phase      = fraction of ((u − speed × held) × bands)
glow       = phase³              (speed ≥ 0)
             (1 − phase)³        (speed < 0)
level      = dim + (1 − dim) × glow
brightness = 1 − fade × (1 − level)
```

Each band has a bright head and a tail that fades behind it. The head leads in the direction that the band moves.
`dim` is 0.12, so the drones outside a band keep the shape visible.
`fade` grows from 0 to 1 over the first second of the hold, and falls back to 0 over the last second.
Outside a hold, and in a formation with no chase, every light is at full brightness.

The chase uses the targets of the drones, so it does not change the assignment or any check.

### 9a. Color the targets

Each target gets a light color from the color pattern of its formation.

| Pattern | Color |
|---|---|
| Solid | The formation color. |
| Rising gradient | A blend from the formation color at the lowest target to the second color at the highest. |
| Across gradient | A blend from the formation color at the left end, as the audience sees it, to the second color at the right end. |
| Outward gradient | A blend from the formation color at the target nearest the formation center to the second color at the farthest target. On a torus, this colors the inner ring and the outer ring. Every target of a sphere is at the same distance from its center, so a sphere gets the formation color only. |
| Drawing colors | The color of the SVG outline that the target comes from. Only an SVG drawing offers this pattern. |

A gradient uses the same paths as the light chase (stage 9), plus the distance from the center for Outward. The paths use the axes of the formation before its yaw and its tilt, so a turned, tilted, or moving formation keeps its colors, like paint.
When all targets are at one place on the path, for example the height of a flat shape that lies on the ground plane, every target gets the formation color.

A drawing is made for paper or a screen, but a drone light is brightest at full power. So the planner scales each drawing color up until its strongest channel is full: dark red becomes red, and black and gray become white. A target on an outline with no color gets the formation color.

Each drone takes the color of its target, so the colors follow the assignment.
In a transition, each drone blends from its color at the old stop to its color at the new stop, in the cross leg.
Takeoff uses the colors of the first formation, and the landing keeps the colors of the last one.
Colors do not change the assignment or any check.

### 10. Report the checks

The Checks section shows the worst value of the whole show.

| Readout | How it is computed |
|---|---|
| Show duration | The end of the last step. |
| Drones outside volume | Number of drones that leave the flight volume at some time. A drone flies straight legs and the volume is a box, so in a transition the drone stays inside exactly when each end of each leg is inside: its stops, and its spreads. In the hold the check looks at the moving formation many times: the pose changes by at most 2° from one look to the next, each swing gets at least 32 looks, and the looks include the ends of the turn ramps. A drone then leaves its true path by at most 0.015% of its distance from the center between two looks. A hold gets at most 4,096 looks. A position on a face of the box is inside. |
| Lowest target | Height of the lowest drone of any formation, at any time in its hold. Red when it is below the ground. |
| Closest approach in flight | The smallest value of any transition. The value of a transition is the smallest value of its legs. The value of a direct flight or a cross is exact: for each pair of drones, the relative position moves along a straight segment, and the simulator takes the shortest distance from that segment to zero. The value of a spread leg is the spacing at its small end (stage 7a). Red below the minimum spacing. |
| Peak speed | The largest value of any step. In a leg: longest path × peak rate of `s`. In a hold: the fastest drone at any look. A look finds the velocity and the acceleration of each drone from its positions 1 ms before and after. |

A formation has a problem when one of these is true:

- Its targets are closer than the minimum spacing.
- A drone is below the ground at some time in the hold.
- A drone is outside the flight volume at some time in the hold.
- Drones come closer than the minimum spacing in the transition to it.
- Drones leave the flight volume when they spread out in the transition to it.
- The motion in the hold is faster than the maximum horizontal speed, climbs or descends faster than the climb and descent limits, or accelerates more than the acceleration limit (with 0.1% for rounding).

The storyboard list and the timeline mark each formation that has a problem.
The timeline also marks a landing in which drones come too close, or leave the flight volume when they spread out.

## User interface

The 3D view fills the page. Overlays on the view hold the view controls and the checks.
A sidebar sits on the right. Its header holds the title, the Undo and Redo buttons, and the Project menu: New show, Import, Export, and the Demos list.
Under the header, three tabs: Show, Fleet, and Drones.
A transport bar sits under the 3D view.

Each field takes one line: a label, a slider for fields that have one, and a number box with its unit.

### Show tab

| Section | Contents |
|---|---|
| Storyboard | One row per formation: color (a gradient shows both colors in its direction), number, shape name, hold time, turn rate, the swings, a chase marker, and a problem marker. Icon buttons in the section header: add, move earlier, move later, remove. Land at the end toggle. |
| Formation | The settings of the formation that is selected in the storyboard: shape selector with an OBJ import button, up axis selector, size, center height, yaw, tilt forward, tilt sideways, hold time, color, color pattern, light chase pattern. For a gradient: the second color. When the chase is on: chase bands and chase speed. Spacing readout and Fit button. The Drawing colors pattern is in the list only for an SVG drawing. An imported SVG drawing starts with its drawing colors. A change to a shape that is not an SVG drawing sets Drawing colors back to Solid. |
| Motion in the hold | Turn rate. Sway, rock, and roll, each an angle with a swing time. A swing time shows only when its angle is not 0. |

### Fleet tab

| Section | Contents |
|---|---|
| Fleet | Drone count. Takeoff grid spacing. |
| Limits | The four speed and acceleration limits. Minimum spacing. Spread out to pass safely toggle (stage 7a). |
| Flight volume | Size. Center X and Y. Floor height. |

### Overlays on the 3D view

| Place | Contents |
|---|---|
| Top left | Paths and Volume toggle buttons. Audience view button. Showtime button. |
| Top right | The Checks panel: a status line, the five readouts, and a list of problems. A click on the status line folds the panel to one line. |
| Top middle | A note while a new plan pauses the page: "Planning the show…" after an imported project file or shape, and "Loading" and the demo name while a demo loads. The page draws the note before it starts the plan. |
| Bottom left | A short hint for the mouse controls. |

The status line says "All checks pass", or counts the problems.
The problem list names each one in words, for example "Formation 2: Targets are below the ground."
It shows four lines at most, and a last line counts the rest.

### Storyboard

A click on a storyboard row selects that formation.
The Formation section then shows its settings, and the timeline moves to the start of its hold, so the 3D view shows the formation.

Add puts a new formation after the selected one.
The new formation keeps the size and place of the selected one, and gets the next built-in shape and the next color.
Remove takes the selected formation out. The last formation stays.
Earlier and Later swap the selected formation with its neighbor.

### Drones tab

The Drones tab holds the drone list: the id, position, and speed of each drone at the current time.
The tab shows the drone count.
The list fills the height of the sidebar.
It draws only the rows that are visible, so 1,000 drones stay fast.

When the Drones tab opens, the list scrolls to the selected drone.
The left and right arrow keys move between the tabs.

### Undo and redo

Every change to the project is a step that the user can undo: fields, the storyboard, imports, demos, and New show.
A change of the view is not a step: the camera, the timeline, the selection, and the overlays.

| Input | Action |
|---|---|
| Ctrl+Z, or ⌘Z on a Mac | Undo |
| Ctrl+Shift+Z, Ctrl+Y, or ⇧⌘Z | Redo |
| Undo and Redo buttons in the sidebar header | Undo and redo |

In a number box the keys undo the typing in the box, not a step of the project.

Quick changes of the same field make one step. A change merges with the step before it when it changes the same field less than 1 second after the last change of that field.
A slider drag then makes one step, however long it takes.
A change after an undo always starts a new step.

A step stores the project as it was, and the formation that the sidebar edited.
An undo or a redo shows that formation in the sidebar, so the user sees what changed.
The project is never changed in place, so a step is only a reference to an old state.
The history keeps 200 steps. It does not survive a page reload.

### Autosave

The page saves the project in the browser storage (`localStorage`), as the text of a project file.
Under a second key, it also saves the pairings of the last plan, with their column prices, in Base64. The pairings are only a speed-up: the solver checks every pair that it keeps from them, so a stale or broken entry can cost time but never give a wrong plan. A failed save of the pairings shows no message.
On page open, the page plans the saved show before any other show, because another plan would replace the stored pairings with its own.
It saves 0.4 seconds after the last change, so a slider drag saves one time.
It also saves at once when the user hides or leaves the page.

When the page opens, it loads the saved project with the same checks as an import.
If the saved text fails a check, the default show opens, and a message tells why.
If the browser does not store the text, for example because a large OBJ model makes it too long, a message tells the user to use Export.

New show replaces the project with the default show. Undo brings the old show back.

### Demos

The `demos` folder holds demo shows as project files.
The Demos list in the Project menu shows the name of each demo and a line about it.
`src/demos.js` holds the list.

| Demo | Drones | What it shows |
|---|---|---|
| First light | 120 | A short show for a first look, in solid colors: a sphere and a helix that turn, a ring with a light chase, and a heart that rocks with a light chase. Then the fleet lands. |
| The works | 400 | Most features in one show. A disc with an Outward gradient, like a sunrise. A turning sphere with an Across gradient. Saturn, an OBJ model with a forward and a sideways tilt. A turning helix with a Rising gradient. A wireframe cube: an OBJ model of thin tubes along the 12 edges, so the drones sit on the edges. It tilts and turns, and an Outward gradient lights its corners. A quadcopter drawing in its drawing colors that sways, rocks, and rolls: a drone made of drones. A torus that turns and rolls. The word WOW! as a drawing. Three hearts inside each other, with a light chase. The fleet spreads out to pass in three transitions and in the landing. |

A click on a demo fetches its file with a relative URL.
The demo then opens like an imported project file: with the same checks, as one undo step, on its first formation, with the camera on the show.
When the file does not load, a message under the header tells why, and the show does not change.

Each demo must pass every check. A test plans each demo and checks that the problem list is empty.
Another test checks that the list in `src/demos.js` and the files in `demos/` match.
To add a demo, export the show, put the file in `demos/`, and add its name, its line, and its file to `src/demos.js`.

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

The Audience view button puts the camera at the audience seat: 160 m in front of the takeoff grid, at eye height, inside the crowd.
It aims the camera at the selected formation with the shot of the Showtime camera (see Showtime), but it keeps the field of view of the editor.
After the Audience view, an orbit turns about the middle of the formation.

### Showtime

The Showtime button hides the sidebar, the transport bar, and the overlays, and asks the browser for full screen.
The show plays from the takeoff grid. The view hides the grid, the flight volume, the paths, and the selection.
A hint at the bottom says the keys. It and the pointer hide after 2.5 seconds with no input.

| Input | Action |
|---|---|
| Space | Pause or play. While the show pauses, the hint says "Paused". |
| Escape, or leaving full screen | Back to the editor |

At the end of the show, a card offers "Watch again" and "Back to the editor".
Back in the editor, the camera is where it was before Showtime. The timeline stays where Showtime stopped.

The Showtime camera stands at the audience seat. For each frame it finds a shot (yaw, pitch, and field of view) that shows the drones and the stop that they fly to:

1. The yaw aims at the middle of the points from left to right.
2. When the points leave room, the bottom of the view shows 3° of ground below the horizon, so the heads of the crowd show at the bottom of the view, and the spare room goes above the points.
3. The field of view grows from 30° until the points fit, with 8 percent of the view free at each edge, up to 75°. When the points do not fit with the ground, the ground leaves the view. When they do not fit at all, the shot aims at their middle.
4. The angles are exact only in the middle of the view, so a last check projects every point and widens the view until each one fits.

The camera eases toward the new shot: it closes 63 percent of the gap in 1.2 seconds. The ease depends on time, not on the number of frames.

When a show opens, the camera frames it: on page open, on New show, on an imported project file, and on a demo.
The camera looks from the start direction at the middle between the lowest bottom and the highest top of the formations.
It stays at the start distance, 240 m, or moves back until that span fills three quarters of the view height.
Undo and redo do not move the camera.

### Transport bar

Play and pause button, timeline strip with a playhead, and time readout.
Times show as minutes, seconds, and tenths, for example `1:05.3`.
The Space key toggles play and pause.

The timeline strip shows the whole show.
Each transition and each hold is one block, and the width of a block shows how long it takes.
A hold block has the number and the color of its formation.
The tooltip of a transition block gives its time, says when the drones spread out to pass, and lists its problems.
A red line under a block marks a problem.

The playhead is a white line with a knob. A drag on the playhead moves the timeline.
The playhead is the thumb of a range input that lies on top of the strip. Only the thumb takes the pointer, so a click on a block reaches the block.
A click on a block selects its formation. A click on the landing block moves the timeline to the start of the landing.

The page opens on the first formation.
Play at the end of the timeline starts again from the takeoff grid.
When the plan changes, the timeline keeps the same moment: the end stays the end, a time in a hold stays in that hold, and a time in a transition keeps its share of that transition.

## Rendering

The view draws these parts in this order:

1. Sky, field, and hills: one triangle that covers the view. Its fragment shader finds the direction of each pixel from the camera axes. Above the horizon it draws a sky that is dark at the top and lighter at the horizon, with the faint glow of a town far behind the show. Below the horizon it finds where the ray meets the ground and draws grass with a faint grain. The light of the show tints the field under it a little. The hills stand on a ring 3.5 km from the show, 8 to 170 m high. Far ground and far hills fade into the haze of the horizon. A little noise keeps the dark gradients from showing bands.
2. Stars: 1,600 points at infinity, above 4°, many dim and a few bright, in faint tints. They fade near the horizon and twinkle a little.
3. Crowd: 1,200 people on the field from the audience line 35 m back, 140 m wide, denser at the front. Each person is one quad that turns about its vertical axis to face the camera. The fragment shader cuts out the outline of a person seen from behind: a head, a neck, sloped shoulders, and the body, with smooth joins. Heights and widths vary, a few people are children, and 5 percent hold up a phone with a lit screen. The show lights the top edges of the people with its mean color. Alpha to coverage smooths the outlines. The crowd is the only solid part: it writes the depth buffer.
4. Ground grid, flight volume, paths, and route: lines with additive blending. They test the depth buffer, so the crowd hides them, and they write no depth.
5. Drones: one `gl.POINTS` draw call with additive blending, also behind the crowd. Each point has the light itself, with a hot white center, and a soft glare around it, like a bright light at night. The light shrinks with distance but has a minimum size, so far drones stay visible. The glare is at least 22 CSS pixels wide.

- Ground grid: a line grid on `z = 0`. The editor shows it; Showtime does not.
- Flight volume: one `gl.LINES` draw call for the edges of the cube.
- Brightness: a second buffer holds the brightness of each light, from stage 9. The page writes it each frame. The selected drone stays at full brightness.
- Light color: a third buffer holds the color of each light, from stage 9a. The page writes it each frame. The selected drone is white.
- Paths: one buffer holds one line per drone per leg. The view draws the lines of the current step at low opacity, in the formation color. In a transition between two formations, the path color blends from one formation color to the other, in the cross leg. In a hold, the current step is the one that led to the hold.
- Route: for the selected drone, the view draws its whole route: each leg of each step, and its path in each hold as short straight lines; the pose changes by at most 10° from one line to the next. The part of the current step is brightest.
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
      "colorPattern": "solid",
      "secondColor": "#ffffff",
      "holdSeconds": 10,
      "tiltForward": 0,
      "tiltSide": 0,
      "turnRate": 6,
      "swayAngle": 0,
      "swaySeconds": 8,
      "rockAngle": 0,
      "rockSeconds": 8,
      "rollAngle": 0,
      "rollSeconds": 8,
      "chase": "off",
      "chaseBands": 4,
      "chaseSpeed": 0.5,
      "seed": 1
    }
  ],
  "landAtEnd": true,
  "spreadToPass": true
}
```

An OBJ formation stores the full OBJ text, and an SVG formation stores the full SVG text:

```json
{ "type": "obj", "fileName": "whale.obj", "upAxis": "y", "text": "v 0 0 0\n..." }
{ "type": "svg", "fileName": "logo.svg", "text": "<svg ...>...</svg>" }
```

`formations` is the storyboard. It holds 1 to 20 entries, in show order.

The simulator writes version 2 and reads versions 1 and 2.
Version 1 had exactly one formation and no landing.
A file with no `landAtEnd` gets no landing, a file with no `volume` gets the default flight volume, a formation with no `turnRate` does not turn, a formation with no tilt stands upright, a formation with no swing angle does not swing (its swing times get 8 s), a formation with no `chase` has no light chase, and a formation with no `colorPattern` has one solid color. Older files then load with their old meaning.
`colorPattern` is one of `solid`, `rising`, `across`, `outward`, and `drawing`. A formation that is not an SVG drawing and has `drawing` gets `solid`.
A file with no `spreadToPass` gets the spread. This changes only a transition that is not safe without it.

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
  social.png      1200 × 630 picture for link previews
demos/
  *.droneshow.json  demo shows; the Project menu opens them
src/
  main.js         start-up; connects state, plan, renderer, and user interface
  state.js        default state, field limits, project file export and import
  history.js      undo and redo history
  autosave.js     saves the project in browser storage and loads it again
  plan.js         runs the stages from state to plan and stores results that did not change
  rng.js          seeded random number generator
  shapes.js       built-in shape generators
  obj.js          OBJ parser and triangle sampler
  svg.js          SVG reader: path data, basic shapes, transforms, colors, and the outline sampler
  sample.js       farthest point sampling and optimization, the curve walk, smallest spacing
  assign.js       assignment solver (Jonker-Volgenant algorithm)
  motion.js       takeoff grid, trapezoid timing, closest approach, turn and swing profiles, pose rotation
  mat4.js         matrix helpers for the camera
  camera.js       orbit camera, the frame of a show, the audience seat shot, and mouse input
  demos.js        the list of demo shows
  renderer.js     WebGL2 shaders, buffers, and draw calls: scenery, lines, and lights
  scenery.js      the people of the crowd and the stars
  ui.js           sidebar tabs and controls, storyboard, drone list, transport bar
  version.js      the milestone number and date that the Project menu shows
test/
  *.test.js       unit tests
tools/
  smoke.js        headless browser smoke test
```

`state.js`, `plan.js`, `rng.js`, `shapes.js`, `obj.js`, `svg.js`, `sample.js`, `assign.js`, `motion.js`, `demos.js`, and `scenery.js` are pure.
They use no DOM and no WebGL, so Node can run their tests.
`camera.js` uses the DOM only in its mouse input function, so Node also tests its other functions.
`plan.js` also lists the problems of a show in words, so a test can check the demos.

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
| `sample.js` | Target count. The first N picks stay the same for a larger N. Smallest spacing on a known point set. The grid sampler picks the same points as a plain search, for each built-in shape, an SVG drawing, an OBJ model, points on a line, and points with many ties. The walk spaces a ring evenly, keeps the spacing at a sharp corner, and handles small and large counts. The optimization never brings picks closer, gains at least 5 percent on each built-in surface, keeps the picks apart, and repeats. |
| `assign.js` | Each drone gets one target. The total cost equals a brute-force search on small cases, and the plain Hungarian algorithm on larger cases. A warm start from a changed problem, or from a problem of another size, is still optimal. The prices prove the solution optimal. Scaling or moving a point set keeps the best pairing. Cold, warm, and coarse to fine solves of a large fleet with ties give the same pairing. |
| `motion.js` | Duration for known cases. No limit is exceeded. Positions at the start and the end. Closest approach equals a dense time scan, and with a limit it stops at a pair below the limit. Turn profile for long and short holds, with room for the centripetal acceleration. A swing fits whole swings in the hold, starts and ends at rest, and stays inside its speed bound. The hold angles add up. The pose rotation equals the three rotations in order, and each tilt leans the right way. |
| `obj.js` | Triangles, faces with four corners, negative indices, up axis. |
| `svg.js` | Each path command, compact numbers and arc flags, smooth curves, arcs on each side, the error rule, each transform and their order, each basic shape, nested groups, skipped elements, namespaces, the orientation and scale of the cloud. Each color format, stroke before fill, the style attribute, colors from groups, `currentColor`, and the color of each cloud point. |
| `history.js` | Undo and redo, quick changes of one field merge, the time window, an undo ends a merge run, the step limit. |
| `camera.js` | The frame of a show: the aim at the middle of the formations, the start direction, the start distance for a short show, and a larger distance for a tall show. The audience seat shot: every point in the view, the horizon in the lower quarter, the narrowest view for a small show, no horizon for a tall show and the middle for a show that does not fit, a turn toward a show to one side. Easing by time and not by frames. The camera eye at the seat, the axes, and the Audience view. |
| `scenery.js` | The crowd: its size, its area, the spacing of the people, the clear space at the seat, heights, phones, a denser front. The stars: unit directions above 4°, a few bright ones. Both are the same each time. |
| `demos.test.js` | Each demo has a name, a line, and a relative URL of a file in `demos/`. The list and the folder match. Each demo loads like an imported project file and passes every check. |
| `page.test.js` | The module preload list equals the modules that the page imports. Every link that the page loads is relative and is a file. The link preview picture is on the site and has the size that its tags give. The version is the last milestone that is done. |
| `autosave.js` | A saved project loads again, one save for many quick changes, the delay, no storage, saved text that is not valid, a failed save. Pairings go through storage unchanged, and a later planner that starts from them gives the same plan. Pairings that are broken are dropped or repaired. |
| `state.js` | Export then import gives the same state. Import rejects bad files. Version 1 files load. A file with no spread setting gets the spread. A file with no color pattern gets one solid color. Drawing colors need an SVG drawing. |
| `plan.js` | One formation: targets, even spacing on a curve and on a surface, timeline, checks. Storyboard: one step per formation, no jump between steps, each stop holds every target one time, the closest approach bound, stored results equal fresh results. Hold motion: the end pose of a turn, the turn speed and acceleration, a turn that is too fast, a turn that leaves the flight volume, the route of a drone. Forward and sideways tilt, a sway that ends where it started, a rock below the ground and out of the volume, swings too fast for each limit, patterns that stay on a tilted formation, all motions together. Light chase: the head and the tail of a band, the direction, the repeat time, the fades, the path of each pattern, a path that follows the drones and ignores the yaw. Spread: the even factor between two formations, the bisection of a takeoff and a landing, no candidate that fails a check, a crossing within 3% of the minimum spacing, the room of a stop in the flight volume, spreads that fit their room, a spread that fits winning over a faster one that leaves the volume, the spread factors of the bound for each kind of stop, the largest spread, the spread point and the volume floor and top, one leg for a safe flight, the minimum spacing in every leg (checked against a full search), legs that join, speed limits, the color blend in the cross, the route corners, no spread when it does not make the flight safe, a spread outside the flight volume. Colors: a solid formation, each gradient against its path (with a yaw), an outward gradient on a sphere, drawing colors at full brightness and the formation color for an outline with no color, the blend of each drone in a transition and through a spread, the colors of the landing. |

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
All URLs that the page loads are relative, so the site works under `/drone-show-sim/`. This includes the demo files, which the page fetches.
`README.md` lists the steps to turn Pages on.

The `main` branch holds the last finished milestone. Work happens on another branch, and `main` moves forward to it after each milestone. Pages serves `main`, so the site shows the last finished milestone.

The page head has these parts for hosting:

| Part | Purpose |
|---|---|
| Module preload | One `<link rel="modulepreload">` per module of the page. Without it, the browser finds the modules one import level at a time: `main.js`, then `plan.js`, then `assign.js`, and so on, one round trip per level. With it, the browser fetches them all at once. A test checks that the list equals the modules that `src/main.js` imports, directly and through other modules. |
| Icon | An inline SVG: three glowing dots on a dark square. It needs no file, so the browser makes no request that ends in a 404. |
| Link preview | Open Graph and Twitter card tags: a title, a description, and `docs/social.png`, a 1200 × 630 picture of the default show. Link crawlers need absolute URLs, so these tags hold the full address of the site. They are the only absolute URLs, and the page does not load them. When the site moves, change them and the `SITE` constant of the page test. |
| Description | A `description` meta tag for search results. |

The version shows in the Project menu: the number of the last milestone that is done, and its date. It comes from `src/version.js`. The commit that finishes a milestone updates that file. A test checks that its number equals the last milestone in this file that is done.
GitHub Pages lets a browser keep each file for 10 minutes, so for a few minutes after a deploy, a browser can show the old version.

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
| 9 | Slow turn | A formation turns about its vertical axis in its hold. | Done |
| 10 | Tune-up | Three sidebar tabs, overlays on the 3D view, one-line fields, a draggable playhead. | Done |
| 11 | Light chase | Bright bands that travel across a formation in its hold. | Done |
| 12 | SVG import | An SVG drawing as the shape of a formation, with drones on its outlines. | Done |
| 13 | Undo and autosave | Undo and redo of every change. The project saves in the browser. | Done |
| 14 | Performance | Canonical copies, a result store, warm starts, coarse to fine solves, and lazy sampling. | Done |
| 15 | Faster page open | A grid for the sampler, and pairings stored with the autosave. | Done |
| 16 | Spread out to pass | A transition that is not safe as a direct flight spreads out, crosses, and closes up. Fit then needs no flight margin. | Done |
| 17 | Color per drone | Rising, Across, and Outward gradients of two colors, and the colors of an SVG drawing. | Done |
| 18 | Even spacing | A walk along curves, and farthest point optimization on surfaces. Fit makes shapes 9 to 32 percent smaller. | Done |
| 19 | Tilt and swings | A fixed tilt forward and sideways. Sway, rock, and roll in the hold, mixed freely with the turn. Checks sample the motion of each hold. | Done |
| 20 | Hosting polish | Module preload, an icon, a link preview, a version in the Project menu, and a `main` branch. | Done |
| 21 | Demos | Two demo shows in the Project menu: First light and The works. The camera frames a show when it opens. A note on the 3D view while a plan pauses the page. | Done |
| 22 | Showtime | A night sky with stars, a field, hills, and a crowd. A glare around each light. Showtime plays the show full screen from the audience seat, with a camera that follows the show. | Done |
| 23 | Spread just enough | The formations grow only as much as an exact check of the crossing needs. Spreads that fit in the flight volume when the quick ones do not. | Done |

## Known limits

- On a surface, the closest pair of targets is about 0.75 to 0.85 of a perfect hexagonal spacing. Each target is a point of the cloud, so the cloud size limits the optimization. A cloud of 80,000 points gave about 0.8 at 1,000 drones, but took about three times as long.
- A cusp or a sharp corner costs spacing: the targets keep away from the other side of the cusp, so the gap at the cusp is larger.
- A change of drone count moves every target a little, so the assignments need new solves.
- A cold plan of a large show, a new shape, a yaw change, or a change of drone count still pauses the page at 1,000 drones: about 1 second for a cold plan of the default show (a page open with stored pairings plans in about 0.35 seconds), and 0.2 to 0.8 seconds for the others, on a slow CPU. If this is a problem, the next step is to run the planner in a Web Worker.
- Drones fly straight legs. The spread keeps the minimum spacing in a transition, but it makes the transition longer. The formations grow only as much as an exact check needs, but in a takeoff or a landing only the formation can grow, so a formation that nearly fills the flight volume can still leave it. The simulator does not plan a path around a single conflict, and it does not move only the drones that conflict: in a stress test, a median of 19% of the drones took part in the conflicts of an unsafe flight.
- A spread cannot fix a stop whose targets are too close together. It also cannot fix a takeoff when the grid spacing is not more than the minimum spacing.
- A drone can land on a grid cell that is not the one it started from.
- The OBJ importer puts drones on every surface of the model, also on surfaces inside it.
- The SVG importer puts drones on outlines only. It does not fill a filled area. It does not read `text` (fonts), `use`, nested `svg` positions, CSS classes, or units such as percent.
- Drawing colors come from `stroke`, `fill`, and `color` only. CSS classes, gradients, opacity, and color names other than the basic ones give no color. Each color goes to full brightness, so a drawing that uses dark and light shades of one hue shows one hue.
- An OBJ model has no colors of its own in the simulator. The importer does not read materials.
- A gradient has two colors. The faint flight paths use the formation color, not the color of each drone.
- The flight volume is a cube. It has no rotation and no separate width, depth, and height.
- Fit changes the size only. A large shape with a low center reaches the ground; the Lowest target check shows this.
- The undo history does not survive a page reload. Only the project does.
- A demo loads with a fetch, so the page must come from a web server. A page opened as a local file cannot load a demo.
- The first plan of The works takes about 1 second on a fast CPU. The page shows a note, but it does not draw while it plans.
- The camera frame looks at the heights of the formations only. A wide formation can be wider than the view.
- The audience seat is always 160 m in front of the takeoff grid. A large show at this distance fills a wide view, and a high formation shows far above the crowd with much empty sky between. Real audiences often stand farther away.
- The people of the crowd are flat outlines that turn to face the camera. From straight above they are thin lines.
- The glare is part of each point, not a bloom of the whole picture. A point whose center leaves the view loses its glare at once.
- The hills are at a fixed distance on a ring, and the scenery has no moon, no clouds, and no shadows.
- A browser can refuse full screen, for example in a frame. Showtime then runs in the window.
- Browser storage holds about 5 MB per site. A show with a large OBJ model can be too large for autosave. Export still works.
- A light chase has three patterns, and a fixed dim level and tail length. The Around pattern follows an outline well when the outline goes once around the formation center, as the heart and the ring do. On a helix it is a sweep, not a chase along the curve.
- The checks of a hold look at the motion many times, not at every moment. Between two looks a drone can leave its path by up to 0.015% of its distance from the center. A very long hold with a fast motion reaches the limit of 4,096 looks; its checks are then coarser.
- A swing time snaps to fit a whole number of swings in the hold, so a swing can be faster or slower than the time that the user sets.
- In a short hold the turn does not reach its turn rate. No readout shows the rate that it reaches.
- A turn moves the end pose of a formation. The transition after it then needs a new assignment, which at 1,000 drones costs the same pause as other changes.

## Future features

- Drones that flow along an outline, so the drones themselves move, not only the lights.
- More shape inputs: point lists and GLB models. Each one is a new source of candidate clouds. The stages after stage 1 do not change.
- Filled SVG areas: drones spread over the inside of a filled shape, not only on its outline.
- Edge placement.
- Gradients with more than two colors.
- Export to a show format such as VVIZ.

## Out of scope

- Mobile layout.
- Wind, battery, GPS error, and drone failure.
- Music sync and pyrotechnics.
- Control of real drones.
- A server. The site is static files only.
