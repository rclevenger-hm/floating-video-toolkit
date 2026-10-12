importScripts("pip-core.js");
importScripts("multi-view.js");

// Probe every accessible frame, then send the action to exactly one document.
// Both functions execute in the content script's isolated world.
async function inspectFrame() {
  const controller = globalThis.__fpipController;
  if (!controller) return {host:location.hostname, missingController:true};
  if (controller.ready) await controller.ready;
  return controller.snapshot();
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
function callToggle(tabId, action = "toggle-pip", knownTab = null) {
  if (pendingActions.has(tabId)) return Promise.resolve({status:"busy"});
  pendingActions.add(tabId);
  // Chrome forwards a worker gesture through ONE API callback, not an arbitrary
  // chain. Start the policy/tab reads together in the original event, then probe
  // from their callbacks. That injection activates the page before selecting
  // one document and requesting PiP within its normal transient activation.
  return new Promise(resolve => {
    const finish = result => { pendingActions.delete(tabId); resolve(result); };
    const failed = () => {
      const error = chrome.runtime.lastError;
      if (!error) return false;
      console.warn("[Floating PiP] action:", error.message);
      finish({status:"unavailable"}); return true;
    };
    const execute = (details, next) => {
      try { chrome.scripting.executeScript(details, replies => {
        if (failed()) return;
        try { next(replies || []); }
        catch (error) { console.warn("[Floating PiP] action:", error.message); finish({status:"unavailable"}); }
      }); }
      catch (error) { console.warn("[Floating PiP] action:", error.message); finish({status:"unavailable"}); }
    };
    let tab = knownTab, settings = null;
    const begin = () => {
        if (!tab || !settings) return;
        const disabledHosts = settings.disabledHosts || [];
        const tabHost = hostOf(tab.url);
        if (FloatingVideoCore.isDisabled(disabledHosts, [tabHost])) return finish({status:"disabled"});
        const probe = mayInstall => execute({target:{tabId,allFrames:true},func:inspectFrame}, results => {
          const missing = results.filter(item => item.result?.missingController &&
            !FloatingVideoCore.isDisabled(disabledHosts, [item.result.host]));
          if (mayInstall && missing.length) {
            // Tabs already open when the extension was installed/reloaded have
            // no controller in the new isolated world. Initialize only those
            // documents, then await their settings before choosing a player.
            const documentIds = missing.map(item => item.documentId);
            const target = documentIds.every(Boolean) ? {tabId,documentIds} : {tabId,frameIds:missing.map(item => item.frameId)};
            const files = chrome.runtime.getManifest().content_scripts.flatMap(script => script.js || []);
            return execute({target,files}, () => probe(false));
          }
          const chosen = FloatingVideoCore.chooseFrame(results, disabledHosts, tabHost);
          if (!chosen) return finish({status:missing.length ? "reload" : "no-video"});
          // Pin the probed document so navigation cannot redirect the action.
          const target = chosen.documentId ? {tabId,documentIds:[chosen.documentId]} : {tabId,frameIds:[chosen.frameId]};
          execute({target,func:injectedToggle,args:[disabledHosts,tabHost,action]}, replies => finish(replies[0]?.result || {status:"unavailable"}));
        });
        probe(true);
    };
    if (!tab) chrome.tabs.get(tabId, result => { if (!failed()) { tab = result; begin(); } });
    chrome.storage.sync.get({disabledHosts:[]}, result => { if (!failed()) { settings = result; begin(); } });
  }).catch(error => {
    console.warn("[Floating PiP] action:", error.message);
    return {status:"unavailable"};
  }).finally(() => pendingActions.delete(tabId));
}

const STATUS_LABELS = {
  disabled:"Disabled on this site", "no-video":"Start a video, then try again. Reload the page after installing.",
  unavailable:"Unable to control this player. Check site access and reload the page.",
  "needs-gesture":"Chrome requires a fresh click. Click PiP beside the video or reload this page and try the toolbar again.",
  "pip-blocked":"This page or browser policy blocks Picture-in-Picture.",
  "pip-unsupported":"This browser or player does not support Picture-in-Picture.",
  "embedded-layout":"In-page layouts require a top-page video. Use native PiP for embedded players.",
  reload:"Reload the page to enable Floating Video.", busy:"A video action is already running."
};
async function performAction(tabId, action = "toggle-pip", tab = null) {
  if (action === 'open-mixer') return FloatingVideoMultiView.openMixer();
  if (action === 'popout-player') return FloatingVideoMultiView.popoutTab(tabId);
  const result = await callToggle(tabId, action, tab);
  const message = result.status === "ok" ? "Floating Video — ready" : STATUS_LABELS[result.status] || "Video action unavailable";
  await chrome.action.setTitle({tabId,title:message});
  return result;
}

// Toolbar icon click -> float / unfloat.
chrome.action.onClicked.addListener((tab) => {
  if (tab?.id != null) performAction(tab.id, "toggle-pip", tab);
});

// Browser shortcuts follow the native PiP owner for playback, even on another tab.
const PLAYBACK_COMMANDS = new Set(["play-pause","play","pause","toggle-mute","mute","unmute"]);
async function commandTarget(command) {
  if (PLAYBACK_COMMANDS.has(command)) {
    await ownerWrite;
    const {pipOwner} = await chrome.storage.session.get("pipOwner");
    if (pipOwner) {
      try { await chrome.tabs.get(pipOwner.tabId); return pipOwner.tabId; }
      catch (_) { await chrome.storage.session.remove("pipOwner"); }
    }
  }
  return (await chrome.tabs.query({active:true,currentWindow:true}))[0]?.id;
}
chrome.commands.onCommand.addListener((command, tab) => {
  if (!chrome.runtime.getManifest().commands[command]) return;
  if (!PLAYBACK_COMMANDS.has(command)) {
    // In particular, Alt+P must retain the command's gesture just like a click.
    if (tab?.id != null) { performAction(tab.id, command, tab); return; }
    chrome.tabs.query({active:true,currentWindow:true}, tabs => {
      if (!chrome.runtime.lastError && tabs[0]?.id != null) performAction(tabs[0].id, command, tabs[0]);
    });
    return;
  }
  commandTarget(command).then(tabId => tabId == null ? null : performAction(tabId,command)).catch(() => {});
});

// Per-tab count of ads the comfort layer muted/skipped, shown on the badge.
const adCounts = new Map();
let statsWrite = Promise.resolve();
let ownerWrite = Promise.resolve();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  if (tabId == null) return;
  if (msg?.type === "PIP_STATE") {
    const updateOwner = async () => {
      if (msg.active) await chrome.storage.session.set({pipOwner:{tabId,documentId:sender.documentId,frameId:sender.frameId}});
      else {
        const {pipOwner}=await chrome.storage.session.get("pipOwner");
        if (pipOwner?.tabId === tabId && pipOwner?.documentId === sender.documentId)
          await chrome.storage.session.remove("pipOwner");
      }
    };
    ownerWrite=ownerWrite.then(updateOwner).catch(() => {});
  } else if (msg?.type === "GET_TAB_HOST") {
    chrome.storage.session.get('multiViewWindows').then(({multiViewWindows = {}}) => {
      sendResponse({host:hostOf(sender.tab?.url),multiView:multiViewWindows[tabId]?.windowId === sender.tab.windowId});
    });
    return true;
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

chrome.tabs.onRemoved.addListener(async tabId => {
  adCounts.delete(tabId);
  const {pipOwner}=await chrome.storage.session.get("pipOwner");
  if(pipOwner?.tabId===tabId) await chrome.storage.session.remove("pipOwner");
});
chrome.storage.onChanged?.addListener((_changes,area) => {
  if(area!=="sync") return;
  chrome.tabs.query({active:true,currentWindow:true}).then(tabs=>tabs[0] && refreshMenu(tabs[0])).catch(()=>{});
});

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
    const groups = {
      multi:["Multi-view & audio mixer",["open-mixer","popout-player"]],
      playback:["Playback",["play-pause","play","pause","toggle-mute","mute","unmute"]],
      view:["Ultrawide & mini-player",["toggle-mini","toggle-cinema","cycle-fit","zoom-in","zoom-out","reset-view"]],
      corner:["Mini-player corner",["snap-1","snap-2","snap-3","snap-4"]]
    };
    const commands=chrome.runtime.getManifest().commands;
    for(const [key,[title,actions]] of Object.entries(groups)) {
      const id="fpip-group-"+key;
      chrome.contextMenus.create({id,title,contexts:["action"]});
      for(const action of actions) chrome.contextMenus.create({id:"fpip-command:"+action,parentId:id,title:commands[action].description,contexts:["action"]});
    }
    chrome.contextMenus.create({
      id: MENU_DISABLE,
      title: "Disable floating video on this site",
      type: "checkbox",
      checked: false,
      contexts: ["action"],
    });
    chrome.contextMenus.create({
      id: MENU_ADCOMFORT,
      title: "Ad comfort (experimental)",
      type: "checkbox",
      checked: false,
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
      title: "Caption bridge (experimental)",
      type: "checkbox",
      checked: false,
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
    adComfort = false,
    adSpeed = "auto",
    autoPip = true,
    showButton = false,
    smartSpeed = false,
    ssExtraHosts = [],
    ccPip = false,
  } = await chrome.storage.sync.get({
    disabledHosts: [],
    adComfort: false,
    adSpeed: "auto",
    autoPip: true,
    showButton: false,
    smartSpeed: false,
    ssExtraHosts: [],
    ccPip: false,
  });
  chrome.contextMenus.update(MENU_DISABLE, {
    checked: !!host && disabledHosts.includes(host),
  });
  chrome.contextMenus.update(MENU_ADCOMFORT, { checked: adComfort === true });
  chrome.contextMenus.update(MENU_AUTOPIP, { checked: autoPip !== false });
  chrome.contextMenus.update(MENU_BUTTON, { checked: showButton === true });
  chrome.contextMenus.update(MENU_SMART, { checked: smartSpeed === true });
  const ssAllowed =
    !!host &&
    (SS_BUILTIN.some((d) => host === d || host.endsWith("." + d)) ||
      ssExtraHosts.includes(host));
  chrome.contextMenus.update(MENU_SSHERE, { checked: ssAllowed });
  chrome.contextMenus.update(MENU_CC, { checked: ccPip === true });
  for (const s of SPEED_OPTS) {
    chrome.contextMenus.update(MENU_SPEED + ":" + s, {
      checked: String(adSpeed) === String(s),
    });
  }
}

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    await refreshMenu(await chrome.tabs.get(tabId));
  } catch (_) {}
});
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === "complete" || info.url) refreshMenu(tab).catch(() => {});
  if (info.url) {
    adCounts.delete(tabId);
    chrome.action.setBadgeText({ tabId, text: "" });
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (String(info.menuItemId).startsWith("fpip-command:") && tab?.id != null) {
    await performAction(tab.id,String(info.menuItemId).slice("fpip-command:".length));
  } else if (info.menuItemId === MENU_DISABLE) {
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
