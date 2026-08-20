/**
 * Unit tests for the toast queue. No DOM, no store subscribers except where the point is that
 * subscribers are notified — the module is pure bookkeeping over an array.
 *
 * The edges pinned here are the ones that would put something wrong in front of a user: a
 * second card about a run that already has one, a stack that grows without bound, the empty
 * snapshot changing identity (which re-renders every reader forever), and a `key` replacement
 * that moves the card out from under the pointer heading for its Dismiss button.
 */
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  TOAST_LIMIT,
  dismissAllToasts,
  dismissToast,
  dismissToastByKey,
  getServerToastsSnapshot,
  getToastsSnapshot,
  resetToastsForTest,
  subscribeToasts,
  toast,
  type ToastInput,
} from "./toast";

const input = (over: Partial<ToastInput> = {}): ToastInput => ({
  status: "awaiting_proposal",
  title: "Add invoice approval",
  project: "platform",
  ...over,
});

beforeEach(() => resetToastsForTest());

test("the store starts empty and the server snapshot is the same frozen reference", () => {
  assert.deepEqual(getToastsSnapshot(), []);
  // Identity, not equality: `useSyncExternalStore` compares snapshots by reference, so a
  // fresh `[]` per read would loop.
  assert.equal(getToastsSnapshot(), getServerToastsSnapshot());
});

test("toast() appends and returns an id that dismissToast accepts", () => {
  const id = toast(input());
  assert.equal(getToastsSnapshot().length, 1);
  assert.equal(getToastsSnapshot()[0].id, id);

  dismissToast(id);
  assert.deepEqual(getToastsSnapshot(), []);
});

test("dismissing the last toast returns to the shared empty reference", () => {
  const id = toast(input());
  dismissToast(id);
  // Or an empty stack would be a new array — and a new snapshot — every time.
  assert.equal(getToastsSnapshot(), getServerToastsSnapshot());
});

test("a repeated key replaces in place rather than stacking a second card", () => {
  toast(input({ key: "task:a", status: "awaiting_proposal" }));
  toast(input({ key: "task:b", status: "awaiting_report" }));
  const updated = toast(input({ key: "task:a", status: "done" }));

  const after = getToastsSnapshot();
  assert.equal(after.length, 2, "the same subject must not occupy two cards");
  // Position is held: a card that jumps to the end of the stack as its status changes moves
  // out from under a pointer already heading for its Dismiss button.
  assert.equal(after[0].id, updated);
  assert.equal(after[0].status, "done");
  assert.equal(after[1].key, "task:b");
});

test("keyless toasts stack, even when identical", () => {
  toast(input());
  toast(input());
  assert.equal(getToastsSnapshot().length, 2);
});

test("the stack is capped, dropping the oldest", () => {
  for (let i = 0; i < TOAST_LIMIT + 2; i += 1) {
    toast(input({ key: `task:${i}`, title: `Run ${i}` }));
  }
  const after = getToastsSnapshot();
  assert.equal(after.length, TOAST_LIMIT);
  assert.equal(after[0].title, "Run 2", "the two oldest should have been dropped");
  assert.equal(after[after.length - 1].title, `Run ${TOAST_LIMIT + 1}`);
});

test("dismissToastByKey retracts a subject without touching its neighbours", () => {
  toast(input({ key: "task:a" }));
  toast(input({ key: "task:b" }));

  dismissToastByKey("task:a");
  assert.deepEqual(
    getToastsSnapshot().map((t) => t.key),
    ["task:b"],
  );

  // A key nobody is showing is a no-op, not an error — the watcher clears speculatively.
  dismissToastByKey("task:zzz");
  assert.equal(getToastsSnapshot().length, 1);
});

test("dismissAllToasts empties the stack", () => {
  toast(input({ key: "task:a" }));
  toast(input({ key: "task:b" }));
  dismissAllToasts();
  assert.deepEqual(getToastsSnapshot(), []);
});

test("subscribers are notified on change and not on a no-op dismissal", () => {
  let calls = 0;
  const unsubscribe = subscribeToasts(() => {
    calls += 1;
  });

  toast(input({ key: "task:a" }));
  assert.equal(calls, 1);

  // Nothing matches, so nothing changed — emitting anyway would re-render every reader.
  dismissToast("toast_does_not_exist");
  dismissToastByKey("task:nope");
  assert.equal(calls, 1);

  dismissToastByKey("task:a");
  assert.equal(calls, 2);

  unsubscribe();
  toast(input());
  assert.equal(calls, 2, "an unsubscribed listener must stop being called");
});

test("ids are unique across replacements, so React keys never collide", () => {
  const first = toast(input({ key: "task:a" }));
  const second = toast(input({ key: "task:a", status: "done" }));
  assert.notEqual(first, second);
});
