import { initDb, seedDefaults } from "./db";
import { createControlPlaneApp } from "./app";
import { DEFAULT_CHAT_MODEL, DEFAULT_THEME, resolveControlPlanePort } from "./config";
import { DEFAULT_LOCALE } from "./i18n";
import { logger } from "./logger";
import { recoverStaleModelPullJobs } from "./model-manager";
import { startHousekeeping, stopHousekeeping } from "./housekeeping";
import { captureResultAsync, normalizeFailureMessage } from "../../shared/failure";

const startupResult = await captureResultAsync(async () => {
  initDb();
  seedDefaults({ theme: DEFAULT_THEME, defaultModel: DEFAULT_CHAT_MODEL, locale: DEFAULT_LOCALE });

  const recoveredCount = recoverStaleModelPullJobs();
  if (recoveredCount > 0) {
    logger.warn("Recovered stale model pull jobs on startup", { count: recoveredCount });
  }

  startHousekeeping();

  const app = createControlPlaneApp();
  app.listen(resolveControlPlanePort());

  logger.info("Vertu Control Plane started", {
    host: app.server?.hostname ?? "0.0.0.0",
    port: app.server?.port ?? 0,
  });

  const shutdown = () => {
    logger.info("Shutting down Vertu Control Plane");
    stopHousekeeping();
    void app.stop().finally(() => process.exit(0));
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}, (failure) => normalizeFailureMessage(failure, "Startup failed."));

if (!startupResult.ok) {
  logger.error("Startup failed", { error: startupResult.error });
  process.exit(1);
}
