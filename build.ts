import { build, emptyDir } from 'https://deno.land/x/dnt@0.39.0/mod.ts';
import npmPkg from './package.json' with { type: 'json' };

const OUTPUT_DIR = './dist';

if (import.meta.main) {
  await emptyDir(OUTPUT_DIR);

  await build({
    entryPoints: [
      './src/mod.ts',
      {
        name: './adaptors',
        path: './src/adaptors/mod.ts',
      },
      {
        name: './namespace',
        path: './src/namespace/mod.ts',
      },
      {
        name: './nfd-mgmt',
        path: './src/nfd-mgmt/mod.ts',
      },
      {
        name: './security',
        path: './src/security/mod.ts',
      },
      {
        name: './storage',
        path: './src/storage/mod.ts',
      },
      {
        name: './sync-agent',
        path: './src/sync-agent/mod.ts',
      },
      {
        name: './utils',
        path: './src/utils/mod.ts',
      },
      {
        name: './workspace',
        path: './src/workspace/mod.ts',
      },
    ],
    outDir: OUTPUT_DIR,
    shims: {
      // Do not shim Deno. It conflicts with the browser.
      deno: false,
      custom: [{
        module: './types/deno.d.ts',
        globalNames: ['Deno'],
      }],
    },
    test: false, // Required due to some dependencies do not include test files.
    esModule: true,
    typeCheck: false,
    packageManager: 'pnpm',
    // package.json properties
    package: npmPkg,
    postBuild() {
      // steps to run after building and before running the tests
      Deno.copyFileSync('LICENSE', `${OUTPUT_DIR}/LICENSE`);
      Deno.copyFileSync('README.md', `${OUTPUT_DIR}/README.md`);
      Deno.copyFileSync('.npmrc', `${OUTPUT_DIR}/.npmrc`);
      const dntShim = new TextEncoder().encode('const Deno = globalThis.Deno;\nexport { Deno };');
      Deno.writeFileSync(`${OUTPUT_DIR}/esm/_dnt.shims.js`, dntShim);
      Deno.writeFileSync(`${OUTPUT_DIR}/script/_dnt.shims.js`, dntShim);
    },
  });
}
