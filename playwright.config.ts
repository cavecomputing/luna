import { defineConfig } from '@playwright/test'

/**
 * End-to-end tests, against the packaged app.
 *
 * Not against `electron-vite dev`: the thing worth testing is what ships, and
 * the dev server differs from it in exactly the places that break — the custom
 * protocol the renderer loads over, the asar bundle, and the content security
 * policy. `npm run test:e2e` packages first for that reason.
 *
 * Serial by default. Each test launches its own copy of the app with its own
 * throwaway `userData`, so they do not share state — but they do each spawn a
 * real Electron process and, in some cases, a real MCP server, and running a
 * dozen of those at once measures the machine rather than the app.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  // An app launch plus a subprocess handshake is slower than a web page.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // A failing e2e test is usually a timing or a focus problem, and the trace is
  // the only way to see which. Kept off for passing runs so the artifact
  // directory does not fill up.
  use: { trace: 'retain-on-failure' },
  reporter: process.env.CI === undefined ? 'list' : [['list'], ['html', { open: 'never' }]],
  // Never silently pass a suite that could not find the app it was meant to
  // test. `launch` throws with instructions instead.
  forbidOnly: process.env.CI !== undefined,
  retries: process.env.CI === undefined ? 0 : 1,
})
