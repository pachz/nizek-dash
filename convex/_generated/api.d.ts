/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as chatActions from "../chatActions.js";
import type * as chatSyncInternal from "../chatSyncInternal.js";
import type * as chats from "../chats.js";
import type * as commits from "../commits.js";
import type * as crons from "../crons.js";
import type * as gitActions from "../gitActions.js";
import type * as gitRepos from "../gitRepos.js";
import type * as lib_businessDays from "../lib/businessDays.js";
import type * as lib_parse from "../lib/parse.js";
import type * as lib_softDelete from "../lib/softDelete.js";
import type * as lib_taskCode from "../lib/taskCode.js";
import type * as matchActions from "../matchActions.js";
import type * as nizekActions from "../nizekActions.js";
import type * as projects from "../projects.js";
import type * as releaseActions from "../releaseActions.js";
import type * as seed from "../seed.js";
import type * as settings from "../settings.js";
import type * as summary from "../summary.js";
import type * as summaryActions from "../summaryActions.js";
import type * as syncInternal from "../syncInternal.js";
import type * as tasks from "../tasks.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  chatActions: typeof chatActions;
  chatSyncInternal: typeof chatSyncInternal;
  chats: typeof chats;
  commits: typeof commits;
  crons: typeof crons;
  gitActions: typeof gitActions;
  gitRepos: typeof gitRepos;
  "lib/businessDays": typeof lib_businessDays;
  "lib/parse": typeof lib_parse;
  "lib/softDelete": typeof lib_softDelete;
  "lib/taskCode": typeof lib_taskCode;
  matchActions: typeof matchActions;
  nizekActions: typeof nizekActions;
  projects: typeof projects;
  releaseActions: typeof releaseActions;
  seed: typeof seed;
  settings: typeof settings;
  summary: typeof summary;
  summaryActions: typeof summaryActions;
  syncInternal: typeof syncInternal;
  tasks: typeof tasks;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
