# Drone show simulator

A browser tool that previews a drone light show in 3D.

`SPEC.md` is the source of truth for scope, terms, algorithms, and milestones.
Read it before any change.

Status: the simulator plays a storyboard of several formations. A formation can turn slowly in its hold, and a light chase can run across it. When a direct flight would bring drones too close, the fleet spreads out, crosses, and closes up. The page has undo and redo, and it autosaves the show in the browser. `SPEC.md` lists the milestones, the known limits, and the future features.

## Hard constraints

- No runtime dependencies: no 3D library and no user interface framework.
- No build step. Plain JavaScript with native ES modules and JSDoc types.
- Raw WebGL2 for the 3D view.
- All URLs are relative, so the site works from a GitHub Pages subpath.
- YAGNI: build only what the current feature needs.

## Conventions

- Units: meters, seconds, degrees.
- Axes: right-handed, Z up. The audience stands on the negative Y axis and looks toward positive Y.
- Use the terms from `SPEC.md` in code, interface text, and docs: drone, fleet, shape, target, formation, storyboard, takeoff grid, stop, transition, leg, spread, hold, turn, light chase, step, assignment, flight volume.
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
- When a design or technical decision changes, update `SPEC.md` and this file in the same commit. Update `README.md` when the controls or the commands change.
- Prose style: Simplified Technical English. Short sentences, active voice, one term per concept.
