#!/usr/bin/env node
// Capture a logged-in browser session to .qa/auth/storageState.json.
//
// Run it, log in by hand in the window that opens, and it writes the cookies + localStorage
// that every later QA run and every generated spec reuses. Credentials are typed by the
// human into a real browser; they never pass through the agent's context.
//
// Usage:
//   node scripts/save-auth.mjs <login-url> [options]
//     --wait-for-url <substring>       done when the URL contains this (default: it changes)
//     --wait-for-selector <selector>   done when this appears (e.g. '[data-testid=avatar]')
//     --out <path>                     default: <project>/.qa/auth/storageState.json
//     --timeout <seconds>              default: 180
//     --browser <channel>              default: chrome
//
// Exits 0 on success with a one-line JSON summary on stdout, 1 on timeout.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const argv = process.argv.slice(2);
const loginUrl = argv.find((a) => !a.startsWith('--'));
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

if (!loginUrl) {
  console.error('usage: node save-auth.mjs <login-url> [--wait-for-url s] [--wait-for-selector s] [--out p] [--timeout n]');
  process.exit(2);
}

const projectDir = process.env.QA_PROJECT_DIR || process.cwd();
const out = resolve(flag('out', `${projectDir}/.qa/auth/storageState.json`));
const timeoutMs = Number(flag('timeout', '180')) * 1000;
const waitUrl = flag('wait-for-url', null);
const waitSelector = flag('wait-for-selector', null);

const browser = await chromium.launch({ headless: false, channel: flag('browser', 'chrome') });
const context = await browser.newContext();
const page = await context.newPage();
await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });

console.error(`[qa] A browser window is open at ${loginUrl}.`);
console.error(`[qa] Log in there. Waiting up to ${timeoutMs / 1000}s for the session to establish.`);

try {
  if (waitSelector) {
    await page.waitForSelector(waitSelector, { timeout: timeoutMs });
  } else if (waitUrl) {
    await page.waitForURL((u) => u.toString().includes(waitUrl), { timeout: timeoutMs });
  } else {
    // No explicit signal: consider login done when we've navigated away from the login URL
    // AND at least one cookie exists. Polls rather than racing a single navigation, because
    // real login flows bounce through several redirects.
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (Date.now() > deadline) throw new Error('timeout');
      const movedOn = !page.url().startsWith(loginUrl);
      const cookies = await context.cookies();
      if (movedOn && cookies.length > 0) break;
      await page.waitForTimeout(1000);
    }
  }
} catch {
  console.error('[qa] Timed out waiting for login. Nothing was saved.');
  await browser.close();
  process.exit(1);
}

mkdirSync(dirname(out), { recursive: true });
const state = await context.storageState();
writeFileSync(out, JSON.stringify(state, null, 2));
console.log(JSON.stringify({
  saved: out,
  cookies: state.cookies.length,
  origins: state.origins.map((o) => o.origin),
  finalUrl: page.url(),
}));
await browser.close();
