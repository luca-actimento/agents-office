// Re-export the DEFAULT_LAYOUT string from src/ — esbuild inlines it at build time.
// This avoids runtime file-system reads and works correctly in the bundled dist/server/index.cjs.
export { DEFAULT_LAYOUT as DEFAULT_LAYOUT_STR } from '../src/defaultLayout.js';
