export type DocumentIndexingJob = {
  documentId: string;
  reason: "collab_store" | "manual_version" | "status_change";
};

export async function enqueueDocumentIndexing(job: DocumentIndexingJob) {
  console.info(`document indexing queued: ${job.documentId} (${job.reason})`);
}
