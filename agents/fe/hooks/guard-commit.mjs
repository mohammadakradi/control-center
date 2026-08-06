#!/usr/bin/env node
// PreToolUse(Bash) guard: mechanically block destructive git actions on the default branch.
// Enforces the fe engineering rule "never commit/push directly to the default branch".
// Covers two clear violations:
//   1. `git commit` while HEAD is main/master.
//   2. `git push` that would land on main/master (current branch is main/master with no
//      explicit refspec, an explicit `… main`/`master`/`HEAD:main` refspec, or a force push
//      to it).
// Detection is scoped per shell segment (split on `&&`, `||`, `;`, `|`, `&`, newlines —
// respecting quotes/backticks/`$( … )`) and anchored to an actual `git <subcommand>`
// invocation at the start of that segment. This is deliberate: a naive whole-string scan for
// "git" and "commit" anywhere would false-positive on e.g. `git log && echo "recent commit
// bodies"` (no commit happening) and could equally false-negative by letting an unrelated
// segment's text (e.g. an echoed "switch -c") wrongly suppress a real block elsewhere in the
// same chained command.
// Fail-OPEN: on any uncertainty (parse error, not a git repo, git missing) it allows, so it
// can never break normal operation — it only blocks the clear violations.
import { execSync } from "node:child_process";

const ALLOW = 0;
const BLOCK = 2; // exit 2 → Claude Code blocks the tool and feeds stderr back to the agent

function allow() {
  process.exit(ALLOW);
}
function block(message) {
  process.stderr.write(message + "\n");
  process.exit(BLOCK);
}

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(""));
  });
}

// Split a shell command string into individual command segments on `&&`, `||`, `;`, `|`, `&`,
// and newlines — without splitting inside single/double quotes, backticks, or `$( … )`.
function splitSegments(cmd) {
  const segments = [];
  let current = "";
  let quote = null;
  let parenDepth = 0;

  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];

    if (quote) {
      current += c;
      if (c === quote && cmd[i - 1] !== "\\") quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      quote = c;
      current += c;
      continue;
    }
    if (c === "$" && cmd[i + 1] === "(") {
      current += "$(";
      parenDepth++;
      i++;
      continue;
    }
    if (parenDepth > 0) {
      if (c === "(") parenDepth++;
      else if (c === ")") parenDepth--;
      current += c;
      continue;
    }

    const two = cmd.slice(i, i + 2);
    if (two === "&&" || two === "||") {
      segments.push(current);
      current = "";
      i++;
      continue;
    }
    if (c === ";" || c === "|" || c === "&" || c === "\n") {
      segments.push(current);
      current = "";
      continue;
    }
    current += c;
  }
  segments.push(current);
  return segments.map((s) => s.trim()).filter(Boolean);
}

// Global git options that consume a separate following token as their value.
const GIT_VALUE_OPTS = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path"]);
// A segment invokes git directly if it starts with (optional env assignments / sudo) `git`.
const GIT_CMD_RE = /^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*(?:sudo\s+)?git\b/;

// Return the actual subcommand (e.g. "commit", "push", "checkout") for a segment that
// invokes git directly at its start, or null if this segment isn't a git invocation.
function gitSubcommand(segment) {
  const m = segment.match(GIT_CMD_RE);
  if (!m) return null;
  const tokens = segment.slice(m[0].length).trim().split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < tokens.length && tokens[i].startsWith("-")) {
    const opt = tokens[i];
    i++;
    if (GIT_VALUE_OPTS.has(opt) && !opt.includes("=") && i < tokens.length) i++;
  }
  return tokens[i] || null;
}

function hasFlag(segment, flag) {
  return segment === flag || segment.startsWith(flag + " ") || segment.includes(" " + flag + " ") || segment.endsWith(" " + flag);
}

const raw = await readStdin().catch(() => "");
let input;
try {
  input = JSON.parse(raw);
} catch {
  allow();
}

const cmd = input?.tool_input?.command;
if (typeof cmd !== "string") allow();

const gitSegments = splitSegments(cmd)
  .map((segment) => ({ segment, subcommand: gitSubcommand(segment) }))
  .filter((s) => s.subcommand);
if (gitSegments.length === 0) allow();

// If the same command also creates/switches to a branch, it's handling the guardrail itself.
const handlesOwnBranch = gitSegments.some(
  ({ segment, subcommand }) =>
    (subcommand === "checkout" && hasFlag(segment, "-b")) ||
    (subcommand === "switch" && hasFlag(segment, "-c")),
);
if (handlesOwnBranch) allow();

const hasCommit = gitSegments.some(({ subcommand }) => subcommand === "commit");
const pushSegments = gitSegments.filter(({ subcommand }) => subcommand === "push");
if (!hasCommit && pushSegments.length === 0) allow();

const cwd = input?.cwd || process.cwd();
let branch = "";
try {
  branch = execSync("git rev-parse --abbrev-ref HEAD", {
    cwd,
    stdio: ["ignore", "pipe", "ignore"],
  })
    .toString()
    .trim();
} catch {
  allow(); // not a git repo / git unavailable → don't interfere
}

const onDefault = branch === "main" || branch === "master";

if (hasCommit && onDefault) {
  block(
    `[fe] Blocked: refusing to commit directly to the default branch "${branch}". ` +
      `Create a feature branch first (e.g. \`git switch -c <name>\`), then commit. ` +
      `(fe engineering rule: git is gated)`,
  );
}

for (const { segment } of pushSegments) {
  // Explicit refspec naming the default branch, e.g. `git push origin main`, `HEAD:master`.
  const targetsDefault = /(^|[\s:])(main|master)(\s|$)/.test(segment);
  // Bare `git push` (or `git push <remote>` / `-u …`) while sitting on the default branch.
  const barePushOnDefault = onDefault && !/[\w./-]+\s*:\s*[\w./-]+/.test(segment);
  const isForce = /(--force(?!-with-lease)\b|\s-f\b)/.test(segment);

  if (targetsDefault || barePushOnDefault) {
    const how = isForce ? "force-push" : "push";
    block(
      `[fe] Blocked: refusing to ${how} to the default branch ("${branch || "main/master"}"). ` +
        `Push your feature branch and open a PR instead (e.g. \`git push -u origin <feature-branch>\`). ` +
        `(fe engineering rule: git is gated)`,
    );
  }
}

allow();
