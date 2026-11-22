import vitestConfig from "./vitest.config.ts";

const { include = [], exclude = [] } = vitestConfig.test.coverage;

process.env.PBT_SEED ??= "20260101";

process.env.PBT_NUM_RUNS ??= "25";

export default {
  $schema: "./node_modules/@stryker-mutator/core/schema/stryker-schema.json",

  mutate: [...include, ...exclude.map((pattern) => `!${pattern}`)],
  mutator: { excludedMutations: [] },

  testRunner: "vitest",
  plugins: ["@stryker-mutator/vitest-runner"],

  vitest: {
    configFile: "vitest.config.ts",
    related: true,
  },

  tsconfigFile: "",

  concurrency: 2,
  disableBail: true,

  thresholds: { high: 80, low: 60, break: null },

  incremental: false,
  incrementalFile: "coverage/stryker/incremental.json",

  reporters: ["html", "json", "clear-text", "progress"],
  htmlReporter: { fileName: "coverage/stryker/mutation.html" },
  jsonReporter: { fileName: "coverage/stryker/mutation.json" },

  ignorePatterns: [
    ".claude",
    ".agents",
    ".cursor",
    ".fallow",
    ".husky",
    ".vscode",
    ".changeset",
    ".github",
    "docker",
    "coverage",
    "/docs",
    "**/dist/**",
    "**/build/**",
    "**/.evlog/**",
    "**/.vercel/**",
    "**/.repos/**",
    "**/repos/**",
  ],
};
