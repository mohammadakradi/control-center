/**
 * Unit tests for the shared UI helpers. Pure functions, no database.
 *
 * `taskDisplayTitle` is the one thing every task list in the app agrees on, so the edges
 * pinned here are the ones that would put the wrong text in front of a user: a title that
 * exists but is ignored, and an "empty" title that is really whitespace and would render as
 * a blank row.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { taskDisplayTitle } from "./ui";

test("taskDisplayTitle prefers the generated title over the raw request", () => {
  assert.equal(
    taskDisplayTitle({
      title: "Add invoice approval flow",
      requestText: "Please add a flow where invoices over $500 need a second approver…",
    }),
    "Add invoice approval flow",
  );
});

test("taskDisplayTitle falls back to the request text when untitled", () => {
  // Tasks that predate titling, and ones whose title generation failed, hold null.
  assert.equal(
    taskDisplayTitle({ title: null, requestText: "fix the header spacing" }),
    "fix the header spacing",
  );
  assert.equal(
    taskDisplayTitle({ requestText: "fix the header spacing" }),
    "fix the header spacing",
  );
});

test("taskDisplayTitle treats empty and whitespace-only values as absent", () => {
  // `request_text` defaults to "" in the schema, so the empty string is the common case;
  // whitespace would otherwise render as a row with no visible subject at all.
  assert.equal(taskDisplayTitle({ title: "", requestText: "" }), null);
  assert.equal(taskDisplayTitle({ title: "   ", requestText: "\n\t" }), null);
  assert.equal(taskDisplayTitle({ title: null, requestText: null }), null);
  assert.equal(taskDisplayTitle({}), null);
  assert.equal(taskDisplayTitle({ title: "  ", requestText: "real request" }), "real request");
});

test("taskDisplayTitle trims what it returns", () => {
  assert.equal(taskDisplayTitle({ title: "  Padded title \n" }), "Padded title");
});
