import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../../../chatgpt-auth';
import { ownerSettingsGet, ownerSettingsPost } from '../../../../lib/api-settings.mjs';
export const dynamic = 'force-dynamic';
export async function GET() {
  return ownerSettingsGet(await getChatGPTUser(), env);
}
export async function POST(request: Request) {
  return ownerSettingsPost(request, await getChatGPTUser(), env);
}
