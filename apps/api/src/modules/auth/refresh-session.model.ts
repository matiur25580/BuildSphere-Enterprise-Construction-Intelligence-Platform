import { Schema, model } from "mongoose";

const refreshSessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    familyId: { type: String, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true, index: true },
    revokedAt: { type: Date, default: null },
    replacedByTokenHash: { type: String, default: null },
    userAgent: { type: String, maxlength: 500 },
    ipAddress: { type: String, maxlength: 100 },
  },
  { timestamps: true },
);

refreshSessionSchema.index({ familyId: 1, revokedAt: 1 });
refreshSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const RefreshSession = model("RefreshSession", refreshSessionSchema);
