/**
 * Control Plane client-side script: HTMX extensions, validation, error handling, confirm modal, toast cleanup.
 * Expects window.__VERTU_CONFIG__ to be set before this script loads (injected by layout).
 */

/** Filter AI provider tabs by name. Called from oninput on the provider search input. */
function filterProviderTabs(query) {
  var tabs = document.querySelectorAll('[name="provider-tabs"]');
  var q = (query || "").toLowerCase().trim();
  tabs.forEach(function (tab) {
    var label = (tab.getAttribute("aria-label") || "").toLowerCase();
    var content = tab.nextElementSibling;
    var show = !q || label.includes(q);
    tab.style.display = show ? "" : "none";
    if (content && content.classList.contains("tab-content")) {
      content.style.display = show ? "" : "none";
    }
  });
}
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
  let pendingOperatorWorkspaceFocus = false;
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

  function focusOperatorWorkspaceNow() {
    var workspace = document.getElementById("operator-workspace");
    var input = document.getElementById("floating-chat-msg");
    if (!workspace || !input) return false;
    workspace.scrollIntoView({ behavior: "smooth", block: "start" });
    window.requestAnimationFrame(function () {
      if (typeof input.focus === "function") {
        input.focus({ preventScroll: true });
      }
    });
    return true;
  }

  function openOperatorWorkspace() {
    if (focusOperatorWorkspaceNow()) return;
    var mainContent = document.getElementById("main-content");
    if (!mainContent || typeof htmx === "undefined") {
      window.location.assign("/dashboard/overview#operator-workspace");
      return;
    }
    pendingOperatorWorkspaceFocus = true;
    htmx.ajax("GET", "/dashboard/overview", {
      target: mainContent,
      swap: "innerHTML show:top",
    });
    if (window.location.pathname !== "/dashboard/overview") {
      window.history.pushState({}, "", "/dashboard/overview");
    }
    syncNavActiveState("/dashboard/overview");
  }

  window.focusOperatorWorkspace = openOperatorWorkspace;

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
      if (!isValidUrl(trimmed) || !URL.canParse(trimmed)) return MSG.modelRefInvalid || "Invalid model reference.";
      const parsed = new URL(trimmed);
      const hostname = parsed.hostname.toLowerCase();
      const hostOk = hostname === host || hostname === "www." + host;
      if (!hostOk || parsed.search || parsed.hash) return MSG.modelRefInvalid || "Invalid model reference.";
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

  function getTrimmedFieldValue(form, selector) {
    const field = form.querySelector(selector + ":checked") || form.querySelector(selector);
    if (!field || typeof field.value !== "string") return "";
    return field.value.trim();
  }

  function validateAiWorkflowForm(form) {
    const mode = getTrimmedFieldValue(form, '[name="mode"]');
    const message = getTrimmedFieldValue(form, '[name="message"]');
    if (!mode) {
      return MSG.aiWorkflowModeRequired || "Select a workflow mode.";
    }
    if (!message) {
      return MSG.aiWorkflowMessageRequired || "Enter a prompt for the workflow.";
    }
    if (mode === "image") {
      const size = getTrimmedFieldValue(form, '[name="imageOptions[size]"]');
      const seedValue = getTrimmedFieldValue(form, '[name="imageOptions[seed]"]');
      const stepsValue = getTrimmedFieldValue(form, '[name="imageOptions[steps]"]');

      if (size && !/^[0-9]{3,4}x[0-9]{3,4}$/.test(size)) return MSG.aiWorkflowImageSizeInvalid || "Select a valid image size.";
      if (seedValue) {
        const seed = Number(seedValue);
        if (!Number.isFinite(seed) || !Number.isInteger(seed)) {
          return MSG.aiWorkflowSeedInteger || "Seed must be an integer.";
        }
      }
      if (stepsValue) {
        const steps = Number(stepsValue);
        if (!Number.isFinite(steps) || !Number.isInteger(steps) || steps < 1 || steps > 100) {
          return MSG.aiWorkflowStepsRange || "Steps must be an integer between 1 and 100.";
        }
      }
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

      if (path.indexOf("/api/ai/workflows/run") !== -1) {
        const form = el && (el.form || (el.closest && el.closest("form")));
        if (form) {
          err = validateAiWorkflowForm(form);
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
          const platform = getTrimmedFieldValue(form, '[name="platform"]');
          if (!platform || (platform !== "android" && platform !== "ios" && platform !== "desktop")) {
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
  const dialogOpeners = new Map();

  document.body.addEventListener("click", function (evt) {
    const dismissButton = evt.target && evt.target.closest("[data-dismiss-target]");
    if (dismissButton) {
      const targetId = dismissButton.getAttribute("data-dismiss-target");
      const target = targetId ? document.getElementById(targetId) : null;
      if (target) {
        target.classList.add("hidden");
      }
      return;
    }

    const navButton = evt.target && evt.target.closest("[data-nav-href]");
    if (navButton) {
      const href = navButton.getAttribute("data-nav-href");
      if (href) {
        window.location.assign(href);
      }
      return;
    }

    const drawerButton = evt.target && evt.target.closest("[data-drawer-open]");
    if (drawerButton) {
      const drawerId = drawerButton.getAttribute("data-drawer-open");
      const drawer = drawerId ? document.getElementById(drawerId) : null;
      if (drawer && drawer instanceof HTMLInputElement) {
        drawer.checked = true;
        drawer.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return;
    }

    const operatorWorkspaceTrigger = evt.target && evt.target.closest("[data-operator-workspace-open]");
    if (operatorWorkspaceTrigger) {
      evt.preventDefault();
      openOperatorWorkspace();
      return;
    }

    const dialogTrigger = evt.target && evt.target.closest("[data-dialog-open]");
    if (dialogTrigger) {
      const dialogId = dialogTrigger.getAttribute("data-dialog-open");
      const dialog = dialogId ? document.getElementById(dialogId) : null;
      if (dialog && typeof dialog.showModal === "function") {
        dialogOpeners.set(dialogId, dialogTrigger);
        dialog.showModal();
        const eventName = dialogTrigger.getAttribute("data-dialog-event");
        if (eventName) {
          document.body.dispatchEvent(new Event(eventName));
        }
        const focusTargetId = dialogTrigger.getAttribute("data-dialog-focus");
        if (focusTargetId) {
          setTimeout(function () {
            const focusTarget = document.getElementById(focusTargetId);
            if (focusTarget && typeof focusTarget.focus === "function") {
              focusTarget.focus();
            }
          }, 100);
        }
      }
      return;
    }

    const btn = evt.target && evt.target.closest("[data-preset-target]");
    if (!btn) return;
    const targetId = btn.getAttribute("data-preset-target");
    const value = btn.getAttribute("data-preset-value");
    if (targetId && value !== null) {
      const input = document.getElementById(targetId);
      if (input) input.value = value;
    }
  });

  /** Update sidebar and dock active states after HTMX section swap. */
  function syncNavActiveState(path) {
    var section = "";
    var match = path && path.match(/\/dashboard\/(\w+)/);
    if (match) {
      section = match[1];
    } else if (path === "/" || path === "") {
      section = "overview";
    }
    if (!section) return;

    // Update sidebar links
    document.querySelectorAll('.drawer-side .menu a[hx-get]').forEach(function (link) {
      var href = link.getAttribute("hx-get") || "";
      var isActive = href === "/dashboard/" + section;
      link.classList.toggle("active", isActive);
      if (isActive) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    });

    // Update mobile dock links
    document.querySelectorAll('.dock a[hx-get]').forEach(function (link) {
      var href = link.getAttribute("hx-get") || "";
      var isActive = href === "/dashboard/" + section;
      link.classList.toggle("dock-active", isActive);
      if (isActive) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    });
  }

  /** Listen for HTMX content swaps on the main content area. */
  document.body.addEventListener("htmx:afterSettle", function (evt) {
    if (evt.detail && evt.detail.target && evt.detail.target.id === "main-content") {
      var path = evt.detail.pathInfo && evt.detail.pathInfo.requestPath;
      syncNavActiveState(path);
      if (pendingOperatorWorkspaceFocus) {
        pendingOperatorWorkspaceFocus = false;
        focusOperatorWorkspaceNow();
      }
    }
  });

  /** Handle popstate for browser back/forward navigation. */
  window.addEventListener("popstate", function () {
    syncNavActiveState(window.location.pathname);
  });

  document.addEventListener("DOMContentLoaded", function () {
    var modelSourceSelect = document.getElementById("model-source-select");
    var modelRefInput = document.getElementById("model-ref-input");
    var modelRefHint = document.getElementById("model-ref-validator-hint");

    /** Sync model source hint text and placeholder when source dropdown changes. */
    function syncModelSourceHint() {
      if (!modelSourceSelect || !modelRefInput || !modelRefHint) return;
      var selected = modelSourceSelect.options[modelSourceSelect.selectedIndex];
      if (!selected) return;
      var placeholder = selected.getAttribute("data-placeholder");
      var hint = selected.getAttribute("data-hint");
      if (placeholder && placeholder.trim().length > 0) {
        modelRefInput.setAttribute("placeholder", placeholder);
      }
      var fallbackHint = modelRefHint.getAttribute("data-default-hint") || "";
      modelRefHint.textContent = hint && hint.trim().length > 0 ? hint : fallbackHint;
    }

    if (modelSourceSelect) {
      modelSourceSelect.addEventListener("change", syncModelSourceHint);
      syncModelSourceHint();
    }

    var drawerCheckbox = document.getElementById("vertu-drawer");
    var drawerTrigger = document.querySelector(".drawer-button");
    var drawerSide = document.querySelector(".drawer-side");
    var sidebarNavLinks = drawerSide ? Array.from(drawerSide.querySelectorAll('a[hx-get]')) : [];

    /** Manage drawer open/close focus behavior for accessibility. */
    function onDrawerChange() {
      if (!drawerCheckbox) return;
      var isOpen = drawerCheckbox.checked;
      if (drawerTrigger) {
        drawerTrigger.setAttribute("aria-expanded", String(isOpen));
      }
      var isMobile = window.matchMedia("(max-width: " + (BREAKPOINT_LG - 1) + "px)").matches;
      if (isMobile && isOpen && sidebarNavLinks.length > 0) {
        sidebarNavLinks[0].focus();
      } else if (isMobile && !isOpen && drawerTrigger) {
        drawerTrigger.focus();
      }
    }

    if (drawerCheckbox) {
      drawerCheckbox.addEventListener("change", onDrawerChange);
      onDrawerChange();
    }

    /** Auto-close mobile drawer after clicking an HTMX nav link. */
    document.querySelectorAll(".drawer-side a[hx-get]").forEach(function (link) {
      link.addEventListener("click", function () {
        if (drawerCheckbox && window.matchMedia("(max-width: " + (BREAKPOINT_LG - 1) + "px)").matches) {
          drawerCheckbox.checked = false;
          drawerCheckbox.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });
    });

    /** Sidebar keyboard navigation: arrow keys between tab links. */
    if (drawerSide) {
      drawerSide.addEventListener("keydown", function (evt) {
        if (evt.key !== "ArrowDown" && evt.key !== "ArrowUp") return;
        var links = Array.from(drawerSide.querySelectorAll('.menu a[hx-get]'));
        if (links.length === 0) return;
        var idx = links.indexOf(document.activeElement);
        if (idx === -1) return;
        evt.preventDefault();
        var next = evt.key === "ArrowDown"
          ? links[(idx + 1) % links.length]
          : links[(idx - 1 + links.length) % links.length];
        if (next && typeof next.focus === "function") next.focus();
      });
    }

  });
})();
