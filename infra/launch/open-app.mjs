#!/usr/bin/env node
/**
 * Waits for the dashboard to answer, then opens it as a Chrome **app window** — no tabs, no
 * address bar. Used by `pnpm app`, which brings the container up detached first.
 *
 * This is the zero-install path. For a real installed app (own Dock/Launchpad icon, survives
 * restarts, shows in ⌘Tab), open the dashboard in Chrome once and use the install button in
 * the address bar — that's what `app/manifest.ts` is for. Both point at the same server.
 */
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const URL_ = process.env.APP_URL ?? "http://localhost:3001";
const TIMEOUT_MS = 180_000; // first `--build` run can be slow
const POLL_MS = 750;

async function waitForServer() {
  const deadline = Date.now() + TIMEOUT_MS;
  let announced = false;
  while (Date.now() < deadline) {
    try {
      // Any HTTP answer means Next is up — / redirects to /signin when signed out.
      await fetch(URL_, { redirect: "manual" });
      return true;
    } catch {
      if (!announced) {
        console.log(`Waiting for ${URL_} …`);
        announced = true;
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }
  return false;
}

/** Chrome (or a Chromium sibling) in app mode, falling back to the default browser. */
async function openAppWindow() {
  const arg = `--app=${URL_}`;
  if (process.platform === "darwin") {
    for (const app of ["Google Chrome", "Chromium", "Microsoft Edge", "Brave Browser"]) {
      try {
        await execFileAsync("open", ["-na", app, "--args", arg]);
        return app;
      } catch {
        /* not installed — try the next one */
      }
    }
    await execFileAsync("open", [URL_]);
    return "your default browser (no Chromium browser found)";
  }

  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", "chrome", arg], { detached: true, stdio: "ignore" }).unref();
    return "Chrome";
  }

  for (const bin of ["google-chrome", "chromium", "chromium-browser", "microsoft-edge"]) {
    try {
      spawn(bin, [arg], { detached: true, stdio: "ignore" }).unref();
      return bin;
    } catch {
      /* not on PATH — try the next one */
    }
  }
  spawn("xdg-open", [URL_], { detached: true, stdio: "ignore" }).unref();
  return "your default browser (no Chromium browser found)";
}

if (!(await waitForServer())) {
  console.error(
    `${URL_} never answered. Check the container: docker logs platform --tail 50`,
  );
  process.exit(1);
}
console.log(`Opening ${URL_} in ${await openAppWindow()}`);
console.log("Stop the stack with: pnpm stop");
