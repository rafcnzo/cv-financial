export interface Job {userId:string;documentId:string;}
export interface Env {
 HYPERDRIVE:Hyperdrive; AUTH_HYPERDRIVE:Hyperdrive; DOCUMENTS:R2Bucket; EXTRACTION:Workflow<Job>;
 ENVIRONMENT:string; JWT_SECRET:string; OTP_SECRET:string; GOOGLE_CLIENT_ID:string;
 RESEND_API_KEY:string; RESEND_FROM:string; RESEND_WEBHOOK_SECRET:string;
 CLAUDE_API_KEY:string; AI_MODEL:string; AI_MONTHLY_LIMIT_USD:string; AI_MONTHLY_QUOTA:string;
 AI_INPUT_USD_PER_MTOK:string; AI_OUTPUT_USD_PER_MTOK:string; AI_RETRIES_USD_RESERVE:string;
 R2_ACCOUNT_ID:string; R2_BUCKET:string; R2_ACCESS_KEY_ID:string; R2_SECRET_ACCESS_KEY:string;
 MAX_STORAGE_BYTES:string; MAX_DB_BYTES:string; INGEST_DOMAIN:string;
 FCM_PROJECT_ID:string; FCM_SERVICE_ACCOUNT_EMAIL:string; FCM_PRIVATE_KEY:string;
}
