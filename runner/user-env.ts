import { getUserToken } from "../lib/secrets";

const SHARED_TOKEN_VARS = ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY"] as const;

/** Operator secrets the agent subprocess must never receive: the vault master key
 *  would let anyone who gets it decrypt every user's stored token. (GH_TOKEN, by
 *  contrast, stays in — agents need it for `gh`/git — and is redacted from
 *  transcripts instead; see `sensitiveEnvValues`.) */
const OPERATOR_ONLY_VARS = ["SECRETS_MASTER_KEY"] as const;

export type TaskEnv = Record<string, string | undefined>;

/** Secret values that must be scrubbed from anything user-visible (task events, SSE,
 *  task errors): the credentials present in the child env, plus operator secrets that
 *  the agent could still surface by reading files (e.g. `cat .env` when the managed
 *  project is this repo itself). */
export function sensitiveEnvValues(env: TaskEnv): string[] {
  const values = [
    env.CLAUDE_CODE_OAUTH_TOKEN,
    env.ANTHROPIC_API_KEY,
    env.GH_TOKEN,
    env.GITHUB_TOKEN,
    process.env.GH_TOKEN,
    process.env.GITHUB_TOKEN,
    process.env.SECRETS_MASTER_KEY,
  ];
  return [...new Set(values.filter((s): s is string => Boolean(s)))];
}

/**
 * Build the subprocess env for a task's SDK sessions, so the run bills the task
 * owner's own Anthropic credential.
 *
 * SDK caveat (sdk.d.ts `Options.env`): the value REPLACES the subprocess env, it is
 * not merged — so spread `process.env` to keep PATH/HOME/etc. The shared token vars
 * are stripped first so the owner's token strictly wins over both the repo-root
 * `.env` credential and any ambient `~/.claude` login.
 *
 * Fails closed: no owner token → throw (dispatch fails with a clear error), unless
 * `ALLOW_SHARED_TOKEN_FALLBACK=1` explicitly re-enables the shared credential. A missing
 * or wrong `SECRETS_MASTER_KEY` reads as "no token" rather than a crypto error, so this
 * agrees with `canRunTasks` in every branch and the user gets the actionable message.
 */
export function buildTaskEnv(userId: string | null): TaskEnv {
  const env: TaskEnv = { ...process.env };
  for (const k of SHARED_TOKEN_VARS) delete env[k];
  for (const k of OPERATOR_ONLY_VARS) delete env[k];

  const owned = userId ? getUserToken(userId) : null;
  if (owned) {
    env[owned.kind === "oauth" ? "CLAUDE_CODE_OAUTH_TOKEN" : "ANTHROPIC_API_KEY"] =
      owned.token;
    return env;
  }

  if (process.env.ALLOW_SHARED_TOKEN_FALLBACK === "1") {
    for (const k of SHARED_TOKEN_VARS) {
      if (process.env[k]) env[k] = process.env[k];
    }
    return env;
  }

  throw new Error(
    userId
      ? "No Anthropic token is configured for this task's owner. Save your token under Settings → Anthropic token, then dispatch again."
      : "This task has no owner (it predates sign-in), so there is no token to run it on. Dispatch a new task while signed in.",
  );
}
