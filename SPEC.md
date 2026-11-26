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
Each marcher carries a lantern. The flight lights say what the lanterns do on the march: they stay lit and change color, or the band covers them and uncovers them at the new picture.

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
| Hover layer | The takeoff grid lifted straight up to the hover height. The rows of the grid lift off to it one after another, and the fleet flies on from it as from a stop. The landing comes back to it, and the rows descend one after another. |
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
| Flight lights | What the drone lights do in the flight to a formation: they blend to the new colors, or they show an effect: Dark, Glimmer, Starburst, or Color wave. The landing has flight lights of its own, the landing lights. |
| Spark color | The color of the twinkles of a glimmer and of the hot flash of a starburst. |
| Dark level | The brightness of the lights in a flight whose effect turns them down, as a share of full brightness: in a dark flight, between the twinkles of a glimmer, and after the embers of a starburst. 0 turns them off. |
| Audience seat | The place in the crowd where the Audience view and Showtime put the camera: at eye height, 10 m behind the front row of the crowd. |
| Showtime | A mode that hides the panels and plays the whole show full screen, from the audience seat. |
| Color pattern | How the drones of a formation get their light colors: one solid color, a gradient, or the drawing colors of an SVG drawing. |
| Gradient | A blend from the formation color to a second color across the formation: rising, across, or outward. |
| Step | One transition and the hold after it. A show is a list of steps. |
| Assignment | The mapping from each drone to one target. The drill chart. |
| Flight volume | The cube that the drones must stay inside. |
| Vertical spacing | The smallest distance between two drones when one is straight above the other. A drone pushes air down (its downwash), so a drone under it needs more room than a drone beside it. |
| Spacing distance | The distance that the spacing checks use: the distance between two drones with the height difference times minimum spacing ÷ vertical spacing. It compares with the minimum spacing. |

Formation, transition, and storyboard are the terms that Skybrush uses.

## Decisions

| Topic | Decision |
|---|---|
| Purpose | Visual-first preview with real units. No flyable export yet. |
| Platform | Browsers with WebGL2 on a computer, a tablet, or a phone. On a phone the sidebar is a sheet at the bottom of the screen, and every control works with touch. |
| Rendering | Raw WebGL2. No 3D library. |
| Language | Plain JavaScript, native ES modules, JSDoc types. No build step. |
| Runtime dependencies | None. |
| Fleet size | 1 to 1,000 drones. Default 100. |
| Shape inputs | Built-in shapes, OBJ models, and SVG drawings. |
| Drone placement | Even spread over the surface of a 3D shape, or along the outlines of a flat shape and of an SVG drawing. |
| Show | Takeoff, 1 to 20 formations in storyboard order, and a landing that the user can turn off. The rows of the takeoff grid lift off to a hover layer one after another, and land the same way, as real shows do. |
| Color | Each drone has its own light color. A formation has a color pattern: one solid color, a gradient of two colors (Rising, Across, or Outward), or, for an SVG drawing, the colors of the drawing. In a transition each drone blends from its old color to its new color. |
| Hold motion | Each formation can have a fixed tilt, forward and sideways. In its hold it can turn, sway, rock, and roll, all at the same time. The turn lets the audience see the depth of the shape. Each swing ends where it started. |
| Light chase | Each formation can run a light chase in its hold: Around, Rising, or Across, with a number of bands and a speed. |
| Flight lights | Each formation sets what the lights do in the flight to it: Blend, Dark, Glimmer, Starburst, or Color wave. The landing has its own setting. An effect changes only the lights, never the flights or the checks. |
| Scenery | A night sky with stars, a field, hills on the horizon, and a crowd at the audience line. They show the place and the scale of the show. The editor shows them too, with a faint grid on the field. |
| Showtime | A Showtime button plays the whole show full screen from the audience seat. The camera follows the show. |
| Drone list | A list with live data, in its own sidebar tab. Select a drone to highlight it and its route. |
| Path display | The paths of the current step, faint. The route of the selected drone, bright. A toggle hides the faint paths. |
| Spacing conflict | Markers and readouts warn. A Fit button sets the smallest safe size. |
| Downwash | A vertical spacing, separate from the minimum spacing. The two make an ellipsoid of room around each drone. |
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
| Vertical spacing | 3 m |
| Takeoff grid spacing | 3 m |
| Hover height | 10 m |
| Row delay | 0.5 s |
| Flight volume size | 120 m |
| Flight volume position | Centered on the origin, floor on the ground |
| Storyboard | A 40 m sphere, a 100 m heart, and a 50 m torus. Each has its center at 60 m and a hold of 10 s. The sphere turns at 6°/s, the torus at −6°/s. The heart is flat, so it does not turn; it runs a light chase around its outline instead, with 5 bands at 0.25 laps/s, and it rocks 5° toward the audience and back. The torus leans 20° toward the audience, and it has an outward gradient from orange on its inner ring to pink on its outer ring. |
| Landing | On |
| Flight lights and landing lights | Blend, with a dark level of 0 |

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

A drone pushes air down. A drone in that downwash, under another drone, gets less lift and shakes. So the room that a drone needs is an ellipsoid: the minimum spacing across, and the vertical spacing up and down.
All spacing checks use the spacing distance: the distance between two drones with the height difference times `k = minimum spacing ÷ vertical spacing`. Two drones are too close when the spacing distance is below the minimum spacing, which is the same as one drone inside the ellipsoid of the other. With the defaults, a drone straight above another needs 3 m, and a drone beside it needs 2 m.
The planner gets the spacing distance from copies of the points with each height times `k`. That scale is linear, so a straight flight on the copies is still straight, all drones still share one progress value, and every exact check of stage 7 and stage 7a works on the copies as it is. A shrink or growth of a stop is still a uniform scale on the copies too.

For each formation, the simulator finds the smallest spacing distance between any two targets.
The readout shows this distance in red when it is below the minimum spacing.
A turn about the vertical axis does not change any height difference. A tilt, a rock, a roll, and a turn about a tilted axis do. With a vertical spacing that is not the minimum spacing, the spacing of a formation that leans in its hold is the smallest spacing at up to 24 poses of the hold, about one for each 5° of motion.
A formation that lies flat has no height differences, so the vertical spacing does not change it. An upright curve, such as a ring or the sides of a heart, has drones above one another, so it needs a larger size.

Spacing grows in proportion to size.
The Fit button sets the size so that the smallest distance is the minimum spacing.
When the spread is off, Fit adds a margin: the smallest distance is then `√2 × minimum spacing`.
That margin is what stage 6 needs: with it, a direct flight also keeps the minimum spacing.
With the spread on, the margin is not necessary, so Fit makes shapes about 30% smaller.

### 5. Build the takeoff grid

