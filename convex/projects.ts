import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("projects").take(100);
  },
});

export const setEnabled = mutation({
  args: {
    nizekId: v.string(),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db
      .query("projects")
      .withIndex("by_nizekId", (q) => q.eq("nizekId", args.nizekId))
      .unique();
    if (!project) throw new Error("Project not found");
    await ctx.db.patch(project._id, { enabled: args.enabled });
  },
});

export const setAllEnabled = mutation({
  args: { enabled: v.boolean() },
  handler: async (ctx, args) => {
    const projects = await ctx.db.query("projects").take(100);
    for (const p of projects) {
      await ctx.db.patch(p._id, { enabled: args.enabled });
    }
  },
});
