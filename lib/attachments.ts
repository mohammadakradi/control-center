/**
 * Client-safe attachment helpers — no `node:*` imports, so this can be imported from
 * `"use client"` components (unlike `lib/uploads.ts`, which touches the filesystem).
 */

/**
 * Read each file's bytes into memory now, and rebuild it as a plain in-memory `File`.
 *
 * WebKit's `fetch()`, given a `FormData` holding a live `File` handle, can stream that file's
 * bytes lazily off disk as the request body is sent rather than buffering it up front — and
 * has multiple long-standing, still-open bugs where that stream is cut short (a timeout, a
 * revoked resource, iOS Safari's ~60s blob-read ceiling), which delivers a truncated multipart
 * body the server can't parse (`BAD_MULTIPART` in `lib/uploads.ts`). Reading the bytes here
 * trades the lazy stream for an ordinary in-memory buffer, which every engine's `fetch` sends
 * as a normal, fully-buffered body.
 */
export async function materializeFiles(files: File[]): Promise<File[]> {
  return Promise.all(
    files.map(
      async (f) =>
        new File([await f.arrayBuffer()], f.name, {
          type: f.type,
          lastModified: f.lastModified,
        }),
    ),
  );
}
