import { DocumentAsset } from "./document-asset.model.js";
import { DocumentUploadSession } from "./document-upload-session.model.js";
import { deleteDocumentObject } from "./document-storage.js";

const BATCH_SIZE = 50;
const COMPLETING_GRACE_MS = 60 * 60 * 1000;
const CLEANUP_RETRY_MS = 15 * 60 * 1000;

export type UploadCleanupResult = { examined: number; cleaned: number; retained: number };

export const reconcileExpiredDocumentUploads = async (now = new Date()): Promise<UploadCleanupResult> => {
  const completingBefore = new Date(now.getTime() - COMPLETING_GRACE_MS);
  const retryBefore = new Date(now.getTime() - CLEANUP_RETRY_MS);
  const candidates = await DocumentUploadSession.find({
    $or: [
      { status: "uploading", expiresAt: { $lte: now } },
      { status: "completing", updatedAt: { $lte: completingBefore } },
      { status: "cleaning", updatedAt: { $lte: retryBefore } },
    ],
  }).sort({ updatedAt: 1 }).limit(BATCH_SIZE).select("_id parts finalStorageKey status").lean();

  let cleaned = 0;
  let retained = 0;
  for (const candidate of candidates) {
    const claimed = await DocumentUploadSession.findOneAndUpdate(
      {
        _id: candidate._id,
        $or: [
          { status: "uploading", expiresAt: { $lte: now } },
          { status: "completing", updatedAt: { $lte: completingBefore } },
          { status: "cleaning", updatedAt: { $lte: retryBefore } },
        ],
      },
      { $set: { status: "cleaning" } },
      { new: true },
    ).lean();
    if (!claimed) continue;

    try {
      for (const part of claimed.parts) await deleteDocumentObject(part.storageKey);
      if (claimed.finalStorageKey) {
        const referenced = await DocumentAsset.exists({ storageKey: claimed.finalStorageKey });
        if (!referenced) await deleteDocumentObject(claimed.finalStorageKey);
      }
      await DocumentUploadSession.deleteOne({ _id: claimed._id, status: "cleaning" });
      cleaned += 1;
    } catch (error) {
      retained += 1;
      await DocumentUploadSession.updateOne({ _id: claimed._id, status: "cleaning" }, { $set: { updatedAt: new Date() } }).catch(() => undefined);
      console.error("Document upload cleanup failed; session retained for retry", { uploadSessionId: String(claimed._id), error });
    }
  }
  return { examined: candidates.length, cleaned, retained };
};

export const startDocumentUploadCleanupWorker = () => {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await reconcileExpiredDocumentUploads();
    } catch (error) {
      console.error("Document upload cleanup cycle failed", error);
    } finally {
      running = false;
    }
  };
  void run();
  const timer = setInterval(() => void run(), 5 * 60 * 1000);
  timer.unref();
  return () => clearInterval(timer);
};
