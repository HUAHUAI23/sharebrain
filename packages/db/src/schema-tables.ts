import { getTableName } from "drizzle-orm";

import {
  auditLogs,
  documentBlocks,
  documentChunks,
  documentCrdtSnapshots,
  documents,
  documentVersions,
  projects,
  searchItems,
  timelineEvents,
} from "./schema";

const sharebrainTables = [
  auditLogs,
  documentBlocks,
  documentChunks,
  documentCrdtSnapshots,
  documents,
  documentVersions,
  projects,
  searchItems,
  timelineEvents,
] as const;

export const sharebrainTableNames = sharebrainTables.map((table) => getTableName(table)).sort();