The grid is close to square: the column count is `ceil(sqrt(N))`.
Drone ids run from 1 to N, row by row.

The default grid spacing of 3 m is more than `√2 × 2 m`, so the grid has the same margin as a formation that Fit sets with the spread off.

Real shows do not lift the whole fleet at once. The rows lift off one after another, so no drone waits in the downwash of another near the ground, and the fleet climbs to a low hover height before it flies to the first formation. The simulator does the same:

1. Lift-off: each row of the grid climbs straight up to the hover height, the row nearest the audience first. Row `r` starts `r × row delay` after the first one. Within a row, all drones climb together.
2. The fleet flies from the hover layer to the first formation, as from any stop.
3. For the landing, the fleet flies from the last formation to the hover layer.
4. Touchdown: each row descends straight to the ground, in the same order as at the lift-off. A drone lands in the row of the grid cell that it lands on.

A drone that climbs or descends straight keeps its distance across to every other drone. So in a lift-off and a touchdown, no two drones come closer than the grid spacing, at any vertical spacing, and the planner needs no search for it.
The hover layer is in the air, so unlike the grid on the ground it can spread out (stage 7a). A takeoff to a formation that nearly fills the flight volume can then grow both ends by the same factor.
A hover height of 0 turns this off: the fleet flies straight from the grid, and straight back to it.
On the 60 random shows of stage 7a, the hover layer cut the spreads that leave the flight volume from 9 to 2.

### 6. Assign drones to targets

For each transition, the solver pairs the points of the two stops.
It finds the pairs with the smallest total of squared distances.
It uses the Jonker-Volgenant algorithm, which gives the same result as the Hungarian algorithm in less time.

Squared distance matters.
With this assignment and with all drones on the same count, straight paths stay apart.
If the closest spacing at both stops is `D`, the closest approach in flight is at least `D ÷ √2`.
Skybrush documents the same bound.
The bound holds for the plain distance, because the assignment uses plain squared distances. It does not hold for the spacing distance of a vertical spacing. The exact checks do not need it.

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

In the lift-off and the touchdown each drone has a delay: the start of its row. A drone then follows the shared profile from its own start: `position(t) = from + s(t − delay) × (to − from)`, with `s` 0 before the start. Such a leg lasts the profile plus the longest delay.

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
The takeoff grid on the ground never grows, so a takeoff or a landing straight from the grid has two legs. The hover layer can grow, so a takeoff from it can have a spread leg at both ends, after the lift-off.

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

### 9b. Plan the flight lights

The flight lights of a formation say what the lights do in the transition to it. The landing has flight lights of its own: the landing lights. The takeoff uses the flight lights of the first formation.

The flight lights are an effect and its settings. Each setting serves some effects, and the sidebar shows it only for them. A setting that the chosen effect does not use keeps its value, so a change back to an effect finds its settings again.

| Effect | The lights in the flight |
|---|---|
| Blend | The lights stay at full brightness, and the colors blend from the old stop to the new one (stage 9a). |
| Dark | The lights go down to the dark level, and come back as the fleet arrives. The audience sees the old picture go out and the new picture come on, like a slide change. |
| Glimmer | The lights go down to the dark level, and random twinkles in the spark color flash across the fleet, like glitter. A slow rate and a warm spark color look like fireflies. |
| Starburst | A flash in the spark color travels across the fleet: outward from the middle, or inward from the edge, like an implosion. Each drone flashes when the flash reaches it, then cools to its own color and fades like the ember of a firework, with a flicker, down to the dark level. |
| Color wave | Bands of rainbow colors travel across the fleet in a direction. |
| Bands | Bright bands in the drone colors travel across the fleet in a direction, over the dark level. Outward and inward bands are ripples. |
| Pulse | The whole fleet beats together: it breathes (swells and fades smoothly), beats like a heart (two quick beats and a rest), or strobes (short flashes in the spark color). |
| Dissolve | The lights stay on. Each drone keeps its old color until its own random moment, then shows its new color with a short spark. The old picture dissolves into the new one, drone by drone. |
| Speed glow | Each drone is as bright as it is fast: the fastest drone at full brightness, a drone at rest at the dark level. The fastest drones also move toward the spark color, like hot metal. |

| Setting | Effects | Range | Fallback | Meaning |
|---|---|---|---|---|
| Direction (`burstDirection`) | Starburst | Outward, Inward | Outward | The way of the flash. |
| Direction (`bandDirection`) | Color wave, Bands | Left to right, Right to left, Rising, Falling, Outward, Inward, Spin, All together | Left to right | The way that the bands travel, as the audience sees the fleet. Outward and inward make rings, spin makes spokes that turn clockwise, and all together gives the whole fleet one color at a time. |
| Style (`pulseStyle`) | Pulse | Breathe, Heartbeat, Strobe | Breathe | The shape of each beat. |
| Spark color (`sparkColor`) | Glimmer, Starburst, Pulse, Dissolve, Speed glow | a color | white | The color of a twinkle at its peak, of the hot flash, of a strobe flash, of the spark of a dissolve, and of the fastest drones of a speed glow. A breath and a heartbeat do not use it. |
| Dark level (`darkLevel`) | Dark, Glimmer, Starburst, Bands, Pulse, Speed glow | 0 to 50 % | 0 | The brightness of the lights in the flight: in a dark flight, between twinkles, bands, and beats, after the embers, and of a drone at rest. |
| Twinkle rate (`twinkleRate`) | Glimmer | 0.1 to 6 per s | 1.3 | Twinkles of each drone per second. |
| Flash time (`flashTime`) | Starburst | 0.1 to 3 s | 0.6 | The time that the flash takes to cross the fleet. |
| Ember time (`emberTime`) | Starburst | 0.2 to 5 s | 1 | The time constant of the embers. |
| Bands (`bandCount`) | Color wave, Bands | 0.5 to 8 | 1.5 | The number of bands across the fleet. Spin rounds it to a whole number of spokes, at least 1. |
| Band speed (`bandSpeed`) | Color wave, Bands | 0.05 to 4 per s | 0.5 | The number of bands that pass one drone each second. |
| Band width (`bandWidth`) | Bands | 5 to 90 % | 30 | The share of the space from one band to the next that a band lights. |
| Pulse rate (`pulseRate`) | Pulse | 10 to 300 per min | 60 | Beats per minute. |
| Fade time (`fadeTime`) | all but Blend and Dissolve | 0.1 to 5 s | 1 | The time for the effect to come in and to go out. |

An effect comes in over the first `fade` seconds of the transition and goes out over its last `fade` seconds. So the fleet leaves the old stop with its lights on, and arrives at the new stop with its lights on:

