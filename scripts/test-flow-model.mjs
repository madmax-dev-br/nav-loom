import {build} from 'esbuild';
import {createRequire} from 'node:module';
const result=await build({entryPoints:['tests/variations.ts'],bundle:true,platform:'node',format:'cjs',write:false});
new Function('require',Buffer.from(result.outputFiles[0].contents).toString())(createRequire(import.meta.url));
