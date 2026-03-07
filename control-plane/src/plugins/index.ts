/**
 * Plugin barrel: all Elysia plugins for the control plane.
 *
 * Each plugin is a standalone Elysia instance that can be composed
 * into the main app via `.use()`.
 */
export { dashboardPlugin } from "./dashboard.plugin";
export { healthPlugin } from "./health.plugin";
export { createModelManagementPlugin } from "./model-management.plugin";
export { createAppBuildPlugin } from "./app-build.plugin";
export { createDeviceReadinessPlugin } from "./device-readiness.plugin";
export { createFlowRoutesPlugin } from "./flow-routes.plugin";
export { createAiWorkflowPlugin } from "./ai-workflows.plugin";
export { createAiProviderManagementPlugin } from "./ai-provider-management.plugin";
export { createPreferencesPlugin } from "./preferences.plugin";
export { createUcpDiscoveryPlugin } from "./ucp-discovery.plugin";
