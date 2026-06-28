import { loadServerEnv } from "@sharebrain/config";
import postgres from "postgres";

import { getAdminDatabaseUrl, normalizePostgresUrl, quoteIdentifier } from "../database-url";
import { DEFAULT_DATABASE_URL } from "../defaults";

const env = loadServerEnv(process.env);
const databaseUrl = normalizePostgresUrl(env.DATABASE_URL ?? DEFAULT_DATABASE_URL);
const databaseName = new URL(databaseUrl).pathname.slice(1);

if (!databaseName) {
  throw new Error("DATABASE_URL 必须包含数据库名称。");
}

if (env.NODE_ENV === "production") {
  throw new Error("禁止在 production 环境执行 db:reset。");
}

const adminSql = postgres(getAdminDatabaseUrl(databaseUrl), { prepare: false });

try {
  await adminSql`
    select pg_terminate_backend(pid)
    from pg_stat_activity
    where datname = ${databaseName}
      and pid <> pg_backend_pid()
  `;
  await adminSql.unsafe(`drop database if exists ${quoteIdentifier(databaseName)}`);
  await adminSql.unsafe(`create database ${quoteIdentifier(databaseName)}`);
  console.info(`已重置开发数据库: ${databaseName}`);
} finally {
  await adminSql.end();
}
