import 'dotenv/config';

// Variables with no safe default. A missing value here is a deployment
// mistake, not a dev-convenience gap — CLAUDE.md invariant #7 (admin
// isolation) and the JWT signing chain both depend on these being real,
// operator-supplied secrets. Never backfill them with a literal fallback.
const REQUIRED_VARS = [
  'ROOT_ADMIN_ACCESS_ID',
  'ROOT_ADMIN_ACCESS_TOKEN',
  'JWT_SECRET',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_CLIENT_EMAIL',
  'FIREBASE_PRIVATE_KEY',
];

const missing = REQUIRED_VARS.filter((key) => !process.env[key]);
if (missing.length > 0) {
  throw new Error(
    `[env] Missing required environment variable(s): ${missing.join(', ')}. ` +
      'Set these explicitly — there is no safe default for admin/JWT secrets. See backend/.env.example.'
  );
}

export const env = {
  PORT: Number(process.env.PORT) || 4000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  CORS_ORIGIN: process.env.CORS_ORIGIN || '*',

  FIREBASE_SERVICE_ACCOUNT_PATH: process.env.FIREBASE_SERVICE_ACCOUNT_PATH || null,
  FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID,
  FIREBASE_CLIENT_EMAIL: process.env.FIREBASE_CLIENT_EMAIL,
  FIREBASE_PRIVATE_KEY: process.env.FIREBASE_PRIVATE_KEY,

  ROOT_ADMIN_ACCESS_ID: process.env.ROOT_ADMIN_ACCESS_ID,
  ROOT_ADMIN_ACCESS_TOKEN: process.env.ROOT_ADMIN_ACCESS_TOKEN,

  JWT_SECRET: process.env.JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '12h',

  GOOGLE_GENERATIVE_AI_API_KEY: process.env.GOOGLE_GENERATIVE_AI_API_KEY || null,
  GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-pro',

  DEFAULT_VAULT_MATURITY_DAYS: Number(process.env.DEFAULT_VAULT_MATURITY_DAYS) || 3,

  // Gates the 60-second vault-maturity scheduler (DEPLOYMENT_GUIDE.md step
  // 4 / CLAUDE.md invariant #8). Defaults to true; set to the literal
  // string 'false' for tests/CI so no stray background timer fires.
  ENABLE_VAULT_SCHEDULER: process.env.ENABLE_VAULT_SCHEDULER !== 'false',
};
