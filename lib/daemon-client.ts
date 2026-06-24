import { RUNNER_URL } from "./config";

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
