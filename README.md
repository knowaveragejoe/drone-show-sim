# Drone show simulator

A browser tool that previews a drone light show in 3D.
The drones take off from a ground grid, fly to a formation, and hold it.

![A torus of 400 drones in flight, with flight paths and the drone list](docs/screenshot.png)

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
| Click a drone or a list row | Select that drone |
| Click empty space, or Escape | Clear the selection |
| Space | Play or pause |

The sidebar has six sections.

| Section | What it does |
|---|---|
| Project | Saves the project to a JSON file and loads it again. |
| Fleet | Sets the drone count, the speed and acceleration limits, and the spacing. |
| Formation | Sets the shape, size, height, rotation, color, and hold time. Fit sets the smallest size that keeps the minimum spacing. |
| Checks | Shows the lowest target, the transition duration, the closest approach in flight, and the peak speed. A value turns red when it breaks a limit. |
| View | Hides the flight paths. Moves the camera to where the audience stands. |
| Drones | Lists each drone with its position and speed at the current time. |

A shape is one of seven built-in shapes or an OBJ model.
The importer reads the vertices and faces of the model. It ignores materials and textures.

Above 250 drones, a slider applies its value when you let go.

## How it works

`SPEC.md` describes the design: the terms, the steps from shape to flight plan, and the project file format.

In short:

1. The shape becomes 20,000 random points.
2. Farthest point sampling picks one evenly spread target per drone.
3. An assignment solver gives each drone the target that makes the total of squared flight distances smallest. With this assignment, straight paths do not cross closer than 0.7 times the spacing.
4. All drones fly on one shared accelerate, cruise, brake profile. The profile is the fastest one that keeps every drone inside every limit.

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
3. Select "Deploy from a branch", then the branch and the `/ (root)` folder.

The empty `.nojekyll` file tells Pages to serve the files as they are.
