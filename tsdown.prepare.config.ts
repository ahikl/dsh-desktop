import { defineConfig } from 'tsdown'

// Self-contained `prepare` build for git installs: transpiles src/ straight to
// lib/ with no type checking and no project references, so it never assumes a
// sibling monorepo checkout (dsh framework packages stay external — they are
// peerDependencies resolved from the receiver's dsh install at runtime). This
// is the build `dsh plugin add github:...` triggers; types come only from the
// dev-only `build` (tsc + tsdown) used for npm publishing.
export default defineConfig({
  entry: ['src/index.ts', 'src/startup.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  dts: false,
  fixedExtension: false,
  clean: false,
})
