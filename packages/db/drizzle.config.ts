import { defineConfig } from "drizzle-kit";

export default defineConfig({
    schema: "./src/schema/index.ts",
    out: "./drizzle",
    dialect: "postgresql",
    dbCredentials: {
        url: process.env.DATABASE_URL ?? "postgres://oj:oj@localhost:5432/oj",
    },
    casing: "snake_case",
});
