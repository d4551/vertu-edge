/**
 * HTMX extension: job-poll
 *
 * Auto-polling extension that intelligently stops when a job reaches a
 * terminal state (succeeded, failed, cancelled). Replaces ad-hoc polling
 * teardown patterns with declarative behaviour.
 *
 * Usage:
 *   <div hx-ext="job-poll"
 *        job-poll-url="/api/flows/runs/123"
 *        job-poll-interval="2s"
 *        job-poll-target="#job-status"
 *        job-poll-swap="innerHTML"
 *        job-poll-terminal-selector="[data-job-terminal]">
 *   </div>
 *
 * Attributes:
 *   job-poll-url            — URL to poll
 *   job-poll-interval       — Polling interval (default: "2s", supports "500ms", "3s")
 *   job-poll-target         — CSS selector for the element to update (defaults to self)
 *   job-poll-swap           — htmx swap strategy (default: "innerHTML")
 *   job-poll-terminal-selector — CSS selector checked after each swap;
 *                                if a matching element exists in the response,
 *                                polling stops. (default: "[data-job-terminal]")
 *   job-poll-max            — Maximum number of polls before auto-stop (default: unlimited)
 */
(function () {
  "use strict";

  if (typeof htmx === "undefined") return;

  var TERMINAL_STATES = ["succeeded", "failed", "cancelled", "error"];
  var DEFAULT_INTERVAL = 2000;
  var DEFAULT_SWAP = "innerHTML";
  var DEFAULT_TERMINAL_SELECTOR = "[data-job-terminal]";

  /** Parse an interval string like "2s", "500ms", or bare number to ms. */
  function parseInterval(raw) {
    if (!raw || typeof raw !== "string") return DEFAULT_INTERVAL;
    var trimmed = raw.trim().toLowerCase();
    if (!trimmed) return DEFAULT_INTERVAL;
    if (trimmed.endsWith("ms")) {
      var ms = parseInt(trimmed.slice(0, -2), 10);
      return isFinite(ms) && ms > 0 ? ms : DEFAULT_INTERVAL;
    }
    if (trimmed.endsWith("s")) {
      var s = parseFloat(trimmed.slice(0, -1));
      return isFinite(s) && s > 0 ? Math.round(s * 1000) : DEFAULT_INTERVAL;
    }
    var n = parseInt(trimmed, 10);
    return isFinite(n) && n > 0 ? n : DEFAULT_INTERVAL;
  }

  /** Check whether a response indicates terminal job state. */
  function isTerminal(target, terminalSelector) {
    if (!target) return false;
    // Check for terminal selector in the swapped content
    if (target.querySelector && target.querySelector(terminalSelector)) {
      return true;
    }
    // Also check data-job-status attribute on the target itself
    var status = target.getAttribute && target.getAttribute("data-job-status");
    if (status && TERMINAL_STATES.indexOf(status.toLowerCase()) !== -1) {
      return true;
    }
    return false;
  }

  // Track active pollers by element
  var activePollers = new WeakMap();

  function startPolling(elt) {
    if (activePollers.has(elt)) return; // already polling

    var url = elt.getAttribute("job-poll-url");
    if (!url) return;

    var interval = parseInterval(elt.getAttribute("job-poll-interval"));
    var targetSelector = elt.getAttribute("job-poll-target");
    var swap = elt.getAttribute("job-poll-swap") || DEFAULT_SWAP;
    var terminalSelector = elt.getAttribute("job-poll-terminal-selector") || DEFAULT_TERMINAL_SELECTOR;
    var maxPolls = parseInt(elt.getAttribute("job-poll-max") || "0", 10);
    var pollCount = 0;

    var target = targetSelector ? document.querySelector(targetSelector) : elt;
    if (!target) return;

    var timerId = setInterval(function () {
      pollCount++;

      // Check max polls
      if (maxPolls > 0 && pollCount > maxPolls) {
        stopPolling(elt);
        return;
      }

      // Check if element is still in DOM
      if (!document.body.contains(elt)) {
        stopPolling(elt);
        return;
      }

      // Re-resolve target each poll (it may have been swapped)
      var currentTarget = targetSelector ? document.querySelector(targetSelector) : elt;
      if (!currentTarget) {
        stopPolling(elt);
        return;
      }

      // Issue the HTMX request
      htmx.ajax("GET", url, {
        target: currentTarget,
        swap: swap,
      });
    }, interval);

    activePollers.set(elt, { timerId: timerId, terminalSelector: terminalSelector });
  }

  function stopPolling(elt) {
    var poller = activePollers.get(elt);
    if (poller) {
      clearInterval(poller.timerId);
      activePollers.delete(elt);
      // Dispatch custom event for listeners
      elt.dispatchEvent(new CustomEvent("job-poll:stopped", { bubbles: true }));
    }
  }

  htmx.defineExtension("job-poll", {
    onEvent: function (name, evt) {
      var elt = evt.detail ? evt.detail.elt : null;

      if (name === "htmx:afterProcessNode") {
        // Start polling when a job-poll element is processed
        if (elt && elt.getAttribute && elt.getAttribute("job-poll-url")) {
          startPolling(elt);
        }
      }

      if (name === "htmx:afterSettle") {
        // After content is swapped, check for terminal state
        var target = evt.detail ? evt.detail.target : null;
        if (!target) return;

        // Find the job-poll parent element
        var pollElt = target.closest ? target.closest("[job-poll-url]") : null;
        if (!pollElt) {
          // The target itself might be a poll element
          if (target.getAttribute && target.getAttribute("job-poll-url")) {
            pollElt = target;
          }
        }
        if (!pollElt) return;

        var poller = activePollers.get(pollElt);
        if (!poller) return;

        if (isTerminal(target, poller.terminalSelector)) {
          stopPolling(pollElt);
        }
      }

      if (name === "htmx:beforeCleanupElement") {
        // Clean up when element is removed from DOM
        if (elt && activePollers.has(elt)) {
          stopPolling(elt);
        }
      }
    },
  });
})();
