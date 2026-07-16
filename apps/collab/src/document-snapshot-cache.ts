// 为单副本协作服务保留最近 Yjs 快照，避免房间重开重复访问远程数据库。
import type { CollabContext } from "./auth";

type SnapshotCacheKey = Pick<CollabContext, "documentId" | "tenantId">;

type SnapshotCacheEntry = {
  expiresAt: number;
  size: number;
  snapshot: Uint8Array;
};

export type DocumentSnapshotCacheOptions = {
  maxBytes?: number;
  maxEntries?: number;
  now?: () => number;
  ttlMs?: number;
};

const defaultMaxBytes = 64 * 1024 * 1024;
const defaultMaxEntries = 64;
const defaultTtlMs = 30 * 60_000;

const getCacheKey = ({ documentId, tenantId }: SnapshotCacheKey) =>
  `${tenantId}:${documentId}`;

export class DocumentSnapshotCache {
  private readonly entries = new Map<string, SnapshotCacheEntry>();
  private readonly maxBytes: number;
  private readonly maxEntries: number;
  private readonly now: () => number;
  private readonly ttlMs: number;
  private totalBytes = 0;

  constructor({
    maxBytes = defaultMaxBytes,
    maxEntries = defaultMaxEntries,
    now = Date.now,
    ttlMs = defaultTtlMs,
  }: DocumentSnapshotCacheOptions = {}) {
    this.maxBytes = Math.max(0, Math.floor(maxBytes));
    this.maxEntries = Math.max(0, Math.floor(maxEntries));
    this.now = now;
    this.ttlMs = Math.max(0, Math.floor(ttlMs));
  }

  get(context: SnapshotCacheKey) {
    const key = getCacheKey(context);
    const entry = this.entries.get(key);

    if (!entry) return null;
    const now = this.now();
    if (entry.expiresAt <= now) {
      this.remove(key, entry);
      return null;
    }

    // 热文档采用滑动过期；Map 插入顺序作为 LRU。容量和条目上限仍约束内存，
    // 保存与版本恢复路径会主动刷新或失效，因此无需固定周期回源数据库。
    entry.expiresAt = now + this.ttlMs;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.snapshot;
  }

  set(context: SnapshotCacheKey, snapshot: Uint8Array) {
    const key = getCacheKey(context);
    const existing = this.entries.get(key);
    if (existing) this.remove(key, existing);

    if (
      this.maxBytes === 0 ||
      this.maxEntries === 0 ||
      snapshot.byteLength > this.maxBytes
    ) {
      return;
    }

    const entry: SnapshotCacheEntry = {
      expiresAt: this.now() + this.ttlMs,
      size: snapshot.byteLength,
      snapshot,
    };
    this.entries.set(key, entry);
    this.totalBytes += entry.size;

    while (
      this.entries.size > this.maxEntries ||
      this.totalBytes > this.maxBytes
    ) {
      const oldest = this.entries.entries().next().value as
        | [string, SnapshotCacheEntry]
        | undefined;
      if (!oldest) break;
      this.remove(oldest[0], oldest[1]);
    }
  }

  delete(context: SnapshotCacheKey) {
    const key = getCacheKey(context);
    const entry = this.entries.get(key);
    if (entry) this.remove(key, entry);
  }

  private remove(key: string, entry: SnapshotCacheEntry) {
    if (!this.entries.delete(key)) return;
    this.totalBytes = Math.max(0, this.totalBytes - entry.size);
  }
}
