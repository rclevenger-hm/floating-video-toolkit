// Always-On-Top Floating Video (PiP)
// Runs in every frame. Finds the real playing video, keeps the
// disablePictureInPicture flag stripped (sites like Paramount+ re-apply it
// around ad breaks), then opens native Picture-in-Picture (always-on-top).

(() => {
  "use strict";

  // Guard against double-injection (e.g. leftover script after a reload).
  if (window.__fpipLoaded) return;
  window.__fpipLoaded = true;

  const core = globalThis.FloatingVideoCore;
  const host = core.hostOf(location.href);
  let tabHost = "";
  let disabledHosts = [];
  let enabled = false; // Fail closed until settings and top-page policy arrive.
  function policyHosts() {
    return [host, tabHost, ...Array.from(location.ancestorOrigins || [], core.hostOf)];
  }
  let userWantsPip = false; // sticky: keep floating across episode changes
  let pulsing = false;
  let showButton = false; // in-page floating PiP button (off by default)
  let autoPip = true; // auto-float when the tab is hidden (native autoPiP)
  const ADJ_DEFAULTS = {
    brightness: 1,
    contrast: 1,
    saturation: 1,
    sharpen: 0,
    zoom: 1,
  };
  let viewSettings = {...core.VIEW_DEFAULTS};
  let layout = null;
  let adj = { ...ADJ_DEFAULTS }; // display adjustments (CSS-only, DRM-safe)

  // ---- find the video the user is actually watching ----
  let selectedVideo = null;
  let selectedAt = 0;
  function rememberVideo(event) {
    if (!enabled || !event.isTrusted || !(event.target instanceof HTMLVideoElement)) return;
    selectedVideo = event.target;
    selectedAt = Date.now();
  }
  document.addEventListener("pointerdown", rememberVideo, true);
  document.addEventListener("contextmenu", rememberVideo, true);
  function getActiveVideo() {
    return layout?.video || core.pickVideo(document.querySelectorAll("video"), selectedVideo, selectedAt);
  }
  globalThis.__fpipController = {
    snapshot() {
      const video = getActiveVideo();
      return {enabled, host, ancestors:policyHosts(), inPip:!!document.pictureInPictureElement, inLayout:!!layout?.mode,
        candidate: enabled && video ? core.describeVideo(video, video === selectedVideo ? selectedAt : 0) : null};
    },
    run:runAction
  };

  async function runAction(action) {
    if (!enabled) return {status:"disabled"};
    if (action === "toggle-pip") {
      layout?.close();
      return {status:await togglePip() ? "ok" : "unavailable"};
    }
    const video = document.pictureInPictureElement || getActiveVideo();
    if (!video) return {status:"no-video"};
    try {
      if (action === "play-pause") { if (video.paused) await video.play(); else video.pause(); }
      else if (action === "play") await video.play();
      else if (action === "pause") video.pause();
      else if (["toggle-mute","mute","unmute"].includes(action)) {
        video.muted = action === "toggle-mute" ? !video.muted : action === "mute";
        if (inAd && adVideo === video) prevMuted = video.muted;
      } else if (["toggle-mini","toggle-cinema"].includes(action) || /^snap-[1-4]$/.test(action)) {
        if (window.self !== window.top) return {status:"embedded-layout"};
        if (document.pictureInPictureElement) await document.exitPictureInPicture();
        if (action.startsWith("snap-")) {
          viewSettings.corner = Number(action.slice(-1));
          layout.open("mini",viewSettings.corner);
          await chrome.storage.sync.set({viewSettings});
        } else layout.toggle(action === "toggle-mini" ? "mini" : "cinema");
      } else if (action === "close-layout") layout.close();
      else if (action === "cycle-fit") {
        const modes=["original","fit","fill","stretch"];
        viewSettings.fit=modes[(modes.indexOf(viewSettings.fit)+1)%modes.length];
        await chrome.storage.sync.set({viewSettings});
      } else if (action === "zoom-in" || action === "zoom-out") {
        adj.zoom=core.clamp(Math.round((adj.zoom+(action === "zoom-in" ? 0.1 : -0.1))*100)/100,1,3,1);
        await chrome.storage.sync.set({videoAdjust:adj});
      } else if (action === "reset-view") {
        viewSettings={...viewSettings,fit:"original",ratio:"auto",panX:50,panY:50};
        adj.zoom=1;
        await chrome.storage.sync.set({viewSettings,videoAdjust:adj});
      } else return {status:"unsupported"};
      applyVideoTweaks();
      return {status:"ok"};
    } catch (error) {
      console.warn("[Floating PiP] player action:",error.message);
      return {status:"unavailable"};
    }
  }

  const adjustedStyles = FloatingVideoState.createStyleLedger();
  const originalFlags = new Map();
  function rememberFlags(video) {
    if (!originalFlags.has(video)) originalFlags.set(video, {
      disabled:video.getAttribute("disablepictureinpicture"), auto:video.autoPictureInPicture
    });
  }
  function restoreFlags() {
    for (const [video, original] of originalFlags) {
      if (original.disabled === null) video.removeAttribute("disablepictureinpicture");
      else video.setAttribute("disablepictureinpicture", original.disabled);
      try { video.autoPictureInPicture = original.auto; } catch (_) {}
    }
    originalFlags.clear();
  }
  // ---- strip the disable flag from one or all videos ----
  function stripFlag(video) {
    rememberFlags(video);
    try {
      video.disablePictureInPicture = false;
    } catch (_) {}
    video.removeAttribute("disablepictureinpicture");
    video.removeAttribute("disablePictureInPicture");
  }
  function stripAll() {
    document.querySelectorAll("video").forEach(stripFlag);
  }

  // ---- is our extension context still valid? false after an extension reload,
  //      which is when orphaned content scripts start throwing on chrome.* ----
  function alive() {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch (_) {
      return false;
    }
  }
  function teardownAll() {
    enabled = false;
    userWantsPip = false;
    stopPulse();
    stopKeepClear();
    stopAdWatch();
    ssStop();
    ccStop();
    syncAutoPipHandler();
    layout?.close();
    adjustedStyles.restoreAll();
    restoreFlags();
    btn?.remove();
    btn = null;
    for (const id of ["fpip-style", "fpip-sharpen-svg", "fpip-cosmetic", "fpip-ad-style"]) document.getElementById(id)?.remove();
    adOverlay?.remove();
    adOverlay = null;
    adOverlayLabel = null;
  }

  // ---- display adjustments: CSS filter/transform only, so DRM-safe ----
  function adjustActive() {
    return (
      adj.brightness !== 1 ||
      adj.contrast !== 1 ||
      adj.saturation !== 1 ||
      adj.sharpen > 0 ||
      adj.zoom > 1 || viewSettings.fit !== "original" || viewSettings.panX !== 50 || viewSettings.panY !== 50 || !!layout?.mode
    );
  }
  function buildFilter() {
    const p = [];
    if (adj.brightness !== 1) p.push("brightness(" + adj.brightness + ")");
    if (adj.contrast !== 1) p.push("contrast(" + adj.contrast + ")");
    if (adj.saturation !== 1) p.push("saturate(" + adj.saturation + ")");
    if (adj.sharpen > 0) p.push("url(#fpip-sharpen)");
    return p.join(" ");
  }
  function ensureSharpen(a) {
    let fe = document.getElementById("fpip-sharpen-fe");
    if (!fe) {
      const NS = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(NS, "svg");
      svg.id = "fpip-sharpen-svg";
      svg.setAttribute("width", "0");
      svg.setAttribute("height", "0");
      svg.style.position = "absolute";
      const filter = document.createElementNS(NS, "filter");
      filter.id = "fpip-sharpen";
      fe = document.createElementNS(NS, "feConvolveMatrix");
      fe.id = "fpip-sharpen-fe";
      fe.setAttribute("order", "3");
      fe.setAttribute("preserveAlpha", "true");
      filter.appendChild(fe);
      svg.appendChild(filter);
      document.documentElement.appendChild(svg);
    }
    const k = a;
    fe.setAttribute(
      "kernelMatrix",
      "0 " + -k + " 0 " + -k + " " + (1 + 4 * k) + " " + -k + " 0 " + -k + " 0"
    );
  }
  function applyAdjust(active) {
    const on = !!active && adjustActive();
    adjustedStyles.restoreExcept(on ? active : null);
    if (!on) return;
    if (adj.sharpen > 0) ensureSharpen(adj.sharpen);
    adjustedStyles.set(active, "filter", buildFilter());
    adjustedStyles.set(active, "transform", adj.zoom > 1 ? "scale(" + adj.zoom + ")" : "none");
    adjustedStyles.set(active, "transform-origin", viewSettings.panX + "% " + viewSettings.panY + "%");
    adjustedStyles.set(active, "object-fit", ({original:"contain",fit:"contain",fill:"cover",stretch:"fill"})[viewSettings.fit]);
    adjustedStyles.set(active, "object-position", viewSettings.panX + "% " + viewSettings.panY + "%");
    adjustedStyles.set(active, "clip-path", adj.zoom > 1 ? "inset(" + ((adj.zoom - 1) / adj.zoom * 50) + "%)" : "none");
  }

  // ---- auto-PiP on tab switch ----
  // The bare `autoPictureInPicture` attribute is NOT enough on normal sites;
  // modern Chrome auto-enters PiP via a MediaSession "enterpictureinpicture"
  // action handler (its invocation carries the activation PiP needs). Keep the
  // attribute too as belt-and-suspenders for players that honor it.
  let autoPipHooked = false;
  function syncAutoPipHandler() {
    if (enabled && autoPip && !autoPipHooked) {
      try {
        navigator.mediaSession.setActionHandler(
          "enterpictureinpicture",
          async () => {
            const v = getActiveVideo();
            if (!enabled || !autoPip || !v || document.pictureInPictureElement) return;
            stripFlag(v);
            try {
              await v.requestPictureInPicture();
            } catch (_) {}
          }
        );
        autoPipHooked = true;
      } catch (_) {} // action unsupported on this Chrome -> attribute-only
    } else if ((!enabled || !autoPip) && autoPipHooked) {
      try {
        navigator.mediaSession.setActionHandler("enterpictureinpicture", null);
      } catch (_) {}
      autoPipHooked = false;
    }
  }

  // ---- maintain all per-video tweaks: strip flag, auto-PiP, adjustments ----
  function applyVideoTweaks() {
    if (!enabled) return;
    syncAutoPipHandler();
    const active = autoPip || adjustActive() ? getActiveVideo() : null;
    document.querySelectorAll("video").forEach((v) => {
      stripFlag(v);
      try {
        v.autoPictureInPicture = !!(autoPip && v === active);
      } catch (_) {}
    });
    applyAdjust(active);
    layout?.render();
  }

  // ---- keep the flag clear: ads/players love to re-set it ----
  let observer = null;
  let interval = null;
  function startKeepClear() {
    if (observer || !enabled) return;
    applyVideoTweaks();
    observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (
          m.type === "attributes" &&
          m.target instanceof HTMLVideoElement
        ) {
          stripFlag(m.target);
        } else if (m.type === "childList") {
          m.addedNodes.forEach((n) => {
            if (n instanceof HTMLVideoElement) stripFlag(n);
            else if (n.querySelectorAll)
              n.querySelectorAll("video").forEach(stripFlag);
          });
        }
      }
    });
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["disablepictureinpicture"],
    });
    // Belt-and-suspenders for players that fight the observer; also self-
    // terminate if the extension was reloaded (orphaned script -> stop quietly).
    interval = setInterval(() => {
      if (!alive()) return teardownAll();
      applyVideoTweaks();
    }, 2000);
  }
  function stopKeepClear() {
    observer?.disconnect();
    observer = null;
    if (interval) clearInterval(interval);
    interval = null;
  }

  // ---- toggle PiP. Must be called from a real user gesture. ----
  // Short lock so duplicate triggers (popup + fan-out, stale listeners) that
  // arrive together collapse into a single on/off instead of flashing.
  let busy = false;
  async function togglePip() {
    if (!enabled || busy) return false;
    busy = true;
    setTimeout(() => (busy = false), 700);
    try {
      if (document.pictureInPictureElement) {
        userWantsPip = false; // explicit user exit -> stop following episodes
        stopPulse();
        await document.exitPictureInPicture();
        return true;
      }
      const video = getActiveVideo();
      if (!video) return false; // no video in THIS frame
      return await enterPip(video);
    } catch (err) {
      console.warn("[Floating PiP] request failed:", err && err.message);
      return false;
    }
  }

  // ---- enter PiP on a specific video ----
  // A gesture-free call only succeeds while another element is already in PiP
  // (Chrome treats it as a swap) -- that's what carries us across episodes.
  async function enterPip(video) {
    if (!enabled || !video) return false;
    stripFlag(video);
    try {
      await video.requestPictureInPicture();
      userWantsPip = true;
      stopPulse();
      return true;
    } catch (_) {
      // Expected when called without a gesture / no PiP to swap from. Stay quiet
      // (the caller pulses the button instead of retrying).
      return false;
    }
  }

  // ---- after an involuntary exit, invite a one-click resume ----
  // Chrome forbids gesture-free re-entry once nothing is in PiP, so we do NOT
  // retry requestPictureInPicture (that just floods the console with
  // "must be handling a user gesture"). Seamless episode hops are handled by the
  // gesture-free *swap* path below; everything else pulses the button.
  function inviteResume() {
    if (userWantsPip && !document.pictureInPictureElement) startPulse();
  }

  // ---- pulse the floating button when we need a click to resume ----
  function startPulse() {
    if (window.self !== window.top || !btn || pulsing) return;
    pulsing = true;
    btn.style.opacity = "1";
    btn.style.animation = "fpip-pulse 1s ease-in-out infinite";
  }
  function stopPulse() {
    pulsing = false;
    if (btn) btn.style.animation = "";
  }

  // ---- follow serial content across episode/ad transitions ----
  // Involuntary exit (element removed on episode change) -> come back.
  document.addEventListener(
    "leavepictureinpicture",
    () => {
      ccStop(); // restore caption state the moment we're back in-page
      if (userWantsPip) inviteResume();
    },
    true
  );
  // A video starts playing while we're in sticky mode.
  document.addEventListener(
    "playing",
    (e) => {
      if (!enabled || !userWantsPip || !(e.target instanceof HTMLVideoElement)) return;
      const v = e.target;
      const cur = document.pictureInPictureElement;
      if (!cur) {
        inviteResume(); // can't grab gesture-free -> pulse for a one-click
      } else if (
        cur !== v &&
        !v.paused &&
        v.videoWidth * v.videoHeight >= cur.videoWidth * cur.videoHeight
      ) {
        enterPip(v); // overlap window: swap to next episode gesture-free
      }
    },
    true
  );

  // ---- floating button (guaranteed user gesture) ----
  let btn = null;
  function ensureButton() {
    if (window.self !== window.top) return; // only top frame
    if (!enabled || !showButton) {
      btn?.remove();
      btn = null;
      return;
    }
    if (btn) return;
    if (!document.getElementById("fpip-style")) {
      const st = document.createElement("style");
      st.id = "fpip-style";
      st.textContent =
        "@keyframes fpip-pulse{0%,100%{box-shadow:0 0 0 0 rgba(45,108,223,.7)}50%{box-shadow:0 0 0 9px rgba(45,108,223,0)}}";
      document.documentElement.appendChild(st);
    }
    btn = document.createElement("button");
    btn.textContent = "⧉ PiP";
    Object.assign(btn.style, {
      position: "fixed",
      top: "16px",
      right: "16px",
      zIndex: "2147483647",
      padding: "6px 10px",
      font: "600 13px system-ui, sans-serif",
      color: "#fff",
      background: "rgba(0,0,0,0.65)",
      border: "1px solid rgba(255,255,255,0.35)",
      borderRadius: "8px",
      cursor: "pointer",
      opacity: "0",
      transition: "opacity .2s",
      userSelect: "none",
    });
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      // Use the same single-owner route as toolbar and browser commands.
      chrome.runtime.sendMessage({type: "FAN_OUT_PIP"}).catch(() => {});
    });
    hookButtonFade();
    document.documentElement.appendChild(btn);
  }
  // Registered once -- ensureButton can run many times as the toggle flips, and
  // re-adding this listener on each call would stack duplicates (leak).
  let fadeHooked = false;
  function hookButtonFade() {
    if (fadeHooked) return;
    fadeHooked = true;
    document.addEventListener("mousemove", (e) => {
      if (!btn || pulsing) return;
      btn.style.opacity = e.clientY < 120 ? "1" : "0";
    });
  }

  // Browser commands are the single source of truth for extension shortcuts.
  // No hardcoded Alt+P listener: remapping in Chrome must remove the old binding.

  // Exposed for in-world callers; the toolbar/command path uses its own
  // self-contained injected toggle (see background.js) and signals us via the
  // DOM events below so sticky/pulse state stays in sync.
  window.__fpipToggle = togglePip;
  document.addEventListener("fpip:entered", () => {
    userWantsPip = true;
    stopPulse();
  });
  document.addEventListener("fpip:userexit", () => {
    userWantsPip = false;
    stopPulse();
  });

  // ===== lite ad-comfort: mute / speed through / mask ads, never blocks =====
  // Non-destructive: it only touches the <video> element (mute, playbackRate)
  // and an overlay -- never the network/stream -- so the worst case is "does
  // nothing", never a broken or stalled player. Paramount+ stitches ads into
  // the same stream (SSAI), so this is a comfort layer, not a true blocker.
  let adComfort = true;
  let adSpeedMode = "auto"; // "auto" (self-tuning) | a fixed number (2/3/5/16)
  let learnedRate = 16; // auto-tuned fastest rate the player honors, per host
  let rateLearnedAt = 0;
  const RATE_LADDER = [16, 8, 5, 3, 2, 1.5, 1];
  const RATE_REPROBE_MS = 6 * 60 * 60 * 1000;
  let inAd = false;
  let inAdSince = 0;
  let prevMuted = null;
  let prevRate = null;
  let adVideo = null; // the exact element we muted/sped, so we restore THAT one
  let adRateTimer = null;
  let adCheckTimer = null;
  let adOverlay = null;
  let adOverlayLabel = null;

  // Per-site ad-UI markers. PiP works everywhere already; this only governs the
  // ad-comfort layer. Selectors are best-effort and site-specific -- refine each
  // site with the DevTools snippet in the README (the console logs which one
  // matched). Set `speed:false` for players that error on playbackRate changes
  // (e.g. if Hulu throws) -- that leaves mute + mask, which is always safe.
  // IMPORTANT: avoid substring matchers like [class*="ad-..."] or
  // [data-testid*="ad"] -- the substring "ad" lives inside loADing, downloAD,
  // shADow, bADge, loAD-unit, etc., causing false positives that fast-forward
  // real content. Use whole-token class selectors (.ad-pod can't match
  // "load-pod") and only collision-proof words ("advertisement"/"commercial").
  const COMMON_AD_SELECTORS = [
    ".ad-indicator",
    ".ad-overlay",
    ".ad-pod",
    ".ad-break",
    ".ad-badge",
    ".ad-countdown",
    ".ad-container",
    "[data-ad-active]",
    '[class*="advertisement" i]',
    '[aria-label*="advertisement" i]',
    '[class*="commercial" i]',
  ];
  const AD_RULES = [
    {
      // YouTube: reliable -- the player gets an `ad-showing` class during ads.
      // Beyond mute + speed, auto-click the Skip button the moment it appears.
      match: ["youtube.com", "youtube-nocookie.com"],
      selectors: [".ad-showing", ".ad-interrupting", ".ytp-ad-player-overlay"],
      skipButtons: [
        ".ytp-ad-skip-button",
        ".ytp-ad-skip-button-modern",
        ".ytp-skip-ad-button",
        ".ytp-ad-skip-button-container button",
      ],
      speed: true,
      verified: true, // .ad-showing is reliable
    },
    {
      match: ["paramountplus.com", "cbs.com"],
      selectors: [".skin-ad", ".ad-ui", ".adCountdown", ...COMMON_AD_SELECTORS],
      speed: true,
      verified: true, // confirmed working in practice
    },
    {
      // Hulu: the timeline playhead gains a `--ad` modifier class during ads
      // (confirmed via DevTools). Ad-specific + whole-token = collision-proof.
      match: ["hulu.com"],
      selectors: [".Timeline__playhead--ad"],
      speed: true, // flip to false if Hulu throws a playback error on ads
      verified: true,
    },
    {
      // Disney+/ESPN: unverified (no confirmed marker yet) -> stay dormant.
      match: ["disneyplus.com"],
      selectors: [...COMMON_AD_SELECTORS],
      speed: true,
    },
    {
      match: ["espn.com", "plus.espn.com"],
      selectors: [...COMMON_AD_SELECTORS],
      speed: true,
    },
  ];
  function activeAdRule() {
    for (const r of AD_RULES) {
      if (r.match.some((d) => host === d || host.endsWith("." + d))) return r;
    }
    return { selectors: COMMON_AD_SELECTORS, speed: true };
  }
  const AD_RULE = activeAdRule();

  function adShowing() {
    for (const sel of AD_RULE.selectors) {
      let el;
      try {
        el = document.querySelector(sel);
      } catch (_) {
        continue;
      }
      if (el && el.getClientRects().length) return sel; // present & rendered
    }
    return null;
  }

  // ---- self-healing "Skip Ad" (YouTube): learned -> hardcoded -> discover ----
  let learnedSkip = []; // selectors learned from real ads (persisted)
  let lastLearnAt = 0;
  let learnedThisAd = false;
  let learnMode = false;
  const LEARN_COOLDOWN_MS = 6 * 60 * 60 * 1000; // once / 6h, let one ad teach us

  chrome.storage?.local?.get(
    { ytSkipLearned: [], ytSkipLearnedAt: 0, adRateByHost: {} },
    (r) => {
      if (!r || chrome.runtime?.lastError) return; // context gone
      learnedSkip = Array.isArray(r.ytSkipLearned) ? r.ytSkipLearned : [];
      lastLearnAt = r.ytSkipLearnedAt || 0;
      const rec = r.adRateByHost && r.adRateByHost[host];
      if (rec && typeof rec.rate === "number") {
        learnedRate = rec.rate;
        rateLearnedAt = rec.at || 0;
      }
    }
  );

  function rememberSkip(sel) {
    if (!sel) return;
    learnedSkip = [sel, ...learnedSkip.filter((s) => s !== sel)].slice(0, 5);
    lastLearnAt = Date.now();
    learnedThisAd = true;
    try {
      chrome.storage?.local?.set({
        ytSkipLearned: learnedSkip,
        ytSkipLearnedAt: lastLearnAt,
      });
    } catch (_) {}
    console.log("[Floating PiP] learned skip selector:", sel);
  }

  function tryClickSelectors(sels) {
    for (const sel of sels || []) {
      let btns;
      try {
        btns = document.querySelectorAll(sel);
      } catch (_) {
        continue;
      }
      for (const b of btns) {
        if (b && b.getClientRects().length) {
          try {
            b.click();
            return sel;
          } catch (_) {}
        }
      }
    }
    return null;
  }

  // Heuristic: a visible, skip-labelled clickable inside the player. Never a
  // click-through ("visit/advertiser"). Returns a reusable selector if found.
  function discoverSkip() {
    const player =
      document.querySelector("#movie_player, .html5-video-player") || document;
    let nodes;
    try {
      nodes = player.querySelectorAll(
        'button, [role="button"], a, [class*="skip" i]'
      );
    } catch (_) {
      return null;
    }
    let best = null;
    let bestScore = 0;
    for (const el of nodes) {
      if (!el.getClientRects().length) continue; // visible only
      const cls = ("" + (el.className || "")).toLowerCase();
      const label = ((el.getAttribute?.("aria-label") || "") + "").toLowerCase();
      const text = (el.textContent || "").trim().toLowerCase();
      const hay = cls + " " + label + " " + text;
      if (!/skip/.test(hay)) continue; // must be skip-related
      if (/visit|advertiser|learn more|shop|website|sponsor/.test(hay)) continue;
      let score = 1;
      if (/skip\s*ad/.test(hay)) score += 3;
      if (/ytp/.test(cls)) score += 2;
      if (/ad-?/.test(cls)) score += 1;
      if (el.tagName === "BUTTON" || el.getAttribute?.("role") === "button")
        score += 1;
      if (text.length && text.length < 24) score += 1;
      if (score > bestScore) {
        best = el;
        bestScore = score;
      }
    }
    if (!best) return null;
    try {
      best.click();
    } catch (_) {}
    const tag = best.tagName.toLowerCase();
    const stable = ("" + (best.className || ""))
      .split(/\s+/)
      .filter((c) => /skip|ytp|ad/.test(c) && /^[a-z0-9-]+$/.test(c));
    if (stable.length) return tag + "." + stable.join(".");
    if (best.id && /^[a-z0-9-]+$/i.test(best.id)) return tag + "#" + best.id;
    return null; // clicked, but no stable selector to remember
  }

  function clickSkip() {
    if (!AD_RULE.skipButtons) return; // skip-capable sites only (YouTube)
    // Fast path: anything we already know.
    if (tryClickSelectors(learnedSkip)) return;
    if (tryClickSelectors(AD_RULE.skipButtons)) return;
    // Heal: after a short grace, discover the current button and remember it.
    if (Date.now() - inAdSince > 1200 && !learnedThisAd) {
      const sel = discoverSkip();
      if (sel) rememberSkip(sel);
    }
  }

  function saveLearnedRate() {
    rateLearnedAt = Date.now();
    try {
      chrome.storage?.local?.get({ adRateByHost: {} }, (r) => {
        if (!r || chrome.runtime?.lastError) return; // context gone
        const map = r.adRateByHost || {};
        map[host] = { rate: learnedRate, at: rateLearnedAt };
        try {
          chrome.storage?.local?.set({ adRateByHost: map });
        } catch (_) {}
      });
    } catch (_) {}
  }
  function nextBelow(r) {
    for (const c of RATE_LADDER) if (c < r - 0.01) return c;
    return 1;
  }
  // Auto mode: observe what the player actually allowed and converge on the
  // highest rate that sticks (per host). Self-corrects down on reset/clamp.
  function applyAdRateAuto(v) {
    const actual = v.playbackRate || 1;
    if (actual < learnedRate - 0.25) {
      const next =
        actual > 1.25
          ? Math.round(actual * 10) / 10 // player clamped & holds -> adopt it
          : nextBelow(learnedRate); // player reset to ~1x -> ratchet down
      if (next < learnedRate) {
        learnedRate = next;
        saveLearnedRate();
        console.log("[Floating PiP] auto ad speed @", host, "->", learnedRate + "x");
      }
    }
    if (learnedRate > 1.01) {
      try {
        v.playbackRate = learnedRate;
      } catch (_) {}
    }
  }
  function applyAdRate(v) {
    if (!v) return;
    if (adSpeedMode === "auto") return applyAdRateAuto(v);
    try {
      if (v.playbackRate < adSpeedMode) v.playbackRate = adSpeedMode;
    } catch (_) {}
  }
  function enterAd(matched) {
    if (inAd) return;
    inAd = true;
    inAdSince = Date.now();
    learnedThisAd = false;
    // Once per cooldown, let one ad play normally (no speed-up) so the skip UI
    // renders at its natural timing and we can (re)learn its selector.
    learnMode =
      !!AD_RULE.skipButtons &&
      (learnedSkip.length === 0 || Date.now() - lastLearnAt > LEARN_COOLDOWN_MS);
    // Auto speed: re-probe from the top of the ladder if we've never tuned this
    // host or the last tuning is stale (the site's clamp policy may have changed).
    if (
      adSpeedMode === "auto" &&
      (rateLearnedAt === 0 || Date.now() - rateLearnedAt > RATE_REPROBE_MS)
    ) {
      learnedRate = RATE_LADDER[0];
    }
    console.log(
      "[Floating PiP] ad via",
      matched,
      learnMode ? "-> learning skip" : AD_RULE.speed ? "-> mute + skip" : "-> mute"
    );
    adVideo = getActiveVideo();
    if (adVideo) {
      prevMuted = adVideo.muted;
      prevRate = adVideo.playbackRate;
      try {
        adVideo.muted = true;
      } catch (_) {}
      if (AD_RULE.speed && !learnMode) {
        applyAdRate(adVideo);
        adRateTimer = setInterval(() => applyAdRate(adVideo), 600);
      }
    }
    showAdOverlay();
  }
  function exitAd(completed = true) {
    if (!inAd) return;
    inAd = false;
    const secs = Math.round((Date.now() - inAdSince) / 1000);
    console.log("[Floating PiP] ad ended (" + secs + "s on screen)");
    try {
      if (completed) chrome.runtime?.sendMessage?.({ type: "AD_SESSION_ENDED" })?.catch(() => {});
    } catch (_) {}
    if (adRateTimer) {
      clearInterval(adRateTimer);
      adRateTimer = null;
    }
    // Restore the EXACT element we touched (not whatever is active now).
    const v = adVideo || getActiveVideo();
    if (v) {
      try {
        if (prevMuted !== null) v.muted = prevMuted;
      } catch (_) {}
      try {
        v.playbackRate = prevRate || 1;
      } catch (_) {}
    }
    adVideo = null;
    prevMuted = prevRate = null;
    hideAdOverlay();
  }

  // Honest label: only claim "skipping" when a speed-up is actually engaged.
  // In auto mode the learned rate can settle at 1x (e.g. YouTube resets it), so
  // this is re-checked every tick while the ad shows.
  function adLabel() {
    if (learnMode) return "Ad — learning skip…";
    const speeding =
      AD_RULE.speed && (adSpeedMode !== "auto" || learnedRate > 1.01);
    return speeding ? "Ad — muted & skipping…" : "Ad — muted";
  }

  function ensureAdStyle() {
    if (document.getElementById("fpip-ad-style")) return;
    const st = document.createElement("style");
    st.id = "fpip-ad-style";
    st.textContent = "@keyframes fpip-bar{0%{left:-40%}100%{left:100%}}";
    document.documentElement.appendChild(st);
  }
  function showAdOverlay() {
    if (window.self !== window.top) return; // overlay only meaningful in page
    ensureAdStyle();
    if (!adOverlay) {
      adOverlay = document.createElement("div");
      Object.assign(adOverlay.style, {
        position: "fixed",
        zIndex: "2147483646",
        background: "#000",
        color: "#9a9aa2",
        font: "600 14px system-ui, sans-serif",
        display: "none",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "12px",
        opacity: "0",
        transition: "opacity .25s ease",
        pointerEvents: "none", // never trap clicks -> never interrupt
      });
      adOverlayLabel = document.createElement("div");
      const barWrap = document.createElement("div");
      Object.assign(barWrap.style, {
        position: "relative",
        width: "120px",
        height: "3px",
        background: "rgba(255,255,255,0.15)",
        borderRadius: "3px",
        overflow: "hidden",
      });
      const bar = document.createElement("div");
      Object.assign(bar.style, {
        position: "absolute",
        top: "0",
        width: "40%",
        height: "100%",
        background: "#2d6cdf",
        borderRadius: "3px",
        animation: "fpip-bar 1.1s linear infinite",
      });
      barWrap.appendChild(bar);
      adOverlay.appendChild(adOverlayLabel);
      adOverlay.appendChild(barWrap);
      document.documentElement.appendChild(adOverlay);
    }
    adOverlayLabel.textContent = adLabel();
    adOverlay.style.display = "flex";
    positionOverlay();
    requestAnimationFrame(() => {
      if (adOverlay) adOverlay.style.opacity = "1"; // fade in
    });
  }
  function positionOverlay() {
    if (!adOverlay) return;
    // Track the SAME element we muted/sped (adVideo), not a re-resolved pick --
    // same principle as the v1.10.1 mute fix.
    const v = adVideo || getActiveVideo();
    if (!v) return;
    const r = v.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return; // video offscreen (e.g. in PiP)
    Object.assign(adOverlay.style, {
      left: r.left + "px",
      top: r.top + "px",
      width: r.width + "px",
      height: r.height + "px",
    });
  }
  function hideAdOverlay() {
    if (!adOverlay) return;
    adOverlay.style.opacity = "0"; // fade out, then hide
    setTimeout(() => {
      if (adOverlay && adOverlay.style.opacity === "0")
        adOverlay.style.display = "none";
    }, 300);
  }

  function startAdWatch() {
    // Only run where ad detection is confirmed reliable. On unverified sites we
    // stay fully dormant so a wrong selector can never touch real content.
    if (adCheckTimer || !enabled || !adComfort || !AD_RULE.verified) return;
    adCheckTimer = setInterval(() => {
      if (!alive()) return teardownAll(); // extension reloaded -> stop quietly
      try {
        tickAdWatch();
      } catch (_) {}
    }, 500);
  }
  function tickAdWatch() {
    const on = adShowing();
    if (on && !inAd) enterAd(on);
    else if (!on && inAd) exitAd();
    if (inAd) {
        // Re-assert mute every tick on the SAME element. In an ad pod ("Ad 1
        // of 2") the next ad starts under the same .ad-showing without a fresh
        // enterAd, and the player re-sets audio -- so set-once would leave ad 2
        // audible. Tied to adVideo so we never mute a different (content) element.
        if (adVideo && !adVideo.muted) {
          try {
            adVideo.muted = true;
          } catch (_) {}
        }
      positionOverlay();
      if (adOverlayLabel) adOverlayLabel.textContent = adLabel();
      clickSkip(); // dismiss YouTube "Skip Ad" as soon as it shows
      if (Date.now() - inAdSince > 4 * 60 * 1000) exitAd(); // safety backstop
    }
  }
  function stopAdWatch() {
    if (adCheckTimer) {
      clearInterval(adCheckTimer);
      adCheckTimer = null;
    }
    exitAd(false);
  }

  // ===== smart speed: dialogue-aware playback rate (opt-in) =====
  // Taps audio via WebAudio and watches energy in the speech band (~300-3400Hz):
  // voice present -> talk rate (e.g. 1.25x), sustained quiet -> quiet rate
  // (e.g. 1.5x). Drop to talk rate is INSTANT (don't clip word starts); speeding
  // up needs ~700ms of quiet (don't flap on mid-sentence pauses).
  // HARD-GATED to non-DRM hosts: createMediaElementSource on Widevine (or
  // cross-origin-tainted) media outputs permanent silence -- it would
  // irreversibly kill audio on Paramount+/Hulu/Disney+. YouTube only for now.
  let smartSpeed = false;
  let ssRates = { talk: 1.25, quiet: 1.5 };
  let ssTimer = null;
  let ssCtx = null;
  let ssDriven = null; // video whose rate we currently own
  let ssBase = null; // user's manually-chosen rate (null -> use ssRates as-is)
  let ssLastSet = null; // rate WE last wrote; anything else observed = external
  let ssExt = []; // timestamps of recent external rate changes
  let ssHoldUntil = 0; // while set, a player is fighting us: don't adopt, override
  let ssSilentSince = 0;
  let ssSilenceWarned = false;
  let ssStartedLog = false;
  let ssQuietSince = 0;
  let ssPeak = 0.05; // decaying rolling peak -> adaptive threshold
  let ssState = "talk";
  const ssNodes = new WeakMap();
  const ssConnections = new Set(); // video -> {analyser, buf}
  // Non-DRM hosts where the WebAudio tap is safe. Plex personal libraries are
  // DRM-free (and the mediaKeys guard still skips any DRM'd Plex FAST content).
  // Dropout (Vimeo OTT) is DRM-free HLS; its player iframe is embed.vhx.tv.
  const SS_HOSTS = [
    "youtube.com",
    "youtube-nocookie.com",
    "plex.tv",
    "dropout.tv",
    "vhx.tv",
  ];
  let ssExtraHosts = []; // user-allowlisted hosts (e.g. a NAS Plex at a local IP)

  function ssHostAllowed(h) {
    return (
      SS_HOSTS.some((d) => h === d || h.endsWith("." + d)) ||
      ssExtraHosts.includes(h)
    );
  }
  function ssAllowedHere() {
    if (ssHostAllowed(host)) return true;
    // Iframe-embedded players (e.g. Dropout's embed.vhx.tv) run us under the
    // frame's host; honor an allowlisted TOP page via ancestorOrigins too.
    try {
      for (const o of location.ancestorOrigins || []) {
        if (ssHostAllowed(new URL(o).hostname)) return true;
      }
    } catch (_) {}
    return false;
  }
  function ssAttach(v) {
    if (!v) return null;
    if (v.mediaKeys) {
      if (!v.dataset.fpipSsSkip) {
        v.dataset.fpipSsSkip = "1";
        console.log("[Floating PiP] smart speed: DRM audio -- skipping");
      }
      return null; // never touch DRM audio
    }
    let rec = ssNodes.get(v);
    if (rec) {
      if (rec.bypassed) {
        rec.src.disconnect();
        rec.src.connect(rec.analyser);
        rec.analyser.connect(ssCtx.destination);
        rec.bypassed = false;
      }
      return rec;
    }
    // Tapping a cross-origin stream (without CORS opt-in) silences it
    // irreversibly -- refuse instead of risking the audio. blob:/data: (MSE)
    // and same-origin URLs are safe; crossOrigin-attributed elements untaint.
    const mediaSrc = v.currentSrc || v.src || "";
    let safeSrc =
      mediaSrc.startsWith("blob:") || mediaSrc.startsWith("data:");
    if (!safeSrc && mediaSrc) {
      try {
        safeSrc = new URL(mediaSrc, location.href).origin === location.origin;
      } catch (_) {}
    }
    if (!safeSrc && !v.crossOrigin) {
      if (!v.dataset.fpipSsSkip) {
        v.dataset.fpipSsSkip = "1";
        console.log(
          "[Floating PiP] smart speed: cross-origin stream -- can't analyze" +
            " audio safely here"
        );
      }
      return null;
    }
    try {
      ssCtx = ssCtx || new AudioContext();
      const src = ssCtx.createMediaElementSource(v);
      const analyser = ssCtx.createAnalyser();
      analyser.fftSize = 2048;
      src.connect(analyser);
      analyser.connect(ssCtx.destination); // keep audio audible
      rec = { src, analyser, buf: new Uint8Array(analyser.frequencyBinCount), bypassed:false };
      ssConnections.add(rec);
      ssNodes.set(v, rec);
      console.log("[Floating PiP] smart speed: analyser attached");
      return rec;
    } catch (_) {
      if (!v.dataset.fpipSsSkip) {
        v.dataset.fpipSsSkip = "1";
        console.log(
          "[Floating PiP] smart speed: cannot attach analyser (audio element" +
            " already claimed by the site or another extension)"
        );
      }
      return null;
    }
  }
  // Effective targets: if the user picked their own speed (via the player UI),
  // that becomes the dialogue pace and quiet scales by the talk->quiet ratio
  // (1.25/1.5 defaults -> x1.2). Otherwise the configured absolutes apply.
  function ssTargets() {
    if (ssBase == null) return ssRates;
    const factor = ssRates.quiet / (ssRates.talk || 1);
    return { talk: ssBase, quiet: Math.min(16, ssBase * factor) };
  }
  function ssTick() {
    if (!alive()) return teardownAll();
    if (!smartSpeed || !enabled || inAd) return; // never fight the ad logic
    const v = getActiveVideo();
    if (!v || v.paused) return;
    const rec = ssAttach(v);
    if (!rec) return;
    if (ssCtx.state === "suspended") {
      ssCtx.resume().catch(() => {});
      return;
    }
    // Context-awareness: a rate we didn't write means the user (or player UI)
    // chose a speed -- adopt it as the new base instead of stomping it. BUT a
    // player that keeps resetting the rate (e.g. Plex during a transcode) looks
    // like repeated "user" changes -- a one-off is intent, a burst is a fight:
    // stop adopting and hold our target.
    const cur = v.playbackRate;
    if (v !== ssDriven) {
      ssRestoreRate();
      ssBase = Math.abs(cur - 1) > 0.01 ? cur : null; // pre-set speed on attach
      ssLastSet = null;
      ssExt = [];
      ssHoldUntil = 0;
    } else if (ssLastSet != null && Math.abs(cur - ssLastSet) > 0.01) {
      const now2 = Date.now();
      ssExt = ssExt.filter((ts) => now2 - ts < 10000);
      ssExt.push(now2);
      if (now2 < ssHoldUntil || ssExt.length >= 3) {
        if (now2 >= ssHoldUntil) {
          ssHoldUntil = now2 + 60000;
          console.log(
            "[Floating PiP] smart speed: player keeps resetting the rate -> overriding it"
          );
        }
        // don't adopt; our target gets reasserted below
      } else {
        ssBase = cur;
        console.log("[Floating PiP] smart speed base ->", cur + "x (user set)");
      }
    }
    const a = rec.analyser;
    a.getByteFrequencyData(rec.buf);
    const binHz = ssCtx.sampleRate / a.fftSize;
    const lo = Math.floor(300 / binHz);
    const hi = Math.min(rec.buf.length - 1, Math.ceil(3400 / binHz));
    let sum = 0;
    for (let i = lo; i <= hi; i++) sum += rec.buf[i];
    const level = sum / (hi - lo + 1) / 255;
    const now = Date.now();
    // Watchdog: analyser reading dead silence while unmuted playback runs means
    // the stream is cross-origin-tainted (the tap also silences the audio).
    if (level < 0.003 && !v.muted && v.volume > 0) {
      if (!ssSilentSince) ssSilentSince = now;
      else if (now - ssSilentSince > 10000 && !ssSilenceWarned) {
        ssSilenceWarned = true;
        console.warn(
          "[Floating PiP] smart speed: no audio signal for 10s. If the video is" +
            " also silent, this stream is cross-origin-tainted -- smart speed" +
            " can't run here; disable it and reload the tab to restore audio."
        );
      }
    } else {
      ssSilentSince = 0;
    }
    ssPeak = Math.max(level, ssPeak * 0.999);
    const talking = level > ssPeak * 0.25;
    if (talking) {
      ssQuietSince = 0;
      ssState = "talk";
    } else {
      if (!ssQuietSince) ssQuietSince = now;
      if (now - ssQuietSince > 700) ssState = "quiet";
    }
    const t = ssTargets();
    const target = ssState === "talk" ? t.talk : t.quiet;
    if (Math.abs(v.playbackRate - target) > 0.01) {
      try {
        v.playbackRate = target;
      } catch (_) {}
    }
    ssLastSet = target;
    ssDriven = v;
  }
  function ssStart() {
    if (ssTimer || !smartSpeed || !enabled) return;
    if (!ssAllowedHere()) {
      if (!ssStartedLog) {
        ssStartedLog = true;
        console.log(
          "[Floating PiP] smart speed: host not on allowlist (" + host + ")"
        );
      }
      return;
    }
    if (!ssStartedLog) {
      ssStartedLog = true;
      console.log("[Floating PiP] smart speed: watching for dialogue");
    }
    ssTimer = setInterval(ssTick, 150);
  }
  function ssRestoreRate() {
    if (ssDriven && ssLastSet != null && Math.abs(ssDriven.playbackRate - ssLastSet) < 0.01) {
      try { ssDriven.playbackRate = ssBase ?? 1; } catch (_) {}
    }
    ssDriven = null;
    ssLastSet = null;
  }
  function ssStop() {
    if (ssTimer) clearInterval(ssTimer);
    ssTimer = null;
    ssRestoreRate();
    // A MediaElementSource cannot be detached back to native playback. Bypass
    // the analyser, keeping the destination connected so disabling stays audible.
    for (const rec of ssConnections) {
      if (rec.bypassed) continue;
      try {
        rec.src.disconnect();
        rec.analyser.disconnect();
        rec.src.connect(ssCtx.destination);
        rec.bypassed = true;
      } catch (_) {}
    }
  }

  // ===== cosmetic: hide YouTube's "Includes paid promotion" overlay =====
  // A DOM overlay drawn over the player; clickable, so it's easy to hit by
  // accident. Purely cosmetic hide, YouTube only, toggleable.
  let hidePaidOverlay = true;
  function applyPaidOverlayHide() {
    const wanted = enabled && hidePaidOverlay && ytIsHere();
    let st = document.getElementById("fpip-cosmetic");
    if (wanted && !st) {
      st = document.createElement("style");
      st.id = "fpip-cosmetic";
      st.textContent =
        ".ytp-paid-content-overlay,.ytp-inline-preview-paid-content-overlay" +
        "{display:none!important}";
      document.documentElement.appendChild(st);
    } else if (!wanted && st) {
      st.remove();
    }
  }

  // ===== captions in PiP =====
  // Site captions are HTML overlays, which the PiP window can't show. Native
  // native PiP caption rendering varies by browser, so experimentally we
  // either (a) flip an existing loaded track to "showing", or (b) mirror the
  // site's on-screen caption DOM into live VTT cues on the video. Only active
  // while in PiP; everything is restored on exit. DRM-safe (no frame access).
  let ccPip = true;
  let ccTimer = null;
  let ccGeneration = 0;
  let ccAbort = null;
  let ccSaved = null; // [{t, mode}] original track modes to restore
  let ccVideo = null;
  let ccNative = null; // a real loaded track we flipped to "showing"
  let ccMode = "mirror"; // "native" | "yt" | "mirror"
  let ytCcCache = {}; // videoId -> cue list or null (kept to one entry)
  let ccLastText = "";
  let ccStartAt = 0;
  let ccFoundAny = false;
  let ccWarned = false;
  const ccTracks = new WeakMap(); // video -> our mirror TextTrack
  const CC_SELECTOR =
    '.ytp-caption-segment,[class*="caption" i],[class*="subtitle" i],[class*="timedtext" i],[class*="libjass" i]';

  // Deep query fallback: walk open shadow roots (some players render captions
  // inside them). Only used when the plain query finds nothing caption-ish.
  function ccQueryAll() {
    let nodes;
    try {
      nodes = document.querySelectorAll(CC_SELECTOR);
    } catch (_) {
      return [];
    }
    if (nodes.length) return Array.from(nodes);
    const out = [];
    const walk = (root, depth) => {
      if (depth > 4) return;
      let list;
      try {
        list = root.querySelectorAll(CC_SELECTOR);
      } catch (_) {
        return;
      }
      out.push(...list);
      let all;
      try {
        all = root.querySelectorAll("*");
      } catch (_) {
        return;
      }
      for (const el of all) if (el.shadowRoot) walk(el.shadowRoot, depth + 1);
    };
    walk(document, 0);
    return out;
  }

  function ccScrape(v) {
    const vr = v.getBoundingClientRect();
    const nodes = ccQueryAll();
    const cands = [];
    for (const el of nodes) {
      if (
        el.closest(
          'button,[role="button"],[role="menu"],[role="menuitem"],[role="dialog"],select,input'
        )
      )
        continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      // must overlap the video's box (captions sit over the picture)
      if (
        r.right < vr.left ||
        r.left > vr.right ||
        r.bottom < vr.top ||
        r.top > vr.bottom
      )
        continue;
      const t = (el.textContent || "").trim();
      if (!t || t.length > 300) continue;
      cands.push(el);
    }
    // leaves only: drop wrappers that contain another candidate
    const leaves = cands.filter(
      (el) => !cands.some((o) => o !== el && el.contains(o))
    );
    const seen = new Set();
    const lines = [];
    for (const el of leaves) {
      const t = (el.textContent || "").trim();
      if (t && !seen.has(t)) {
        seen.add(t);
        lines.push(t);
      }
    }
    return lines.join("\n").slice(0, 300);
  }

  // ---- YouTube: the page player stops rendering its caption overlay while in
  // PiP ("Playing in picture-in-picture" placeholder), so mirroring finds
  // nothing. Instead, fetch the video's actual caption (timedtext) track and
  // load it as real cues -- exact timing, rendered natively in the PiP window.
  function ytIsHere() {
    return /(^|\.)youtube(-nocookie)?\.com$/.test(host);
  }
  async function ytLoadCaptions(v, generation, signal) {
    if (!ytIsHere()) return false;
    const ccBtn = document.querySelector(".ytp-subtitles-button");
    if (ccBtn && ccBtn.getAttribute("aria-pressed") === "false") {
      console.log(
        "[Floating PiP] PiP captions: YouTube CC is off -- turn CC on in the" +
          " player, then re-float"
      );
      return false;
    }
    let id = "";
    try {
      id = new URL(location.href).searchParams.get("v") || "";
    } catch (_) {}
    if (!id) return false;
    let cues = ytCcCache[id];
    if (cues === undefined) {
      cues = null;
      try {
        const html = await (
          await fetch(location.href, { credentials: "same-origin", signal })
        ).text();
        const m = html.match(/"captionTracks":(\[.*?\])\s*,\s*"/);
        if (m) {
          const tracks = JSON.parse(m[1]);
          const lang = (navigator.language || "en").split("-")[0];
          const pick =
            tracks.find(
              (t) =>
                !/^a\./.test(t.vssId || "") &&
                (t.languageCode || "").startsWith(lang)
            ) ||
            tracks.find((t) => (t.languageCode || "").startsWith(lang)) ||
            tracks.find((t) => !/^a\./.test(t.vssId || "")) ||
            tracks[0];
          if (pick && pick.baseUrl) {
            const data = await (
              await fetch(pick.baseUrl + "&fmt=json3", {
                credentials: "same-origin", signal,
              })
            ).json();
            cues = [];
            for (const ev of data.events || []) {
              const text = (ev.segs || [])
                .map((s) => s.utf8 || "")
                .join("")
                .trim();
              if (!text || ev.tStartMs == null) continue;
              cues.push({
                s: ev.tStartMs / 1000,
                e: (ev.tStartMs + (ev.dDurationMs || 3000)) / 1000,
                text,
              });
            }
            if (!cues.length) cues = null;
          }
        }
      } catch (_) {
        cues = null;
      }
      ytCcCache = { [id]: cues }; // single-entry cache
    }
    if (!cues || signal.aborted || generation !== ccGeneration || !enabled || !ccPip || ccVideo !== v) return false;
    const tr = ccEnsureTrack(v);
    ccClearCues(tr);
    for (const c of cues) {
      try {
        tr.addCue(new VTTCue(c.s, c.e, c.text));
      } catch (_) {}
    }
    console.log(
      "[Floating PiP] PiP captions: loaded YouTube caption track (" +
        cues.length +
        " cues)"
    );
    return true;
  }

  function ccEnsureTrack(v) {
    let tr = ccTracks.get(v);
    if (!tr) {
      tr = v.addTextTrack("captions", "fpip", "");
      ccTracks.set(v, tr);
    }
    tr.mode = "showing";
    return tr;
  }
  function ccClearCues(tr) {
    try {
      while (tr.cues && tr.cues.length) tr.removeCue(tr.cues[0]);
    } catch (_) {}
  }

  function ccTick() {
    const v = document.pictureInPictureElement;
    if (!(v instanceof HTMLVideoElement)) return ccStop();
    if (ccMode === "native" && ccNative) {
      // Players that draw their own overlay flip the track back to "hidden";
      // re-assert every tick or the PiP captions die moments after entry.
      if (ccNative.mode !== "showing") {
        try {
          ccNative.mode = "showing";
        } catch (_) {}
      }
      return;
    }
    if (ccMode === "yt") {
      const tr = ccTracks.get(v);
      if (tr && tr.mode !== "showing") {
        try {
          tr.mode = "showing";
        } catch (_) {}
      }
      return;
    }
    const text = ccScrape(v);
    if (text) ccFoundAny = true;
    else if (!ccFoundAny && !ccWarned && Date.now() - ccStartAt > 12000) {
      ccWarned = true;
      console.log(
        "[Floating PiP] PiP captions: no caption text found after 12s. Are" +
          " subtitles turned on in the player? If they are, this site's" +
          " caption element doesn't match my selectors -- capture it in" +
          " DevTools and report it."
      );
    }
    if (text === ccLastText) return;
    ccLastText = text;
    const tr = ccEnsureTrack(v);
    ccClearCues(tr);
    if (text) {
      try {
        // Long end time: the cue lives until the next text change clears it.
        tr.addCue(
          new VTTCue(Math.max(0, v.currentTime - 0.1), v.currentTime + 600, text)
        );
      } catch (_) {}
    }
  }

  function ccStart(v) {
    if (!ccPip || !enabled || !(v instanceof HTMLVideoElement)) return;
    if (ccTimer && ccVideo === v) return;
    ccStop();
    ccAbort = new AbortController();
    const generation = ccGeneration;
    ccVideo = v;
    ccSaved = [];
    ccNative = null;
    ccStartAt = Date.now();
    ccFoundAny = false;
    ccWarned = false;
    ccLastText = "";
    try {
      for (const t of v.textTracks) {
        if (t.label === "fpip") continue;
        ccSaved.push({ t, mode: t.mode });
        // A loaded track (cues populated) means the site is really using it.
        if (
          !ccNative &&
          (t.kind === "captions" || t.kind === "subtitles") &&
          t.cues &&
          t.cues.length
        )
          ccNative = t;
      }
    } catch (_) {}
    if (ccNative) {
      ccMode = "native";
      try {
        ccNative.mode = "showing"; // Native PiP rendering remains browser-dependent.
      } catch (_) {}
      console.log("[Floating PiP] PiP captions: native track (re-asserting)");
    } else {
      ccMode = "mirror";
      console.log("[Floating PiP] PiP captions: mirroring on-page captions");
      if (ytIsHere()) {
        // YouTube unrenders its overlay in PiP; load the real track instead.
        ytLoadCaptions(v, generation, ccAbort.signal)
          .then((ok) => {
            if (ok && generation === ccGeneration && ccTimer && ccVideo === v) {
              ccMode = "yt";
              ccFoundAny = true; // suppress the mirror "nothing found" warning
            }
          })
          .catch(() => {});
      }
    }
    // Timer runs for ALL paths: native/yt re-assert modes, mirror scrapes.
    ccTimer = setInterval(() => {
      if (!alive()) return teardownAll();
      try {
        ccTick();
      } catch (_) {}
    }, 300);
  }
  function ccStop() {
    ccGeneration++;
    ccAbort?.abort();
    ccAbort = null;
    if (ccTimer) clearInterval(ccTimer);
    ccTimer = null;
    ccNative = null;
    ccMode = "mirror";
    if (ccSaved) {
      for (const { t, mode } of ccSaved) {
        try {
          t.mode = mode;
        } catch (_) {}
      }
      ccSaved = null;
    }
    if (ccVideo) {
      const tr = ccTracks.get(ccVideo);
      if (tr) {
        ccClearCues(tr);
        try {
          tr.mode = "disabled";
        } catch (_) {}
      }
      ccVideo = null;
    }
    ccLastText = "";
  }

  document.addEventListener(
    "enterpictureinpicture",
    (e) => {
      if (e.target instanceof HTMLVideoElement) ccStart(e.target);
    },
    true
  );

  // ---- enabled state from storage (per-site toggle + ad-comfort) ----
  function applyEnabled(hosts) {
    disabledHosts = Array.isArray(hosts) ? hosts : [];
    enabled = !core.isDisabled(disabledHosts, policyHosts());
    if (enabled) {
      startKeepClear();
      if (adComfort) startAdWatch();
      if (smartSpeed) ssStart();
      applyPaidOverlayHide();
      if (document.body) ensureButton();
      else
        document.addEventListener("DOMContentLoaded", ensureButton, {
          once: true,
        });
    } else {
      teardownAll();
    }
  }

  layout = FloatingVideoLayout.create({getVideo:getActiveVideo,getSettings:()=>viewSettings,onAction:runAction});
  document.addEventListener("keydown", event => {
    if (!enabled || !layout.mode || event.defaultPrevented || event.repeat || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
    const target=event.composedPath()[0];
    if (target?.isContentEditable || target?.closest?.("input,textarea,select,[role=textbox]")) return;
    if (event.key === "Escape") { event.preventDefault(); layout.close(); applyVideoTweaks(); }
    else if (viewSettings.miniKeys && /^[1-4]$/.test(event.key)) {
      event.preventDefault(); runAction("snap-"+event.key);
    }
  }, true);

  function parseSpeedMode(val) {
    return val === "auto" || val == null ? "auto" : Number(val) || "auto";
  }
  chrome.storage?.sync?.get(
    {
      disabledHosts: [],
      adComfort: true,
      adSpeed: "auto",
      autoPip: true,
      showButton: false,
      videoAdjust: ADJ_DEFAULTS,
      viewSettings: core.VIEW_DEFAULTS,
      smartSpeed: false,
      smartSpeedRates: { talk: 1.25, quiet: 1.5 },
      ssExtraHosts: [],
      ccPip: true,
      hidePaidOverlay: true,
    },
    async (res) => {
      if (!res || chrome.runtime?.lastError) return; // context gone
      try {
        const policy = await chrome.runtime.sendMessage({type: "GET_TAB_HOST"});
        tabHost = policy?.host || "";
      } catch (_) { return; } // Retry by reloading the tab if the worker is unavailable.
      hidePaidOverlay = res.hidePaidOverlay !== false;
      adComfort = res.adComfort !== false;
      adSpeedMode = parseSpeedMode(res.adSpeed);
      autoPip = res.autoPip !== false;
      showButton = res.showButton === true;
      adj = { ...ADJ_DEFAULTS, ...(res.videoAdjust || {}) };
      viewSettings=core.normalizeView(res.viewSettings);
      smartSpeed = res.smartSpeed === true;
      ssRates = { talk: 1.25, quiet: 1.5, ...(res.smartSpeedRates || {}) };
      ssExtraHosts = Array.isArray(res.ssExtraHosts) ? res.ssExtraHosts : [];
      ccPip = res.ccPip !== false;
      applyEnabled(res.disabledHosts);
      // Already floating when we loaded (e.g. script injected late)? Attach now.
      if (ccPip && document.pictureInPictureElement) {
        ccStart(document.pictureInPictureElement);
      }
    }
  );
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area === "sync") {
      if (changes.disabledHosts) applyEnabled(changes.disabledHosts.newValue);
      if (changes.adSpeed) adSpeedMode = parseSpeedMode(changes.adSpeed.newValue);
      if (changes.adComfort) {
        adComfort = changes.adComfort.newValue !== false;
        if (adComfort && enabled) startAdWatch();
        else stopAdWatch();
      }
      if (changes.autoPip) {
        autoPip = changes.autoPip.newValue !== false;
        if (enabled) applyVideoTweaks();
      }
      if (changes.showButton) {
        showButton = changes.showButton.newValue === true;
        if (enabled) ensureButton();
      }
      if (changes.viewSettings) {
        viewSettings=core.normalizeView(changes.viewSettings.newValue);
        if (enabled) applyVideoTweaks();
      }
      if (changes.videoAdjust) {
        adj = { ...ADJ_DEFAULTS, ...(changes.videoAdjust.newValue || {}) };
        if (enabled) applyVideoTweaks();
      }
      if (changes.smartSpeed) {
        smartSpeed = changes.smartSpeed.newValue === true;
        if (smartSpeed && enabled) ssStart();
        else ssStop();
      }
      if (changes.ssExtraHosts) {
        ssExtraHosts = Array.isArray(changes.ssExtraHosts.newValue)
          ? changes.ssExtraHosts.newValue
          : [];
        ssStartedLog = false; // re-log the allowlist verdict for this host
        if (smartSpeed && enabled && ssAllowedHere()) ssStart();
        else if (!ssAllowedHere()) ssStop();
      }
      if (changes.smartSpeedRates) {
        ssRates = {
          talk: 1.25,
          quiet: 1.5,
          ...(changes.smartSpeedRates.newValue || {}),
        };
      }
      if (changes.hidePaidOverlay) {
        hidePaidOverlay = changes.hidePaidOverlay.newValue !== false;
        applyPaidOverlayHide();
      }
      if (changes.ccPip) {
        ccPip = changes.ccPip.newValue !== false;
        if (ccPip && enabled && document.pictureInPictureElement) {
          ccStart(document.pictureInPictureElement);
        } else if (!ccPip) {
          ccStop();
        }
      }
    } else if (area === "local") {
      // Live-apply resets from the status page.
      if (changes.adRateByHost) {
        const rec = changes.adRateByHost.newValue?.[host];
        if (rec && typeof rec.rate === "number") {
          learnedRate = rec.rate;
          rateLearnedAt = rec.at || 0;
        } else {
          learnedRate = RATE_LADDER[0]; // forgotten -> re-probe next ad
          rateLearnedAt = 0;
        }
      }
      if (changes.ytSkipLearned) {
        learnedSkip = Array.isArray(changes.ytSkipLearned.newValue)
          ? changes.ytSkipLearned.newValue
          : [];
      }
    }
  });
})();
