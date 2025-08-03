// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // This is critical for a Node.js project. The default is 'jsdom'.
    environment: 'node',

    // Use globals for a smoother migration from Jest (describe, it, expect, etc.)
    globals: true,

    // Include test files with new pattern for Vitest
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],

    // Configuration for coverage reporting
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      // Ensure all files in 'src' are included in the report
      all: true,
      include: ['src'],
      exclude: [
        'src/index.ts', // Exclude main entry point
        'src/**/*.test.ts', // Exclude test files from coverage
        'src/types', // Exclude type definition files
        'src/**/*.d.ts'
      ],
    },

    // Setup file for global mocks and test utilities
    setupFiles: ['./test/setup/vitest-setup.js'],
  },
});