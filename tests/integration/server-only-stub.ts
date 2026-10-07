/**
 * Stands in for the `server-only` package during integration tests.
 *
 * That package's default export throws on import, which is the whole point of
 * it: a client bundle that reaches a server module fails the build. Next
 * neutralises it when bundling server code via the `react-server` export
 * condition, which maps it to an empty module. Its exports map only exposes
 * `.`, so that stub cannot be aliased directly — hence this file.
 *
 * Aliasing only this one marker package, rather than flipping the
 * `react-server` condition for the project, keeps React's own resolution
 * untouched.
 */
export {};
