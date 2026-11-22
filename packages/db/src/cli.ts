import { fileURLToPath } from "node:url";
import { migrate } from "./migrate.js";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://postgres:dev@localhost:5433/vibe";
const migrationsDir = fileURLToPath(new URL("../migrations", import.meta.url));

const applied = await migrate(databaseUrl, migrationsDir);

console.log(applied.length > 0 ? `Applied: ${applied.join(", ")}` : "Nothing to migrate");
