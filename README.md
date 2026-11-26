# Drone show simulator

[![CI](https://github.com/knowaveragejoe/drone-show-sim/actions/workflows/ci.yml/badge.svg)](https://github.com/knowaveragejoe/drone-show-sim/actions/workflows/ci.yml)

A browser tool that previews a drone light show in 3D.
The drones take off from a ground grid, fly to each formation of a storyboard in turn, and land.

![The sixth formation of The works demo: a quadcopter drawn by 400 drones, with red and green rotor guards, over a night field with hills on the horizon. Faint flight paths show the flight into it. The sidebar shows the storyboard, and the timeline strip shows the whole show.](docs/screenshot.png)

Try it at https://knowaveragejoe.github.io/drone-show-sim/.

The page is static files. It has no dependencies and no build step.

## Run it

Serve the folder with any static file server, then open the page:

```sh
uv run python -m http.server 8000
```

Open `http://localhost:8000/`. The browser must support WebGL2.

## Use it

| Input | Action |
|---|---|
| Drag in the 3D view | Orbit |
| Right-drag or Shift-drag | Pan |
| Wheel | Zoom |
| Click a drone or a row of the drone list | Select that drone |
| Click a storyboard row or a hold block of the timeline | Select that formation |
| Click a flight block of the timeline | Preview that flight: it plays again and again |
| Click a problem in the Checks panel | Show it: the timeline moves to it, and its drones get amber rings |
| Click empty space, or Escape | Clear the selection |
| Space | Play or pause |
| Left and right arrow keys | Jump to the previous or the next formation |
| Ctrl+Z, or ⌘Z on a Mac | Undo |
| Ctrl+Shift+Z, Ctrl+Y, or ⇧⌘Z | Redo |

On a phone or a tablet:

| Touch | Action |
|---|---|
| Drag with one finger in the 3D view | Orbit |
| Pinch with two fingers | Zoom |
| Drag with two fingers | Pan |
| Tap a drone | Select that drone |

On a phone the sidebar is a sheet at the bottom of the screen. It opens with only its tabs in sight, so the show is large. Tap a tab or the handle to open the sheet to half the screen, and swipe up or down on the handle or the tabs to make it taller or shorter.

The sidebar has three tabs. A click on the title of a section folds it; the page remembers the folded sections.

| Tab | What it does |
|---|---|
| Show | The storyboard lists the formations of the show in order. Its buttons add, move, and remove formations. Below it, you set the shape, size, height, rotation, tilt, and hold time of the selected formation, and in Colors and lights, its colors, flight lights, and light chase. The Motion in the hold section makes the formation turn, sway (turn back and forth), rock (lean toward the audience and back), and roll (lean left and right), all at the same time if you like. Each swing ends where it started. The color pattern gives the formation one color, a gradient of two colors (rising, across, or outward from the center), or the colors of an SVG drawing. A light chase sends bright bands across the formation in its hold, like the bulbs of a theater marquee. Flight lights set what the lights do in the flight to the formation: Blend keeps them on and blends the colors, Dark turns them down to the dark level so the new picture appears like a slide, Glimmer twinkles like glitter, Starburst sends a flash out from the middle (or in from the edge) and lets the lights fade like firework embers. Color wave sends rainbow bands across the fleet: sideways, up or down, out or in as rings, around as spokes, or all together. Bands sends bright bands in the drone colors the same ways, Pulse makes the fleet breathe, beat like a heart, or strobe, Dissolve changes each drone to its new color at its own moment with a spark, and Speed glow makes each drone as bright as it is fast. Under the list, a line names the flight that the lights belong to, such as "1 Sphere → 2 Heart", with a Preview button that plays that flight again and again while you change the settings. Each effect has its own settings under that line, such as the twinkle rate, the spark color, the band speed, the pulse rate, and the fade time. Landing lights, under Land at the end, do the same for the landing. In the editor, a dark drone shows as a dull gray dot; Showtime hides it, as a real audience would not see it. Fit sets the smallest size that keeps the minimum spacing, also in flight. |
| Fleet | Sets the drone count, the takeoff grid, the hover height and row delay of the takeoff, the speed and acceleration limits, the minimum spacing, the vertical spacing, and the flight volume: the cube that the drones must stay inside. The vertical spacing is the room that a drone needs straight above another: a drone pushes air down, so the drone under it needs more room than a drone beside it. "Spread out to pass safely" lets the fleet open out before a crossing that would bring drones too close (on by default). |
| Drones | Lists each drone with its position and speed at the current time. |

The sidebar header has Undo and Redo buttons and a Project menu. Every change to the show can be undone; a slider drag counts as one step.
The show saves in your browser as you work, so a page reload brings it back. In the Project menu, New show starts again from the default show (Undo brings the old one back), and Import and Export load and save the show as a JSON file.

The Project menu also opens two demo shows. First light is a short show of four shapes. The works shows most features at once: gradients, tilts, swings, two OBJ models, three SVG drawings, a light chase, the spread, and every flight light effect. Undo brings your own show back. The demo files are in the `demos` folder; to add one, export a show into that folder and list it in `src/demos.js`.

The 3D view shows the show at night over a field, with stars, hills on the horizon, and a crowd where the audience stands. They give a sense of place and scale. Overlays on the 3D view show or hide the flight paths and the flight volume. The View menu flies the camera to the whole show, or to the selected formation from the front, the side, above, or a seat in the crowd. A drag or a pinch stops the flight.

**Showtime** plays the whole show full screen, as a person in the crowd sees it. The camera stands in the crowd and follows the show. Space, a click, or a tap pauses and plays. Escape or the cross button at the top right goes back to the editor. On an iPhone, Safari does not allow full screen for a page, so Showtime fills the window.
The Checks panel at the top right shows the show duration, the drones outside the flight volume, the lowest target, the closest approach in flight, and the peak speed. It lists each problem in words; a click on a problem moves the timeline to it and puts an amber ring on each drone that causes it. A click on its status line folds the panel.

The timeline strip under the 3D view shows the whole show: one block per flight and one per hold. Drag the playhead to move through the show. The buttons next to Play jump to the previous or the next formation, and the list at the right end sets the playback speed: 0.5×, 1×, 2×, or 4×.

A shape is one of seven built-in shapes, an OBJ model, or an SVG drawing. The button next to the Shape list imports a file.

- An OBJ model gets drones on its surface. The importer reads vertices and faces. It ignores materials and textures.
- An SVG drawing gets drones on its outlines, and it stands upright facing the audience. The importer reads paths, rectangles, circles, ellipses, lines, polylines, polygons, and transforms. It does not read text, so convert text to paths first. The drones take the stroke or fill color of each outline, at full brightness. Set the color pattern to Solid to use one color instead.

Above 250 drones, the sliders for drone count, yaw, tilt, and turn rate apply their value when you let go. The others apply at once at every fleet size.

## How it works

`SPEC.md` describes the design: the terms, the steps from shape to flight plan, and the project file format.

In short:

1. Each shape becomes 40,000 points: random over a surface, or in order along a curve.
2. One evenly spread target per drone. On a surface, farthest point sampling picks the targets, and then each target moves away from its nearest neighbors. On a curve, a walk along it keeps one point per spacing, and skips spots that are too close to another part of the curve.
3. For each flight, an assignment solver pairs the drones with the targets so that the total of squared flight distances is the smallest. With these pairs, straight paths do not cross closer than 0.7 times the spacing.
4. When a direct flight would still bring drones too close, the fleet spreads out first: the formations grow, the drones cross, and the new formation closes up. A larger spacing at both ends makes the crossing safe, and the pairs stay the best ones. The formations grow only as much as an exact check of the crossing needs: when both grow by the same factor, every distance in the crossing grows by that factor too.
5. In each flight, all drones fly on one shared accelerate, cruise, brake profile. The profile is the fastest one that keeps every drone inside every limit.
6. As in real shows, the rows of the takeoff grid lift off one after another to a low hover layer, and the fleet flies on from there. The landing is the same in reverse. A straight climb keeps every drone's distance across, so the rows cannot collide, and the hover layer can spread out like a formation.

## Test it

The commands need Node 20 or later. None of them needs `npm install`.

```sh
npm test            # unit tests for the math
npm run smoke       # opens the page in headless Chrome and checks that it draws a frame
npm run typecheck   # checks the JSDoc types of src/ with TypeScript, in strict mode
```

The smoke test needs Chrome or Chromium. Set `CHROME_PATH` if the script does not find the browser.
The type check downloads one pinned version of TypeScript with `npx` the first time. The page does not use it.

GitHub Actions runs all three on every push and pull request. The badge at the top shows the result for `main`.

## Publish it on GitHub Pages

1. Make the repository public.
2. In the repository settings, open Pages.
3. Under "Build and deployment", set Source to "GitHub Actions".

The CI workflow then deploys `main` after each push, but only when every check passes. `main` holds the last finished milestone. To deploy again by hand, open the CI workflow on the Actions tab and select "Run workflow" on `main`.

"Deploy from a branch" with `main` and the `/ (root)` folder also works, but it deploys without the checks. The empty `.nojekyll` file is for that case: it tells Pages to serve the files as they are.

The page head has a link preview for chat apps and social sites. Its tags hold the full address of the site, because link crawlers need it. If you publish the site at another address, change those tags in `index.html` and the `SITE` constant in `test/page.test.js`.
