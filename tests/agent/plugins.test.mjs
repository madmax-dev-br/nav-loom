import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,cp,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Runtime} from '../../agent/runtime.mjs';
import {Plugins} from '../../agent/plugins.mjs';
import {parse} from 'yaml';
test('real container plugin health, tools, immutable bundle and permission revocation',{skip:process.env.NAVLOOM_CONTAINER_TEST!=='1'},async t=>{const root=await mkdtemp(join(tmpdir(),'navloom-plugin-'));t.after(()=>rm(root,{recursive:true,force:true}));await cp('examples/agent-project',root,{recursive:true,filter:source=>!/(runtime\.json|service\.lock|graph\.json|\/runs\/|\/evidence\/|\/revisions\/|\/versions\/)/.test(source)});const r=await new Runtime(root).init(),p=new Plugins(r);const activated=await p.activate('deeplinks');assert.ok(activated.revision);const result=await p.invoke({plugin:'deeplinks',tool:'describe'});assert.equal(result.screens,0);await writeFile(join(root,'.navloom/plugins/deeplinks/server.mjs'),'throw Error("Changed after activation")');assert.equal((await p.invoke({plugin:'deeplinks',tool:'describe'})).screens,0);await assert.rejects(p.activate('deeplinks'));assert.equal((await p.active())[0].revision,activated.revision);const config=await r.store.config();config.permissions.pluginCapabilities=[];await r.configure(config);await assert.rejects(p.invoke({plugin:'deeplinks',tool:'describe'}),/revoked/);});
