# Drone show simulator

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
| Click a storyboard row or a timeline block | Select that formation |
| Click empty space, or Escape | Clear the selection |
| Space | Play or pause |
| Ctrl+Z, or ⌘Z on a Mac | Undo |
| Ctrl+Shift+Z, Ctrl+Y, or ⇧⌘Z | Redo |

The sidebar has three tabs.

| Tab | What it does |
|---|---|
| Show | The storyboard lists the formations of the show in order. Its buttons add, move, and remove formations. Below it, you set the shape, size, height, rotation, tilt, hold time, colors, and light chase of the selected formation. The Motion in the hold section makes the formation turn, sway (turn back and forth), rock (lean toward the audience and back), and roll (lean left and right), all at the same time if you like. Each swing ends where it started. The color pattern gives the formation one color, a gradient of two colors (rising, across, or outward from the center), or the colors of an SVG drawing. A light chase sends bright bands across the formation in its hold, like the bulbs of a theater marquee. Fit sets the smallest size that keeps the minimum spacing, also in flight. |
| Fleet | Sets the drone count, the takeoff grid, the speed and acceleration limits, the minimum spacing, the vertical spacing, and the flight volume: the cube that the drones must stay inside. The vertical spacing is the room that a drone needs straight above another: a drone pushes air down, so the drone under it needs more room than a drone beside it. "Spread out to pass safely" lets the fleet open out before a crossing that would bring drones too close (on by default). |
| Drones | Lists each drone with its position and speed at the current time. |

The sidebar header has Undo and Redo buttons and a Project menu. Every change to the show can be undone; a slider drag counts as one step.
The show saves in your browser as you work, so a page reload brings it back. In the Project menu, New show starts again from the default show (Undo brings the old one back), and Import and Export load and save the show as a JSON file.

The Project menu also opens two demo shows. First light is a short show of four shapes. The works shows most features at once: gradients, tilts, swings, two OBJ models, three SVG drawings, a light chase, and the spread. Undo brings your own show back. The demo files are in the `demos` folder; to add one, export a show into that folder and list it in `src/demos.js`.

The 3D view shows the show at night over a field, with stars, hills on the horizon, and a crowd where the audience stands. They give a sense of place and scale. Overlays on the 3D view show or hide the flight paths and the flight volume, and move the camera into the crowd.

**Showtime** plays the whole show full screen, as a person in the crowd sees it. The camera stands in the crowd and follows the show. Space pauses and plays, and Escape goes back to the editor.
The Checks panel at the top right shows the show duration, the drones outside the flight volume, the lowest target, the closest approach in flight, and the peak speed. It lists each problem in words. A click on its status line folds it.

The timeline strip under the 3D view shows the whole show: one block per flight and one per hold. Drag the playhead to move through the show.

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

## Test it

Both commands need Node 20 or later. Neither needs `npm install`.

```sh
npm test          # unit tests for the math
npm run smoke     # opens the page in headless Chrome and checks that it draws a frame
```

The smoke test needs Chrome or Chromium. Set `CHROME_PATH` if the script does not find the browser.

## Publish it on GitHub Pages

1. Make the repository public.
2. In the repository settings, open Pages.
3. Select "Deploy from a branch", then `main` and the `/ (root)` folder. `main` holds the last finished milestone.

The empty `.nojekyll` file tells Pages to serve the files as they are.

The page head has a link preview for chat apps and social sites. Its tags hold the full address of the site, because link crawlers need it. If you publish the site at another address, change those tags in `index.html` and the `SITE` constant in `test/page.test.js`.
