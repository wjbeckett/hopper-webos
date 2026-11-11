/// <reference types="vite/client" />

/** Build version, <major>.<minor>.<commit count> (see vite.config.ts). */
declare const __APP_VERSION__: string;
/** Short commit hash of the build, with "+" when built from uncommitted changes. Empty without git. */
declare const __APP_COMMIT__: string;
