// 在内存镜像 Y.Doc 中按认证 actor 收集变化批次，并为持久化提供可回滚的 drain 边界。
import type { DocumentDiscussionList } from "@sharebrain/contracts";
import { yTextToSlateElement } from "@slate-yjs/core";
import * as Y from "yjs";

import type { CollabContext } from "./auth";
import { readDocumentReviewDiscussions } from "./document-store";

export type DocumentActivityBatch = {
  id: string;
  context: CollabContext;
  startedAt: Date;
  occurredAt: Date;
  beforeValue: unknown[];
  afterValue: unknown[];
  beforeDiscussions: DocumentDiscussionList | null;
  afterDiscussions: DocumentDiscussionList | null;
};

type ActiveBatch = {
  context: CollabContext;
  startedAt: Date;
  occurredAt: Date;
  beforeValue: unknown[];
  beforeDiscussions: DocumentDiscussionList | null;
};

type TrackerState = {
  mirror: Y.Doc;
  currentValue: unknown[];
  currentDiscussions: DocumentDiscussionList | null;
  active: ActiveBatch | null;
  pending: DocumentActivityBatch[];
  inFlight: Map<string, DocumentActivityBatch[]>;
};

export type DocumentActivityDrain = {
  token: string;
  batches: DocumentActivityBatch[];
};

function readValue(document: Y.Doc) {
  return structuredClone(yTextToSlateElement(document.get("content", Y.XmlText)).children);
}

function readDiscussions(document: Y.Doc) {
  const discussions = readDocumentReviewDiscussions(document);
  return discussions === null ? null : structuredClone(discussions);
}

function cloneDocument(document: Y.Doc) {
  const mirror = new Y.Doc();
  Y.applyUpdate(mirror, Y.encodeStateAsUpdate(document));
  return mirror;
}

function sameState(left: Y.Doc, right: Y.Doc) {
  const leftVector = Y.encodeStateVector(left);
  const rightVector = Y.encodeStateVector(right);
  if (leftVector.byteLength !== rightVector.byteLength) return false;
  return leftVector.every((byte, index) => byte === rightVector[index]);
}

function isCollabContext(value: unknown): value is CollabContext {
  if (!value || typeof value !== "object") return false;
  const context = value as Partial<CollabContext>;
  return Boolean(context.userId && context.tenantId && context.documentId && context.role);
}

export class DocumentActivityTracker {
  private readonly states = new Map<string, TrackerState>();

  initialize(documentName: string, document: Y.Doc) {
    const mirror = cloneDocument(document);
    this.states.set(documentName, {
      mirror,
      currentValue: readValue(mirror),
      currentDiscussions: readDiscussions(mirror),
      active: null,
      pending: [],
      inFlight: new Map(),
    });
  }

  capture(input: {
    documentName: string;
    document: Y.Doc;
    context: unknown;
    update: Uint8Array;
    now?: Date;
  }) {
    const state = this.states.get(input.documentName);
    if (!state) {
      this.initialize(input.documentName, input.document);
      return;
    }
    const now = input.now ?? new Date();

    if (!isCollabContext(input.context)) {
      this.finishActive(state);
      Y.applyUpdate(state.mirror, input.update);
      state.currentValue = readValue(state.mirror);
      state.currentDiscussions = readDiscussions(state.mirror);
      return;
    }

    if (state.active && state.active.context.userId !== input.context.userId) {
      this.finishActive(state);
    }
    if (!state.active) {
      state.active = {
        context: input.context,
        startedAt: now,
        occurredAt: now,
        beforeValue: structuredClone(state.currentValue),
        beforeDiscussions:
          state.currentDiscussions === null ? null : structuredClone(state.currentDiscussions),
      };
    }

    Y.applyUpdate(state.mirror, input.update);
    state.active.occurredAt = now;
  }

  beginDrain(documentName: string, authoritativeDocument: Y.Doc): DocumentActivityDrain | null {
    const state = this.states.get(documentName);
    if (!state) return null;
    this.finishActive(state);
    if (!sameState(state.mirror, authoritativeDocument)) {
      const mirror = cloneDocument(authoritativeDocument);
      state.mirror.destroy();
      state.mirror = mirror;
      state.currentValue = readValue(mirror);
      state.currentDiscussions = readDiscussions(mirror);
    }
    if (state.pending.length === 0) return null;

    const token = crypto.randomUUID();
    const batches = state.pending;
    state.pending = [];
    state.inFlight.set(token, batches);
    return { token, batches };
  }

  commitDrain(documentName: string, token: string) {
    this.states.get(documentName)?.inFlight.delete(token);
  }

  rollbackDrain(documentName: string, token: string) {
    const state = this.states.get(documentName);
    const batches = state?.inFlight.get(token);
    if (!state || !batches) return;
    state.inFlight.delete(token);
    state.pending = [...batches, ...state.pending];
  }

  remove(documentName: string) {
    const state = this.states.get(documentName);
    state?.mirror.destroy();
    this.states.delete(documentName);
  }

  private finishActive(state: TrackerState) {
    if (!state.active) return;
    const afterValue = readValue(state.mirror);
    const afterDiscussions = readDiscussions(state.mirror);
    state.pending.push({
      id: crypto.randomUUID(),
      context: state.active.context,
      startedAt: state.active.startedAt,
      occurredAt: state.active.occurredAt,
      beforeValue: state.active.beforeValue,
      afterValue,
      beforeDiscussions: state.active.beforeDiscussions,
      afterDiscussions,
    });
    state.currentValue = structuredClone(afterValue);
    state.currentDiscussions =
      afterDiscussions === null ? null : structuredClone(afterDiscussions);
    state.active = null;
  }
}
