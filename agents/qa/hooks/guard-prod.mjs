#!/usr/bin/env node
// PreToolUse guard: keep a QA run from mutating state on an origin the project has declared
// to be production.
//
// Why a hook and not just a rule. "Don't write to prod" is exactly the instruction that holds
// for forty steps and then loses to step forty-one, because by then the agent is deep in a
// scenario and the click in front of it is the obvious next move. A rule cannot see which
// origin the browser is actually on; this can, because it watches every browser_navigate go
// past and remembers.
//
// Opt-in by construction. With no `productionOrigins` in .qa/config.json this guard never
// fires. Declaring an origin there is the act that turns it on.
//
// Hold-once semantics, matching the other agents' guards: the first mutating call on a
// production origin is held with an explanation; running the SAME tool again goes through.
// So the worst case is one wasted turn per tool class, never a wall — a scenario that
// genuinely has to write to prod stays possible, but never by accident.
//
// Fail-OPEN everywhere: bad JSON, no config, unwritable temp dir -> allow.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ALLOW = 0;
const BLOCK = 2; // exit 2 -> Claude Code blocks the call and feeds stderr back to the agent

const allow = () => process.exit(ALLOW);
const block = (m) => { process.stderr.write(m + '\n'); process.exit(BLOCK); };

// Tools that change something on the page or the server behind it. browser_snapshot,
// browser_find, browser_take_screenshot, browser_console_messages, browser_network_requests
// and the other read-only tools are deliberately absent — observing prod is the whole point.
const MUTATING = new Set([
  'browser_click', 'browser_type', 'browser_fill_form', 'browser_press_key',
  'browser_select_option', 'browser_file_upload', 'browser_drop', 'browser_drag',
  'browser_run_code_unsafe', 'browser_evaluate', 'browser_handle_dialog',
]);

const readStdin = () => new Promise((r) => {
  let d = '';
  process.stdin.on('data', (c) => (d += c));
  process.stdin.on('end', () => r(d));
  process.stdin.on('error', () => r(''));
});

let input;
try { input = JSON.parse(await readStdin()); } catch { allow(); }

const fullName = String(input?.tool_name || '');
const bare = fullName.split('__').pop();          // mcp__qa_playwright__browser_click -> browser_click
if (!bare.startsWith('browser_')) allow();

const cwd = input?.cwd || process.cwd();
let prodOrigins = [];
try {
  const cfg = JSON.parse(readFileSync(resolve(cwd, '.qa/config.json'), 'utf8'));
  prodOrigins = Array.isArray(cfg.productionOrigins) ? cfg.productionOrigins : [];
} catch { allow(); }
if (!prodOrigins.length) allow();

const originOf = (u) => { try { return new URL(u).origin; } catch { return null; } };
const isProd = (origin) => !!origin && prodOrigins.some((p) => {
  const po = originOf(p) || p;
  return origin === po;
});

// --- remember which origin the browser is on, across calls in this session ---------------
const sessionId = String(input?.session_id || cwd).replace(/[^A-Za-z0-9_-]/g, '');
let stateFile = null;
try {
  const dir = join(tmpdir(), 'cc-qa-prod-guard');
  mkdirSync(dir, { recursive: true });
  stateFile = join(dir, `${sessionId}.json`);
} catch { allow(); }

const load = () => {
  try { return JSON.parse(readFileSync(stateFile, 'utf8')); } catch { return { origin: null, held: [] }; }
};
const save = (s) => {
  try { writeFileSync(stateFile, JSON.stringify({ ...s, held: (s.held || []).slice(-50) }), 'utf8'); } catch { /* degrade to hold-every-time */ }
};

const state = load();

if (bare === 'browser_navigate') {
  const o = originOf(input?.tool_input?.url);
  if (o) save({ ...state, origin: o });
  allow(); // navigating to prod is reading, never blocked
}

if (!MUTATING.has(bare)) allow();
if (!isProd(state.origin)) allow();

// Already held this tool class on this origin -> the agent made a deliberate second call.
const key = `${state.origin}::${bare}`;
if ((state.held || []).includes(key)) allow();
save({ ...state, held: [...(state.held || []), key] });

block(
  `[qa] Held once: \`${bare}\` on ${state.origin}, which .qa/config.json lists under ` +
  `productionOrigins. Writes here hit real users' data and cannot be rolled back by ending ` +
  `the run.\n` +
  `\n` +
  `Before you repeat it, pick one:\n` +
  `  1. Re-point the run at a non-production origin — that is almost always the right answer, ` +
  `and .qa/config.json's baseUrl already names one.\n` +
  `  2. Establish that this step is non-mutating after all (opening a menu, focusing a field) ` +
  `and run the SAME tool again — it will go through.\n` +
  `  3. If the scenario genuinely requires writing to production, say so in your report with ` +
  `what it will create, then run it again.\n` +
  `\n` +
  `This holds each tool once per origin, so you can never get stuck. Read-only tools ` +
  `(browser_snapshot, browser_find, browser_take_screenshot, browser_console_messages, ` +
  `browser_network_requests) are never held. (qa rule 8)`,
);
