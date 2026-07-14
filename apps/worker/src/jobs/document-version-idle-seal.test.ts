// 验证空闲封存的候选边界、批次、幂等以及与正文保存共享 document 行锁的竞态语义。
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { loadServerEnv } from "@sharebrain/config";
import { DOCUMENT_VERSION_FORMAT_VERSION, hashDocumentVersionValue } from "@sharebrain/contracts";
import { createDatabaseClient, materializeAutoVersion } from "@sharebrain/db";
import {
  documentVersions,
  documents,
  projectModules,
  projects,
  tenants,
  users,
} from "@sharebrain/db/schema";
import { asc, eq, inArray } from "drizzle-orm";

import {
  runDocumentVersionIdleSeal,
  sealIdleDocumentVersionCandidate,
} from "./document-version-idle-seal";

const now = new Date("2026-07-13T12:00:00.000Z");
const old = new Date(now.getTime() - 10 * 60_000);
const recent = new Date(now.getTime() - 60_000);
const value = [{ type: "p", children: [{ text: "idle checkpoint" }] }];
const env = loadServerEnv({
  ...process.env,
  DOCUMENT_VERSION_IDLE_SEAL_SECONDS: "120",
  DOCUMENT_VERSION_IDLE_SEAL_INTERVAL_SECONDS: "30",
  DOCUMENT_VERSION_IDLE_SEAL_BATCH_SIZE: "100",
});
const db = createDatabaseClient(env.DATABASE_URL);
const documentIds: string[] = [];
const tenantId = crypto.randomUUID();
const userId = crypto.randomUUID();
const projectId = crypto.randomUUID();
const moduleId = crypto.randomUUID();
let contentHash = "";

type CheckpointFixture = {
  currentVersion?: number;
  documentDeletedAt?: Date | null;
  kind?: "auto" | "restore";
  sealedAt?: Date | null;
  updatedAt?: Date;
  versionDeletedAt?: Date | null;
  versionNo?: number;
};

async function createCheckpointFixture(input: CheckpointFixture = {}) {
  const documentId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const versionNo = input.versionNo ?? 1;
  documentIds.push(documentId);
  await db.insert(documents).values({
    id: documentId,
    tenantId,
    projectId,
    moduleId,
    title: `Idle seal ${documentId}`,
    currentVersion: input.currentVersion ?? versionNo,
    sortKey: `idle-seal-${documentId}`,
    createdBy: userId,
    updatedBy: userId,
    createdAt: old,
    updatedAt: input.updatedAt ?? old,
    deletedAt: input.documentDeletedAt ?? null,
  });
  await db.insert(documentVersions).values({
    id: versionId,
    tenantId,
    documentId,
    versionNo,
    kind: input.kind ?? "auto",
    sealedAt: input.sealedAt ?? null,
    formatVersion: DOCUMENT_VERSION_FORMAT_VERSION,
    contentHash,
    plateJson: value,
    plainText: "idle checkpoint",
    createdBy: userId,
    updatedBy: userId,
    createdAt: old,
    updatedAt: input.updatedAt ?? old,
    deletedAt: input.versionDeletedAt ?? null,
  });
  return { documentId, versionId };
}

async function readVersion(versionId: string) {
  const [version] = await db
    .select({
      deletedAt: documentVersions.deletedAt,
      sealedAt: documentVersions.sealedAt,
      updatedAt: documentVersions.updatedAt,
    })
    .from(documentVersions)
    .where(eq(documentVersions.id, versionId));
  return version;
}

beforeAll(async () => {
  await db.insert(tenants).values({
    id: tenantId,
    tenantId,
    name: "Idle seal test",
    createdBy: userId,
    updatedBy: userId,
  });
  await db.insert(users).values({
    id: userId,
    tenantId,
    email: `idle-seal-${userId}@sharebrain.test`,
    displayName: "Idle Seal Test",
    createdBy: userId,
    updatedBy: userId,
  });
  await db.insert(projects).values({
    id: projectId,
    tenantId,
    name: "Idle seal project",
    ownerId: userId,
    createdBy: userId,
    updatedBy: userId,
  });
  await db.insert(projectModules).values({
    id: moduleId,
    tenantId,
    projectId,
    key: "documents",
    name: "Documents",
    kind: "collection",
    sortKey: "idle-seal",
    createdBy: userId,
    updatedBy: userId,
  });
  contentHash = await hashDocumentVersionValue(value);
});

afterAll(async () => {
  if (documentIds.length > 0) {
    await db.delete(documentVersions).where(inArray(documentVersions.documentId, documentIds));
    await db.delete(documents).where(inArray(documents.id, documentIds));
  }
  await db.delete(projectModules).where(eq(projectModules.id, moduleId));
  await db.delete(projects).where(eq(projects.id, projectId));
  await db.delete(users).where(eq(users.id, userId));
  await db.delete(tenants).where(eq(tenants.id, tenantId));
  await db.$client.end({ timeout: 1 });
});

