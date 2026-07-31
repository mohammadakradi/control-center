import { RUNNER_URL } from "./config";
import type { Attachment } from "./db/schema";

/** Read the runner's error body (it returns `{ error }` JSON) so callers surface the
 *  real reason — e.g. "user has no Anthropic token configured" — not just a status. */
async function runnerError(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? `${fallback} (${res.status}). Is the runner on ${RUNNER_URL}?`;
}

/** Forward a task action (respond/reply/stop) to the runner, passing the JSON body
 *  through. Returns the runner's status + body for the route handler to relay. */
export async function daemonTaskAction(
  taskId: string,
  action: "respond" | "reply" | "stop",
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(
    `${RUNNER_URL}/tasks/${encodeURIComponent(taskId)}/${action}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    },
  );
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

/** Tell the runner daemon to start executing a task (it loads task details from the shared DB). */
export async function daemonStartTask(taskId: string): Promise<void> {
  const res = await fetch(`${RUNNER_URL}/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ taskId }),
  });
  if (!res.ok) {
    throw new Error(await runnerError(res, "Runner daemon failed to start task"));
  }
}

/** Tell the runner daemon to resume a task — optionally with a change request + new files.
 *  Files are already saved to disk by the caller; only their metadata (paths) is forwarded. */
export async function daemonContinueTask(
  taskId: string,
  message?: string,
  attachments: Attachment[] = [],
): Promise<void> {
  const res = await fetch(`${RUNNER_URL}/tasks/${taskId}/continue`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, attachments }),
  });
  if (!res.ok) {
    throw new Error(await runnerError(res, "Runner daemon failed to continue task"));
  }
}
