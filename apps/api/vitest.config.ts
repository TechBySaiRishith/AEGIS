import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globals: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      // Focus coverage on the units that have direct unit tests. Glue /
      // orchestration files (handler.ts, clone.ts, html.ts, critique.ts,
      // synthesizer.ts) are exercised end-to-end via pipeline.integration.test.ts
      // and are deliberately excluded from per-file thresholds — measuring
      // them with v8 line coverage would produce misleading numbers for
      // code that's actually tested at the integration layer.
      include: [
        "src/council/algorithmic.ts",
        "src/intake/analyze.ts",
        "src/reports/generator.ts",
        "src/llm/registry.ts",
        "src/experts/**/analyzer.ts",
      ],
      thresholds: {
        // Global floor — production-grade baseline covering every file
        // in the include list. Derived from the `pnpm exec vitest run
        // --coverage` output on the commit that introduced this config,
        // then rounded down with a 3–5 point safety margin so CI fails
        // on material regressions without flapping on noise. Sentinel's
        // analyzer (~45% lines) is the bottleneck; improving its direct
        // unit coverage will let these floors ratchet upward.
        lines: 74,
        statements: 74,
        branches: 67,
        functions: 85,

        // Per-file floors for safety-critical cores. These files drive
        // verdicts, reports, and expert routing — regressions here are
        // expensive, so we lock them close to actual coverage.
        "src/council/algorithmic.ts": {
          lines: 95,
          statements: 95,
          branches: 92,
          functions: 98,
        },
        "src/intake/analyze.ts": {
          lines: 73,
          statements: 73,
          branches: 63,
          functions: 90,
        },
        "src/reports/generator.ts": {
          lines: 78,
          statements: 78,
          branches: 57,
          functions: 95,
        },
        "src/llm/registry.ts": {
          lines: 82,
          statements: 82,
          branches: 69,
          functions: 95,
        },
        "src/experts/sentinel/analyzer.ts": {
          lines: 58,
          statements: 58,
          branches: 74,
          functions: 78,
        },
      },
    },
  },
});
