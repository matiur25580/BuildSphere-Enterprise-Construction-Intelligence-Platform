export type ReadinessDependencies = {
  mongodbReady: boolean;
  collaborationTransactionsReady: boolean;
  documentStorageCheck: () => Promise<void>;
  clamavCheck: () => Promise<boolean>;
};

export type ReadinessResult = {
  ready: boolean;
  mongodb: "connected" | "disconnected";
  collaborationOutboxTransactions: "enabled" | "unavailable";
  clamav: "available" | "unavailable";
  documentStorage: "available" | "unavailable";
};

/** Evaluate every dependency required before this API can receive production traffic. */
export const evaluateReadiness = async ({
  mongodbReady,
  collaborationTransactionsReady,
  documentStorageCheck,
  clamavCheck,
}: ReadinessDependencies): Promise<ReadinessResult> => {
  const [storageResult, clamavResult] = await Promise.allSettled([
    documentStorageCheck(),
    clamavCheck(),
  ]);
  const storageReady = storageResult.status === "fulfilled";
  const clamavReady = clamavResult.status === "fulfilled" && clamavResult.value;

  return {
    ready: mongodbReady && collaborationTransactionsReady && storageReady && clamavReady,
    mongodb: mongodbReady ? "connected" : "disconnected",
    collaborationOutboxTransactions: collaborationTransactionsReady ? "enabled" : "unavailable",
    clamav: clamavReady ? "available" : "unavailable",
    documentStorage: storageReady ? "available" : "unavailable",
  };
};
