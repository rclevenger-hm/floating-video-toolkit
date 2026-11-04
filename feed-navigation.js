(function (root) {
  "use strict";

  function hostIs(host, domain) { return host === domain || host.endsWith("." + domain); }
  function viewFor(location) {
    if (!location || !/^https?:$/.test(location.protocol)) return null;
    const host = location.hostname.toLowerCase(), path = location.pathname;
    if (hostIs(host, "youtube.com")) {
      if (/^\/shorts\//.test(path)) return "shorts";
      if (path === "/watch") return "youtube";
    }
    if (hostIs(host, "instagram.com") && /^\/reels?(?:\/|$)/.test(path)) return "instagram";
    if (hostIs(host, "facebook.com") && /^\/reels?(?:\/|$)/.test(path)) return "facebook";
    if (hostIs(host, "tiktok.com") && (/^\/(?:foryou|following|friends|explore)?\/?$/.test(path) || /^\/@[^/]+\/video\/[^/]+\/?$/.test(path))) return "tiktok";
    return null;
  }

  function available(element, doc, playerControl = false) {
    if (!element || !element.isConnected || element.ownerDocument !== doc || typeof element.click !== "function") return false;
    if (element.matches(":disabled") || element.closest('[hidden], [inert], [aria-hidden="true"], [aria-disabled="true"]')) return false;
    for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
      const style = doc.defaultView.getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || (style.opacity === "0" && !(playerControl && node.matches(".ytp-chrome-bottom, .ytp-chrome-controls"))) || style.pointerEvents === "none") return false;
    }
    const rect = element.getBoundingClientRect();
    const win = doc.defaultView;
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < win.innerHeight && rect.left < win.innerWidth;
  }

  function createNavigator(options = {}) {
    const doc = options.document || root.document;
    function scopeFor(view, video, container) {
      const anchor = container && container.ownerDocument === doc && container.isConnected ? container :
        video && video.ownerDocument === doc && video.isConnected ? video : null;
      if (view === "shorts") return anchor?.closest("ytd-shorts") || doc.querySelector("ytd-shorts");
      if (view === "youtube") return anchor?.closest("#movie_player, .html5-video-player") || doc.querySelector("#movie_player");
      // Never search arbitrary page carousels. Reels/detail dialogs take priority
      // over the surrounding main feed, including while the video is in PiP.
      if (!anchor) return null;
      return anchor.closest('[role="dialog"]') || anchor.closest('main, [role="main"]');
    }
    function navigate(direction, sourceVideo, sourceContainer) {
      if (direction !== "next" && direction !== "previous") return false;
      const view = viewFor(doc?.location);
      if (!view) return false;
      const video = sourceVideo || options.getVideo?.();
      const container = sourceContainer || options.getSourceContainer?.();
      const scope = scopeFor(view, video, container);
      if (!scope) return false;
      const next = direction === "next";
      let selectors;
      if (view === "youtube") selectors = [next ? ".ytp-next-button" : ".ytp-prev-button"];
      else if (view === "shorts") selectors = [next ? '#navigation-button-down button, button#navigation-button-down' : '#navigation-button-up button, button#navigation-button-up'];
      else if (view === "tiktok") selectors = [next ? '[data-e2e="arrow-down"], [data-e2e="arrow-right"]' : '[data-e2e="arrow-up"], [data-e2e="arrow-left"]'];
      else selectors = [];
      const labels = next ? ["Next video", "Next reel", "Scroll to next video", "Go to next video"] :
        ["Previous video", "Previous reel", "Scroll to previous video", "Go to previous video"];
      // Instagram/Facebook expose arrow names on SVGs inside role=button nodes.
      // Generic Next/Previous is permitted only in these reel-specific views.
      if (view === "instagram" || view === "facebook") labels.push(next ? "Next" : "Previous");
      selectors.push(labels.map(label => `[aria-label="${label}" i]`).join(", "));
      for (const selector of selectors) {
        const candidates = new Set();
        for (const match of scope.querySelectorAll(selector)) {
          const button = match.closest('button, [role="button"], a.ytp-next-button, a.ytp-prev-button');
          if (button && scope.contains(button) && available(button, doc, view === "youtube" && button.matches(".ytp-next-button, .ytp-prev-button"))) candidates.add(button);
        }
        // Ambiguity is safer to decline than to advance an unrelated carousel.
        if (candidates.size > 1) return false;
        if (candidates.size === 1) {
          try { candidates.values().next().value.click(); return true; }
          catch (_) { return false; }
        }
      }
      return false;
    }
    return {navigate, isSupported: () => Boolean(viewFor(doc?.location))};
  }
  root.FloatingVideoNavigation = {createNavigator, viewFor};
  if (typeof module !== "undefined") module.exports = root.FloatingVideoNavigation;
})(globalThis);
