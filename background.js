importScripts("pip-core.js");

// Probe every accessible frame, then send the action to exactly one document.
// Both functions execute in the content script's isolated world.
function inspectFrame() {
  return globalThis.__fpipController?.snapshot() || {host: location.hostname};
}
async function injectedToggle(disabledHosts = [], tabHost = "", action = "toggle-pip") {
  const hosts = [tabHost, location.hostname];
  for (const origin of location.ancestorOrigins || []) {
    try { hosts.push(new URL(origin).hostname); } catch (_) {}
  }
  if (disabledHosts.some(h => hosts.includes(h))) return {status: "disabled"};
  const controller = globalThis.__fpipController;
  if (!controller) return {status: "reload"};
  if (!controller.snapshot().enabled) return {status: "disabled"};
  return controller.run(action);
}
const pendingActions = new Set();
async function callToggle(tabId, action = "toggle-pip") {
  if (pendingActions.has(tabId)) return {status: "busy"};
  pendingActions.add(tabId);
  try {
    const tab = await chrome.tabs.get(tabId);
    const {disabledHosts = []} = await chrome.storage.sync.get({disabledHosts: []});
    const tabHost = hostOf(tab.url);
    if (FloatingVideoCore.isDisabled(disabledHosts, [tabHost])) return {status: "disabled"};
    const results = await chrome.scripting.executeScript({target:{tabId,allFrames:true},func:inspectFrame});
    const chosen = FloatingVideoCore.chooseFrame(results, disabledHosts, tabHost);
    if (!chosen) return {status: "no-video"};
    // documentIds prevent a navigation between probe and action selecting a new page.
    const target = chosen.documentId ? {tabId,documentIds:[chosen.documentId]} : {tabId,frameIds:[chosen.frameId]};
    const replies = await chrome.scripting.executeScript({target,func:injectedToggle,args:[disabledHosts,tabHost,action]});
    return replies[0]?.result || {status: "unavailable"};
  } catch (error) {
    console.warn("[Floating PiP] action:", error.message);
    return {status: "unavailable"};
  } finally { pendingActions.delete(tabId); }
}

const STATUS_LABELS = {
  disabled:"Disabled on this site", "no-video":"Start a video, then try again. Reload the page after installing.",
  unavailable:"Unable to control this player. Check site access and reload the page.",
  "embedded-layout":"In-page layouts require a top-page video. Use native PiP for embedded players.",
  reload:"Reload the page to enable Floating Video.", busy:"A video action is already running."
};
async function performAction(tabId, action = "toggle-pip") {
  const result = await callToggle(tabId, action);
  const message = result.status === "ok" ? "Floating Video — ready" : STATUS_LABELS[result.status] || "Video action unavailable";
  await chrome.action.setTitle({tabId,title:message});
  return result;
}

// Toolbar icon click -> float / unfloat.
chrome.action.onClicked.addListener((tab) => {
  if (tab?.id != null) performAction(tab.id);
});

// Keyboard command (Alt+P by default; configurable at chrome://extensions/shortcuts).
chrome.commands.onCommand.addListener((command) => {
  if (!chrome.runtime.getManifest().commands[command]) return;
  chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
    const tab = tabs[0];
    if (tab?.id != null) performAction(tab.id, command);
  });
});

// Per-tab count of ads the comfort layer muted/skipped, shown on the badge.
const adCounts = new Map();
let statsWrite = Promise.resolve();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  if (tabId == null) return;
  if (msg?.type === "GET_TAB_HOST") {
    sendResponse({host: hostOf(sender.tab?.url)});
  } else if (msg?.type === "FAN_OUT_PIP") {
    performAction(tabId).then(sendResponse);
    return true;
  } else if (msg?.type === "AD_SESSION_ENDED") {
    const n = (adCounts.get(tabId) || 0) + 1;
    adCounts.set(tabId, n);
    chrome.action.setBadgeBackgroundColor({ tabId, color: "#2d6cdf" });
    chrome.action.setBadgeText({ tabId, text: String(n) });
    // Persistent per-host total for the status page.
    const host = hostOf(sender.tab?.url);
    if (host) {
      statsWrite = statsWrite.then(async () => {
        const {adStatsByHost = {}} = await chrome.storage.local.get({adStatsByHost:{}});
        adStatsByHost[host] = (adStatsByHost[host] || 0) + 1;
        await chrome.storage.local.set({adStatsByHost});
      }).catch(error => console.warn("[Floating PiP] statistics:",error.message));
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
