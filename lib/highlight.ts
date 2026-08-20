/**
 * Syntax highlighting: source text → one flat token list per line.
 *
 * **This module is only ever reached through `await import()`** (see `components/CodeView.tsx`).
 * It statically pulls in every grammar it registers, so importing it eagerly would put ~200 KB
 * of language definitions into the bundle of every page that can open a diff. Keep it that way.
 *
 * Why lowlight rather than highlight.js directly, or Shiki:
 * - lowlight returns a **hast tree**, so the viewers build React elements from it. highlight.js'
 *   own API returns an HTML *string*, which would mean `dangerouslySetInnerHTML` on markup
 *   derived from file contents — a foothold this app has no reason to hand out.
 * - the colours arrive as **class names** (`hljs-keyword`), so the theme is CSS and lives with
 *   the rest of the token layer in `app/globals.css`. Shiki emits inline `style` attributes
 *   from a bundled VS Code theme, which cannot follow light/dark from those variables without
 *   a second mechanism — and it needs a WASM regex engine, under a Next build that is already
 *   far off the public release train.
 */

import { createLowlight } from "lowlight";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import scss from "highlight.js/lib/languages/scss";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import type { CodeLanguage } from "@/lib/code-lang";

/** One run of characters sharing a highlight class. `cls` is "" for unclassified text. */
export type CodeToken = { text: string; cls: string };
/** A source line as tokens, in order. Joining every `text` reproduces the line exactly. */
export type CodeLine = CodeToken[];

/** The minimum of hast this module walks. Declared structurally rather than importing
 *  `@types/hast`, which is lowlight's dependency and not ours to reach into. */
type HastNode = {
  type: string;
  value?: string;
  properties?: { className?: unknown };
  children?: HastNode[];
};

let instance: ReturnType<typeof createLowlight> | null = null;

function lowlight() {
  if (!instance) {
    instance = createLowlight();
    instance.register({
      bash,
      c,
      cpp,
      css,
      diff,
      dockerfile,
      go,
      ini,
      java,
      javascript,
      json,
      markdown,
      php,
      python,
      ruby,
      rust,
      scss,
      sql,
      swift,
      typescript,
      xml,
      yaml,
    });
  }
  return instance;
}

function classNameOf(node: HastNode): string | null {
  const raw = node.properties?.className;
  if (Array.isArray(raw)) return raw.join(" ");
  return typeof raw === "string" ? raw : null;
}

/**
 * Flatten a hast tree into lines of tokens.
 *
 * The **innermost** class wins rather than the ancestor chain being concatenated: highlight.js
 * nests (a `hljs-subst` inside a `hljs-string`), and joining the chain would put two `.hljs-*`
 * rules of equal specificity on one span, leaving the colour to be decided by the order the
 * CSS happens to be emitted in. Text that is *not* inside the inner span is a sibling text
 * node, so it still gets the outer class — which is the behaviour we want anyway.
 */
function flatten(node: HastNode, cls: string, lines: CodeLine[]): void {
  if (node.type === "text") {
    const parts = String(node.value ?? "").split("\n");
    parts.forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part) lines[lines.length - 1].push({ text: part, cls });
    });
    return;
  }
  const own = node.type === "element" ? classNameOf(node) : null;
  for (const child of node.children ?? []) flatten(child, own ?? cls, lines);
}

/** The grammars actually registered here. Exported so `lib/code-lang.test.ts` can hold this
 *  module and `HIGHLIGHT_LANGUAGES` to each other — a language the map can return but this
 *  module never registered would silently render every such file unhighlighted. */
export function registeredLanguages(): string[] {
  return lowlight().listLanguages();
}

/** Every line as a single unclassified token — the shape the viewers render when there is no
 *  grammar for the file, the content is too big to highlight, or highlighting threw. */
export function plainLines(code: string): CodeLine[] {
  return code.split("\n").map((line) => (line ? [{ text: line, cls: "" }] : []));
}

/**
 * Highlight `code` and return its lines. Falls back to `plainLines` if the grammar throws —
 * highlight.js can raise on input it considers illegal for a language, and a file that fails
 * to colour must still be readable.
 */
export function highlightLines(code: string, language: CodeLanguage): CodeLine[] {
  try {
    const tree = lowlight().highlight(language, code) as unknown as HastNode;
    const lines: CodeLine[] = [[]];
    flatten(tree, "", lines);
    return lines;
  } catch {
    return plainLines(code);
  }
}
