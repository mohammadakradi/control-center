/**
 * Where the runner listens.
 *
 * This is a security default, not a preference: the daemon has no authentication of its own —
 * it trusts that the only thing reaching it is the Next.js proxy, which does the auth — and it
 * dispatches agent sessions under the owner's Anthropic token against their files. It shipped
 * bound to every interface, so anything on the same Wi-Fi could drive it. Containers are the one
 * place that needs a wider bind, and they get it explicitly.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { runnerHost } from "./config";

test("the runner binds loopback when nothing says otherwise", () => {
  assert.equal(runnerHost(undefined), "127.0.0.1");
});

test("an empty or blank RUNNER_HOST does not widen the bind", () => {
  assert.equal(runnerHost(""), "127.0.0.1");
  assert.equal(runnerHost("   "), "127.0.0.1");
});

test("a container can ask for every interface explicitly", () => {
  assert.equal(runnerHost("0.0.0.0"), "0.0.0.0");
});
