/**
 * The reserved local identity, in a module that pulls in nothing else.
 *
 * `lib/auth` re-exports these, but importing *it* drags in `lib/db`, whose module body opens
 * (and therefore creates) the SQLite file. That's wrong for the CLIs that move database files
 * around: `runner/import.ts` only needs the constant, and importing auth made an empty database
 * appear before the importer had decided what to do with the destination.
 */
export const LOCAL_USER_ID = "user_local";
export const LOCAL_USER_EMAIL = "local@device";
