import { defineConfig } from 'tsdown'

// tsc (tsconfig.json) emits lib/types/{index,startup}.js + .d.ts first; tsdown
// bundles those two runtime entries into lib/{index,startup}.js. Dependencies
// and peers stay external, so the dsh framework packages resolve from the
// receiver's dsh installation at runtime rather than being bundled.
export default defineConfig({
  entry: ['lib/types/index.js', 'lib/types/startup.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  dts: false,
  fixedExtension: false,
  clean: false,
})