```
fade  = min(fade time, T ÷ 4)
share = min(1, t ÷ fade, (T − t) ÷ fade)
in    = share² × (3 − 2 × share)
```

`t` is the time since the start of the transition, and `T` is the length of the transition. `in` is 0 when the effect is out and 1 when it is fully in.

Each effect gives a color and a brightness per drone. The light of a drone is the blend of the plain light (its blended color at full brightness) and the light of the effect, by `in`.

Dark: `brightness = 1 − in × (1 − dark level)`.

Glimmer cuts the time into slots. A slot lasts `min(0.3 s, 0.8 ÷ rate)`, so a twinkle stays short and at most 80 percent of the time of a drone has a twinkle. Each drone starts its slots at its own random time. In a share `rate × slot` of its slots, the drone twinkles: its light rises and falls once, as `peak × sin⁴(π × place in the slot)`, with a random peak from 0.4 to 1. So each drone twinkles `rate` times per second. A twinkle moves the light toward the spark color, by up to 70 percent at its peak. Between twinkles the light is at the dark level.

Starburst starts at once: it has no fade at the start, because the flash is its start. It goes out over the last `fade` seconds, as the other effects do.

```
reach  = min(flash time, T ÷ 4)         time for the flash to cross the fleet
age    = t − ripple × reach             time since the flash reached the drone
heat   = e^(−age ÷ 0.3 s)               the spark color when hot, the drone color when cool
glow   = e^(−age ÷ min(ember time, T ÷ 6))   the ember fades
flicker = 0.4 + 0.6 × random            a new random number 15 times per second
brightness = dark level + (peak − dark level) × glow × (flicker + heat × (1 − flicker))
peak   = 1 + 0.6 × heat
```

`ripple` is the place of the drone on the way of the flash: for an outward flash, its distance from the middle of the fleet when the flight starts, as a share of the largest distance; for an inward flash, 1 minus that share. It uses the side and the height only, not the depth, so the flash spreads over the picture that the audience sees: on a sphere it starts in the middle of the disk. Before the flash reaches a drone (`age` below 0), the drone keeps its plain light. At its peak the flash is 1.6 times as bright as a light at full brightness.

Color wave: `hue = place × bands − band speed × t`, and the color is the bright rainbow color of the fractional part of the hue, at full brightness. The place of a drone comes from its position at that time, as the audience sees it (side `x` and height `z`), about the mean position of the fleet at that time. `S` is the size of the larger formation of the flight.

| Direction | Place |
|---|---|
| Left to right, Right to left | `±x ÷ S` |
| Rising, Falling | `±z ÷ S` |
| Outward, Inward | `±√(x² + z²) ÷ (S ÷ 2)` |
| Spin | the angle from the top, clockwise, as a share of a full turn |
| All together | 0 |

Across the fleet the places span about 1, so `bands` bands fit across it. A band with one hue travels the way of the direction. As the drones fly, they move through the bands, and the bands move too.

Bands use the same places and phase: `phase = fractional part of (place × bands − band speed × t)`. A drone sees its phase fall, so a band reaches it at `phase = width` and leaves it at 0. The band is bright at its head and fades along its tail:

```
glow       = phase ÷ width   when phase < width, else 0
brightness = dark level + (1 − dark level) × glow
```

The color is the blended color of the drone (stage 9a).

Pulse: `beats = pulse rate ÷ 60 × t`, and `place` is the fractional part of `beats`. The beat is 0 to 1:

| Style | Beat |
|---|---|
| Breathe | `0.5 + 0.5 × cos(2π × place)`: full at the start of each beat, so the fleet leaves the old picture lit |
| Heartbeat | the larger of `e^(−((place − 0.08) ÷ 0.06)²)` and `0.75 × e^(−((place − 0.3) ÷ 0.06)²)`: a strong beat, a softer one, and a rest |
| Strobe | 1 for the first 12 percent of each beat, else 0 |

`brightness = dark level + (1 − dark level) × beat`. A strobe also moves the color to the spark color by `beat`. All drones beat together.

Dissolve has no fade: the lights stay on from start to end. Each drone changes its color at a random moment from 15 to 85 percent of the transition. Before its moment it shows its color at the old stop, and after it, its color at the new stop: there is no blend. A spark marks the moment: `spark = e^(−((t − moment) ÷ 0.1 s)²)`, `brightness = 1 + 0.6 × spark`, and the color moves to the spark color by `spark`.

Speed glow: `ratio = speed ÷ top`, where `speed` is the speed of the drone in the leg that it flies, and `top` is the peak speed of the fastest drone of that leg. `brightness = dark level + (1 − dark level) × ratio`, and the color moves to the spark color by `0.5 × ratio²`. In the cruise of a leg, a drone that flies far is bright and a drone that flies a short way is dim. At the end of a leg all drones slow down, so in a spread the fleet dims a little where it turns.

The random numbers come from a hash of the step, the drone, and the slot, the flicker time, or the dissolve. They are not from a generator with a state, so any time of the show gives the same lights, also after a seek, and the show looks the same each time it plays.

Under every effect but Dissolve, the colors blend as in stage 9a. With a dark level above 0, the faint lights change color in the flight.
The lights of a hold (stage 9) do not change.
Flight lights do not change the flights, the assignment, or any check.

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

Each problem has a kind and a step: the flight to a formation and its hold, or the landing. A click on a problem in the Checks panel shows it in the 3D view: the timeline moves to a time, and the drones that cause the problem get a mark.

| Problem | Time | Marked drones |
|---|---|---|
| Takeoff grid cells outside the flight volume | The start of the show | The drones on those cells |
| Hover layer outside the flight volume | The end of the lift-off | The drones that are outside at the hover layer |
| Targets too close together | The pose of the hold where the closest pair is closest | That pair |
| Targets below the ground | The pose of the hold where the lowest drone is lowest | Each drone that goes below the ground |
| Targets outside the flight volume | The pose of the hold with the most drones outside | Each drone that is outside at some pose |
| Drones too close in the flight, or in the landing | The moment of the closest approach | The two drones that come closest |
| Drones outside the flight volume in a spread | The end of the leg whose pose has the most drones outside | The drones outside at that pose |
| A motion in the hold that breaks a limit | The start of the hold | None |

The closest pair of a flight comes from the same exact search as the closest approach (stage 7), with heights scaled as in the spacing distance. It searches each leg in which all drones fly together; the lift-off and the touchdown keep the grid spacing. The progress of the closest moment gives its time: the time is found by halving an interval, because the progress grows with the time. The poses of a moving hold are up to 24 times in the hold, about one for each 10° of motion; a still hold has one pose.

## User interface

