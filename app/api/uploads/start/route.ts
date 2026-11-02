import { env } from 'cloudflare:workers';
import { startUploadJob } from '../../../../lib/upload-jobs.mjs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  return startUploadJob(request, env);
}
