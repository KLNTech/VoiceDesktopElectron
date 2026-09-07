import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    /*
     * Node by default, jsdom for the files that say `.web`.
     *
     * The suffix convention already existed and did NOTHING: with only `environment: 'node'`
     * set, `test/talk-control.web.test.ts` ran under Node, where `typeof document` is
     * `undefined` — verified. The name promised an environment the runner never provided, and
     * `jsdom` and `@testing-library/react` sat in devDependencies imported by no file in the
     * repo. A suffix that carries no behaviour is worse than no convention: the next person
     * writes a DOM test, names it `.web`, and finds out at the assertion rather than the setup.
     *
     * ## Why there is no `include` beside `projects`
     *
     * There was, and it ran the whole suite TWICE. A root-level `include` defines a project of
     * its own, so every file matching it was collected once there and once again by the named
     * `node` project below: 31 test files reported from 16 on disk, every assertion executed
     * twice, and two real Electron launches per run where one was intended. It is invisible in
     * the summary — a doubled suite is green exactly as often as a single one — and it was found
     * only by counting the file names in the JSON reporter. Everything the runner collects is
     * now named by exactly one project.
     */
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
          exclude: ['test/**/*.web.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'web',
          environment: 'jsdom',
          include: ['test/**/*.web.test.{ts,tsx}'],
        },
      },
    ],
  },
})