The 3D view fills the page. Overlays on the view hold the view controls and the checks.
A sidebar sits on the right. Its header holds the title, the Undo and Redo buttons, and the Project menu: New show, Import, Export, and the Demos list.
Under the header, three tabs: Show, Fleet, and Drones.
A transport bar sits under the 3D view.

Each field takes one line: a label, a slider for fields that have one, and a number box with its unit.

The fields are in groups. A click on the title of a group folds the group to its title, and a second click opens it. A chevron shows the state. The browser storage keeps the folded groups, so they stay folded after a reload. The folds are a convenience of one viewer, so they are not part of the project and not undo steps. Every group starts open.

### Layouts

The layout follows the width of the window.

| Window | Layout |
|---|---|
| Wider than 1000 px | The 3D view and the transport bar on the left, the sidebar on the right, 352 px wide. |
| 721 to 1000 px wide | The same, with a sidebar 320 px wide. The transport bar has two lines: the timeline, and under it the buttons, the time, and the speed. The Checks panel sits under the view buttons. When the sidebar title does not fit, it ends with an ellipsis. |
| 720 px wide or less | A phone: the 3D view and the transport bar fill the screen, and the sidebar is a sheet at the bottom. The transport bar has two lines, as above. |

On a window 1000 px wide or less, or 500 px high or less, the Checks panel starts folded, so it does not cover the 3D view. Its status line still shows when a check fails.

The sheet has three heights. The body element has a `data-sheet` value for each:

| Height | What shows |
|---|---|
| `peek` | A handle, the tab bar, Undo, Redo, and the Project menu. The title is left out, to save room. The page opens with this height, so the show is large. |
| `half` | Half of the screen. The 3D view stays in sight above it. |
| `full` | All of the screen except 200 px: the transport bar and a strip of the 3D view. The strip is too small for the hint and the Checks panel, so they hide. |

A tap on the handle opens a sheet at `peek` to `half`, and closes it to `peek` from the other heights. A swipe of at least 24 px up or down on the handle or the tab bar makes the sheet one height taller or shorter. A swipe on a tab changes only the height, not the tab. A tap on a tab opens a sheet at `peek` to `half`. A message under the header, for example a failed import, also opens it to `half`, so the message does not hide. The height changes with a short animation.
The handle and the tab bar act when the finger lifts, not on the click that can follow: a browser can leave out that click, for example when a tap stops the glide of a fast swipe.

On a phone the Project menu opens as a sheet of its own, over the bottom of the screen.

A touch screen (no hover, a coarse pointer) gets larger controls at every width: 36 px controls, 40 px tabs, storyboard rows, and menu items, a 44 px Play button, 32 px rows in the drone list, larger slider knobs, and a playhead 28 px wide with the same thin line. Number boxes and lists use 16 px text, because a phone browser zooms into a box with smaller text when the box takes the focus. The hints on the 3D view and in Showtime name touch gestures instead of the mouse and the keys.

### Show tab

| Section | Contents |
|---|---|
| Storyboard | One row per formation: color (a gradient shows both colors in its direction), number, shape name, hold time, turn rate, the swings, the flight light effect when it is not Blend, a chase marker, and a problem marker. Icon buttons in the section header: add, move earlier, move later, remove. Land at the end toggle. Landing lights, shown only when the show lands, with the flight ("3 Torus → Landing"), a Preview button, and the settings of the chosen effect. |
| Formation | The settings of the formation that is selected in the storyboard: shape selector with an OBJ import button, up axis selector, size, center height, yaw, tilt forward, tilt sideways, hold time. Spacing readout and Fit button. |
| Colors and lights | Color, color pattern, flight lights, light chase pattern. For a gradient: the second color. Under the flight lights: the flight that they belong to, for example "1 Sphere → 2 Heart" or "Takeoff → 1 Sphere", with a Preview button, and then the settings of the chosen effect (stage 9b). When the chase is on: chase bands and chase speed. The Drawing colors pattern is in the list only for an SVG drawing. An imported SVG drawing starts with its drawing colors. A change to a shape that is not an SVG drawing sets Drawing colors back to Solid. |
| Motion in the hold | Turn rate. Sway, rock, and roll, each an angle with a swing time. A swing time shows only when its angle is not 0. |

### Fleet tab

| Section | Contents |
|---|---|
| Fleet | Drone count. Takeoff grid spacing. Hover height. Row delay, shown only when the hover height is not 0. |
| Limits | The four speed and acceleration limits. Minimum spacing. Vertical spacing. Spread out to pass safely toggle (stage 7a). |
| Flight volume | Size. Center X and Y. Floor height. |

### Overlays on the 3D view

| Place | Contents |
|---|---|
| Top left | Paths and Volume toggle buttons. View menu. Showtime button. |
| Top right | The Checks panel: a status line, the five readouts, and a list of problems. A click on the status line folds the panel to one line. |
| Top middle | A note while a new plan pauses the page: "Planning the show…" after an imported project file or shape, and "Loading" and the demo name while a demo loads. The page draws the note before it starts the plan. |
| Bottom left | A short hint for the mouse controls. |

The status line says "All checks pass", or counts the problems.
The problem list names each one in words, for example "Formation 2: Targets are below the ground."
It shows four lines at most, and a last line counts the rest.
Each problem is a button. A click on it moves the timeline to the problem, pauses the show, shows the formation in the sidebar, and marks the drones that cause it (stage 10). For two drones that come too close, it also selects the first of them, so its route shows how they meet. The marks go away at a change of the project, at Escape, at a click on empty space in the 3D view, and in Showtime.

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
| First light | 120 | A short show for a first look, in solid colors and with the default spacings: a sphere and a helix that turn, a ring with a light chase, and a heart that rocks with a light chase. The flight to the heart is dark, so the heart appears like a slide. Then the fleet lands. The ring and the heart stand upright, so the vertical spacing makes them larger, and the fleet spreads out to pass in three transitions and in the landing. |
| The works | 400 | Most features in one show. A disc with an Outward gradient, like a sunrise. A turning sphere with an Across gradient. Saturn, an OBJ model with a forward and a sideways tilt. A turning helix with a Rising gradient. A wireframe cube: an OBJ model of thin tubes along the 12 edges, so the drones sit on the edges. It tilts and turns, and an Outward gradient lights its corners. A quadcopter drawing in its drawing colors that sways, rocks, and rolls: a drone made of drones. A torus that turns and rolls. The word WOW! as a drawing. Three hearts inside each other, with a light chase. Every flight light effect: the fleet glimmers as it takes off, bands ripple out of the disc on the way to the sphere, a rainbow spins on the way to Saturn, the drones glow by their speed on the way to the helix, the helix implodes into the cube, the cube dissolves into the quadcopter, the flight to the torus is dark, the torus bursts like a firework before WOW!, the hearts arrive on a heartbeat, and the fleet lands like a swarm of warm, slow fireflies. The minimum spacing is 1.5 m and the vertical spacing 2.25 m. The fleet spreads out to pass in six transitions and in the landing. |

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
| Drag with one finger | Orbit |
| Pinch with two fingers | Zoom: fingers that move apart bring the camera closer, by the change of the distance between them |
| Drag with two fingers | Pan: the scene follows the point between the fingers. A pinch and a pan can happen in one gesture. |
| Click or tap | Select the nearest drone. A finger moves more than a mouse, so a tap can move 10 px and a click 4 px. |

