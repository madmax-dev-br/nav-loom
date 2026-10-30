import Workspace from './workspace';
import {requireChatGPTUser} from './chatgpt-auth';
export const dynamic='force-dynamic';
async function ProtectedWorkspace(){await requireChatGPTUser('/');return <Workspace/>;}
export default function Page(){return <ProtectedWorkspace/>;}
