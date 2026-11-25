import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Status wall entries. kind: "working" | "scheduled" | "done".
// Working entries with isHeadline = 1 surface as the headline item.
export const statusEntries = sqliteTable("status_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  detail: text("detail").notNull().default(""),
  isHeadline: integer("is_headline").notNull().default(0),
  sort: integer("sort").notNull().default(0),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const pipelineItems = sqliteTable("pipeline_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  platform: text("platform").notNull(),
  stage: text("stage").notNull(),
  missing: text("missing").notNull().default(""),
  note: text("note").notNull().default(""),
  sort: integer("sort").notNull().default(0),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const desks = sqliteTable("desks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  subtitle: text("subtitle").notNull().default(""),
  metrics: text("metrics").notNull(),
  nextStep: text("next_step").notNull(),
  sort: integer("sort").notNull().default(0),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Verdict is the boss's three-way call on an inbox item (2026-11-12):
// "pending" (waiting), "approved" (拍板通过), "redo" (打回重做),
// "dropped" (去掉，不做了). `decided` stays as a legacy mirror of
// verdict === "approved" for older readers.
export const inboxItems = sqliteTable("inbox_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  stakes: text("stakes").notNull(),
  since: text("since").notNull().default(""),
  decided: integer("decided").notNull().default(0),
  verdict: text("verdict", {
    enum: ["pending", "approved", "redo", "dropped"],
  })
    .notNull()
    .default("pending"),
  sort: integer("sort").notNull().default(0),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});
