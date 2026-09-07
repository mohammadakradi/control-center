/**
 * The onboarding code-graph build. Against real fake `ensure-graphify.sh` scripts on disk and
 * real spawned processes — the module's whole job is "run a shell script somewhere and survive
 * whatever it does", so stubbing the spawn would test the stub.
 *
 * The behaviours that matter are the fail-soft ones. This exists because the *prose* version
 * of this step was skipped silently on two of five projects; a replacement that can itself
 * fail silently, hang a launch, or throw into the run loop would be no better.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureCodeGraph, graphScriptPath, graphTargets } from "./code-graph";

const root = mkdtempSync(join(tmpdir(), "platform-code-graph-test-"));
process.on("exit", () => rmSync(root, { recursive: true, force: true }));

/** A stand-in ensure-graphify.sh. `body` is bash appended after the shebang. */
function fakeAgent(name: string, body: string): string {
  const dir = join(root, name, "scripts");
  mkdirSync(dir, { recursive: true });
  const script = join(dir, "ensure-graphify.sh");
  writeFileSync(script, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(script, 0o755);
  return join(root, name);
}

function project(path: string, members: { path: string; role?: string }[] = []) {
  return { path, isWorkspace: members.length > 0, members };
}

function dir(name: string): string {
  const p = join(root, name);
  mkdirSync(p, { recursive: true });
  return p;
}

test("graphScriptPath prefers the running agent's own copy over the bundled ones", () => {
  const agent = fakeAgent("agent-own", "exit 0");
  const bundled = join(root, "bundled");
  mkdirSync(join(bundled, "swe", "scripts"), { recursive: true });
  writeFileSync(join(bundled, "swe", "scripts", "ensure-graphify.sh"), "#!/usr/bin/env bash\n");

  assert.equal(
    graphScriptPath(agent, bundled),
    join(agent, "scripts", "ensure-graphify.sh"),
  );
});

test("graphScriptPath falls back to a bundled agent when the plugin has no script", () => {
  // The real case: a plugin installed through the Claude Code CLI that predates the script.
  // Falling back is what stops that project from silently opting out of having a graph.
  const bundled = join(root, "bundled-fallback");
  mkdirSync(join(bundled, "fe", "scripts"), { recursive: true });
  writeFileSync(join(bundled, "fe", "scripts", "ensure-graphify.sh"), "#!/usr/bin/env bash\n");

  assert.equal(
    graphScriptPath(join(root, "no-such-plugin"), bundled),
    join(bundled, "fe", "scripts", "ensure-graphify.sh"),
  );
  assert.equal(graphScriptPath(null, join(root, "nothing-here")), null);
});

test("graphTargets covers a plain project, and every member of a workspace exactly once", () => {
  assert.deepEqual(graphTargets(project("/tmp/solo")), ["/tmp/solo"]);

  const ws = graphTargets(
    project("/tmp/ws", [{ path: "." }, { path: "backend" }, { path: "../frontend" }]),
  );
  // The root appears once despite being named twice (as "." and as the project path itself).
  assert.deepEqual(ws.sort(), ["/tmp/frontend", "/tmp/ws", "/tmp/ws/backend"].sort());
  assert.equal(new Set(ws).size, ws.length);
});

test("graphTargets ignores malformed member entries rather than resolving garbage", () => {
  const targets = graphTargets(
    project("/tmp/ws2", [
      { path: "backend" },
      { path: "   " },
      // A hand-edited workspace.json can hold anything; `resolve(root, undefined)` throws.
      { path: undefined as unknown as string },
    ]),
  );
  assert.deepEqual(targets.sort(), ["/tmp/ws2", "/tmp/ws2/backend"].sort());
});

test("a successful build reports built and forwards the script's own log lines", async () => {
  const agent = fakeAgent(
    "agent-ok",
    'echo "[graphify] building project graph…"\necho "[graphify] ready"\nexit 0',
  );
  const target = dir("repo-ok");
  const logs: string[] = [];

  const results = await ensureCodeGraph({
    project: project(target),
    agentSourcePath: agent,
    env: process.env,
    onLog: (m) => logs.push(m),
    timeoutMs: 30_000,
  });

  assert.deepEqual(results, [{ path: target, outcome: "built" }]);
  assert.ok(logs.includes("[graphify] building project graph…"));
  assert.ok(logs.includes("[graphify] ready"));
  assert.ok(logs.some((l) => l.includes("1/1 ready")));
});

test("a script that exits non-zero fails soft — it never throws and never rejects", async () => {
  const agent = fakeAgent("agent-broken", 'echo "boom" >&2\nexit 3');
  const target = dir("repo-broken");

  const results = await ensureCodeGraph({
    project: project(target),
    agentSourcePath: agent,
    env: process.env,
    onLog: () => {},
    timeoutMs: 30_000,
  });

  assert.deepEqual(results, [{ path: target, outcome: "failed" }]);
});

test("a hanging build is killed at the ceiling instead of holding the launch open", async () => {
  // The whole reason there is a ceiling: `graphify extract` on a huge tree must not become an
  // unbounded wait before the onboarding session has even started.
  const agent = fakeAgent("agent-hang", "sleep 60");
  const target = dir("repo-hang");
  const logs: string[] = [];

  const started = Date.now();
  const results = await ensureCodeGraph({
    project: project(target),
    agentSourcePath: agent,
    env: process.env,
    onLog: (m) => logs.push(m),
    timeoutMs: 400,
  });

  assert.deepEqual(results, [{ path: target, outcome: "timeout" }]);
  assert.ok(Date.now() - started < 20_000, "must not wait for the child to finish");
  assert.ok(logs.some((l) => l.includes("gave up")));
});

test("a missing target directory is skipped, and the rest of a workspace still builds", async () => {
  const agent = fakeAgent("agent-ws", "exit 0");
  const wsRoot = dir("ws-root");
  mkdirSync(join(wsRoot, "backend"), { recursive: true });

  const results = await ensureCodeGraph({
    project: project(wsRoot, [{ path: "." }, { path: "backend" }, { path: "gone" }]),
    agentSourcePath: agent,
    env: process.env,
    onLog: () => {},
    timeoutMs: 30_000,
  });

  const byPath = new Map(results.map((r) => [r.path, r.outcome]));
  assert.equal(byPath.get(wsRoot), "built");
  assert.equal(byPath.get(join(wsRoot, "backend")), "built");
  assert.equal(byPath.get(join(wsRoot, "gone")), "missing-dir");
});

test("no script anywhere reports no-script and says the run continues", async () => {
  const target = dir("repo-no-script");
  const logs: string[] = [];

  const results = await ensureCodeGraph({
    project: project(target),
    agentSourcePath: join(root, "nope"),
    bundledDir: join(root, "also-nope"),
    env: process.env,
    onLog: (m) => logs.push(m),
    timeoutMs: 30_000,
  });

  assert.deepEqual(results, [{ path: target, outcome: "no-script" }]);
  assert.ok(logs.some((l) => l.includes("fall back to ordinary code search")));
});

test("timeoutMs 0 disables the pre-build without spawning anything", async () => {
  // The escape hatch has to be real: an install that doesn't want this must be able to turn it
  // off, and a script that would have run must not run anyway.
  const agent = fakeAgent("agent-never", 'echo "SHOULD NOT RUN"\nexit 0');
  const target = dir("repo-disabled");
  const logs: string[] = [];

  const results = await ensureCodeGraph({
    project: project(target),
    agentSourcePath: agent,
    env: process.env,
    onLog: (m) => logs.push(m),
    timeoutMs: 0,
  });

  assert.deepEqual(results, [{ path: target, outcome: "disabled" }]);
  assert.ok(!logs.some((l) => l.includes("SHOULD NOT RUN")));
});
