import { initDb } from "./db";
import { createControlPlaneApp } from "./app";
import { resolveControlPlanePort } from "./config";
import { logger } from "./logger";

initDb();

const app = createControlPlaneApp();
app.listen(resolveControlPlanePort());

logger.info("Vertu Control Plane started", {
  host: app.server?.hostname ?? "0.0.0.0",
  port: app.server?.port ?? 0,
});
