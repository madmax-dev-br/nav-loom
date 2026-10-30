import {resolve} from 'node:path';
import {createService} from '../agent/service.mjs';
const root=resolve(process.argv[2]||process.cwd()),port=Number(process.env.NAVLOOM_AGENT_PORT||4788);
const service=await createService({root,port});console.log(`Navloom agent service: http://127.0.0.1:${service.port} · project ${root}`);
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await service.close();process.exit(0);});
