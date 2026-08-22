import "@sharebrain/config/dotenv";

import { loadServerEnv } from "@sharebrain/config";
import postgres from "postgres";

import { normalizePostgresUrl } from "../database-url";

const env = loadServerEnv(process.env);
const sql = postgres(normalizePostgresUrl(env.DATABASE_URL), { max: 1, prepare: false });

try {
  await sql`create extension if not exists vector`;
  console.info("数据库扩展已就绪: vector");
} finally {
  await sql.end();
}
