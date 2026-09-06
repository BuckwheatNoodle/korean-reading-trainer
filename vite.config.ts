import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const buildEnvironment = (globalThis as typeof globalThis & {
  process?: { env?: Record<string, string | undefined> };
}).process?.env ?? {};
const repositoryName = buildEnvironment.GITHUB_REPOSITORY?.split("/")[1];
const githubPagesBase = repositoryName && !repositoryName.endsWith(".github.io")
  ? `/${repositoryName}/`
  : "/";

export default defineConfig({
  // GitHub project Pages is served below /<repository>/. A repository variable
  // named VITE_BASE_PATH can override this (use "/" for a custom domain).
  base: buildEnvironment.VITE_BASE_PATH || githubPagesBase,
  plugins: [react()],
  test: {
    environment: "node",
    globals: true,
  },
});
