// 验证协作快照缓存按租户隔离，并遵守 TTL、条目和字节上限。
import { describe, expect, test } from "bun:test";

import { DocumentSnapshotCache } from "./document-snapshot-cache";

const context = (documentId: string, tenantId = "tenant-a") => ({
  documentId,
  tenantId,
});

describe("document snapshot cache", () => {
  test("keeps snapshots isolated by tenant and document", () => {
    const cache = new DocumentSnapshotCache();
    cache.set(context("document-a"), new Uint8Array([1, 2, 3]));

    expect(cache.get(context("document-a"))).toEqual(new Uint8Array([1, 2, 3]));
    expect(cache.get(context("document-b"))).toBeNull();
    expect(cache.get(context("document-a", "tenant-b"))).toBeNull();
  });

  test("uses sliding expiry and supports explicit restore invalidation", () => {
    let now = 100;
    const cache = new DocumentSnapshotCache({ now: () => now, ttlMs: 50 });
    cache.set(context("document-a"), new Uint8Array([1]));
    now = 149;
    expect(cache.get(context("document-a"))).not.toBeNull();
    now = 198;
    expect(cache.get(context("document-a"))).not.toBeNull();
    cache.delete(context("document-a"));
    expect(cache.get(context("document-a"))).toBeNull();

    cache.set(context("document-a"), new Uint8Array([2]));
    now = 247;
    expect(cache.get(context("document-a"))).not.toBeNull();
    now = 298;
    expect(cache.get(context("document-a"))).toBeNull();
  });

  test("evicts least recently used entries by count and byte size", () => {
    const cache = new DocumentSnapshotCache({ maxBytes: 5, maxEntries: 2 });
    cache.set(context("document-a"), new Uint8Array([1, 1]));
    cache.set(context("document-b"), new Uint8Array([2, 2]));
    expect(cache.get(context("document-a"))).not.toBeNull();

    cache.set(context("document-c"), new Uint8Array([3, 3]));
    expect(cache.get(context("document-b"))).toBeNull();
    expect(cache.get(context("document-a"))).not.toBeNull();
    expect(cache.get(context("document-c"))).not.toBeNull();

    cache.set(context("document-d"), new Uint8Array([4, 4, 4, 4]));
    expect(cache.get(context("document-a"))).toBeNull();
    expect(cache.get(context("document-c"))).toBeNull();
    expect(cache.get(context("document-d"))).not.toBeNull();
  });
});
