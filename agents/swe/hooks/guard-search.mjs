#!/usr/bin/env node
// PreToolUse(Bash) guard: make the code graph the FIRST answer to a structural question,
// instead of a tree-wide grep sweep.
//
// Why this is a hook and not a rule. Rule 17 has told the agent to query the graph instead of
// brute-force searching since the graph existed. Measured over the week of 2026-08-28 across
// 28 tasks: 4,079 Bash calls, of which 1,951 were grep/find and 2,576 were cat/sed/head —
// against 44 `graphify` calls, 1.1%, flat for four weeks. Those thousands of calls are not
// just tool results, they are *turns*, and turns are the entire bill. Prose did not move it.
//
// What it blocks: a recursive/tree-wide code search (`grep -r`, `rg`, `find . -name`) in a
// repo that HAS a graph. Nothing else. Targeted reads (`grep -n x path/to/file.ts`), filters
// in a pipeline (`git log | grep fix`), and every repo without `graphify-out/graph.json` are
// untouched.
//
// Loop safety — the part that matters. It blocks a given search ONCE per session. Ask the
// graph; if the graph doesn't answer it, run the same search again and it goes through. So
// the worst case is one wasted turn per distinct question, never a wall the agent can get
// stuck against. Without this the obvious failure is: blocked -> graphify -> no answer ->
// same grep -> blocked -> forever.
//
// Fail-OPEN everywhere: parse error, no graph, no state dir, anything unexpected -> allow.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ALLOW = 0;
const BLOCK = 2; // exit 2 -> Claude Code blocks the tool and feeds stderr back to the agent

const AGENT = process.env.CC_GUARD_AGENT_LABEL || "swe";

function allow() {
  process.exit(ALLOW);
}
function block(message) {
  process.stderr.write(message + "\n");
  process.exit(BLOCK);
}

function readStdin() {
  return new Promise((r) => {
    let d = "";
    process.stdin.on("data", (c) => (d += c));
    process.stdin.on("end", () => r(d));
    process.stdin.on("error", () => r(""));
  });
}

// Split into commands on `&&`, `||`, `;` and newlines — deliberately NOT on `|`, because a
// pipeline's later stages are filters, not searches, and `git log | grep fix` must never be
// mistaken for a tree sweep. Quotes, backticks and `$( … )` are respected.
function splitCommands(cmd) {
  const out = [];
  let cur = "";
  let quote = null;
  let depth = 0;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (quote) {
      cur += c;
      if (c === quote && cmd[i - 1] !== "\\") quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      quote = c;
      cur += c;
      continue;
    }
    if (c === "$" && cmd[i + 1] === "(") {
      cur += "$(";
      depth++;
      i++;
      continue;
    }
    if (depth > 0) {
      if (c === "(") depth++;
      else if (c === ")") depth--;
      cur += c;
      continue;
    }
    const two = cmd.slice(i, i + 2);
    if (two === "&&" || two === "||") {
      out.push(cur);
      cur = "";
      i++;
      continue;
    }
    if (c === ";" || c === "\n") {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

/** The leading stage of a pipeline — everything before the first top-level `|`. */
function leadingStage(command) {
  let quote = null;
  let depth = 0;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      if (c === quote && command[i - 1] !== "\\") quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      quote = c;
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "|" && depth === 0 && command[i + 1] !== "|") return command.slice(0, i);
  }
  return command;
}

