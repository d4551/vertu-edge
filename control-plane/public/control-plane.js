/**
 * Control Plane client-side script: HTMX extensions, validation, error handling, confirm modal, toast cleanup.
 * Expects window.__VERTU_CONFIG__ to be set before this script loads (injected by layout).
 */
if (typeof htmx !== "undefined") {
  htmx.defineExtension("fade-swap", {
    isInlineSwap: function (swapStyle) {
      return swapStyle === "fade";
    },
    handleSwap: function (swapStyle, target, fragment, settleInfo) {
      if (swapStyle !== "fade") return false;
      target.style.opacity = "0";
      setTimeout(function () {
        target.innerHTML = "";
        Array.from(fragment.children).forEach(function (c) {
          target.appendChild(c);
        });
        target.style.opacity = "1";
      }, 300);
      return true;
    },
  });
}

(function () {
  "use strict";
  const CONFIG = window.__VERTU_CONFIG__ || {};
  const ERR_NETWORK = CONFIG.errNetwork || "Network error";
  const ERR_TIMEOUT = CONFIG.errTimeout || "Request timed out";
  const ERR_RESPONSE = CONFIG.errResponse || "Request failed";
  const MSG = CONFIG.validation || {};
  const CONFIRM_DEFAULT = CONFIG.confirmModalDefault || "Continue?";
  const BREAKPOINT_LG = typeof CONFIG.layoutBreakpointLgPx === "number" ? CONFIG.layoutBreakpointLgPx : 1024;
  const MODEL_SOURCE_REGISTRY = Array.isArray(CONFIG.modelSources) ? CONFIG.modelSources : [];
  const DEFAULT_MODEL_SOURCE =
    typeof CONFIG.defaultModelSource === "string" && CONFIG.defaultModelSource.trim()
      ? CONFIG.defaultModelSource.trim().toLowerCase()
      : ((MODEL_SOURCE_REGISTRY[0] || {}).id || "");
  const DEFAULT_SOURCE_META =
    MODEL_SOURCE_REGISTRY.find((entry) => entry && entry.id === DEFAULT_MODEL_SOURCE) ||
    MODEL_SOURCE_REGISTRY[0] ||
    null;
  const DEFAULT_CANONICAL_HOST = DEFAULT_SOURCE_META && DEFAULT_SOURCE_META.canonicalHost
    ? DEFAULT_SOURCE_META.canonicalHost
    : null;
  const MODEL_SOURCE_LOOKUP = new Map();
  MODEL_SOURCE_REGISTRY.forEach(function (entry) {
    if (!entry || typeof entry.id !== "string") return;
    MODEL_SOURCE_LOOKUP.set(entry.id.toLowerCase(), entry);
  });

  function showGlobalError(msg) {
    const el = document.getElementById("global-error");
    const msgEl = document.getElementById("global-error-message");
    if (el && msgEl) {
      msgEl.textContent = msg;
      el.classList.remove("hidden");
    }
  }

  function showValidationError(targetId, html) {
    const el = document.getElementById(targetId);
    if (el) {
      el.innerHTML = html;
      el.setAttribute("data-state", "error");
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  function isValidUrl(s) {
    if (!s || typeof s !== "string") return false;
    const trimmed = s.trim();
    if (!trimmed) return false;
    return /^https?:[/][/][^ \t\n\r]+$/i.test(trimmed);
  }

  function resolveModelSource(source) {
    const normalized = typeof source === "string" ? source.trim().toLowerCase() : "";
    return MODEL_SOURCE_LOOKUP.get(normalized) || MODEL_SOURCE_LOOKUP.get(DEFAULT_MODEL_SOURCE) || null;
  }

  function validateOpaqueModelRef(trimmed) {
    if (/[.][.]|\\|[\r\n\x00]/.test(trimmed) || /[ \t\n\r]/.test(trimmed)) return MSG.modelRefInvalid || "Invalid model reference.";
    return null;
  }

  function validateHostModelRef(trimmed, canonicalHost) {
    const host = canonicalHost || DEFAULT_CANONICAL_HOST;
    if (!host) {
      return validateOpaqueModelRef(trimmed);
    }
    if (/[.][.]|\\|[\r\n\x00]/.test(trimmed)) return MSG.modelRefInvalid || "Invalid model reference.";
    const lower = trimmed.toLowerCase();
    if (lower.startsWith("http://") || lower.startsWith("https://")) {
      if (!isValidUrl(trimmed)) return MSG.modelRefInvalid || "Invalid model reference.";
      try {
        const parsed = new URL(trimmed);
        const hostname = parsed.hostname.toLowerCase();
        const hostOk = hostname === host || hostname === "www." + host;
        if (!hostOk || parsed.search || parsed.hash) return MSG.modelRefInvalid || "Invalid model reference.";
      } catch (_error) {
        return MSG.modelRefInvalid || "Invalid model reference.";
      }
    }
    const escapedHost = host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const hostPrefix = host + "/";
    const wwwHostPrefix = "www." + hostPrefix;
    const normalized = lower.startsWith(hostPrefix)
      ? trimmed.slice(hostPrefix.length)
      : lower.startsWith(wwwHostPrefix)
        ? trimmed.slice(wwwHostPrefix.length)
        : trimmed.replace(new RegExp("^" + escapedHost + "/", "i"), "");
    const parts = normalized.split("/").filter(Boolean);
    if (parts.length !== 2) return MSG.modelRefInvalid || "Invalid model reference.";
    if (!/^[a-zA-Z0-9][\w.\-]{0,127}$/.test(parts[0]) || !/^[a-zA-Z0-9][\w.\-]{0,127}$/.test(parts[1])) return MSG.modelRefInvalid || "Invalid model reference.";
    return null;
  }

  function isLikelyAudioMime(value) {
    return /^[a-z][a-z0-9+.-]*\/[a-z0-9+.-]+$/i.test(value);
  }

  function isLikelyBase64(value) {
    const compact = value.replace(/\s+/g, "");
    if (!compact.length || compact.length % 4 !== 0) return false;
    return /^[A-Za-z0-9+/=]+$/.test(compact);
  }

  function getTrimmedFieldValue(form, selector) {
    const field = form.querySelector(selector);
    if (!field || typeof field.value !== "string") return "";
    return field.value.trim();
  }

  function getBooleanFieldChecked(form, selector) {
    const field = form.querySelector(selector);
    return !!(field && field.checked);
  }

  function validateFloatingChatForm(form) {
    const message = getTrimmedFieldValue(form, '[name="message"]');
    const speechMime = getTrimmedFieldValue(form, '[name="speechInput[mimeType]"]');
    const speechData = getTrimmedFieldValue(form, '[name="speechInput[data]"]');
    const requestTts = getBooleanFieldChecked(form, '[name="requestTts"]');
    const ttsOutputMimeType = getTrimmedFieldValue(form, '[name="ttsOutputMimeType"]');

    const hasSpeechMime = speechMime.length > 0;
    const hasSpeechData = speechData.length > 0;

    if (!message && !hasSpeechMime && !hasSpeechData) {
      return MSG.chatMessageOrSpeechRequired || "Enter a message or provide both speech MIME type and data.";
    }

    if (hasSpeechMime !== hasSpeechData) {
      return MSG.chatSpeechInputPairRequired || "Provide both speech MIME type and speech data together.";
    }

    if (hasSpeechMime && !isLikelyAudioMime(speechMime)) {
      return MSG.chatSpeechMimeInvalid || "Invalid MIME type. Use a format like audio/wav.";
    }

    if (hasSpeechData && !isLikelyBase64(speechData)) {
      return MSG.chatSpeechDataInvalid || "Speech data must be valid base64.";
    }

    if (requestTts && !ttsOutputMimeType) {
      return MSG.chatTtsOutputFormatRequired || "Select a TTS output format.";
    }

    return null;
  }

  function validateModelRef(val, source) {
    const trimmed = (val || "").trim();
    if (!trimmed) return MSG.modelRefEmpty || "Model reference is required.";
    const sourceMeta = resolveModelSource(source);
    if (!sourceMeta) {
      return validateOpaqueModelRef(trimmed);
    }
    if (sourceMeta.modelRefValidation === "huggingface") {
      return validateHostModelRef(trimmed, sourceMeta.canonicalHost || DEFAULT_CANONICAL_HOST || null);
    }
    return validateOpaqueModelRef(trimmed);
  }

  function validateFlowYaml(val) {
    if (!val || (val = val.trim()).length === 0) return MSG.flowYamlEmpty || "Flow YAML is required.";
    return null;
  }

  function validateUcpUrl(val) {
    if (!val || (val = val.trim()).length === 0) return MSG.ucpUrlEmpty || "UCP URL is required.";
    if (!isValidUrl(val)) return MSG.ucpUrlInvalid || "Invalid UCP URL.";
    return null;
  }

  function validateAiKeys(form, providerId) {
    const requiresKey = form.querySelector('input[name="apiKey"]');
    if (requiresKey && requiresKey.required) {
      const key = (requiresKey.value || "").trim();
      if (!key) return MSG.keyRequired || "API key is required.";
    }
    const urlInput = form.querySelector('input[name="baseUrl"]');
    if (urlInput && urlInput.required) {
      const url = (urlInput.value || "").trim();
      if (!url) return MSG.baseUrlInvalid || "Base URL is required.";
      if (!isValidUrl(url)) return MSG.baseUrlInvalid || "Invalid base URL.";
    }
    return null;
  }

  document.body.addEventListener(
    "htmx:beforeRequest",
    function (evt) {
      const el = evt.detail.elt;
      const target = evt.detail.target;
      const targetId = target && target.id ? target.id : null;
      const path = (evt.detail.pathInfo && evt.detail.pathInfo.requestPath) || "";
      let err = null;

      if (path.indexOf("/api/models/pull") !== -1) {
        const form = el && (el.form || (el.closest && el.closest("form")));
        if (form) {
          const ref = (form.querySelector('[name="modelRef"]') || {}).value;
          const src = (form.querySelector('[name="source"]') || {}).value;
          err = validateModelRef(ref, src);
        }
        if (err && targetId) {
          evt.preventDefault();
          showValidationError(targetId, '<div class="alert alert-error shadow-sm text-sm" role="alert">' + err + "</div>");
          return;
        }
      }

      if (path.indexOf("/api/ai/chat") !== -1) {
        const form = el && (el.form || (el.closest && el.closest("form")));
        if (form) {
          err = validateFloatingChatForm(form);
        }
        if (err && targetId) {
          evt.preventDefault();
          showValidationError(targetId, '<div class="alert alert-error shadow-sm text-sm" role="alert">' + err + "</div>");
          return;
        }
      }

      if (path.indexOf("/api/apps/build") !== -1) {
        const form = el && (el.form || (el.closest && el.closest("form")));
        if (form) {
          const platform = (form.querySelector('[name="platform"]') || {}).value;
          if (!platform || (platform !== "android" && platform !== "ios")) {
            err = MSG.appBuildPlatform || "Please select a platform.";
          }
        }
        if (err && targetId) {
          evt.preventDefault();
          showValidationError(targetId, '<div class="alert alert-error shadow-sm text-sm" role="alert">' + err + "</div>");
          return;
        }
      }

      if (path.indexOf("/api/flows/") !== -1 && (path.indexOf("/runs") !== -1 || path.indexOf("/validate") !== -1)) {
        const yamlEl = document.getElementById("flow-yaml");
        const yaml = yamlEl ? yamlEl.value : "";
        err = validateFlowYaml(yaml);
        if (err && targetId) {
          evt.preventDefault();
          showValidationError(targetId, '<div class="alert alert-error shadow-sm text-sm" role="alert">' + err + "</div>");
          return;
        }
      }

      if (path.indexOf("/api/ucp/discover") !== -1) {
        const form = el && (el.form || (el.closest && el.closest("form")));
        const url = form ? (form.querySelector('[name="url"]') || {}).value : "";
        err = validateUcpUrl(url);
        if (err && targetId) {
          evt.preventDefault();
          showValidationError(targetId, '<div class="alert alert-error shadow-sm text-sm" role="alert">' + err + "</div>");
          return;
        }
      }

      if (path.indexOf("/api/ai/keys") !== -1 && path.indexOf("/delete") === -1) {
        const form = el && (el.form || (el.closest && el.closest("form")));
        if (form) {
          err = validateAiKeys(form);
        }
        if (err && targetId) {
          evt.preventDefault();
          showValidationError(targetId, '<div class="alert alert-error shadow-sm text-sm" role="alert">' + err + "</div>");
          return;
        }
      }

      if (el) el.setAttribute("aria-busy", "true");
      if (target) target.setAttribute("aria-busy", "true");
    },
    { capture: true }
  );

  document.body.addEventListener("htmx:afterRequest", function (evt) {
    const el = evt.detail.elt;
    const target = evt.detail.target;
    if (el) el.removeAttribute("aria-busy");
    if (target) target.removeAttribute("aria-busy");
  });

  document.body.addEventListener("htmx:sendError", function () {
    showGlobalError(ERR_NETWORK);
  });

  document.body.addEventListener("htmx:timeout", function () {
    showGlobalError(ERR_TIMEOUT);
  });

  document.body.addEventListener("htmx:responseError", function (evt) {
    const status = evt.detail && evt.detail.xhr && evt.detail.xhr.status;
    showGlobalError(status ? ERR_RESPONSE + " (" + status + ")" : ERR_RESPONSE);
  });

  // Confirm modal with focus restoration
  (function () {
    let pendingConfirm = null;
    let modalOpener = null;

    document.body.addEventListener("htmx:confirm", function (evt) {
      if (!evt.detail.target.hasAttribute("hx-confirm")) return;
      evt.preventDefault();
      pendingConfirm = evt;
      // Track the element that triggered the modal so focus can be restored on close
      modalOpener = document.activeElement || evt.detail.elt || null;
      const modal = document.getElementById("confirm-modal");
      const desc = document.getElementById("confirm-modal-desc");
      if (!modal || !desc) return;
      desc.textContent = evt.detail.question || CONFIRM_DEFAULT;
      modal.showModal();
    });

    function closeConfirmModal() {
      const modal = document.getElementById("confirm-modal");
      if (modal) modal.close();
      // Return focus to the element that opened the modal
      if (modalOpener && typeof modalOpener.focus === "function") {
        modalOpener.focus();
      }
      modalOpener = null;
    }

    const okBtn = document.getElementById("confirm-modal-ok");
    if (okBtn) {
      okBtn.addEventListener("click", function () {
        if (pendingConfirm) {
          pendingConfirm.detail.issueRequest(true);
          pendingConfirm = null;
        }
        closeConfirmModal();
      });
    }

    const cancelBtn = document.getElementById("confirm-modal-cancel");
    if (cancelBtn) {
      cancelBtn.addEventListener("click", function () {
        pendingConfirm = null;
        closeConfirmModal();
      });
    }
  })();

  // Toast cleanup: remove from DOM (not just hide) so screen readers are notified
  (function () {
    let toastTimeout;
    document.body.addEventListener("htmx:afterSettle", function () {
      const container = document.getElementById("toast-container");
      if (container && container.children.length > 0) {
        if (toastTimeout) clearTimeout(toastTimeout);
        toastTimeout = setTimeout(function () {
          // Remove children from DOM so aria-live="polite" on container announces removal
          while (container.firstChild) {
            container.removeChild(container.firstChild);
          }
        }, 4000);
      }
    });
  })();

  // Event delegation for data-preset buttons (XSS-safe alternative to inline onclick)
  document.body.addEventListener("click", function (evt) {
    const btn = evt.target && evt.target.closest("[data-preset-target]");
    if (!btn) return;
    const targetId = btn.getAttribute("data-preset-target");
    const value = btn.getAttribute("data-preset-value");
    if (targetId && value !== null) {
      const input = document.getElementById(targetId);
      if (input) input.value = value;
    }
  });

  document.addEventListener("DOMContentLoaded", function () {
    const modelSourceSelect = document.getElementById("model-source-select");
    const modelRefInput = document.getElementById("model-ref-input");
    const modelRefHint = document.getElementById("model-ref-validator-hint");

    function syncModelSourceHint() {
      if (!modelSourceSelect || !modelRefInput || !modelRefHint) return;
      const selected = modelSourceSelect.options[modelSourceSelect.selectedIndex];
      if (!selected) return;
      const placeholder = selected.getAttribute("data-placeholder");
      const hint = selected.getAttribute("data-hint");
      if (placeholder && placeholder.trim().length > 0) {
        modelRefInput.setAttribute("placeholder", placeholder);
      }
      const fallbackHint = modelRefHint.getAttribute("data-default-hint") || "";
      modelRefHint.textContent = hint && hint.trim().length > 0 ? hint : fallbackHint;
    }

    if (modelSourceSelect) {
      modelSourceSelect.addEventListener("change", syncModelSourceHint);
      syncModelSourceHint();
    }

    const drawerCheckbox = document.getElementById("vertu-drawer");
    const drawerTrigger = document.querySelector(".drawer-button");
    const drawerSide = document.querySelector(".drawer-side");
    const sidebarLinks = drawerSide ? Array.from(drawerSide.querySelectorAll('a[href^="#"]')) : [];
    const floatingChatTtsToggle = document.getElementById("floating-chat-request-tts");
    const floatingChatTtsOutput = document.getElementById("floating-chat-tts-output-mime");
    const floatingChatTtsVoice = document.getElementById("floating-chat-tts-voice");

    function syncFloatingChatTtsState() {
      const enabled = floatingChatTtsToggle && floatingChatTtsToggle.checked;
      if (!floatingChatTtsOutput || !floatingChatTtsVoice) return;
      if (enabled) {
        floatingChatTtsOutput.removeAttribute("disabled");
        floatingChatTtsVoice.removeAttribute("disabled");
      } else {
        floatingChatTtsOutput.setAttribute("disabled", "disabled");
        floatingChatTtsVoice.setAttribute("disabled", "disabled");
      }
    }

    function onDrawerChange() {
      if (!drawerCheckbox) return;
      const isOpen = drawerCheckbox.checked;
      if (drawerTrigger) {
        drawerTrigger.setAttribute("aria-expanded", String(isOpen));
      }
      const isMobile = window.matchMedia("(max-width: " + (BREAKPOINT_LG - 1) + "px)").matches;
      if (isMobile && isOpen && sidebarLinks.length > 0) {
        sidebarLinks[0].focus();
      } else if (isMobile && !isOpen && drawerTrigger) {
        drawerTrigger.focus();
      }
    }

    if (drawerCheckbox) {
      drawerCheckbox.addEventListener("change", onDrawerChange);
      onDrawerChange();
    }

    document.querySelectorAll(".drawer-side a[href^='#']").forEach(function (link) {
      link.addEventListener("click", function () {
        if (drawerCheckbox && window.matchMedia("(max-width: " + (BREAKPOINT_LG - 1) + "px)").matches) {
          drawerCheckbox.checked = false;
          drawerCheckbox.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });
    });

    document.querySelectorAll('#card-ai-providers .collapse .collapse-title, .collapse-title[role="button"]').forEach(function (trigger) {
      trigger.addEventListener("keydown", function (evt) {
        if (evt.key === "Enter" || evt.key === " ") {
          evt.preventDefault();
          trigger.click();
        }
      });
      const collapse = trigger.closest(".collapse");
      const input = collapse && collapse.querySelector('input[type="checkbox"], input[type="radio"]');
      if (input) {
        const syncExpanded = function () {
          trigger.setAttribute("aria-expanded", String(input.checked));
        };
        input.addEventListener("change", syncExpanded);
        syncExpanded();
      }
    });

    if (floatingChatTtsToggle) {
      floatingChatTtsToggle.addEventListener("change", syncFloatingChatTtsState);
      syncFloatingChatTtsState();
    }
  });
})();
