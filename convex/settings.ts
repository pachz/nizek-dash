import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const get = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", "main"))
      .unique();
  },
});

export const saveCookie = mutation({
  args: {
    cookieHeader: v.string(),
    deviceId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", "main"))
      .unique();
    const cookieHeader = args.cookieHeader.trim();
    if (existing) {
      await ctx.db.patch(existing._id, {
        cookieHeader,
        deviceId: args.deviceId ?? existing.deviceId,
        lastError: undefined,
      });
      return existing._id;
    }
    return await ctx.db.insert("settings", {
      key: "main",
      cookieHeader,
      deviceId: args.deviceId ?? crypto.randomUUID(),
    });
  },
});

export const clearCookie = mutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", "main"))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        cookieHeader: undefined,
        centrifugoToken: undefined,
        centrifugoExpiresAt: undefined,
        lastError: undefined,
      });
    }
  },
});