When one finger lifts after a pinch, the other finger orbits from where it is, with no jump, and its lift is not a tap. A third finger does nothing.

The View menu moves the camera to a view of the whole show or of the selected formation:

| View | Camera |
|---|---|
| Whole show | The frame of a show, as when a show opens (see Showtime). |
| Front | Level with the middle of the formation, from the audience side. |
| Side | Level with the middle of the formation, from the right side as the audience sees it. |
| Top | Straight down on the formation (89°, the steepest orbit), with the audience side at the bottom of the view. |
| Audience | At the audience seat: 160 m in front of the takeoff grid, at eye height, inside the crowd. |

The views of the formation use its targets as its hold starts.
Front, Side, and Top aim at the middle of the box around the targets. The camera stands back until every target fits in three quarters of the view width and of the view height.
Audience aims at the formation with the shot of the Showtime camera (see Showtime).
No view changes the field of view of the editor. After a view of the formation, an orbit turns about the middle of the formation.

The camera flies to the view in 0.8 seconds: slow at the start, fast in the middle, and slow at the end.
The target and the angles change evenly, and the azimuth turns the short way around. The distance changes by the same factor in each equal part of the flight, so a flight from far away does not rush at the end.
A drag, a pinch, or the wheel stops the flight where the camera is.
When the system asks for less motion, the camera jumps to the view.
An opened show also stops a flight. Showtime first finishes it at once, so that the editor gets the camera at the new view back after Showtime.
The menu closes after a choice, at a press outside it, and at Escape.

### Showtime

The Showtime button hides the sidebar, the transport bar, and the overlays, and asks the browser for full screen.
The show plays from the takeoff grid. The view hides the grid, the flight volume, the paths, and the selection.
A hint at the bottom says the keys, or on a touch screen, the tap. A round button with a cross at the top right goes back to the editor. The hint, the button, and the pointer hide after 2.5 seconds with no input; a move of the pointer or a touch brings them back. While the show pauses, they stay. At the end of the show, the end card, the button, and the pointer stay.

| Input | Action |
|---|---|
| Space, or a click or a tap on the view | Pause or play, as in a video player. While the show pauses, the hint says "Paused". At the end, a tap plays the show again. |
| Escape, the cross button, or leaving full screen | Back to the editor |

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

Previous, Play and pause, and Next buttons; the timeline strip with a playhead; the time readout; and the playback speed.
Times show as minutes, seconds, and tenths, for example `1:05.3`.
The Space key toggles play and pause.

Next moves the timeline to the start of the next hold, or to the end of the show after the last one. Previous moves it to the start of the hold that the timeline is in. From less than 1 s after the start of a hold, it goes on to the hold before, as in a music player, and from the first hold it goes to the start of the show. Both keep play and pause as they are. When the timeline lands on a hold, the sidebar shows that formation. The left and right arrow keys do the same, except in a control that uses them: a number box, a slider, a list, or the tabs.

The playback speed is 0.5×, 1×, 2×, or 4×. It is part of the view, not of the project, and it starts at 1× on each page load. Showtime plays at the same speed; its hint shows the speed when it is not 1×.

The timeline strip shows the whole show.
Each transition and each hold is one block, and the width of a block shows how long it takes.
A hold block has the number and the color of its formation.
The tooltip of a transition block gives its time, names its flight light effect when it is not Blend, says when the drones spread out to pass, and lists its problems.
A transition block blends from the color of the old formation to the color of the new one. The block of a flight with an effect shows the effect: a dark flight is dark in the middle, a glimmer has small sparks, a starburst starts with a white flash, a color wave has rainbow bands, bands have white stripes, a pulse has a row of beats, a dissolve goes from the old color to the new one through a scatter of sparks, and a speed glow is brightest in the middle.
A red line under a block marks a problem.

The playhead is a white line with a knob. A drag on the playhead moves the timeline.
The playhead is the thumb of a range input that lies on top of the strip. Only the thumb takes the pointer, so a click on a block reaches the block.
A click on a hold block selects its formation. A click on a flight block previews that flight, and the sidebar shows the formation that it flies to. A click on the landing block previews the landing.

A preview plays one flight again and again, so the user can see its flight lights while they change them. It starts 1 s before the flight, in the hold before it, and ends 1.5 s after the flight, in the hold after it, so the change of picture shows; the start and the end of the show limit it. At its end it starts again. Pause and play keep the preview, and the playback speed applies. The flight block of the preview has an outline in the accent color, and its Preview button says Stop. The preview stops at a second click on its block or its button, a drag of the playhead, Previous or Next, a click on a storyboard row or a hold block, and Showtime. A change of the project keeps the preview of the same step.

The page opens on the first formation.
Play at the end of the timeline starts again from the takeoff grid.
When the plan changes, the timeline keeps the same moment: the end stays the end, a time in a hold stays in that hold, and a time in a transition keeps its share of that transition.

## Rendering

The view draws these parts in this order:

1. Sky, field, and hills: one triangle that covers the view. Its fragment shader finds the direction of each pixel from the camera axes. Above the horizon it draws a sky that is dark at the top and lighter at the horizon, with the faint glow of a town far behind the show. Below the horizon it finds where the ray meets the ground and draws grass with a faint grain. The light of the show tints the field under it a little. The hills stand on a ring 3.5 km from the show, 8 to 170 m high. Far ground and far hills fade into the haze of the horizon. A little noise keeps the dark gradients from showing bands.
2. Stars: 1,600 points at infinity, above 4°, many dim and a few bright, in faint tints. They fade near the horizon and twinkle a little.
3. Crowd: 1,200 people on the field from the audience line 35 m back, 140 m wide, denser at the front. Each person is one quad that turns about its vertical axis to face the camera. The fragment shader cuts out the outline of a person seen from behind: a head, a neck, sloped shoulders, and the body, with smooth joins. Heights and widths vary, a few people are children, and 5 percent hold up a phone with a lit screen. The show lights the top edges of the people with its mean color. Alpha to coverage smooths the outlines. The crowd is the only solid part: it writes the depth buffer.
4. Ground grid, flight volume, paths, and route: lines with additive blending. They test the depth buffer, so the crowd hides them, and they write no depth.
5. Drones: one `gl.POINTS` draw call with additive blending, also behind the crowd. Each point has the light itself, with a hot white center, and a soft glare around it, like a bright light at night. The light shrinks with distance but has a minimum size, so far drones stay visible. The glare is at least 22 CSS pixels wide. In the editor, a drone whose light is off or nearly off shows as a dull gray dot with no glare, so the user can see where it flies. Showtime shows no dot: the audience does not see a dark drone.

