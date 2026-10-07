import { defineConfig } from "vitest/config";

const coverage = {
  provider: "v8" as const,
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
};

export default defineConfig({
  // Resolves the `@/*` -> `./src/*` alias from tsconfig.json natively, so no
  // vite-tsconfig-paths plugin is needed.
  resolve: { tsconfigPaths: true },
  test: {
    coverage,
    projects: [
      {
        resolve: { tsconfigPaths: true },
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
          // Playwright owns tests/e2e; the integration project owns its own.
          exclude: ["tests/e2e/**", "tests/integration/**", "node_modules/**"],
        },
      },
      {
        // Server Actions and their dependencies `import "server-only"`, whose
        // default export throws by design. See the stub for why it is aliased
        // rather than resolved through the `react-server` condition.
        resolve: {
          tsconfigPaths: true,
          alias: {
            "server-only": new URL(
              "./tests/integration/server-only-stub.ts",
              import.meta.url,
            ).pathname,
          },
        },
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          // Runs before any test file is imported, so DATABASE_URL points at
          // the test database before src/lib/db/client evaluates.
          setupFiles: ["./tests/integration/setup.ts"],
          // These share one database, so they must not run concurrently.
          fileParallelism: false,
          testTimeout: 30_000,
        },
      },
    ],
  },
});
