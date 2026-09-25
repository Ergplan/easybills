/**
 * No-op stand-in for the `server-only` package.
 *
 * Used exclusively by CLI entry points (see `tsconfig.scripts.json`), which run
 * server code in plain Node where the real package throws by design. The Next
 * build continues to use the real one, so a `server-only` module accidentally
 * imported into a client bundle still fails the build.
 */
export {};
