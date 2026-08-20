/**
 * highlight.js ships type declarations for its entry point but not for the per-language
 * subpaths (`highlight.js/lib/languages/typescript`), which is how `lib/highlight.ts` loads
 * exactly the grammars it registers instead of pulling the whole 2.6 MB set into the bundle.
 * Without this, every one of those imports is a `TS2307`.
 *
 * The import sits *inside* the `declare module` block on purpose: a top-level import would
 * make this file a module, and a `declare module` inside a module is a module augmentation,
 * which cannot use a wildcard pattern.
 */
declare module "highlight.js/lib/languages/*" {
  import type { LanguageFn } from "highlight.js";
  const language: LanguageFn;
  export default language;
}