- Ground grid: a line grid on `z = 0`. The editor shows it; Showtime does not.
- Flight volume: one `gl.LINES` draw call for the edges of the cube.
- Brightness: a second buffer holds the brightness of each light, from stages 9 and 9b. The page writes it each frame. 1 is full brightness; the flash of a starburst and the spark of a dissolve go above 1, so their glare grows. The selected drone stays at full brightness.
- Light color: a third buffer holds the color of each light, from stages 9a and 9b. The page writes it each frame. The selected drone is white.
- Paths: one buffer holds one line per drone per leg. The view draws the lines of the current step at low opacity, in the formation color. In a transition between two formations, the path color blends from one formation color to the other, in the cross leg. In a hold, the current step is the one that led to the hold.
- Route: for the selected drone, the view draws its whole route: each leg of each step, and its path in each hold as short straight lines; the pose changes by at most 10° from one line to the next. The part of the current step is brightest.
- Long lines are split into short segments. A software WebGL renderer drops a whole line when one end is behind the camera.
- Camera: a hand-written orbit camera with a perspective projection.
- Marks: each drone that a problem marks gets an amber ring around its light, at least 14 CSS pixels wide, with one draw call for all marked drones. A ring shows on a formation of any color.
- Picking: on a click, the code projects every drone to screen space and takes the nearest one inside 10 pixels. A tap of a finger is less exact, so it takes the nearest one inside 24 pixels.
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
    "minVerticalSpacing": 3,
    "gridSpacing": 3,
    "hoverHeight": 10,
    "rowDelay": 0.5
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
      "flightLights": {
        "effect": "blend",
        "burstDirection": "out",
        "bandDirection": "right",
        "pulseStyle": "breathe",
        "sparkColor": "#ffffff",
        "darkLevel": 0,
        "twinkleRate": 1.3,
        "flashTime": 0.6,
        "emberTime": 1,
        "bandCount": 1.5,
        "bandSpeed": 0.5,
        "bandWidth": 30,
        "pulseRate": 60,
        "fadeTime": 1
      },
      "seed": 1
    }
  ],
  "landAtEnd": true,
  "spreadToPass": true,
  "landingLights": { "effect": "blend", "...": "the same settings as flightLights" }
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
A file with no `minVerticalSpacing` gets the minimum spacing as its vertical spacing: one spacing in all directions, as before.
A file with no `hoverHeight` gets 0: the fleet flies straight from the takeoff grid and back, as before. A file with no `rowDelay` gets 0.5 s.
`flightLights` and `landingLights` hold the effect and its settings (stage 9b). `effect` is one of `blend`, `dark`, `glimmer`, `starburst`, `wave`, `bands`, `pulse`, `dissolve`, and `speed`. A setting that is not in the file gets its fallback. A file with no flight lights gets `blend`, so its lights stay on, as before. A file from milestones 26 to 29 has the effect as a name only, with `darkLevel` beside it in the formation, and `landingDarkLevel` beside `landingLights`; it loads with those values and the fallbacks of the other settings.

Import checks the `app` name, the `version`, and every value.
It shows a message and changes nothing when a check fails.

## Code layout

```
index.html        page skeleton: canvas, sidebar, transport bar
style.css
package.json      no dependencies; marks the code as ES modules and names the test and check scripts
jsconfig.json     type check settings: strict, for the JSDoc types of src/
README.md         how to run, use, test, and publish the simulator
.nojekyll         tells GitHub Pages to serve the files as they are, when Pages deploys from a branch
.github/workflows/
  ci.yml          checks each push, and deploys main to GitHub Pages when the checks pass
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
  camera.js       orbit camera, the frame of a show, the audience seat shot, the views of the View menu and the flight to them, and mouse and touch input
  demos.js        the list of demo shows
  renderer.js     WebGL2 shaders, buffers, and draw calls: scenery, lines, and lights
  scenery.js      the people of the crowd and the stars
  ui.js           sidebar tabs and controls, storyboard, drone list, transport bar, the sheet on a phone
  version.js      the milestone number and date that the Project menu shows
test/
  *.test.js       unit tests
tools/
  smoke.js        headless browser smoke test
```

