// Smoke test: serves the repository, opens the page in headless Chrome, and checks that
// the page drew a frame with no error. Uses no npm package.
//
// Usage: node tools/smoke.js
// Set CHROME_PATH when the script does not find Chrome or Chromium.

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/opt/pw-browsers/chromium',
];

const server = createServer(async (request, response) => {
  const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const file = resolve(join(ROOT, path === '/' ? 'index.html' : path));
  if (!file.startsWith(ROOT + sep)) {
    response.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    response.writeHead(200, { 'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream' });
    response.end(body);
  } catch {
    response.writeHead(404).end();
  }
});

/**
 * @param {string} chrome path of the browser binary
 * @param {string} url
 * @returns {Promise<string>} the page HTML after the scripts ran
 */
function dumpDom(chrome, url) {
  const flags = [
    '--headless',
    // A machine with no GPU draws WebGL in software.
    '--enable-unsafe-swiftshader',
    // Without a time budget, Chrome prints the page before the first frame.
    '--virtual-time-budget=5000',
    '--dump-dom',
  ];
  // Chrome refuses to start its sandbox for the root user, for example in a container.
  if (process.getuid?.() === 0) flags.unshift('--no-sandbox');
  return new Promise((done, fail) => {
    execFile(chrome, [...flags, url], { timeout: 60000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
      if (error) fail(error);
      else done(stdout);
    });
  });
}

async function main() {
  const chrome = CHROME_CANDIDATES.find((path) => path && existsSync(path));
  if (!chrome) {
    console.error('Chrome or Chromium not found. Set CHROME_PATH to the browser binary.');
    return 1;
  }

  await new Promise((done) => server.listen(0, '127.0.0.1', () => done(undefined)));
  const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
  try {
    const html = await dumpDom(chrome, `http://127.0.0.1:${port}/`);
    if (html.includes('data-smoke="ok"')) {
      console.log('Smoke test passed: the page drew a frame with no error.');
      return 0;
    }
    const rootTag = html.match(/<html[^>]*>/)?.[0] ?? '(no <html> tag in the output)';
    console.error(`Smoke test failed. Root element: ${rootTag}`);
    return 1;
  } finally {
    server.close();
  }
}

process.exitCode = await main();
