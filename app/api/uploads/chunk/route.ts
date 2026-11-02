import { env } from 'cloudflare:workers';
import { uploadChunk } from '../../../../lib/upload-jobs.mjs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  return uploadChunk(request, env);
}
