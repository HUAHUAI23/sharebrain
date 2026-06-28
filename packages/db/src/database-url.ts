const POSTGRES_JS_IGNORED_SEARCH_PARAMS = new Set(["directConnection"]);

export function normalizePostgresUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl);

  for (const key of POSTGRES_JS_IGNORED_SEARCH_PARAMS) {
    url.searchParams.delete(key);
  }

  return url.toString();
}

export function getAdminDatabaseUrl(databaseUrl: string): string {
  const url = new URL(normalizePostgresUrl(databaseUrl));
  url.pathname = "/postgres";
  url.search = "";
  return url.toString();
}

export function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
