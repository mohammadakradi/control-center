import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { BUNDLED_AGENTS_DIR, CODE_GRAPH_TIMEOUT_MS } from "../lib/config";
import type { Project } from "../lib/db/schema";
import type { TaskEnv } from "./user-env";

/**
 * Building a project's `graphify` code graph as part of onboarding.
 *
 * Every agent's `onboard` skill already told the model to run `ensure-graphify.sh`. That is
 * prose, and prose is advisory: of the five projects registered on this install, two had no
 * graph at all — one onboarded before the step existed, one onboarded after it and still
 * skipped it. The script is fail-soft by design (it exits 0 on every failure), so nothing
 * noticed either miss. A graph that doesn't exist can't be queried, which is why 1.1% of the
 * week's Bash calls were `graphify` and 48% were grep/find.
 *
 * So the platform does it, before the session starts, where skipping isn't an option. The
 * skill's own step stays — it is idempotent (a re-run refreshes rather than rebuilds) and it
 * still covers the case where a user drives the agent through the Claude Code CLI instead of
 * through this app.
 */

/** What happened, for the log line and for tests. Never an exception: this is fail-soft. */
export type GraphOutcome =
  | "built" // the script ran to completion (built or refreshed the graph)
  | "no-script" // no ensure-graphify.sh in the agent plugin or the bundled copy
  | "missing-dir" // the target path isn't on disk
  | "timeout" // killed at CODE_GRAPH_TIMEOUT_MS
  | "failed" // the script exited non-zero, or couldn't be spawned
  | "disabled"; // CC_CODE_GRAPH_TIMEOUT_MS=0

export type GraphResult = { path: string; outcome: GraphOutcome };

/**
 * Locate `ensure-graphify.sh`.
 *
 * The running agent's own plugin first — a CLI-installed plugin wins over the bundled copy
 * (`lib/discovery/agents.ts`), and that copy may be newer than what shipped. Then any bundled
 * agent that has one, so an agent whose plugin predates the script (or never had one) still
 * gets a graph rather than silently opting the project out. The script only takes a project
 * directory, so any copy works on any project.
 */
export function graphScriptPath(
  agentSourcePath: string | null | undefined,
  bundledDir: string = BUNDLED_AGENTS_DIR,
): string | null {
  const candidates = [
    ...(agentSourcePath ? [resolve(agentSourcePath, "scripts/ensure-graphify.sh")] : []),
    // Ordered, not discovered: a stable order keeps the log reproducible, and `swe` is the
    // agent whose copy is the reference one.
    ...["swe", "fe", "pm"].map((ns) =>
      resolve(bundledDir, ns, "scripts/ensure-graphify.sh"),
    ),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

/**
 * Every directory that should get its own graph.
 *
 * A workspace is several repos onboarded as one system, and each member gets its own
 * `CLAUDE.md` — so each needs its own graph too, or a task on the backend repo has nothing to
 * query. `members` paths are stored relative to the workspace root (`"."` for the root
 * itself), the same convention `lib/workspace.ts` resolves; duplicates collapse so a `"."`
 * member doesn't build the root twice.
 */
export function graphTargets(project: Pick<Project, "path" | "isWorkspace" | "members">): string[] {
  if (!project.isWorkspace || !project.members.length) return [project.path];
  const seen = new Set<string>();
  for (const m of project.members) {
    if (typeof m?.path === "string" && m.path.trim()) {
      seen.add(resolve(project.path, m.path));
    }
  }
  // The root is always included: a workspace root holds the system-level CLAUDE.md and
  // journal, and `.` is a convention members may or may not declare.
  seen.add(project.path);
  return [...seen];
}

/** Run `ensure-graphify.sh <dir>` once. Resolves — never rejects — with what happened. */
function runOne(
  script: string,
  dir: string,
  env: TaskEnv,
  onLog: (message: string) => void,
  timeoutMs: number,
): Promise<GraphOutcome> {
  if (!existsSync(dir)) {
    onLog(`🕸️ Code graph: skipped ${dir} — not on disk.`);
    return Promise.resolve("missing-dir");
  }
  return new Promise<GraphOutcome>((done) => {
    let child: ChildProcess;
    try {
      child = spawn("bash", [script, dir], {
        cwd: dir,
        // The task env carries the owner's token and HOME; the script installs into
        // $HOME/.local/bin and needs PATH, so it gets the same environment the session does.
        // Cast because this project's `ProcessEnv` declares NODE_ENV required, which a
        // deliberately-rebuilt task env (runner/user-env.ts) doesn't promise to carry.
        env: env as NodeJS.ProcessEnv,
        stdio: ["ignore", "pipe", "pipe"],
        // Its own process group, so the timeout can kill the whole tree. Killing the shell
        // alone leaves the `graphify extract` it spawned running — still walking the tree we
        // just decided to stop walking, and still holding the stdio pipes open, which keeps
        // this process's event loop alive long after we stopped waiting for it.
        detached: true,
      });
    } catch (e) {
      onLog(`🕸️ Code graph: could not start — ${(e as Error).message}`);
      return done("failed");
    }

    // The script's own progress lines already read as a log ("[graphify] building project
    // graph…"), so they're forwarded as-is rather than re-worded. Buffered to whole lines:
    // a chunk boundary mid-line would otherwise become two transcript entries.
    let buffered = "";
    const emit = (chunk: Buffer) => {
      buffered += chunk.toString();
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) onLog(line.trimEnd());
      }
    };
    child.stdout?.on("data", emit);
    child.stderr?.on("data", emit);

    let settled = false;
    const finish = (outcome: GraphOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (buffered.trim()) onLog(buffered.trimEnd());
      // Release the pipes explicitly. A killed group can still leave a read handle open long
      // enough to hold the loop; we are done reading either way.
      child.stdout?.destroy();
      child.stderr?.destroy();
      done(outcome);
    };

    /** SIGKILL the whole process group, falling back to the shell alone. */
    const killTree = () => {
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        // The group is already gone (it exited between the timer firing and this call), or
        // the platform refused the negative pid. Either way, try the direct child and move on.
        try {
          child.kill("SIGKILL");
        } catch {
          /* nothing left to kill */
        }
      }
    };

    const timer = setTimeout(() => {
      // SIGKILL, not SIGTERM: `graphify extract` is a Python process walking a tree, and the
      // point of the ceiling is that onboarding starts now. A build we stopped is not a
      // failure — the agent falls back to ordinary search.
      killTree();
      onLog(
        `🕸️ Code graph: gave up on ${dir} after ${Math.round(timeoutMs / 60_000)} min — ` +
          `onboarding continues without it. Raise CC_CODE_GRAPH_TIMEOUT_MS to allow longer.`,
      );
      finish("timeout");
    }, timeoutMs);
    // Node keeps the event loop alive for a pending timer; this one must not hold the runner
    // open if everything else has finished.
    timer.unref?.();

    child.on("error", (e) => {
      onLog(`🕸️ Code graph: could not start — ${e.message}`);
      finish("failed");
    });
    child.on("close", (code) => {
      // ensure-graphify.sh exits 0 even when it gives up, so a non-zero code here means the
      // script itself broke — worth saying, still not worth failing the task over.
      finish(code === 0 ? "built" : "failed");
    });
  });
}

