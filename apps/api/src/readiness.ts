export type ReadinessDependencies = {
  mongodbReady: boolean;
  documentStorageCheck: () => Promise<void>;
};

export type ReadinessResult = {
  ready: boolean;
  mongodb: "connected" | "disconnected";
  documentStorage: "available" | "unavailable";
};

/** Evaluate the dependencies required before this API can receive production traffic. */
export const evaluateReadiness = async ({
  mongodbReady,
  documentStorageCheck,
}: ReadinessDependencies): Promise<ReadinessResult> => {
  let storageReady = false;
  try {
    await documentStorageCheck();
    storageReady = true;
  } catch {
    // Keep provider details private; readiness exposes only an availability state.
  }

  return {
    ready: mongodbReady && storageReady,
    mongodb: mongodbReady ? "connected" : "disconnected",
    documentStorage: storageReady ? "available" : "unavailable",
  };
};
