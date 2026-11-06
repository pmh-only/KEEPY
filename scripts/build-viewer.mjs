import { build } from 'esbuild';

await build({
  entryPoints: ['offline/main.ts'],
  outfile: '.generated/viewer.js',
  bundle: true,
  format: 'iife',
  platform: 'browser',
  loader: { '.css': 'text' },
  target: 'es2022',
  minify: true,
  legalComments: 'inline',
});
