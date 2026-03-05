import {
  APP_VERSION,
  CHAT_TTS_OUTPUT_FORMATS,
  DEFAULT_CHAT_TTS_VOICE,
  DEFAULT_MODEL_SOURCE,
  LAYOUT_BREAKPOINT_LG_PX,
  MODEL_SOURCE_REGISTRY,
  OPENAI_TTS_DEFAULT_FORMAT,
} from "./config";
import { htmxSpinner, HTMX_SWAP_INNER, HTMX_SWAP_BEFOREEND } from "./htmx-helpers";
import { t, tInterp } from "./i18n";
import { ICON_CHAT, ICON_IDLE_CHAT, ICON_REFRESH, ICON_SEND } from "./icons";
import {
  BRAND_OVERRIDES_CSS_PATH,
  CONTROL_PLANE_SCRIPT_PATH,
  DAISYUI_CSS_PATH,
  HTMX_SSE_EXTENSION_SCRIPT_PATH,
  HTMX_SCRIPT_PATH,
  TAILWIND_BROWSER_SCRIPT_PATH,
} from "./runtime-constants";

/**
 * HTML Layout shell for the Vertu Control Plane dashboard.
 * Uses local HTMX, local daisyUI, and local Tailwind Browser assets.
 */
export function Layout(title: string, children: string, theme: string): string {
  const floatingChatTtsOutputOptions = CHAT_TTS_OUTPUT_FORMATS.map((value) => {
    const isDefault = value === OPENAI_TTS_DEFAULT_FORMAT;
    return `<option value="${value}"${isDefault ? " selected" : ""}>${value}</option>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="${t("layout.locale")}" data-theme="${theme}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="${t("layout.meta_description")}">
  <title>${title} | ${t("layout.page_title_suffix")}</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%23181510'/%3E%3Cpath d='M16 6l8 4v8l-8 4-8-4V10z' fill='none' stroke='%23C9A84C' stroke-width='1.5'/%3E%3Cpath d='M16 6v16M8 10l8 4 8-4' fill='none' stroke='%23C9A84C' stroke-width='1.2'/%3E%3C/svg%3E" />
  <style>
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
  </style>
  <!-- daisyui@5.5.19 (local vendored at /public/daisyui.css, no CDN) -->
  <!-- @tailwindcss/browser@4.2.1 (local vendored at /public/tailwindcss-browser.js, no CDN) -->
  <!-- htmx.org@2.0.8 (local vendored at /public/htmx.min.js, no CDN) -->
  <!-- htmx-ext-sse@2.2.4 (local vendored at /public/htmx-ext-sse.min.js, no CDN) -->
  <script src="${HTMX_SCRIPT_PATH}"></script>
  <script src="${HTMX_SSE_EXTENSION_SCRIPT_PATH}"></script>
  <link href="${DAISYUI_CSS_PATH}" rel="stylesheet" type="text/css" />
  <link href="${BRAND_OVERRIDES_CSS_PATH}" rel="stylesheet" type="text/css" />
  <script src="${TAILWIND_BROWSER_SCRIPT_PATH}"></script>
  <style>
    .htmx-indicator { display: none; }
    .htmx-request .htmx-indicator, .htmx-request.htmx-indicator { display: inline; }
    .skip-link { position: absolute; left: -9999px; z-index: 999; }
    .skip-link:focus { left: 1rem; top: 1rem; padding: 0.5rem 1rem; background: var(--color-primary); color: var(--color-primary-content); border-radius: var(--rounded-btn, 0.25rem); }
    [id$="-result"], #model-list, #providers-validation-result { transition: opacity 0.2s ease; }
    [id$="-result"].htmx-request, #model-list.htmx-request, #providers-validation-result.htmx-request { opacity: 0.5; pointer-events: none; }
    [id$="-result"].htmx-swapping, #model-list.htmx-swapping, #providers-validation-result.htmx-swapping { animation: htmx-fade-out 0.3s ease forwards; }
    [id$="-result"].htmx-settling, #model-list.htmx-settling, #providers-validation-result.htmx-settling { animation: htmx-fade-in 0.3s ease forwards; }
    @keyframes htmx-fade-out { from { opacity: 1; } to { opacity: 0; } }
    @keyframes htmx-fade-in { from { opacity: 0; } to { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) {
      [id$="-result"].htmx-swapping, #model-list.htmx-swapping, #providers-validation-result.htmx-swapping,
      [id^="chat-messages-"].htmx-swapping,
      [id$="-result"].htmx-settling, #model-list.htmx-settling, #providers-validation-result.htmx-settling,
      [id^="chat-messages-"].htmx-settling, #floating-chat-messages.htmx-settling { animation: none; }
      #floating-chat-model-state.htmx-swapping, #floating-chat-model-state.htmx-settling { animation: none; }
    }
  </style>
</head>
  <body class="min-h-screen text-base-content antialiased bg-base-200">
  <a href="#main-content" class="skip-link">${t("layout.skip_to_main")}</a>
  <div id="global-error" class="hidden fixed top-16 sm:top-20 left-2 right-2 sm:left-1/2 sm:-translate-x-1/2 sm:max-w-md sm:mx-4 z-[100] w-[calc(100%-1rem)] sm:w-full" role="alert" aria-live="assertive">
    <div class="alert alert-error shadow-lg">
      <span id="global-error-message"></span>
      <button type="button" class="btn btn-sm btn-ghost" onclick="document.getElementById('global-error').classList.add('hidden')" aria-label="${t("layout.dismiss")}">×</button>
    </div>
  </div>
  <div id="toast-container" class="toast toast-top toast-end z-[110]" aria-live="polite"></div>
  <dialog id="confirm-modal" class="modal" aria-labelledby="confirm-modal-title" aria-describedby="confirm-modal-desc" aria-modal="true">
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
    <input id="vertu-drawer" type="checkbox" class="drawer-toggle" />
    <div class="drawer-content flex flex-col min-h-screen">
      <header class="navbar bg-base-100/90 backdrop-blur-md shadow-sm border-b border-base-content/8 sticky top-0 z-50 min-h-0 shrink-0" aria-label="${t("layout.nav_main_aria")}">
        <button type="button" id="drawer-open-btn" aria-label="${t("layout.open_sidebar")}" aria-controls="vertu-drawer" aria-expanded="false" class="btn btn-ghost btn-square drawer-button lg:hidden tooltip tooltip-right" data-tip="${t("layout.open_sidebar")}" onclick="const drawer=document.getElementById('vertu-drawer'); if(drawer instanceof HTMLInputElement){drawer.checked=true; drawer.dispatchEvent(new Event('change',{bubbles:true}));}">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" /></svg>
        </button>
        <div class="flex-1">
          <a href="/" class="btn btn-ghost text-xl font-bold tracking-[0.25em] uppercase brand-text brand-text-accent" aria-label="${t("layout.home")}">VERTU EDGE</a>
        </div>
        <div class="flex-none gap-2 sm:gap-3 flex-shrink-0 flex items-center">
          ${(function () {
            const nextTheme = theme === "light" ? "dark" : theme === "dark" ? "luxury" : "light";
            const tip = nextTheme === "light" ? t("layout.theme_toggle_light") : nextTheme === "dark" ? t("layout.theme_toggle_dark") : t("layout.theme_toggle_luxury");
            const sunSvg = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>`;
            const moonSvg = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>`;
            const crownSvg = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 2l3 6h6l-4 6h1l-6 8-6-8h1L3 8h6l3-6z" /></svg>`;
            const icon = nextTheme === "light" ? sunSvg : nextTheme === "dark" ? moonSvg : crownSvg;
            return `<button type="button" class="btn btn-ghost btn-square btn-sm w-10 h-10 min-w-10 tooltip tooltip-bottom" data-tip="${tip}" aria-label="${tip}" onclick="window.location.href='/api/prefs/theme/${nextTheme}'">${icon}</button>`;
          })()}
          <!-- hx-include requires #flow-yaml and flow form fields to exist on page (e.g. Flow Engine card) -->
          <button class="btn btn-outline btn-primary btn-sm w-10 h-10 min-w-10 sm:w-auto sm:h-auto sm:min-w-0 sm:px-4 tooltip tooltip-bottom" data-tip="${t("layout.trigger_flow")}" hx-post="/api/flows/runs" hx-include="#flow-yaml, [name=target], [name=maxAttempts], [name=commandTimeoutMs], [name=retryDelayMs]" hx-target="#flow-result" hx-swap="${HTMX_SWAP_INNER}" hx-confirm="${t("layout.trigger_flow_confirm")}" hx-indicator="#trigger-flow-spinner" hx-disabled-elt="this" aria-label="${t("layout.trigger_flow")}"><svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 sm:hidden shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg><span class="hidden sm:inline">${t("layout.trigger_flow_btn")}</span>${htmxSpinner("trigger-flow-spinner")}</button>
        </div>
      </header>
      <main id="main-content" class="container mx-auto px-4 sm:px-6 py-6 max-w-6xl flex-1 min-w-0 w-full overflow-x-hidden" role="main">
        ${children}
      </main>
      <footer class="footer footer-center px-4 py-3 text-base-content/40 text-xs tracking-wide" role="contentinfo">
        <p>${t("layout.footer")} · ${new Date().getFullYear()} · v${APP_VERSION}</p>
      </footer>
    </div>
    <div class="drawer-side">
        <label for="vertu-drawer" aria-label="${t("layout.close_sidebar")}" class="drawer-overlay"></label>
      <nav class="flex flex-col p-4 w-64 min-h-full bg-base-200 text-base-content border-r border-base-content/5" aria-label="${t("layout.nav_dashboard_aria")}">
        <div class="mb-4 px-2 pb-3 border-b border-base-content/8">
          <span class="text-[10px] font-bold uppercase tracking-[0.2em] text-base-content/50">${t("dashboard.title")}</span>
        </div>
        <ul class="menu menu-sm gap-1 flex-1">
          <li class="menu-title pt-2 pb-0"><span class="text-[10px] font-semibold uppercase tracking-widest text-base-content/40">${t("dashboard.nav_on_device")}</span></li>
          <li><a href="#card-models" class="gap-3">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 opacity-70 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
            ${t("model_mgmt.title")}
          </a></li>
          <li><a href="#card-app-build" class="gap-3">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 opacity-70 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M11.42 15.17l-5.59-3.23a.42.42 0 01-.21-.36V7.12a.42.42 0 01.21-.37l5.59-3.23a.42.42 0 01.42 0l5.59 3.23a.42.42 0 01.21.37v4.46a.42.42 0 01-.21.36l-5.59 3.23a.42.42 0 01-.42 0z" /></svg>
            ${t("app_build.title")}
          </a></li>
          <li><a href="#card-flows" class="gap-3">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 opacity-70 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            ${t("flow_engine.title")}
          </a></li>
          <li class="menu-title pt-4 pb-0"><span class="text-[10px] font-semibold uppercase tracking-widest text-base-content/40">${t("dashboard.nav_optional")}</span></li>
          <li><a href="#card-ai-providers" class="gap-3">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 opacity-70 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 0 1-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 0 1 4.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0 1 12 15a9.065 9.065 0 0 0-6.23.693L5 14.5" /></svg>
            ${t("ai_providers.title")}
          </a></li>
          <li><a href="#card-preferences" class="gap-3">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 opacity-70 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            ${t("user_prefs.title")}
          </a></li>
          <li><a href="#card-ucp" class="gap-3">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 opacity-70 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            ${t("ucp.title")}
          </a></li>
        </ul>
        <div class="divider my-1"></div>
        <div class="px-2 pb-2 text-xs text-base-content/40">${tInterp("layout.app_version", { version: APP_VERSION })}</div>
      </nav>
    </div>
  </div>
  <div class="fab" id="floating-chat-fab">
    <button type="button" class="btn btn-lg btn-circle btn-primary shadow-lg" aria-label="${t("ai_providers.floating_chat_aria")}" onclick="document.getElementById('floating-chat-modal').showModal(); document.getElementById('floating-chat-provider')?.dispatchEvent(new Event('load', { bubbles: true })); setTimeout(function(){ document.getElementById('floating-chat-msg')?.focus(); }, 100);">
      ${ICON_CHAT}
    </button>
  </div>
  <dialog id="floating-chat-modal" class="modal modal-bottom sm:modal-middle" aria-labelledby="floating-chat-title" aria-modal="true">
    <div class="modal-box w-11/12 max-w-2xl max-h-[80vh] sm:max-h-[85vh] lg:ml-64 flex flex-col p-0 overflow-hidden">
      <div class="flex items-center justify-between px-4 py-2.5 border-b border-base-300 shrink-0">
        <h3 id="floating-chat-title" class="font-semibold text-base">${t("ai_providers.floating_chat")}</h3>
        <form method="dialog">
          <button type="submit" class="btn btn-xs btn-circle btn-ghost text-base" aria-label="${t("layout.dismiss")}">×</button>
        </form>
      </div>
      <div id="floating-chat-messages" class="flex-1 min-h-[6rem] max-h-60 overflow-y-auto px-4 py-3 space-y-2" role="log" aria-live="polite">
        <div id="floating-chat-placeholder" class="flex flex-col items-center gap-2 py-4 chat-placeholder">
          ${ICON_IDLE_CHAT}
          <p class="text-base-content/60 text-xs">${t("api.idle_chat_result")}</p>
        </div>
      </div>
      <div class="px-4 py-3 border-t border-base-300 shrink-0">
        <form id="floating-chat-form" hx-post="/api/ai/chat" hx-target="#floating-chat-messages" hx-swap="${HTMX_SWAP_BEFOREEND}" hx-indicator="#floating-chat-spinner" hx-disabled-elt="button, input" hx-on::before-request="document.getElementById('floating-chat-placeholder')?.classList.add('hidden')" class="space-y-3" aria-label="${t("ai_providers.floating_chat_form_aria")}">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div class="form-control">
              <label class="label py-0.5" for="floating-chat-provider"><span class="label-text text-xs">${t("ai_providers.provider")}</span></label>
              <select id="floating-chat-provider" name="provider" class="select select-bordered select-sm w-full" aria-label="${t("ai_providers.select_provider")}"
                hx-get="/api/ai/providers/options" hx-trigger="load"
                hx-target="this" hx-swap="innerHTML" required>
                <option value="" disabled selected>${t("ai_providers.loading_models")}</option>
              </select>
            </div>
            <div class="form-control">
              <label class="label py-0.5" for="floating-chat-model"><span class="label-text text-xs">${t("ai_providers.model")}</span></label>
              <div class="join w-full">
                <select id="floating-chat-model" name="model" class="select select-bordered select-sm flex-1 join-item" aria-label="${t("ai_providers.model")}"
                  hx-get="/api/ai/models" hx-trigger="change from:#floating-chat-provider" hx-include="#floating-chat-form" hx-vals='{"stateId":"floating-chat-model-state"}'
                  hx-target="this" hx-swap="innerHTML" required>
                  <option value="" disabled selected>${t("api.models_provider_required")}</option>
                </select>
                <button type="button" class="btn btn-sm btn-secondary join-item" data-tip="${t("model_mgmt.refresh")}"
                  hx-get="/api/ai/models" hx-trigger="click" hx-include="#floating-chat-form" hx-vals='{"stateId":"floating-chat-model-state"}'
                  hx-target="#floating-chat-model" hx-swap="innerHTML" hx-indicator="#floating-chat-model-refresh-spinner" hx-disabled-elt="this"
                  aria-label="${t("model_mgmt.refresh")}">${ICON_REFRESH}${htmxSpinner("floating-chat-model-refresh-spinner", "ml-1")}</button>
              </div>
            </div>
          </div>
          <div id="floating-chat-model-state" class="text-xs text-base-content/60 min-h-[1rem]" role="status" aria-live="polite" data-state="idle">${t("api.idle_model_selection")}</div>
          <div class="form-control">
            <label class="label py-0.5" for="floating-chat-msg"><span class="label-text text-xs">${t("ai_providers.message")}</span></label>
            <textarea id="floating-chat-msg" name="message" rows="2" class="textarea textarea-bordered textarea-sm w-full text-sm"
              placeholder="${t("ai_providers.floating_chat_message_placeholder")}" aria-label="${t("ai_providers.chat_message_aria")}"></textarea>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div class="form-control">
              <label class="label py-0.5" for="floating-chat-speech-mime"><span class="label-text text-xs">${t("ai_providers.floating_chat_speech_mime")}</span></label>
              <input id="floating-chat-speech-mime" name="speechInput[mimeType]" type="text" class="input input-bordered input-sm w-full"
                placeholder="${t("ai_providers.floating_chat_speech_mime_placeholder")}" aria-label="${t("ai_providers.floating_chat_speech_mime_aria")}" />
            </div>
            <div class="form-control">
              <label class="label py-0.5" for="floating-chat-speech-data"><span class="label-text text-xs">${t("ai_providers.floating_chat_speech_data")}</span></label>
              <textarea id="floating-chat-speech-data" name="speechInput[data]" rows="2" class="textarea textarea-bordered textarea-sm w-full text-sm"
                placeholder="${t("ai_providers.floating_chat_speech_data_placeholder")}" aria-label="${t("ai_providers.floating_chat_speech_data_aria")}"></textarea>
            </div>
          </div>
          <p class="text-xs text-base-content/70">${t("ai_providers.floating_chat_speech_group_hint")}</p>
          <div class="form-control">
            <label class="label cursor-pointer py-0.5 gap-2">
              <input id="floating-chat-request-tts" name="requestTts" value="true" type="checkbox" class="checkbox checkbox-sm" aria-label="${t("ai_providers.floating_chat_request_tts_aria")}" />
              <span class="label-text text-xs">${t("ai_providers.floating_chat_request_tts")}</span>
            </label>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div class="form-control">
              <label class="label py-0.5" for="floating-chat-tts-output-mime"><span class="label-text text-xs">${t("ai_providers.floating_chat_tts_output_mime")}</span></label>
              <select id="floating-chat-tts-output-mime" name="ttsOutputMimeType" class="select select-bordered select-sm w-full"
                aria-label="${t("ai_providers.floating_chat_tts_output_mime_aria")}" disabled>
                ${floatingChatTtsOutputOptions}
              </select>
            </div>
            <div class="form-control">
              <label class="label py-0.5" for="floating-chat-tts-voice"><span class="label-text text-xs">${t("ai_providers.floating_chat_tts_voice")}</span></label>
              <input id="floating-chat-tts-voice" name="ttsVoice" type="text" class="input input-bordered input-sm w-full"
                placeholder="${DEFAULT_CHAT_TTS_VOICE}" aria-label="${t("ai_providers.floating_chat_tts_voice_aria")}" disabled />
            </div>
          </div>
          <button type="submit" class="btn btn-accent btn-sm w-full" aria-label="${t("ai_providers.send_aria")}">
            ${ICON_SEND}
            ${t("ai_providers.send")}${htmxSpinner("floating-chat-spinner")}
          </button>
        </form>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop" aria-label="${t("layout.close")}">
      <button type="submit">${t("layout.close")}</button>
    </form>
  </dialog>
  <script>
    window.__VERTU_CONFIG__ = {
      errNetwork: ${JSON.stringify(t("layout.error_network"))},
      errTimeout: ${JSON.stringify(t("layout.error_timeout"))},
      errResponse: ${JSON.stringify(t("layout.error_response"))},
      validation: {
        modelRefEmpty: ${JSON.stringify(t("validation.model_ref_empty"))},
        modelRefInvalid: ${JSON.stringify(t("validation.model_ref_invalid"))},
        chatMessageOrSpeechRequired: ${JSON.stringify(t("validation.chat_message_or_speech_required"))},
        chatSpeechInputPairRequired: ${JSON.stringify(t("validation.chat_speech_input_pair_required"))},
        chatSpeechMimeInvalid: ${JSON.stringify(t("validation.chat_speech_mime_invalid"))},
        chatSpeechDataInvalid: ${JSON.stringify(t("validation.chat_speech_data_invalid"))},
        chatTtsOutputFormatRequired: ${JSON.stringify(t("validation.chat_tts_output_format_required"))},
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
