/**
 * Unit tests for path → grammar.
 *
 * The one that matters is the last: every language this can return has to be registered in
 * `lib/highlight.ts`, or the viewer asks for a grammar that isn't loaded and silently renders
 * the file unhighlighted. The two files are edited together and nothing else enforces that.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { HIGHLIGHT_LANGUAGES, languageForPath } from "./code-lang";
import { registeredLanguages } from "./highlight";

test("common extensions map to their grammar, case-insensitively", () => {
  assert.equal(languageForPath("components/DiffModal.tsx"), "typescript");
  assert.equal(languageForPath("lib/git.ts"), "typescript");
  assert.equal(languageForPath("infra/launch/open-app.mjs"), "javascript");
  assert.equal(languageForPath("app/globals.css"), "css");
  assert.equal(languageForPath("package.json"), "json");
  assert.equal(languageForPath("README.MD"), "markdown");
  assert.equal(languageForPath("infra/release/pack.sh"), "bash");
  assert.equal(languageForPath("infra/docker/docker-compose.yml"), "yaml");
});

test("extensionless files we recognise by name still get a grammar", () => {
  assert.equal(languageForPath("Dockerfile"), "dockerfile");
  assert.equal(languageForPath("infra/docker/Dockerfile"), "dockerfile");
  assert.equal(languageForPath(".editorconfig"), "ini");
});

test("anything we have no grammar for answers null rather than guessing", () => {
  // null is a normal answer — it is what stops the viewer loading the highlighter at all.
  assert.equal(languageForPath("LICENSE"), null);
  assert.equal(languageForPath(".gitignore"), null); // leading dot is not an extension
  assert.equal(languageForPath("vendor/lib"), null); // a submodule diff names a directory
  assert.equal(languageForPath("notes.unknownext"), null);
  assert.equal(languageForPath(""), null);
  assert.equal(languageForPath("some/dir/"), null);
});

test("every language this can return is registered in lib/highlight.ts", () => {
  // `highlightLines` swallows an unknown grammar into the plain fallback, so a missing
  // registration is invisible at the call site — it has to be asserted here.
  const registered = new Set(registeredLanguages());
  for (const language of HIGHLIGHT_LANGUAGES) {
    assert.ok(registered.has(language), `${language} is not registered`);
  }
});
