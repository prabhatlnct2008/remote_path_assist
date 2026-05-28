import { defineConfig } from "vitest/config";

export default defineConfig({
  // Match Next's automatic JSX runtime so .tsx (e.g. react-pdf) needs no React import.
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    // Integration tests share a single file:test.db; run files serially to
    // avoid SQLite write contention (SQLITE_BUSY).
    fileParallelism: false,
    // Injected into process.env before modules load so lib/env.ts validates.
    env: {
      NODE_ENV: "test",
      AUTH_SECRET: "test-auth-secret",
      DATABASE_URL: "file:test.db",
      ENCRYPTION_KEY_V1: Buffer.alloc(32, 7).toString("base64"),
      ENCRYPTION_KEY_V2: Buffer.alloc(32, 9).toString("base64"),
    },
  },
  resolve: {
    alias: {
      "@": new URL(".", import.meta.url).pathname.replace(/\/$/, ""),
    },
  },
});
