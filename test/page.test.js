// Checks of the page files that need no browser: the module list, the local links, the link
// preview, and the version.

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { COMPACT_SCREEN } from '../src/ui.js';
import { VERSION } from '../src/version.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const page = readFileSync(join(root, 'index.html'), 'utf8');

// The site is under this address. The link preview tags use it.
const SITE = 'https://knowaveragejoe.github.io/drone-show-sim/';

/** The value of each attribute with this name in the page. @param {string} name */
const attributes = (name) => [...page.matchAll(new RegExp(`\\s${name}="([^"]*)"`, 'g'))].map((match) => match[1]);

/**
 * Every module that a module imports, and the modules that they import, as paths from the
 * repository root.
 * @param {string} path
 * @param {Set<string>} found
 */
function moduleGraph(path, found = new Set()) {
  if (found.has(path)) return found;
  found.add(path);
  const text = readFileSync(join(root, path), 'utf8');
  for (const [, specifier] of text.matchAll(/(?:from|import)\s+'(\.[^']+)'/g)) {
    moduleGraph(normalize(join(dirname(path), specifier)).replaceAll('\\', '/'), found);
  }
  return found;
}

test('the page preloads exactly the modules that it imports', () => {
  const preloaded = [...page.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map((match) => match[1]);
  assert.equal(new Set(preloaded).size, preloaded.length, 'no module is in the list twice');
  assert.deepEqual(new Set(preloaded), moduleGraph('src/main.js'));
});

test('every local link of the page is a file of the site, and every link is relative', () => {
  for (const url of [...attributes('href'), ...attributes('src')]) {
    if (url.startsWith('data:')) continue;
    assert.ok(!url.startsWith('/') && !/^[a-z]+:/i.test(url), `${url} is not relative`);
    assert.ok(existsSync(join(root, url)), `${url} is not a file`);
  }
});

test('the link preview points to a picture of the right size on the site', () => {
  const property = (name) => page.match(new RegExp(`<meta property="${name}" content="([^"]*)">`))?.[1];
  assert.equal(property('og:url'), SITE);
  const image = property('og:image');
  assert.ok(image.startsWith(SITE), image);
  const file = readFileSync(join(root, image.slice(SITE.length)));
  // A PNG file keeps its width and height at bytes 16 to 23.
  assert.equal(file.toString('latin1', 1, 4), 'PNG');
  assert.equal(file.readUInt32BE(16), Number(property('og:image:width')));
  assert.equal(file.readUInt32BE(20), Number(property('og:image:height')));
});

test('the version is the last milestone that is done', () => {
  const spec = readFileSync(join(root, 'SPEC.md'), 'utf8');
  const done = [...spec.matchAll(/^\| (\d+) \|.*\| Done \|$/gm)].map((match) => Number(match[1]));
  assert.equal(VERSION.milestone, Math.max(...done));
  assert.match(VERSION.date, /^\d{4}-\d{2}-\d{2}$/);
});

test('the script and the style sheet use the same width for the phone layout', () => {
  const style = readFileSync(join(root, 'style.css'), 'utf8');
  assert.ok(style.includes(`@media ${COMPACT_SCREEN} {`), `style.css has no @media ${COMPACT_SCREEN}`);
  // The phone layout is a sheet with three heights, and the script sets each of them.
  for (const height of ['half', 'full']) assert.ok(style.includes(`body[data-sheet="${height}"]`), height);
});
