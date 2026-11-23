import "dotenv/config";
import mongoose from "mongoose";

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error("MONGODB_URI must be configured");

const collections = [
  { name: "projects", field: "budget" },
  { name: "costcodes", field: "budget" },
  { name: "commercialrecords", field: "amount" },
];

const migrate = async () => {
  await mongoose.connect(uri);
  try {
    for (const { name, field } of collections) {
      const collection = mongoose.connection.collection(name);
      const result = await collection.updateMany(
        { [field]: { $exists: true } },
        [{ $set: { [field]: { $toDecimal: { $toString: `$${field}` } } } }],
      );
      const remaining = await collection.countDocuments({
        [field]: { $exists: true },
        $expr: { $ne: [{ $type: `$${field}` }, "decimal"] },
      });
      if (remaining > 0) {
        throw new Error(`Migration incomplete for ${name}.${field}: ${remaining} non-decimal values remain`);
      }
      console.info(`${name}.${field}: matched ${result.matchedCount}, converted ${result.modifiedCount}`);
    }
    console.info("Financial Decimal128 migration completed. Re-running is safe.");
  } finally {
    await mongoose.disconnect();
  }
};

migrate().catch((error) => {
  console.error("Financial Decimal128 migration failed:", error);
  process.exitCode = 1;
});