describe("document version idle seal", () => {
  test("seals only idle current open auto checkpoints and remains idempotent", async () => {
    const eligible = await createCheckpointFixture();
    const recentOpen = await createCheckpointFixture({ updatedAt: recent });
    const nonCurrent = await createCheckpointFixture({ currentVersion: 2 });
    const restore = await createCheckpointFixture({ kind: "restore" });
    const deletedDocument = await createCheckpointFixture({ documentDeletedAt: now });
    const deletedVersion = await createCheckpointFixture({ versionDeletedAt: now });

    const result = await runDocumentVersionIdleSeal(db, env, { now, tenantId });
    expect(result).toMatchObject({ enabled: true, scanned: 1, sealed: 1, skipped: 0 });
    expect((await readVersion(eligible.versionId))?.sealedAt?.toISOString()).toBe(now.toISOString());
    expect((await readVersion(eligible.versionId))?.updatedAt.toISOString()).toBe(now.toISOString());
    for (const fixture of [recentOpen, nonCurrent, restore, deletedDocument, deletedVersion]) {
      expect((await readVersion(fixture.versionId))?.sealedAt).toBeNull();
    }

    const repeated = await runDocumentVersionIdleSeal(db, env, { now, tenantId });
    expect(repeated).toMatchObject({ scanned: 0, sealed: 0, skipped: 0 });
  });

  test("supports disabling and applies a stable batch limit", async () => {
    const disabledCandidate = await createCheckpointFixture();
    const disabled = await runDocumentVersionIdleSeal(
      db,
      loadServerEnv({ ...process.env, DOCUMENT_VERSION_IDLE_SEAL_SECONDS: "0" }),
      { now, tenantId },
    );
    expect(disabled).toMatchObject({ enabled: false, scanned: 0, sealed: 0 });
    expect((await readVersion(disabledCandidate.versionId))?.sealedAt).toBeNull();
    await db
      .update(documentVersions)
      .set({ sealedAt: now })
      .where(eq(documentVersions.id, disabledCandidate.versionId));

    const older = await createCheckpointFixture({ updatedAt: new Date(old.getTime() - 1_000) });
    const newer = await createCheckpointFixture({ updatedAt: old });
    const batchEnv = loadServerEnv({
      ...process.env,
      DOCUMENT_VERSION_IDLE_SEAL_SECONDS: "120",
      DOCUMENT_VERSION_IDLE_SEAL_BATCH_SIZE: "1",
    });
    const first = await runDocumentVersionIdleSeal(db, batchEnv, { now, tenantId });
    expect(first).toMatchObject({ scanned: 1, sealed: 1 });
    expect((await readVersion(older.versionId))?.sealedAt?.toISOString()).toBe(now.toISOString());
    expect((await readVersion(newer.versionId))?.sealedAt).toBeNull();

    const second = await runDocumentVersionIdleSeal(db, batchEnv, { now, tenantId });
    expect(second).toMatchObject({ scanned: 1, sealed: 1 });
    expect((await readVersion(newer.versionId))?.sealedAt?.toISOString()).toBe(now.toISOString());
  });

  test("rechecks a stale candidate after acquiring the document lock", async () => {
    const fixture = await createCheckpointFixture();
    await db
      .update(documentVersions)
      .set({ updatedAt: recent })
      .where(eq(documentVersions.id, fixture.versionId));
    const sealed = await sealIdleDocumentVersionCandidate(db, {
      id: fixture.versionId,
      documentId: fixture.documentId,
      cutoff: new Date(now.getTime() - 120_000),
      now,
      tenantId,
    });

    expect(sealed).toBeFalse();
    expect((await readVersion(fixture.versionId))?.sealedAt).toBeNull();
    expect((await readVersion(fixture.versionId))?.updatedAt.toISOString()).toBe(
      recent.toISOString(),
    );
  });

  test("starts a new open checkpoint after an idle version was sealed", async () => {
    const fixture = await createCheckpointFixture();
    const sealed = await runDocumentVersionIdleSeal(db, env, { now, tenantId });
    expect(sealed.sealed).toBe(1);

    const editedAt = new Date(now.getTime() + 1_000);
    const edited = await db.transaction((tx) =>
      materializeAutoVersion(tx, {
        tenantId,
        documentId: fixture.documentId,
        value: [{ type: "p", children: [{ text: "edited after idle" }] }],
        userId,
        now: editedAt,
      }),
    );
    expect(edited).toMatchObject({ created: true, version: { kind: "auto", versionNo: 2 } });

    const versions = await db
      .select({ sealedAt: documentVersions.sealedAt, versionNo: documentVersions.versionNo })
      .from(documentVersions)
      .where(eq(documentVersions.documentId, fixture.documentId))
      .orderBy(asc(documentVersions.versionNo));
    expect(versions).toEqual([
      { sealedAt: now, versionNo: 1 },
      { sealedAt: null, versionNo: 2 },
    ]);
  });
});
