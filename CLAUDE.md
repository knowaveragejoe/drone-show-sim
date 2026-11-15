# Drone show simulator

A browser tool that previews a drone light show in 3D.

`SPEC.md` is the source of truth for scope, terms, algorithms, and milestones.
Read it before any change.

Status: planning is complete. No code exists yet. The next step is milestone 1 in `SPEC.md`.

## Hard constraints

- No runtime dependencies: no 3D library and no user interface framework.
- No build step. Plain JavaScript with native ES modules and JSDoc types.
- Raw WebGL2 for the 3D view.
- All URLs are relative, so the site works from a GitHub Pages subpath.
- YAGNI: build only what the current milestone needs.

## Conventions

- Units: meters, seconds, degrees.
- Axes: right-handed, Z up. The audience stands on the negative Y axis and looks toward positive Y.
- Use the terms from `SPEC.md` in code, interface text, and docs: drone, fleet, shape, target, formation, takeoff grid, assignment, transition.
- Math modules stay pure: no DOM and no WebGL. Node runs their tests.
- Random sampling uses the seeded generator, so results repeat.

## Commands

These commands work after milestone 1.

- Serve: `uv run python -m http.server 8000`, then open `http://localhost:8000/`.
- Unit tests: `npm test`. Needs Node 20 or later. No `npm install`.
- Smoke test: `npm run smoke`. Needs Chrome or Chromium.

## Workflow

- Work in milestones. The owner tests each milestone by hand in the browser before the next one starts.
- When a design or technical decision changes, update `SPEC.md` and this file in the same commit.
- Prose style: Simplified Technical English. Short sentences, active voice, one term per concept.