`state.js`, `plan.js`, `rng.js`, `shapes.js`, `obj.js`, `svg.js`, `sample.js`, `assign.js`, `motion.js`, `demos.js`, and `scenery.js` are pure.
They use no DOM and no WebGL, so Node can run their tests.
`camera.js` uses the DOM only in its input function, so Node also tests its other functions, also the math of a pinch and a pan.
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
| `motion.js` | Duration for known cases. No limit is exceeded. Positions at the start and the end. Closest approach equals a dense time scan, and with a limit it stops at a pair below the limit. The closest pair is the pair of the closest approach, at the progress of that moment. The time of a progress value is the inverse of the progress at a time. Turn profile for long and short holds, with room for the centripetal acceleration. A swing fits whole swings in the hold, starts and ends at rest, and stays inside its speed bound. The hold angles add up. The pose rotation equals the three rotations in order, and each tilt leans the right way. |
| `obj.js` | Triangles, faces with four corners, negative indices, up axis. |
| `svg.js` | Each path command, compact numbers and arc flags, smooth curves, arcs on each side, the error rule, each transform and their order, each basic shape, nested groups, skipped elements, namespaces, the orientation and scale of the cloud. Each color format, stroke before fill, the style attribute, colors from groups, `currentColor`, and the color of each cloud point. |
| `history.js` | Undo and redo, quick changes of one field merge, the time window, an undo ends a merge run, the step limit. |
| `camera.js` | The frame of a show: the aim at the middle of the formations, the start direction, the start distance for a short show, and a larger distance for a tall show. The audience seat shot: every point in the view, the horizon in the lower quarter, the narrowest view for a small show, no horizon for a tall show and the middle for a show that does not fit, a turn toward a show to one side. Easing by time and not by frames. The camera eye at the seat, the axes, and the Audience view. Each fixed view, in a wide and in a narrow view: every target in the frame, and the outermost one at its edge. The direction of the front, the side, and the top view, with the audience side at the bottom of the top view. A camera flight: its two ends, the short way around, the distance by equal factors, and an ease that starts and ends at rest. A pinch: fingers apart zoom in, together zoom out, a move together pans, two fingers at one point do not zoom. A pan: the scene follows the pointer, a sideways pan keeps the height, and the target stays above the ground. |
| `scenery.js` | The crowd: its size, its area, the spacing of the people, the clear space at the seat, heights, phones, a denser front. The stars: unit directions above 4°, a few bright ones. Both are the same each time. |
| `demos.test.js` | Each demo has a name, a line, and a relative URL of a file in `demos/`. The list and the folder match. Each demo loads like an imported project file and passes every check. |
| `page.test.js` | The module preload list equals the modules that the page imports. Every link that the page loads is relative and is a file. The link preview picture is on the site and has the size that its tags give. The version is the last milestone that is done. The script and the style sheet use the same width for the phone layout, and the style sheet has each height of the sheet. |
| `autosave.js` | A saved project loads again, one save for many quick changes, the delay, no storage, saved text that is not valid, a failed save. Pairings go through storage unchanged, and a later planner that starts from them gives the same plan. Pairings that are broken are dropped or repaired. |
| `state.js` | Export then import gives the same state. Import rejects bad files. Version 1 files load. A file with no spread setting gets the spread. A file with no vertical spacing has one spacing, and a file with no hover height flies straight from the grid. A file with no color pattern gets one solid color. Drawing colors need an SVG drawing. A file with no flight lights keeps the lights on. A file with only the name of the effect and a dark level beside it keeps both. Flight lights with some settings get the fallbacks of the others. Export then import keeps the flight lights. Import rejects a bad effect, a bad choice (also a pulse style), a bad color, and a number out of range. |
| `plan.js` | Problems: the kind and the step of each problem, with the same words as the list of words. A click on a problem: the closest pair of a flight at the moment of its closest approach, the closest pair of a formation, the drones below the ground and the lowest one, the drones outside the flight volume, the start of the hold for a motion; the takeoff, the hover layer, and a spread with the drones outside, and only those. The span of a preview, with its limits at the start and the end of the show. Previous and next: each hold in turn and then the end, the start of the current hold, the hold before from just after a start, the start and the end of the show, a jump from a transition. One formation: targets, even spacing on a curve and on a surface, timeline, checks. Storyboard: one step per formation, no jump between steps, each stop holds every target one time, the closest approach bound, stored results equal fresh results. Hold motion: the end pose of a turn, the turn speed and acceleration, a turn that is too fast, a turn that leaves the flight volume, the route of a drone. Forward and sideways tilt, a sway that ends where it started, a rock below the ground and out of the volume, swings too fast for each limit, patterns that stay on a tilted formation, all motions together. Light chase: the head and the tail of a band, the direction, the repeat time, the fades, the path of each pattern, a path that follows the drones and ignores the yaw. Flight lights: the fade in and out of an effect over the fade time and its share in a short flight, a dark flight that leaves and arrives lit, the dark level and the fade time, the colors that still blend, the landing lights. The hash: it repeats, and it spreads evenly. The six colors of the rainbow. A twinkle in its slot, and the number of twinkles per second at a slow, a middle, and a fast rate. A glimmer over the dark level, whiter at a twinkle, red with a red spark color, the same at the same time, more lit drones at a faster rate. A starburst: the ripple from the middle as the audience sees it, the ring of the flash halfway out, the outer drones not yet reached, the peak, the embers that go dark, the arrival. An inward starburst: the reversed ripple, the outer drones first and in the spark color, longer embers that glow longer. The place of a drone for each band direction. A color wave in four directions: each color against the hue of its place, many hues at once, whole spokes, the old colors at the start and the new ones at the end. A color wave all together: one hue for the fleet, a cycle at the band speed. Bands: the drone colors, each brightness against the phase of its place, about the band width of the drones lit, the whole fleet together. A pulse: the breath, the two beats and the rest of a heartbeat, a strobe flash in the spark color for the whole fleet at the pulse rate. A dissolve: the moments in the middle of the transition, the old or the new color away from a spark, the spark at a moment, the old colors at the start and the new ones at the end. A speed glow: each brightness against the speed of the drone. Hover layer and rows: a straight lift-off in rows with the row delays, the first row higher halfway, a drone that waits at rest, a touchdown in rows onto the grid, the grid spacing in both legs (checked over time), a takeoff to a large formation that fits only with the hover layer, a hover layer outside the flight volume. Spread: the even factor between two formations, the bisection of a takeoff and a landing, no candidate that fails a check, a crossing within 3% of the minimum spacing, the room of a stop in the flight volume, spreads that fit their room, a spread that fits winning over a faster one that leaves the volume, the spread factors of the bound for each kind of stop, the largest spread, the spread point and the volume floor and top, one leg for a safe flight, the minimum spacing in every leg (checked against a full search), legs that join, speed limits, the color blend in the cross, the route corners, no spread when it does not make the flight safe, a spread outside the flight volume. Colors: a solid formation, each gradient against its path (with a yaw), an outward gradient on a sphere, drawing colors at full brightness and the formation color for an outline with no color, the blend of each drone in a transition and through a spread, the colors of the landing. |

The smoke test is `npm run smoke`.
It serves the folder, opens the page in headless Chrome or Chromium, and reads a marker.
The page sets `data-smoke="ok"` on the `<html>` element after the first frame.
It sets `data-smoke="error"` on an uncaught error or a WebGL failure.

The smoke test uses the `--dump-dom` flag of Chrome, so it needs no npm package.
It also sets `--virtual-time-budget`. Without that flag, Chrome prints the page before the first frame.
The `CHROME_PATH` environment variable selects the browser binary.

The type check is `npm run typecheck`.
It runs the TypeScript checker on the JSDoc types of `src/`, in strict mode, and writes no files.
`npx` gets one pinned version of TypeScript, so the project still has no dependencies and needs no `npm install`.
The check covers `src/` only. The tests and the smoke test import Node modules, and the types of those modules are a separate package.
Where the checker cannot see a fact that the code knows, a JSDoc cast states it. For example, a step that moves in its hold always has a body.

GitHub Actions runs all three checks on each push and each pull request: the unit tests on Node 20 and on Node 24, the smoke test in the Google Chrome of the runner, and the type check.

## Hosting

