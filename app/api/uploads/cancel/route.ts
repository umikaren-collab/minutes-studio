import {env} from 'cloudflare:workers';
import {cancelUpload} from '../../../../lib/upload-jobs.mjs';
export const dynamic='force-dynamic';
export async function POST(request:Request){return cancelUpload(request,env)}
