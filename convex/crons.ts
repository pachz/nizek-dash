import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Centrifugo JWTs from panel expire in ~1h — rotate early
crons.interval(
  "rotate centrifugo token",
  { minutes: 45 },
  internal.nizekActions.rotateTokenInternal,
);

// Refresh projects & tasks from panel (also rotates JWT inside syncAll)
crons.interval(
  "sync projects and tasks",
  { minutes: 10 },
  internal.nizekActions.syncAllInternal,
);

// Pull GitHub commits for enabled repos (60d window, incremental)
crons.interval(
  "sync git commits",
  { minutes: 30 },
  internal.gitActions.syncCommitsInternal,
);

// Heuristic + AI match new unmatched commits to tasks
crons.interval(
  "match commits to tasks",
  { minutes: 60 },
  internal.matchActions.runMatchingInternal,
);

// Pull Panel chats (threads + latest messages)
crons.interval(
  "sync panel chats",
  { minutes: 2 },
  internal.chatActions.syncChatsInternal,
);

export default crons;
