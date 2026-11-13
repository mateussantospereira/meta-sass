import "drizzle-orm/sqlite-core";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle",
  schema: "./src/db/schema.ts",
  driver: "better-sqlite3",
});