import { env } from 'cloudflare:workers';
import { finishUploadJob } from '../../../lib/upload-jobs.mjs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  return finishUploadJob(request, env);
}
