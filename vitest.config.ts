import { defineConfig } from 'vitest/config'

// Standalone test config: the pure unit tests live in tests/ and import only
// the package's own source, so no dsh harness is needed here.
export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
  },
})
