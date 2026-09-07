import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    /*
     * Node by default, jsdom for the files that say `.web`.
     *
     * The suffix convention already existed and did NOTHING: with only `environment: 'node'`
     * set, `test/talk-control.web.test.ts` ran under Node, where `typeof document` is
     * `undefined` — verified. The name promised an environment the runner never provided, and
     * `jsdom` and `@testing-library/react` sat in devDependencies imported by no file in the
     * repo. A suffix that carries no behaviour is worse than no convention: the next person
     * writes a DOM test, names it `.web`, and finds out at the assertion rather than the setup.
     */
    environment: 'node',
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
          include: ['test/**/*.web.test.ts'],
        },
      },
    ],
  },
})
