import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Centrifugo JWTs from panel expire in ~1h — rotate early
crons.interval(
  "rotate centrifugo token",
  { minutes: 45 },
  internal.nizekActions.rotateTokenInternal,
);

export default crons;
