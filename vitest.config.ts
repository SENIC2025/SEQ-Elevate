import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    // e2e/fixtures holds unit tests of the end-to-end fixtures (Playwright
    // runs only *.spec.ts).
    include: ["src/**/*.test.ts", "e2e/fixtures/**/*.test.ts"],
    globals: true,
  },
});