GitHub Pages serves the repository root.
The site needs no build.
The CI workflow deploys it: on a push to `main`, a deploy job uploads the repository as it is and publishes it, but only after the unit tests, the smoke test, and the type check pass.
A failed check stops the deploy, so the site keeps the last version that passed.
For this, the Pages source in the repository settings is GitHub Actions.
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
| 24 | Downwash spacing | A vertical spacing. Every spacing check uses an ellipsoid: the minimum spacing across, the vertical spacing up and down. The demos have one too. | Done |
| 25 | Rows and hover layer | The rows of the takeoff grid lift off to a hover layer one after another, and land the same way. The hover layer can spread out. | Done |
| 26 | Flight lights | Each formation sets what the lights do in the flight to it: Blend or Dark, with a dark level. The landing has its own setting. The editor marks dark drones with a gray dot. | Done |
| 27 | Light effects | Three more flight light effects: Glimmer, Starburst, and Color wave. Both demos use flight lights. | Done |
| 28 | Playback and folds | Previous and Next formation buttons and arrow keys. A playback speed. Sidebar groups that fold, and a Colors and lights group. | Done |
| 29 | Phones and touch | On a phone the sidebar is a sheet at the bottom with three heights. Touch gestures in the 3D view, larger controls on a touch screen, a smaller sidebar on a tablet, and Showtime by touch. | Done |
| 30 | Flight light settings | The flight lights become an effect with settings: fade time, twinkle rate, spark color, the direction, flash time, and ember time of a starburst, and the direction, bands, and speed of a color wave. | Done |
| 31 | Light patterns | Four new flight light effects: Bands (also as ripples and spokes), Pulse (breathe, heartbeat, strobe), Dissolve, and Speed glow. The works uses every effect. | Done |
| 32 | Preview and focus | A Preview button and a click on a flight block play one flight again and again. Each set of flight lights names its flight. A click on a problem moves the timeline to it and marks its drones with amber rings. | Done |
| 33 | Checks on every push | A GitHub Actions workflow runs the unit tests on two Node versions, the smoke test, and a strict type check of the JSDoc types. On `main` it deploys the site to GitHub Pages only when every check passes. | Done |
| 34 | Camera views | A View menu on the 3D view: Whole show, and the selected formation from the front, the side, above, and the audience seat. The camera flies to each view, and a drag stops the flight. | Done |

## Known limits

- On a surface, the closest pair of targets is about 0.75 to 0.85 of a perfect hexagonal spacing. Each target is a point of the cloud, so the cloud size limits the optimization. A cloud of 80,000 points gave about 0.8 at 1,000 drones, but took about three times as long.
- A cusp or a sharp corner costs spacing: the targets keep away from the other side of the cusp, so the gap at the cusp is larger.
- A change of drone count moves every target a little, so the assignments need new solves.
- A cold plan of a large show, a new shape, a yaw change, or a change of drone count still pauses the page at 1,000 drones: about 1 second for a cold plan of the default show (a page open with stored pairings plans in about 0.35 seconds), and 0.2 to 0.8 seconds for the others, on a slow CPU. If this is a problem, the next step is to run the planner in a Web Worker.
- Drones fly straight legs. The spread keeps the minimum spacing in a transition, but it makes the transition longer. The formations grow only as much as an exact check needs, but in a takeoff or a landing only the formation can grow, so a formation that nearly fills the flight volume can still leave it. The simulator does not plan a path around a single conflict, and it does not move only the drones that conflict: in a stress test, a median of 19% of the drones took part in the conflicts of an unsafe flight.
- A spread cannot fix a stop whose targets are too close together. It also cannot fix a takeoff when the grid spacing is not more than the minimum spacing.
- A drone can land on a grid cell that is not the one it started from.
- The rows lift off and land in one fixed order, the row nearest the audience first, with one delay for all rows.
- The OBJ importer puts drones on every surface of the model, also on surfaces inside it.
- The SVG importer puts drones on outlines only. It does not fill a filled area. It does not read `text` (fonts), `use`, nested `svg` positions, CSS classes, or units such as percent.
- Drawing colors come from `stroke`, `fill`, and `color` only. CSS classes, gradients, opacity, and color names other than the basic ones give no color. Each color goes to full brightness, so a drawing that uses dark and light shades of one hue shows one hue.
- An OBJ model has no colors of its own in the simulator. The importer does not read materials.
- A gradient has two colors. The faint flight paths use the formation color, not the color of each drone.
- The flight volume is a cube. It has no rotation and no separate width, depth, and height.
- Fit changes the size only. A large shape with a low center reaches the ground; the Lowest target check shows this.
- The undo history does not survive a page reload. Only the project does.
- The spacing of a formation that leans in its hold comes from up to 24 poses, not from every moment of the hold.
- The assignment pairs drones by plain squared distance, not by spacing distance. With a vertical spacing, the bound `D ÷ √2` then does not hold, so more flights need a spread. The exact checks keep each flight safe.
- The ellipsoid is a simple model of downwash. Real downwash is a cone below the drone that also depends on the wind.
- A demo loads with a fetch, so the page must come from a web server. A page opened as a local file cannot load a demo.
- The first plan of The works takes about 1 second on a fast CPU. The page shows a note, but it does not draw while it plans.
- The camera frame looks at the heights of the formations only. A wide formation can be wider than the view.
- The audience seat is always 160 m in front of the takeoff grid. A large show at this distance fills a wide view, and a high formation shows far above the crowd with much empty sky between. Real audiences often stand farther away.
- The people of the crowd are flat outlines that turn to face the camera. From straight above they are thin lines.
- The glare is part of each point, not a bloom of the whole picture. A point whose center leaves the view loses its glare at once.
- The hills are at a fixed distance on a ring, and the scenery has no moon, no clouds, and no shadows.
- A browser can refuse full screen, for example in a frame, or Safari on an iPhone, which gives full screen only to a video. Showtime then runs in the window, with the toolbars of the browser.
- The tooltips that explain the fields come from `title` attributes, and a touch screen does not show them. On a phone or a tablet, those explanations are only in this file and in the README.
- The layout follows the width of the window only. A phone turned on its side is wider than 720 px, so it gets the sidebar layout with a short 3D view. A large touch screen gets the touch controls with the layout of its width.
- In a sheet at `half`, the 3D view is small on a phone: about a third of the screen. A sheet at `full` leaves only a strip of it.
- Browser storage holds about 5 MB per site. A show with a large OBJ model can be too large for autosave. Export still works.
- A flight light effect fades in and out over fixed times, at most 1 s each. The whole fleet fades together, also when the rows of the takeoff grid lift off one after another.
- The embers of a starburst cool to the color of each drone; they have no color of their own. A color wave uses the rainbow only, not the colors of the formations. Bands and a pulse use the drone colors only.
- A pulse beats from the start of the transition. It does not follow music, and it does not line up with the beats of other flights.
- The flash of a starburst spreads by the side and the height of each drone. The takeoff grid lies flat on the ground, so a starburst at the takeoff spreads to the left and the right only.
- The flight lights are lights only. A real starburst in a drone show often flies the drones outward too; here the drones fly their planned paths.
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

- Wind, battery, GPS error, and drone failure.
- Music sync and pyrotechnics.
- Control of real drones.
- A server. The site is static files only.
