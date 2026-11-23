import { Schema, model } from "mongoose";

const documentStorageInventoryStateSchema = new Schema({
  _id: { type: String, required: true },
  cursor: { type: String },
  leaseToken: { type: String },
  leaseUntil: { type: Date, index: true },
}, { timestamps: true, versionKey: false });

export const DocumentStorageInventoryState = model("DocumentStorageInventoryState", documentStorageInventoryStateSchema, "document_storage_inventory_state");
