import { defineConfig } from "vitest/config";

export default defineConfig({
  // Resolves the `@/*` -> `./src/*` alias from tsconfig.json natively, so no
  // vite-tsconfig-paths plugin is needed.
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    // Playwright owns tests/e2e; vitest must not try to run those.
    exclude: ["tests/e2e/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/lib/**/*.ts"],
      exclude: ["src/generated/**", "**/*.d.ts"],
      thresholds: {
        // §22 — the split engine is the one module that must be fully covered.
        "src/lib/splits/**/*.ts": {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },
      },
    },
  },
});
