# Drone show simulator

A browser tool that previews a drone light show in 3D.

`SPEC.md` is the source of truth for scope, terms, algorithms, and milestones.
Read it before any change.

Status: the simulator plays a storyboard of several formations. A formation can tilt forward and sideways. In its hold it can turn, sway, rock, and roll, all at the same time, and a light chase can run across it. Each drone has its own light color: a formation has one color, a two-color gradient, or the colors of an SVG drawing. Targets are evenly spaced: a walk along curves, and farthest point optimization on surfaces. When a direct flight would bring drones too close, the fleet spreads out just enough, crosses, and closes up. The page has undo and redo, and it autosaves the show in the browser. The Project menu opens two demo shows from the `demos` folder. The 3D view shows a night sky, a field, hills, and a crowd, and Showtime plays the show full screen from the audience seat. `SPEC.md` lists the milestones, the known limits, and the future features.

## Hard constraints

- No runtime dependencies: no 3D library and no user interface framework.
- No build step. Plain JavaScript with native ES modules and JSDoc types.
- Raw WebGL2 for the 3D view.
- All URLs that the page loads are relative, so the site works from a GitHub Pages subpath. Only the link preview tags in the page head hold absolute URLs, because link crawlers need them.
- YAGNI: build only what the current feature needs.

## Conventions

- Units: meters, seconds, degrees.
- Axes: right-handed, Z up. The audience stands on the negative Y axis and looks toward positive Y.
- Use the terms from `SPEC.md` in code, interface text, and docs: drone, fleet, shape, target, formation, storyboard, takeoff grid, stop, transition, leg, spread, hold, tilt, turn, swing, sway, rock, roll, light chase, color pattern, gradient, step, assignment, flight volume, audience seat, Showtime.
- Math modules stay pure: no DOM and no WebGL. Node runs their tests.
- Never change the project state in place. Each change makes a new state object. The undo history keeps old state objects as its steps.
- Random sampling uses the seeded generator, so results repeat.

## Commands

- Serve: `uv run python -m http.server 8000`, then open `http://localhost:8000/`.
- Unit tests: `npm test`. Needs Node 20 or later. No `npm install`.
- Smoke test: `npm run smoke`. Needs Chrome or Chromium. Set `CHROME_PATH` if the script does not find the browser.

## Workflow

- Develop without waiting for the owner to test. Check your own work at three levels:
  1. Run the unit tests after each change to a math module.
  2. Run the smoke test after each change to the page.
  3. Take a headless browser screenshot only when a change needs a visual check. Do not use the browser for every small change. Keep screenshot scripts out of the repository.
- In the cloud container, Chromium is at `/opt/pw-browsers/chromium` and Playwright is installed globally. WebGL2 runs there through software rendering.
- Work in milestones. Commit and push after each one.
- In the commit that finishes a milestone, add the milestone to `SPEC.md` and set the same number and the date in `src/version.js`. A test checks the number.
- `main` holds the last finished milestone. After each milestone push, move `main` forward to the work branch (a fast-forward) and push it too.
- A new module in `src/` needs a `modulepreload` link in `index.html`. A test checks the list.
- Each demo in `demos/` must pass every check, and `src/demos.js` must list it. A test checks both. When a change to the planner breaks a demo, fix the demo or the change.
- When a design or technical decision changes, update `SPEC.md` and this file in the same commit. Update `README.md` when the controls or the commands change.
- Prose style: Simplified Technical English. Short sentences, active voice, one term per concept.
