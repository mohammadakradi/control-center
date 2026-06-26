import { RUNNER_URL } from "./config";
import type { Attachment } from "./db/schema";

/** Tell the runner daemon to start executing a task (it loads task details from the shared DB). */
export async function daemonStartTask(taskId: string): Promise<void> {
  const res = await fetch(`${RUNNER_URL}/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ taskId }),
  });
  if (!res.ok) {
    throw new Error(
      `Runner daemon failed to start task (${res.status}). Is it running on ${RUNNER_URL}?`,
    );
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
    throw new Error(
      `Runner daemon failed to continue task (${res.status}). Is it running on ${RUNNER_URL}?`,
    );
  }
}
