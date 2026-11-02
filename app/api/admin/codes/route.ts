import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../../../chatgpt-auth';
import { ownerCodesGet, ownerCodesPost } from '../../../../lib/admin-codes.mjs';
export const dynamic = 'force-dynamic';
export async function GET() {
  return ownerCodesGet(await getChatGPTUser(), env);
}
export async function POST(request: Request) {
  return ownerCodesPost(request, await getChatGPTUser(), env);
}
