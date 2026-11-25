// Actions for the Muse Office artifact.
//
// Data model: four tables (status_entries, pipeline_items, desks,
// inbox_items). The client reads everything through getOffice. Muse (the
// user's agent) updates the wall after real-world checks via the update*
// actions; seedOffice loads the verified 2026-11-09 snapshot exactly once.

import { defineAction, z, type ActionsModule } from "@hatch/space-sdk";
import { asc, eq } from "drizzle-orm";
import * as schema from "./schema";

const statusEntryOut = z.object({
  id: z.number(),
  kind: z.string(),
  title: z.string(),
  detail: z.string(),
  is_headline: z.boolean(),
  updated_at: z.string(),
});

const pipelineOut = z.object({
  id: z.number(),
  title: z.string(),
  platform: z.string(),
  stage: z.string(),
  missing: z.string(),
  note: z.string(),
  updated_at: z.string(),
});

const deskOut = z.object({
  id: z.number(),
  name: z.string(),
  subtitle: z.string(),
  metrics: z.string(),
  next_step: z.string(),
  updated_at: z.string(),
});

const verdictEnum = z.enum(["pending", "approved", "redo", "dropped"]);

const inboxOut = z.object({
  id: z.number(),
  title: z.string(),
  stakes: z.string(),
  since: z.string(),
  decided: z.boolean(),
  verdict: verdictEnum,
  updated_at: z.string(),
});

// Pending waits first, then redo, approved, dropped.
const VERDICT_RANK: Record<z.infer<typeof verdictEnum>, number> = {
  pending: 0,
  redo: 1,
  approved: 2,
  dropped: 3,
};

const officeResponse = z.object({
  status: z.array(statusEntryOut),
  pipeline: z.array(pipelineOut),
  desks: z.array(deskOut),
  inbox: z.array(inboxOut),
});

const okResponse = z.object({ ok: z.literal(true) });

const seedResponse = z.object({ seeded: z.boolean() });

