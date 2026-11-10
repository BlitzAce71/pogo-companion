/// <reference types="vite/client" />

/** Set at build time (vite.config.ts): when this build was made and from which commit. */
declare const __BUILD__: { time: string; sha: string };
