importScripts("pip-core.js");

// Service worker.
//
// PiP is toggled by injecting a self-contained function into the page. Injection
// from a user action (toolbar click / keyboard command) preserves the user
// gesture that requestPictureInPicture() requires -- a plain message does not,
// which is why the old popup button failed. The function is self-contained so it
// doesn't depend on the content script's world, and it dispatches DOM events so
// the content script can layer its sticky/pulse behavior on top.

function injectedToggle(disabledHosts = [], tabHost = "") {
  const hosts = [tabHost, location.hostname];
  for (const origin of location.ancestorOrigins || []) {
    try { hosts.push(new URL(origin).hostname); } catch (_) {}
  }
  if (disabledHosts.some(h => hosts.includes(h))) return {status: "disabled"};
  function pick() {
    const vids = Array.from(document.querySelectorAll("video"));
    const sized = vids.filter((v) => v.videoWidth > 0);
    const playing = sized.filter((v) => !v.paused);
    const pool = playing.length ? playing : sized.length ? sized : vids;
    pool.sort(
      (a, b) => b.videoWidth * b.videoHeight - a.videoWidth * a.videoHeight
    );
    return pool[0];
  }
  (async () => {
    try {
      if (document.pictureInPictureElement) {
        document.dispatchEvent(new CustomEvent("fpip:userexit"));
        await document.exitPictureInPicture();
        return;
      }
      const v = pick();
      if (!v) return; // no video in this frame
      try {
        v.disablePictureInPicture = false;
      } catch (_) {}
      v.removeAttribute("disablepictureinpicture");
      await v.requestPictureInPicture();
      document.dispatchEvent(new CustomEvent("fpip:entered"));
    } catch (e) {
      console.warn("[Floating PiP] toggle:", e && e.message);
    }
  })();
}

async function callToggle(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const {disabledHosts = []} = await chrome.storage.sync.get({disabledHosts: []});
  const tabHost = hostOf(tab.url);
  if (FloatingVideoCore.isDisabled(disabledHosts, [tabHost])) return {status: "disabled"};
  return chrome.scripting
    .executeScript({
      target: { tabId, allFrames: true },
      func: injectedToggle,
      args: [disabledHosts, tabHost],
    })
    .catch(() => {});
}

// Toolbar icon click -> float / unfloat.
chrome.action.onClicked.addListener((tab) => {
  if (tab?.id != null) callToggle(tab.id).catch(() => {});
});

// Keyboard command (Alt+P by default; configurable at chrome://extensions/shortcuts).
chrome.commands.onCommand.addListener((command) => {
  if (command !== "toggle-pip") return;
  chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
    const tab = tabs[0];
    if (tab?.id != null) callToggle(tab.id).catch(() => {});
  });
});

// Per-tab count of ads the comfort layer muted/skipped, shown on the badge.
const adCounts = new Map();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  if (tabId == null) return;
  if (msg?.type === "GET_TAB_HOST") {
    sendResponse({host: hostOf(sender.tab?.url)});
  } else if (msg?.type === "FAN_OUT_PIP") {
    callToggle(tabId).catch(() => {});
  } else if (msg?.type === "AD_SKIPPED") {
    const n = (adCounts.get(tabId) || 0) + 1;
    adCounts.set(tabId, n);
    chrome.action.setBadgeBackgroundColor({ tabId, color: "#2d6cdf" });
    chrome.action.setBadgeText({ tabId, text: String(n) });
    // Persistent per-host total for the status page.
    const host = hostOf(sender.tab?.url);
    if (host) {
      chrome.storage.local.get({ adStatsByHost: {} }, (r) => {
        const m = r.adStatsByHost || {};
        m[host] = (m[host] || 0) + 1;
        chrome.storage.local.set({ adStatsByHost: m });
      });
    }
  }
});

chrome.tabs.onRemoved.addListener((tabId) => adCounts.delete(tabId));

// ---- right-click the toolbar icon: per-site disable + ad-comfort toggle ----
const MENU_DISABLE = "fpip-disable";
const MENU_ADCOMFORT = "fpip-adcomfort";
const MENU_AUTOPIP = "fpip-autopip";
const MENU_BUTTON = "fpip-button";
const MENU_SMART = "fpip-smartspeed";
const MENU_SSHERE = "fpip-sshere";
// Built-in smart-speed hosts (mirror of SS_HOSTS in content.js, display only).
const SS_BUILTIN = [
  "youtube.com",
  "youtube-nocookie.com",
  "plex.tv",
  "dropout.tv",
  "vhx.tv",
];
const MENU_CC = "fpip-ccpip";
const MENU_SPEED = "fpip-speed";
const MENU_STATUS = "fpip-status";
const SPEED_OPTS = ["auto", 2, 3, 5, 16];
const SPEED_TITLE = {
  auto: "Auto (smart)",
  2: "2×",
  3: "3×",
  5: "5×",
  16: "16× (max)",
};

function createMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_DISABLE,
      title: "Disable floating video on this site",
      type: "checkbox",
      checked: false,
      contexts: ["action"],
    });
    chrome.contextMenus.create({
      id: MENU_ADCOMFORT,
      title: "Mute & skip ads (experimental)",
      type: "checkbox",
      checked: true,
      contexts: ["action"],
    });
    chrome.contextMenus.create({
      id: MENU_AUTOPIP,
      title: "Auto-float when I switch tabs",
      type: "checkbox",
      checked: true,
      contexts: ["action"],
    });
    chrome.contextMenus.create({
      id: MENU_BUTTON,
      title: "Show floating PiP button on page",
      type: "checkbox",
      checked: false,
      contexts: ["action"],
    });
    chrome.contextMenus.create({
      id: MENU_SMART,
      title: "Smart speed (dialogue-aware; YouTube, Plex, Dropout)",
      type: "checkbox",
      checked: false,
      contexts: ["action"],
    });
    chrome.contextMenus.create({
      id: MENU_SSHERE,
      title: "Smart speed: allow this site",
      type: "checkbox",
      checked: false,
      contexts: ["action"],
    });
    chrome.contextMenus.create({
      id: MENU_CC,
      title: "Captions in floating window",
      type: "checkbox",
      checked: true,
      contexts: ["action"],
    });
    chrome.contextMenus.create({
      id: MENU_SPEED,
      title: "Ad fast-forward speed",
      contexts: ["action"],
    });
    for (const s of SPEED_OPTS) {
      chrome.contextMenus.create({
        id: MENU_SPEED + ":" + s,
        parentId: MENU_SPEED,
        title: SPEED_TITLE[s],
        type: "radio",
        checked: s === "auto",
        contexts: ["action"],
      });
    }
    chrome.contextMenus.create({
      id: "fpip-sep",
      type: "separator",
      contexts: ["action"],
    });
    chrome.contextMenus.create({
      id: MENU_STATUS,
      title: "Status & learned data…",
      contexts: ["action"],
    });
  });
}
chrome.runtime.onInstalled.addListener(createMenu);
chrome.runtime.onStartup.addListener(createMenu);

function hostOf(url) { return FloatingVideoCore.hostOf(url); }

async function refreshMenu(tab) {
  const host = hostOf(tab?.url);
  const {
    disabledHosts = [],
    adComfort = true,
    adSpeed = "auto",
    autoPip = true,
    showButton = false,
    smartSpeed = false,
    ssExtraHosts = [],
    ccPip = true,
  } = await chrome.storage.sync.get({
    disabledHosts: [],
    adComfort: true,
    adSpeed: "auto",
    autoPip: true,
    showButton: false,
    smartSpeed: false,
    ssExtraHosts: [],
    ccPip: true,
  });
  chrome.contextMenus.update(MENU_DISABLE, {
    checked: !!host && disabledHosts.includes(host),
  });
  chrome.contextMenus.update(MENU_ADCOMFORT, { checked: adComfort !== false });
  chrome.contextMenus.update(MENU_AUTOPIP, { checked: autoPip !== false });
  chrome.contextMenus.update(MENU_BUTTON, { checked: showButton === true });
  chrome.contextMenus.update(MENU_SMART, { checked: smartSpeed === true });
  const ssAllowed =
    !!host &&
    (SS_BUILTIN.some((d) => host === d || host.endsWith("." + d)) ||
      ssExtraHosts.includes(host));
  chrome.contextMenus.update(MENU_SSHERE, { checked: ssAllowed });
  chrome.contextMenus.update(MENU_CC, { checked: ccPip !== false });
  for (const s of SPEED_OPTS) {
    chrome.contextMenus.update(MENU_SPEED + ":" + s, {
      checked: String(adSpeed) === String(s),
    });
  }
}

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    refreshMenu(await chrome.tabs.get(tabId));
  } catch (_) {}
});
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === "complete" || info.url) refreshMenu(tab);
  if (info.url) {
    adCounts.delete(tabId);
    chrome.action.setBadgeText({ tabId, text: "" });
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === MENU_DISABLE) {
    const host = hostOf(tab?.url);
    if (!host) return;
    const { disabledHosts = [] } = await chrome.storage.sync.get({
      disabledHosts: [],
    });
    const set = new Set(disabledHosts);
    if (info.checked) set.add(host);
    else set.delete(host);
    await chrome.storage.sync.set({ disabledHosts: [...set] });
  } else if (info.menuItemId === MENU_ADCOMFORT) {
    await chrome.storage.sync.set({ adComfort: info.checked });
  } else if (info.menuItemId === MENU_AUTOPIP) {
    await chrome.storage.sync.set({ autoPip: info.checked });
  } else if (info.menuItemId === MENU_BUTTON) {
    await chrome.storage.sync.set({ showButton: info.checked });
  } else if (info.menuItemId === MENU_SMART) {
    await chrome.storage.sync.set({ smartSpeed: info.checked });
  } else if (info.menuItemId === MENU_SSHERE) {
    const host = hostOf(tab?.url);
    if (!host) return;
    const { ssExtraHosts = [] } = await chrome.storage.sync.get({
      ssExtraHosts: [],
    });
    const set = new Set(ssExtraHosts);
    if (info.checked) set.add(host);
    else set.delete(host);
    await chrome.storage.sync.set({ ssExtraHosts: [...set] });
  } else if (info.menuItemId === MENU_CC) {
    await chrome.storage.sync.set({ ccPip: info.checked });
  } else if (
    typeof info.menuItemId === "string" &&
    info.menuItemId.startsWith(MENU_SPEED + ":")
  ) {
    const raw = info.menuItemId.split(":")[1];
    const val = raw === "auto" ? "auto" : Number(raw);
    if (val) await chrome.storage.sync.set({ adSpeed: val });
  } else if (info.menuItemId === MENU_STATUS) {
    chrome.runtime.openOptionsPage();
  }
});
