declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    ADMIN_OWNER_EMAIL?: string;
    API_KEY_ENCRYPTION_SECRET?: string;
    GEMINI_API_KEY?: string;
    GEMINI_MODEL?: string;
    SHARED_DEMO_ENABLED?: string;
    BUCKET?: R2Bucket;
  }
}