/**
 * Build (or refresh) the code graph for a project and, for a workspace, each member repo.
 *
 * Sequential rather than parallel: two `graphify extract` runs are two tree walks competing
 * for the same disk, and the first thing a workspace onboarding does is read those same
 * trees. The timeout is per target, so one huge repo can't consume the whole allowance.
 *
 * Fail-soft throughout — this never throws and never fails a task.
 */
export async function ensureCodeGraph(opts: {
  project: Pick<Project, "path" | "isWorkspace" | "members">;
  agentSourcePath?: string | null;
  env: TaskEnv;
  onLog: (message: string) => void;
  timeoutMs?: number;
  bundledDir?: string;
  /** Skip targets that already have a graph instead of refreshing them. For the post-update
   *  backfill, where the job is "give the projects that have none a graph" — refreshing a
   *  124 MB graph nobody asked about is minutes of disk for no new information. */
  onlyMissing?: boolean;
}): Promise<GraphResult[]> {
  const timeoutMs = opts.timeoutMs ?? CODE_GRAPH_TIMEOUT_MS;
  const all = graphTargets(opts.project);
  const targets = opts.onlyMissing
    ? all.filter((p) => !existsSync(resolve(p, "graphify-out/graph.json")))
    : all;
  if (!targets.length) return [];
  if (timeoutMs <= 0) {
    opts.onLog("🕸️ Code graph: disabled (CC_CODE_GRAPH_TIMEOUT_MS=0) — skipping.");
    return targets.map((path) => ({ path, outcome: "disabled" as const }));
  }

  const script = graphScriptPath(opts.agentSourcePath, opts.bundledDir);
  if (!script) {
    opts.onLog(
      "🕸️ Code graph: no ensure-graphify.sh found in this agent or the bundled agents — " +
        "skipping. Tasks will fall back to ordinary code search.",
    );
    return targets.map((path) => ({ path, outcome: "no-script" as const }));
  }

  opts.onLog(
    `🕸️ Building the code graph before onboarding starts — ${targets.length} ` +
      `${targets.length === 1 ? "repo" : "repos"}. Later tasks query this instead of grepping.`,
  );

  const results: GraphResult[] = [];
  for (const path of targets) {
    results.push({
      path,
      outcome: await runOne(script, path, opts.env, opts.onLog, timeoutMs),
    });
  }
  const built = results.filter((r) => r.outcome === "built").length;
  opts.onLog(
    `🕸️ Code graph: ${built}/${results.length} ready. ` +
      `Query it with: PATH="$PATH:$HOME/.local/bin" graphify query "…"`,
  );
  return results;
}
