import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFile} from 'node:fs/promises';
const code=ts.transpileModule(await readFile(new URL('../lib/history-diff.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
const {historyDiff}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
for(const [before,after] of [['name: old\nstatus: saved','name: new\nstatus: saved'],['a\nx\na','a\na'],['a\na','a\nx\na'],['','first'],['same','same']]){
 const diff=historyDiff(before,after);
 assert.equal(diff.filter(l=>l.type!=='added').map(l=>l.text).join('\n'),before);
 assert.equal(diff.filter(l=>l.type!=='removed').map(l=>l.text).join('\n'),after);
}
assert.deepEqual(historyDiff('a\nx\na','a\na').filter(l=>l.type!=='context'),[{type:'removed',text:'x'}]);
console.log('Ordered revision diffs, repeated lines, additions, removals, and unchanged snapshots passed.');
