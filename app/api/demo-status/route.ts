import {env} from 'cloudflare:workers';
import {demoStatus} from '../../../lib/shared-demo.mjs';
export const dynamic='force-dynamic';
export async function GET(){try{return await demoStatus(env)}catch{return Response.json({ready:false,remaining:0,limit:5,reason:'共有機能の準備中です。'},{headers:{'Cache-Control':'no-store'}})}}