function tokenize(stage) {
  // Good enough for flag detection: strip env assignments, then split on whitespace outside
  // quotes. The pattern's exact contents don't matter here, only its shape.
  const tokens = stage.match(/(?:[^\s'"]|'[^']*'|"[^"]*")+/g) || [];
  let i = 0;
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i++;
  if (tokens[i] === "sudo" || tokens[i] === "command" || tokens[i] === "time") i++;
  return tokens.slice(i);
}

const GREPS = new Set(["grep", "egrep", "fgrep", "ggrep"]);
const RIPGREPS = new Set(["rg", "ripgrep"]);

/**
 * Is this leading stage a tree-wide code search?
 *
 * - grep family: only when recursive (`-r`/`-R`, including bundled flags like `-rn`). A
 *   targeted `grep -n foo file.ts` is cheap and precise; the graph has nothing better to say.
 * - ripgrep: recursive by default, so any invocation counts — except one given an explicit
 *   file to read, which is the targeted case again.
 * - find: only the `-name`/`-iname`/`-path` form, which is "where is the file called X" —
 *   exactly a graph question. `find … -delete`, `-exec`, `-newer` and friends are real
 *   filesystem work and are left alone.
 */
function searchKind(stage) {
  const t = tokenize(stage);
  if (!t.length) return null;
  const bin = (t[0].split("/").pop() || "").replace(/^['"]|['"]$/g, "");
  const args = t.slice(1);
  const flags = args.filter((a) => a.startsWith("-"));
  const operands = args.filter((a) => !a.startsWith("-"));

  if (GREPS.has(bin)) {
    const recursive = flags.some((f) => /^-[A-Za-z]*[rR]/.test(f) || f === "--recursive");
    return recursive ? "grep" : null;
  }
  if (RIPGREPS.has(bin)) {
    // `rg pattern path/to/file.ts` — a targeted read, not a sweep.
    const targeted = operands.length > 1 && operands.slice(1).every((o) => /\.\w{1,8}$/.test(o));
    return targeted ? null : "rg";
  }
  if (bin === "find") {
    return flags.some((f) => ["-name", "-iname", "-path", "-ipath"].includes(f)) ? "find" : null;
  }
  return null;
}

/** A stable key for "this same question again", so a repeat is allowed through. */
function queryKey(stage) {
  return createHash("sha256")
    .update(stage.replace(/\s+/g, " ").trim())
    .digest("hex")
    .slice(0, 16);
}

/** Per-session record of which searches have already been nudged once. */
function stateFile(sessionId) {
  const dir = join(tmpdir(), "cc-search-guard");
  mkdirSync(dir, { recursive: true });
  return join(dir, `${sessionId.replace(/[^A-Za-z0-9_-]/g, "")}.json`);
}

function loadSeen(file) {
  try {
    const v = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function saveSeen(file, seen) {
  try {
    // Bounded: a long session must not grow this without limit. Oldest keys fall off.
    writeFileSync(file, JSON.stringify(seen.slice(-200)), "utf8");
  } catch {
    // Unwritable temp dir → the guard degrades to "nudge every time", which the agent can
    // still get past by re-running. Not worth failing the tool call over.
  }
}

const raw = await readStdin().catch(() => "");
let input;
try {
  input = JSON.parse(raw);
} catch {
  allow();
}

const cmd = input?.tool_input?.command;
if (typeof cmd !== "string" || !cmd.trim()) allow();

const cwd = input?.cwd || process.cwd();
// No graph, nothing to redirect to. Never block someone out of searching a repo that has no
// alternative — including every repo onboarded before the graph step existed.
if (!existsSync(resolve(cwd, "graphify-out/graph.json"))) allow();

const sweeps = splitCommands(cmd)
  .map((c) => leadingStage(c).trim())
  .map((stage) => ({ stage, kind: searchKind(stage) }))
  .filter((s) => s.kind);
if (!sweeps.length) allow();

const sessionId = String(input?.session_id || cwd);
const file = stateFile(sessionId);
const seen = loadSeen(file);
const keys = sweeps.map((s) => queryKey(s.stage));

// Already nudged for every search in this command → the agent tried the graph and came back.
// Get out of the way.
if (keys.every((k) => seen.includes(k))) allow();

saveSeen(file, [...seen, ...keys]);

const { kind } = sweeps[0];
const what =
  kind === "find"
    ? "a tree-wide filename search"
    : "a tree-wide code search";

block(
  `[${AGENT}] Held once: ${what} in a repo that has a code graph. Ask the graph first — it ` +
    `answers "where is X / what uses Y / what breaks if I change Z" in one call, where this ` +
    `sweep costs a turn per follow-up read.\n` +
    `\n` +
    `  PATH="$PATH:$HOME/.local/bin" graphify query "<your question in words>"\n` +
    `  PATH="$PATH:$HOME/.local/bin" graphify explain "<symbol or file>"\n` +
    `  PATH="$PATH:$HOME/.local/bin" graphify affected "<symbol or file>"   # blast radius\n` +
    `  PATH="$PATH:$HOME/.local/bin" graphify path "<A>" "<B>"\n` +
    `\n` +
    `If the graph doesn't answer it — a string literal, a comment, a config or non-code file, ` +
    `or a stale graph — run the SAME command again and it will go through. This holds each ` +
    `distinct search once, so you can never get stuck. (${AGENT} rule 17)`,
);
