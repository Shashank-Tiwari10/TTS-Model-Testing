// Loads the repo-root .env before any sibling module reads process.env.
// Import this FIRST in every entrypoint — ESM hoists imports, so a dotenv call in the
// entrypoint body would run only after generate.js etc. have already read their config.
// In GitHub Actions there is no .env file; env comes from workflow secrets and this is a no-op.
import dotenv from "dotenv";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".env") });
