/**
 * Which syntax-highlighting grammar a file path gets.
 *
 * Deliberately a *closed* list: `lib/highlight.ts` registers exactly these grammars with
 * lowlight, so anything this file can return is guaranteed to be loaded, and anything it
 * can't is rendered as plain text rather than pulling another grammar into the bundle.
 * Adding a language means editing both files — that pairing is the point.
 *
 * No `node:*` imports and no DOM: this is read by client components to decide whether the
 * highlighter is worth loading at all, before it is loaded.
 */

export const HIGHLIGHT_LANGUAGES = [
  "bash",
  "c",
  "cpp",
  "css",
  "diff",
  "dockerfile",
  "go",
  "ini",
  "java",
  "javascript",
  "json",
  "markdown",
  "php",
  "python",
  "ruby",
  "rust",
  "scss",
  "sql",
  "swift",
  "typescript",
  "xml",
  "yaml",
] as const;

export type CodeLanguage = (typeof HIGHLIGHT_LANGUAGES)[number];

/** Extension (lowercased, no dot) → grammar. */
const BY_EXTENSION: Record<string, CodeLanguage> = {
  bash: "bash",
  sh: "bash",
  zsh: "bash",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  css: "css",
  diff: "diff",
  patch: "diff",
  go: "go",
  cfg: "ini",
  ini: "ini",
  toml: "ini",
  java: "java",
  cjs: "javascript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  json: "json",
  jsonc: "json",
  webmanifest: "json",
  markdown: "markdown",
  md: "markdown",
  mdx: "markdown",
  php: "php",
  py: "python",
  pyi: "python",
  rb: "ruby",
  rs: "rust",
  sass: "scss",
  scss: "scss",
  sql: "sql",
  swift: "swift",
  cts: "typescript",
  mts: "typescript",
  ts: "typescript",
  tsx: "typescript",
  htm: "xml",
  html: "xml",
  svg: "xml",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
};

/** Whole filenames that carry no extension but are unambiguous. */
const BY_FILENAME: Record<string, CodeLanguage> = {
  ".editorconfig": "ini",
  ".gitconfig": "ini",
  containerfile: "dockerfile",
  dockerfile: "dockerfile",
};

/**
 * The grammar for a repo-relative path, or `null` when we have none — an unknown extension,
 * an extensionless file, or a directory-shaped path (a submodule's diff names a folder).
 *
 * `null` is a normal answer, not a failure: the viewers render plain text for it and skip
 * loading the highlighter entirely.
 */
export function languageForPath(path: string): CodeLanguage | null {
  const name = path.split("/").pop() ?? "";
  if (!name) return null;

  const byName = BY_FILENAME[name.toLowerCase()];
  if (byName) return byName;

  // `.gitignore` has a leading dot and no extension — `lastIndexOf` at 0 is not a suffix.
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;
  return BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? null;
}
