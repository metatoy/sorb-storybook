// @sorb/storybook — esbuild build. Emits dist/{preset,manager,preview}.js.
//
// JS-only (CLAUDE.md): no tsup, no typescript. Panels are authored as .jsx and
// compiled here. react / react-dom / @storybook/* are PEER deps the consumer
// (their Storybook install) provides — they stay external so the addon never
// bundles a second React or a Storybook copy.
import { build, context } from 'esbuild'

/**
 * Externalize React + every @storybook/* package. A bare `@storybook/*` glob is
 * honored by esbuild's `external` matcher, but we also list the concrete entry
 * deps so intent is explicit and resolution can't surprise us.
 */
const external = [
  'react',
  'react-dom',
  'react/jsx-runtime',
  '@sorb/leaf',
  '@storybook/*',
  '@storybook/manager-api',
  '@storybook/preview-api',
  '@storybook/components',
  '@storybook/theming',
]

const shared = {
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2020',
  sourcemap: true,
  jsx: 'automatic',
  external,
  logLevel: 'info',
}

const builds = [
  // Node-side preset: runs in the Storybook builder process. Platform=node so
  // node:fs / node:path resolve.
  { ...shared, platform: 'node', entryPoints: ['src/preset.js'], outfile: 'dist/preset.js' },
  // Manager UI (the Sorb panel) — browser, React.
  { ...shared, platform: 'browser', entryPoints: ['src/manager.jsx'], outfile: 'dist/manager.js' },
  // Preview (in-iframe) side.
  { ...shared, platform: 'browser', entryPoints: ['src/preview.js'], outfile: 'dist/preview.js' },
]

if (process.argv.includes('--watch')) {
  const ctxs = await Promise.all(builds.map((b) => context(b)))
  await Promise.all(ctxs.map((c) => c.watch()))
  console.log('@sorb/storybook — watching for changes...')
} else {
  await Promise.all(builds.map((b) => build(b)))
  console.log('@sorb/storybook — built dist/{preset,manager,preview}.js')
}
