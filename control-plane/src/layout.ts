import { faviconDataUri, LOGO_SVG_PATH } from "./brand";
import {
  APP_VERSION,
  DEFAULT_MODEL_SOURCE,
  LAYOUT_BREAKPOINT_LG_PX,
  MODEL_SOURCE_REGISTRY,
  SUPPORTED_THEMES,
} from "./config";
import { SUPPORTED_LOCALES, t, tInterp, type Locale } from "./i18n";
import {
  BRAND_OVERRIDES_CSS_PATH,
  CONTROL_PLANE_SCRIPT_PATH,
  DAISYUI_CSS_PATH,
  HTMX_JOB_POLL_EXTENSION_SCRIPT_PATH,
  HTMX_SSE_EXTENSION_SCRIPT_PATH,
  HTMX_SCRIPT_PATH,
  TAILWIND_BROWSER_SCRIPT_PATH,
} from "./runtime-constants";

import type { DashboardSection } from "./pages";

/** Sidebar navigation items with HTMX-driven tab routing. */
const NAV_ITEMS: ReadonlyArray<{
  section: DashboardSection;
  titleKey: string;
  icon: string;
}> = [
  {
    section: "overview",
    titleKey: "dashboard.nav_overview",
    icon: '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 opacity-70 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M3 13h8V3H3v10zm10 8h8V11h-8v10zM3 21h8v-6H3v6zm10-10h8V3h-8v8z" /></svg>',
  },
  {
    section: "runtime",
    titleKey: "dashboard.nav_runtime",
    icon: '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 opacity-70 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>',
  },
  {
    section: "build",
    titleKey: "dashboard.nav_build",
    icon: '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 opacity-70 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M11.42 15.17l-5.59-3.23a.42.42 0 01-.21-.36V7.12a.42.42 0 01.21-.37l5.59-3.23a.42.42 0 01.42 0l5.59 3.23a.42.42 0 01.21.37v4.46a.42.42 0 01-.21.36l-5.59 3.23a.42.42 0 01-.42 0z" /></svg>',
  },
  {
    section: "automation",
    titleKey: "dashboard.nav_automation",
    icon: '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 opacity-70 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>',
  },
  {
    section: "system",
    titleKey: "dashboard.nav_system",
    icon: '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 opacity-70 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>',
  },
];

function renderSidebarNav(activeSection: DashboardSection): string {
  return NAV_ITEMS.map((item) => {
    const isActive = item.section === activeSection;
    const activeClass = isActive ? "active" : "";
    const ariaCurrent = isActive ? ' aria-current="page"' : "";
    return `<li><a href="/dashboard/${item.section}" class="gap-3 ${activeClass}"${ariaCurrent}
              hx-get="/dashboard/${item.section}" hx-target="#main-content"
              hx-swap="innerHTML swap:300ms settle:200ms" hx-push-url="true">
            ${item.icon}
            ${t(item.titleKey)}
          </a></li>`;
  }).join("\n          ");
}

function renderMobileDock(activeSection: DashboardSection): string {
  const dockItems = NAV_ITEMS.slice(0, 4).map((item) => {
    const isActive = item.section === activeSection;
    const activeClass = isActive ? "dock-active" : "";
    return `<a href="/dashboard/${item.section}" class="${activeClass}"
        hx-get="/dashboard/${item.section}" hx-target="#main-content"
        hx-swap="innerHTML swap:300ms settle:200ms" hx-push-url="true"
        aria-label="${t(item.titleKey)}"${isActive ? ' aria-current="page"' : ""}>
      ${item.icon}
      <span class="dock-label">${t(item.titleKey)}</span>
    </a>`;
  });
  // Add system as 5th dock item
  const sysItem = NAV_ITEMS[4];
  if (sysItem) {
    const isActive = sysItem.section === activeSection;
    dockItems.push(`<a href="/dashboard/${sysItem.section}" class="${isActive ? "dock-active" : ""}"
        hx-get="/dashboard/${sysItem.section}" hx-target="#main-content"
        hx-swap="innerHTML swap:300ms settle:200ms" hx-push-url="true"
        aria-label="${t(sysItem.titleKey)}"${isActive ? ' aria-current="page"' : ""}>
      ${sysItem.icon}
      <span class="dock-label">${t(sysItem.titleKey)}</span>
    </a>`);
  }
  return `<div class="dock dock-sm vertu-glass lg:hidden" aria-label="${t("layout.nav_dashboard_aria")}">
    ${dockItems.join("\n    ")}
  </div>`;
}