export const Actions = {
  getOffice: defineAction({
    description:
      "Returns the full office state: status wall entries, publishing pipeline, business desks, and the decision inbox.",
    request: z.object({}),
    response: officeResponse,
    async handler(ctx): Promise<z.infer<typeof officeResponse>> {
      const db = ctx.db<typeof schema>();
      const [status, pipeline, deskRows, inbox] = await Promise.all([
        db
          .select()
          .from(schema.statusEntries)
          .orderBy(asc(schema.statusEntries.sort), asc(schema.statusEntries.id)),
        db
          .select()
          .from(schema.pipelineItems)
          .orderBy(asc(schema.pipelineItems.sort), asc(schema.pipelineItems.id)),
        db
          .select()
          .from(schema.desks)
          .orderBy(asc(schema.desks.sort), asc(schema.desks.id)),
        db.select().from(schema.inboxItems),
      ]);
      return {
        status: status.map((r) => ({
          id: r.id,
          kind: r.kind,
          title: r.title,
          detail: r.detail,
          is_headline: r.isHeadline === 1,
          updated_at: r.updatedAt.toISOString(),
        })),
        pipeline: pipeline.map((r) => ({
          id: r.id,
          title: r.title,
          platform: r.platform,
          stage: r.stage,
          missing: r.missing,
          note: r.note,
          updated_at: r.updatedAt.toISOString(),
        })),
        desks: deskRows.map((r) => ({
          id: r.id,
          name: r.name,
          subtitle: r.subtitle,
          metrics: r.metrics,
          next_step: r.nextStep,
          updated_at: r.updatedAt.toISOString(),
        })),
        inbox: [...inbox]
          .sort(
            (a, b) =>
              VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict] ||
              a.sort - b.sort ||
              a.id - b.id,
          )
          .map((r) => ({
            id: r.id,
            title: r.title,
            stakes: r.stakes,
            since: r.since,
            decided: r.decided === 1,
            verdict: r.verdict,
            updated_at: r.updatedAt.toISOString(),
          })),
      };
    },
  }),

  seedOffice: defineAction({
    description:
      "Seeds the office with the verified 2026-11-09 snapshot. No-op when any table already has rows, so it never overwrites later edits.",
    request: z.object({
      status: z.array(
        z.object({
          kind: z.string(),
          title: z.string(),
          detail: z.string().default(""),
          is_headline: z.boolean().default(false),
        }),
      ),
      pipeline: z.array(
        z.object({
          title: z.string(),
          platform: z.string(),
          stage: z.string(),
          missing: z.string().default(""),
          note: z.string().default(""),
        }),
      ),
      desks: z.array(
        z.object({
          name: z.string(),
          subtitle: z.string().default(""),
          metrics: z.string(),
          next_step: z.string(),
        }),
      ),
      inbox: z.array(
        z.object({
          title: z.string(),
          stakes: z.string(),
          since: z.string().default(""),
        }),
      ),
    }),
    response: seedResponse,
    async handler(ctx, args): Promise<z.infer<typeof seedResponse>> {
      const db = ctx.db<typeof schema>();
      const existing = await db
        .select({ id: schema.statusEntries.id })
        .from(schema.statusEntries)
        .limit(1);
      if (existing.length > 0) {
        return { seeded: false };
      }
      const now = new Date();
      await db.batch([
        db.insert(schema.statusEntries).values(
          args.status.map((s, i) => ({
            kind: s.kind,
            title: s.title,
            detail: s.detail,
            isHeadline: s.is_headline ? 1 : 0,
            sort: i,
            updatedAt: now,
          })),
        ),
        db.insert(schema.pipelineItems).values(
          args.pipeline.map((p, i) => ({
            title: p.title,
            platform: p.platform,
            stage: p.stage,
            missing: p.missing,
            note: p.note,
            sort: i,
            updatedAt: now,
          })),
        ),
        db.insert(schema.desks).values(
          args.desks.map((d, i) => ({
            name: d.name,
            subtitle: d.subtitle,
            metrics: d.metrics,
            nextStep: d.next_step,
            sort: i,
            updatedAt: now,
          })),
        ),
        db.insert(schema.inboxItems).values(
          args.inbox.map((it, i) => ({
            title: it.title,
            stakes: it.stakes,
            since: it.since,
            decided: 0,
            sort: i,
            updatedAt: now,
          })),
        ),
      ]);
      ctx.invalidateQueries();
      return { seeded: true };
    },
  }),

  decideInboxItem: defineAction({
    description:
      "Marks one decision-inbox item as approved (or reopens it to pending), persisting the state. Kept for compatibility; setInboxVerdict covers all three verdicts.",
    request: z.object({
      id: z.number().int().positive(),
      decided: z.boolean(),
    }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      await db
        .update(schema.inboxItems)
        .set({
          decided: args.decided ? 1 : 0,
          verdict: args.decided ? "approved" : "pending",
          updatedAt: new Date(),
        })
        .where(eq(schema.inboxItems.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  setInboxVerdict: defineAction({
    description:
      "Records the boss's verdict on one decision-inbox item: approved （拍板通过）, redo （打回重做）, dropped （去掉）, or back to pending. Reopening works from any verdict, including dropped.",
    request: z.object({
      id: z.number().int().positive(),
      verdict: verdictEnum,
    }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      await db
        .update(schema.inboxItems)
        .set({
          verdict: args.verdict,
          decided: args.verdict === "approved" ? 1 : 0,
          updatedAt: new Date(),
        })
        .where(eq(schema.inboxItems.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  updateStatus: defineAction({
    description:
      "Replaces the status wall entries of one kind (working, scheduled, or done) with a fresh list, e.g. after Muse finishes a round of checks.",
    request: z.object({
      kind: z.enum(["working", "scheduled", "done"]),
      entries: z.array(
        z.object({
          title: z.string().min(1),
          detail: z.string().default(""),
          is_headline: z.boolean().default(false),
        }),
      ),
    }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      const now = new Date();
      await db
        .delete(schema.statusEntries)
        .where(eq(schema.statusEntries.kind, args.kind));
      if (args.entries.length > 0) {
        await db.insert(schema.statusEntries).values(
          args.entries.map((e, i) => ({
            kind: args.kind,
            title: e.title,
            detail: e.detail,
            isHeadline: e.is_headline ? 1 : 0,
            sort: i,
            updatedAt: now,
          })),
        );
      }
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  upsertPipelineItem: defineAction({
    description:
      "Creates or updates one publishing-pipeline item (title, platform, stage, what is missing, note).",
    request: z.object({
      id: z.number().int().positive().optional(),
      title: z.string().min(1),
      platform: z.string().min(1),
      stage: z.string().min(1),
      missing: z.string().default(""),
      note: z.string().default(""),
      sort: z.number().int().default(0),
    }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      if (args.id) {
        await db
          .update(schema.pipelineItems)
          .set({
            title: args.title,
            platform: args.platform,
            stage: args.stage,
            missing: args.missing,
            note: args.note,
            sort: args.sort,
            updatedAt: new Date(),
          })
          .where(eq(schema.pipelineItems.id, args.id));
        ctx.invalidateQueries();
        return { id: args.id };
      }
      const result = await db
        .insert(schema.pipelineItems)
        .values({
          title: args.title,
          platform: args.platform,
          stage: args.stage,
          missing: args.missing,
          note: args.note,
          sort: args.sort,
        })
        .returning({ id: schema.pipelineItems.id });
      const inserted = result[0];
      if (!inserted) throw new Error("upsertPipelineItem: insert returned no rows");
      ctx.invalidateQueries();
      return { id: inserted.id };
    },
  }),

  deletePipelineItem: defineAction({
    description: "Removes one publishing-pipeline item by id.",
    request: z.object({ id: z.number().int().positive() }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      await db
        .delete(schema.pipelineItems)
        .where(eq(schema.pipelineItems.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  upsertDesk: defineAction({
    description:
      "Creates or updates one business desk (name, key metrics line, next step).",
    request: z.object({
      id: z.number().int().positive().optional(),
      name: z.string().min(1),
      subtitle: z.string().default(""),
      metrics: z.string().min(1),
      next_step: z.string().min(1),
      sort: z.number().int().default(0),
    }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      if (args.id) {
        await db
          .update(schema.desks)
          .set({
            name: args.name,
            subtitle: args.subtitle,
            metrics: args.metrics,
            nextStep: args.next_step,
            sort: args.sort,
            updatedAt: new Date(),
          })
          .where(eq(schema.desks.id, args.id));
        ctx.invalidateQueries();
        return { id: args.id };
      }
      const result = await db
        .insert(schema.desks)
        .values({
          name: args.name,
          subtitle: args.subtitle,
          metrics: args.metrics,
          nextStep: args.next_step,
          sort: args.sort,
        })
        .returning({ id: schema.desks.id });
      const inserted = result[0];
      if (!inserted) throw new Error("upsertDesk: insert returned no rows");
      ctx.invalidateQueries();
      return { id: inserted.id };
    },
  }),

  addInboxItem: defineAction({
    description:
      "Adds a new item to the decision inbox with its stakes note.",
    request: z.object({
      title: z.string().min(1),
      stakes: z.string().min(1),
      since: z.string().default(""),
      sort: z.number().int().default(99),
    }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const result = await db
        .insert(schema.inboxItems)
        .values({
          title: args.title,
          stakes: args.stakes,
          since: args.since,
          decided: 0,
          sort: args.sort,
        })
        .returning({ id: schema.inboxItems.id });
      const inserted = result[0];
      if (!inserted) throw new Error("addInboxItem: insert returned no rows");
      ctx.invalidateQueries();
      return { id: inserted.id };
    },
  }),
} satisfies ActionsModule;
