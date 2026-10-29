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

export default crons;