function renderNavbarLocaleSelect(storedLocale: Locale): string {
  return `<label class="operator-topbar-control operator-topbar-control--locale" for="navbar-locale-select">
    <span class="operator-topbar-control__label">${t("user_prefs.locale")}</span>
    <select
      id="navbar-locale-select"
      class="select select-ghost select-xs operator-topbar-control__select"
      aria-label="${t("user_prefs.locale_aria")}"
      hx-post="/api/prefs"
      hx-trigger="change"
      hx-vals='js:{"locale": document.getElementById("navbar-locale-select").value}'
      hx-swap="none"
      hx-disabled-elt="this"
      hx-on::after-request="if (event.detail.successful) { window.location.reload(); }"
    >
      ${SUPPORTED_LOCALES.map((locale) => `<option value="${locale}"${locale === storedLocale ? " selected" : ""}>${t(`user_prefs.locale_${locale}`)}</option>`).join("")}
    </select>
  </label>`;
}

function renderNavbarThemeSelect(theme: string): string {
  return `<label class="operator-topbar-control" for="navbar-theme-select">
    <span class="operator-topbar-control__label">${t("user_prefs.theme")}</span>
    <select
      id="navbar-theme-select"
      class="select select-ghost select-xs operator-topbar-control__select"
      aria-label="${t("user_prefs.theme_aria")}"
      hx-post="/api/prefs"
      hx-trigger="change"
      hx-vals='js:{"theme": document.getElementById("navbar-theme-select").value}'
      hx-swap="none"
      hx-on::after-request="if (event.detail.successful) { document.documentElement.setAttribute('data-theme', this.value); }"
    >
      ${SUPPORTED_THEMES.map((th) => `<option value="${th}"${th === theme ? " selected" : ""}>${th.charAt(0).toUpperCase() + th.slice(1)}</option>`).join("")}
    </select>
  </label>`;
}

/**
 * HTML Layout shell for the Vertu Control Plane dashboard.
 * Uses local HTMX, local daisyUI, and local Tailwind Browser assets.
 */
