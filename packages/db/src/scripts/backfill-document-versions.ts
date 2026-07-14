// 以可续跑小批次回填历史版本格式、确定性 hash、sealed 状态和版本媒体引用。
import "@sharebrain/config/dotenv";

import {
  DOCUMENT_VERSION_FORMAT_VERSION,
  extractDocumentInlineMediaIds,
  hashDocumentVersionValue,
  projectDocumentVersionValue,
} from "@sharebrain/contracts";
import { and, asc, eq, gt, isNull, or, sql } from "drizzle-orm";

import { createDatabaseClient } from "../client";
import { syncVersionMediaUsages } from "../document-version-store";
import { documentVersions } from "../schema";

const mode = process.argv.includes("--apply") ? "apply" : process.argv.includes("--dry-run") ? "dry-run" : null;
if (!mode) throw new Error("必须显式传入 --dry-run 或 --apply。");

const db = createDatabaseClient();
const batchSize = 100;
let cursor: string | undefined;
let scanned = 0;
let changed = 0;

try {
  while (true) {
    const rows = await db
      .select()
      .from(documentVersions)
      .where(
        and(
          cursor ? gt(documentVersions.id, cursor) : undefined,
          or(isNull(documentVersions.formatVersion), isNull(documentVersions.contentHash)),
        ),
      )
      .orderBy(asc(documentVersions.id))
      .limit(batchSize);
    if (rows.length === 0) break;

    for (const row of rows) {
      scanned += 1;
      cursor = row.id;
      const projected = projectDocumentVersionValue(row.plateJson);
      const contentHash = await hashDocumentVersionValue(projected);
      changed += 1;
      if (mode === "dry-run") continue;

      await db.transaction(async (tx) => {
        const [higher] = await tx
          .select({ id: documentVersions.id })
          .from(documentVersions)
          .where(
            and(
              eq(documentVersions.documentId, row.documentId),
              gt(documentVersions.versionNo, row.versionNo),
            ),
          )
          .limit(1);
        const sealedAt = higher ? row.updatedAt : null;
        await tx
          .update(documentVersions)
          .set({
            kind: row.kind || "auto",
            sealedAt,
            formatVersion: DOCUMENT_VERSION_FORMAT_VERSION,
            contentHash,
          })
          .where(eq(documentVersions.id, row.id));
        await syncVersionMediaUsages(tx, {
          tenantId: row.tenantId,
          documentId: row.documentId,
          versionId: row.id,
          versionNo: row.versionNo,
          mediaIds: extractDocumentInlineMediaIds(projected),
          userId: row.updatedBy,
          now: new Date(),
        });
      });
    }

    console.info(JSON.stringify({ event: "document_version_backfill_progress", mode, scanned, changed, cursor }));
  }

  if (mode === "apply") {
    await db.execute(sql`
      update documents d
      set current_version = latest.version_no
      from (
        select document_id, max(version_no) as version_no
        from document_versions
        group by document_id
      ) latest
      where d.id = latest.document_id and d.current_version is distinct from latest.version_no
    `);
  }
  console.info(JSON.stringify({ event: "document_version_backfill_completed", mode, scanned, changed }));
} finally {
  await db.$client.end({ timeout: 5 });
}
