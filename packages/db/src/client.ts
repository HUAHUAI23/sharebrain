import { loadServerEnv } from "@sharebrain/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { normalizePostgresUrl } from "./database-url";
import * as schema from "./schema";

export function createDatabaseClient(databaseUrl = loadServerEnv().DATABASE_URL) {
  const sql = postgres(normalizePostgresUrl(databaseUrl), {
    max: 10,
    prepare: false,
  });

  return drizzle(sql, { schema });
}

export type DatabaseClient = ReturnType<typeof createDatabaseClient>;