export function Layout(
  title: string,
  children: string,
  theme: string,
  storedLocale: Locale,
  activeSection: DashboardSection = "overview",
): string {
  return `<!DOCTYPE html>
<html lang="${t("layout.locale")}" data-theme="${theme}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="${t("layout.meta_description")}">
  <title>${title} | ${t("layout.page_title_suffix")}</title>
  <link rel="icon" type="image/svg+xml" href="${faviconDataUri()}" />
  <link rel="preconnect" href="https://fonts.googleapis.com" crossorigin />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Instrument+Serif:ital@0;1&family=Syne:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <!-- daisyui@5.5.19 (local vendored at /public/daisyui.css, no CDN) -->
  <!-- @tailwindcss/browser@4.2.1 (local vendored at /public/tailwindcss-browser.js, no CDN) -->
  <!-- htmx.org@2.0.8 (local vendored at /public/htmx.min.js, no CDN) -->
  <!-- htmx-ext-sse@2.2.4 (local vendored at /public/htmx-ext-sse.min.js, no CDN) -->
  <script src="${HTMX_SCRIPT_PATH}"></script>
  <script src="${HTMX_SSE_EXTENSION_SCRIPT_PATH}"></script>
  <script src="${HTMX_JOB_POLL_EXTENSION_SCRIPT_PATH}"></script>
  <link href="${DAISYUI_CSS_PATH}" rel="stylesheet" type="text/css" />
  <link href="${BRAND_OVERRIDES_CSS_PATH}?v=${APP_VERSION}" rel="stylesheet" type="text/css" />
  <script src="${TAILWIND_BROWSER_SCRIPT_PATH}"></script>
</head>
  <body class="min-h-screen text-base-content antialiased bg-base-200" hx-boost="true">
  <a href="#main-content" class="skip-link">${t("layout.skip_to_main")}</a>
  <div id="global-error" class="hidden fixed top-16 sm:top-20 left-2 right-2 sm:left-1/2 sm:-translate-x-1/2 sm:max-w-md sm:mx-4 z-[100] w-[calc(100%-1rem)] sm:w-full" role="alert" aria-live="assertive">
    <div class="alert alert-error shadow-lg">
      <span id="global-error-message"></span>
      <button type="button" class="btn btn-sm btn-ghost" data-dismiss-target="global-error" aria-label="${t("layout.dismiss")}">×</button>
    </div>
  </div>
  <div id="toast-container" class="toast toast-top toast-end z-[110]" aria-live="polite"></div>
  <dialog id="confirm-modal" class="modal modal-bottom sm:modal-middle" aria-labelledby="confirm-modal-title" aria-describedby="confirm-modal-desc" aria-modal="true">
    <div class="modal-box">
      <h3 id="confirm-modal-title" class="font-bold text-lg">${t("layout.confirm_modal_title")}</h3>
      <p id="confirm-modal-desc" class="py-4"></p>
      <div class="modal-action gap-2">
        <button type="button" class="btn btn-ghost" id="confirm-modal-cancel">${t("layout.confirm_modal_cancel")}</button>
        <button type="button" class="btn btn-primary" id="confirm-modal-ok">${t("layout.confirm_modal_ok")}</button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop" aria-hidden="true"><button type="submit" tabindex="-1"></button></form>
  </dialog>
  <div class="drawer lg:drawer-open">
    <input id="vertu-drawer" type="checkbox" class="drawer-toggle" onchange="document.getElementById('drawer-open-btn').setAttribute('aria-expanded', this.checked)" />
    <div class="drawer-content flex flex-col min-h-screen">
      <header class="navbar vertu-glass shadow-sm border-b border-base-content/10 sticky top-0 z-50 min-h-0 shrink-0" aria-label="${t("layout.nav_main_aria")}">
        <div class="navbar-start">
          <button type="button" id="drawer-open-btn" aria-label="${t("layout.open_sidebar")}" aria-controls="vertu-drawer" aria-expanded="false" class="btn btn-ghost btn-square drawer-button lg:hidden tooltip tooltip-right" data-tip="${t("layout.open_sidebar")}" data-drawer-open="vertu-drawer">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
          <a href="/" class="btn btn-ghost gap-2 text-xl font-bold tracking-[0.25em] uppercase brand-text brand-text-accent" aria-label="${t("layout.home")}">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 shrink-0 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">${LOGO_SVG_PATH}</svg>
            VERTU EDGE
          </a>
        </div>
        <div class="navbar-end gap-2 sm:gap-3">
          <div class="operator-topbar-controls" aria-label="${t("user_prefs.title")}">
            ${renderNavbarLocaleSelect(storedLocale)}
            ${renderNavbarThemeSelect(theme)}
          </div>
          <!-- Navigate to Automation section to access the Flow Engine card -->
          <a href="/dashboard/automation" class="btn btn-outline btn-primary btn-sm w-10 h-10 min-w-10 sm:w-auto sm:h-auto sm:min-w-0 sm:px-4 tooltip tooltip-bottom" data-tip="${t("layout.trigger_flow")}" hx-get="/dashboard/automation" hx-target="#main-content" hx-swap="innerHTML swap:300ms settle:200ms" hx-push-url="true" aria-label="${t("layout.trigger_flow")}"><svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 sm:hidden shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg><span class="hidden sm:inline">${t("layout.trigger_flow_btn")}</span></a>
        </div>
      </header>
      <main id="main-content" class="container mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8 max-w-6xl flex-1 min-w-0 w-full overflow-x-hidden" role="main">
        ${children}
      </main>
      <footer class="footer footer-center sm:footer-horizontal vertu-glass px-4 py-3 text-base-content/55 text-xs tracking-wide border-t border-base-content/10" role="contentinfo">
        <p>${t("layout.footer")} · ${new Date().getFullYear()} · v${APP_VERSION}</p>
      </footer>
    </div>
    <div class="drawer-side">
        <label for="vertu-drawer" aria-label="${t("layout.close_sidebar")}" class="drawer-overlay"></label>
      <nav class="flex flex-col p-4 w-64 min-h-full vertu-glass text-base-content border-r border-base-content/10" aria-label="${t("layout.nav_dashboard_aria")}">
        <div class="mb-4 px-2 pb-3 border-b border-base-content/8">
          <span class="text-[10px] font-bold uppercase tracking-[0.2em] text-base-content/55">${t("dashboard.title")}</span>
        </div>
        <ul class="menu menu-sm gap-1 flex-1" role="tablist" aria-label="${t("dashboard.nav_stages")}">
          <li class="menu-title pt-2 pb-0"><span class="text-[10px] font-semibold uppercase tracking-widest text-base-content/55">${t("dashboard.nav_stages")}</span></li>
          ${renderSidebarNav(activeSection)}
        </ul>
        <div class="divider my-1"></div>
        <div class="px-2 pb-2 text-xs text-base-content/55">${tInterp("layout.app_version", { version: APP_VERSION })}</div>
      </nav>
    </div>
  </div>
  ${renderMobileDock(activeSection)}
  <button
    type="button"
    class="operator-workspace-bubble btn btn-primary shadow-lg fixed bottom-24 right-4 z-40 gap-2 rounded-full border border-primary/30 px-4 lg:bottom-6 lg:right-6"
    data-operator-workspace-open
    aria-label="${t("ai_providers.floating_chat_aria")}"
    title="${t("ai_providers.floating_chat")}"
  >
    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M8 10h8m-8 4h5m-7 6l-3-3.5A2 2 0 013 15.2V6a2 2 0 012-2h14a2 2 0 012 2v9.2a2 2 0 01-1 1.73L16.5 20H8z" /></svg>
    <span class="hidden sm:inline">${t("ai_providers.floating_chat")}</span>
  </button>
  <script>
    window.__VERTU_CONFIG__ = {
      errNetwork: ${JSON.stringify(t("layout.error_network"))},
      errTimeout: ${JSON.stringify(t("layout.error_timeout"))},
      errResponse: ${JSON.stringify(t("layout.error_response"))},
      validation: {
        modelRefEmpty: ${JSON.stringify(t("validation.model_ref_empty"))},
        modelRefInvalid: ${JSON.stringify(t("validation.model_ref_invalid"))},
        aiWorkflowModeRequired: ${JSON.stringify(t("validation.ai_workflow_mode_required"))},
        aiWorkflowMessageRequired: ${JSON.stringify(t("validation.ai_workflow_message_required"))},
        aiWorkflowImageSizeInvalid: ${JSON.stringify(t("validation.ai_workflow_image_size_invalid"))},
        aiWorkflowSeedInteger: ${JSON.stringify(t("validation.ai_workflow_seed_integer"))},
        aiWorkflowStepsRange: ${JSON.stringify(t("validation.ai_workflow_steps_range"))},
        flowYamlEmpty: ${JSON.stringify(t("validation.flow_yaml_empty"))},
        ucpUrlEmpty: ${JSON.stringify(t("validation.ucp_url_empty"))},
        ucpUrlInvalid: ${JSON.stringify(t("validation.ucp_url_invalid"))},
        keyRequired: ${JSON.stringify(t("api.key_required"))},
        baseUrlInvalid: ${JSON.stringify(t("api.base_url_invalid_short"))},
        appBuildPlatform: ${JSON.stringify(t("validation.app_build_platform"))},
      },
      defaultModelSource: ${JSON.stringify(DEFAULT_MODEL_SOURCE)},
      modelSources: ${JSON.stringify(MODEL_SOURCE_REGISTRY.map((source) => ({
        id: source.id,
        modelRefValidation: source.modelRefValidation,
        canonicalHost: source.canonicalHost ?? null,
      })))},
      confirmModalDefault: ${JSON.stringify(t("layout.confirm_modal_default"))},
      layoutBreakpointLgPx: ${LAYOUT_BREAKPOINT_LG_PX},
    };
  </script>
  <script src="${CONTROL_PLANE_SCRIPT_PATH}"></script>
</body>
</html>`;
}
