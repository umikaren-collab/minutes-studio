import { env } from 'cloudflare:workers';
import { uploadStatus } from '../../../../lib/upload-jobs.mjs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return uploadStatus(request, env);
}
