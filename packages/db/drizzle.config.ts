import "@sharebrain/config/dotenv";

import { loadServerEnv } from "@sharebrain/config";
import { defineConfig } from "drizzle-kit";

import { normalizePostgresUrl } from "./src/database-url";
import { sharebrainTableNames } from "./src/schema-tables";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  schemaFilter: ["public"],
  tablesFilter: sharebrainTableNames,
  dbCredentials: {
    url: normalizePostgresUrl(loadServerEnv().DATABASE_URL),
  },
  strict: true,
  verbose: true,
});
