#!/usr/bin/env node
// Smoke tests for guard-search.mjs.  Run: node hooks/test-guard-search.mjs
//
// The two contracts worth protecting are opposite failure modes:
//   1. It must not block work it has no business blocking. A false positive on `git log |
//      grep fix` or `grep -n x file.ts` makes the agent fight its own tools.
//   2. It must never be able to trap the agent. Every held search has to go through on the
//      second attempt, or "ask the graph first" becomes "you may not search".
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TARGET = join(HERE, "guard-search.mjs");

const root = mkdtempSync(join(tmpdir(), "guard-search-test-"));
process.on("exit", () => rmSync(root, { recursive: true, force: true }));

const withGraph = join(root, "repo");
mkdirSync(join(withGraph, "graphify-out"), { recursive: true });
writeFileSync(join(withGraph, "graphify-out", "graph.json"), "{}");
const noGraph = join(root, "plain");
mkdirSync(noGraph, { recursive: true });

let pass = 0;
let fail = 0;
function ok(n) {
  pass++;
  console.log(`  ok   ${n}`);
}
function bad(n, why) {
  fail++;
  console.log(`  FAIL ${n} — ${why}`);
}
function check(n, condition, why) {
  if (condition) ok(n);
  else bad(n, why);
}

// A fresh state dir per run, so a previous run can't make a "held" case look "allowed".
const STATE = join(root, "state");
mkdirSync(STATE, { recursive: true });

function run(command, { cwd = withGraph, session = "s1" } = {}) {
  const r = spawnSync(process.execPath, [TARGET], {
    input: JSON.stringify({ session_id: session, cwd, tool_input: { command } }),
    env: { ...process.env, TMPDIR: STATE },
    encoding: "utf8",
  });
  return { code: r.status, stderr: r.stderr || "" };
}

function expect(name, command, wanted, opts) {
  const { code } = run(command, opts);
  const got = code === 2 ? "held" : code === 0 ? "allowed" : `exit ${code}`;
  check(name, got === wanted, `${got}, expected ${wanted}`);
}

console.log(`guard-search.mjs → ${TARGET}\n`);

console.log("-- holds a tree-wide search when the repo has a graph --");
expect("recursive grep", 'grep -rn "parallelOffer" .', "held", { session: "a1" });
expect("bundled -rl flags", 'grep -rl foo src', "held", { session: "a2" });
expect("bare ripgrep", "rg dispatchTask", "held", { session: "a3" });
expect("find by name", 'find . -name "*.test.ts"', "held", { session: "a4" });
expect("sweep inside a chain", 'pnpm lint && grep -rn foo .', "held", { session: "a5" });

console.log("\n-- never blocks targeted or unrelated work --");
// Each of these being wrong means the agent fights its tools on ordinary commands.
expect("targeted grep on one file", "grep -n foo lib/config.ts", "allowed");
expect("grep as a pipeline filter", "git log --oneline | grep -r fix", "allowed");
expect("ripgrep as a pipeline filter", "cat notes.md | rg todo", "allowed");
expect("ripgrep given a file", "rg foo lib/config.ts", "allowed");
expect("find doing real fs work", "find . -newer x -delete", "allowed");
expect("an ordinary command", "pnpm test", "allowed");
expect("graphify itself", 'graphify query "where is X"', "allowed");

console.log("\n-- a repo with no graph is never held --");
// Including every project onboarded before the graph step existed.
expect("recursive grep, no graph", 'grep -rn foo .', "allowed", { cwd: noGraph, session: "b1" });

console.log("\n-- loop safety: a held search always goes through on retry --");
const s = "loop-session";
expect("first attempt is held", 'grep -rn "widget" .', "held", { session: s });
expect("same search retried is allowed", 'grep -rn "widget" .', "allowed", { session: s });
expect("a different search is still held once", 'grep -rn "gadget" .', "held", { session: s });
expect("...and it too passes on retry", 'grep -rn "gadget" .', "allowed", { session: s });
expect("a new session starts fresh", 'grep -rn "widget" .', "held", { session: "other" });

console.log("\n-- fail-open on anything it cannot understand --");
{
  const r = spawnSync(process.execPath, [TARGET], { input: "not json", encoding: "utf8" });
  check("malformed input", r.status === 0, `exit ${r.status}`);
  const r2 = spawnSync(process.execPath, [TARGET], { input: "{}", encoding: "utf8" });
  check("no command in payload", r2.status === 0, `exit ${r2.status}`);
}

console.log("\n-- the held message tells the agent how to proceed --");
{
  const { stderr } = run('grep -rn zzz .', { session: "msg" });
  const says = (t) => stderr.includes(t);
  check(
    "names the tool and the escape hatch",
    says("graphify query") && says("SAME command again"),
    JSON.stringify(stderr.slice(0, 120)),
  );
}

console.log(`\npassed: ${pass}   failed: ${fail}`);
process.exit(fail ? 1 : 0);
