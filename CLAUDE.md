# Drone show simulator

A browser tool that previews a drone light show in 3D.

`SPEC.md` is the source of truth for scope, terms, algorithms, and milestones.
Read it before any change.

Status: version 1 is built. `SPEC.md` lists the milestones, the known limits, and the future features.

## Hard constraints

- No runtime dependencies: no 3D library and no user interface framework.
- No build step. Plain JavaScript with native ES modules and JSDoc types.
- Raw WebGL2 for the 3D view.
- All URLs are relative, so the site works from a GitHub Pages subpath.
- YAGNI: build only what the current milestone needs.

## Conventions

- Units: meters, seconds, degrees.
- Axes: right-handed, Z up. The audience stands on the negative Y axis and looks toward positive Y.
- Use the terms from `SPEC.md` in code, interface text, and docs: drone, fleet, shape, target, formation, takeoff grid, flight volume, assignment, transition.
- Math modules stay pure: no DOM and no WebGL. Node runs their tests.
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
