/* Service-worker coordination. Source tabs stay alive; only their windows change. */
(function (root) {
  'use strict';
  let windowWrite = Promise.resolve(), mixerOpen = null;
  const serial = task => { const result = windowWrite.then(task); windowWrite = result.catch(() => {}); return result; };
  const error = () => ({status:'unavailable',message:'Player unavailable. Refresh players or reload the source tab.'});
  const validTarget = t => t && Number.isInteger(t.tabId) && typeof t.documentId === 'string' && typeof t.videoId === 'string';
  async function records() { return (await chrome.storage.session.get('multiViewWindows')).multiViewWindows || {}; }
  async function enabledTab(tab) {
    const {disabledHosts = []} = await chrome.storage.sync.get({disabledHosts:[]});
    return {disabledHosts, allowed:!FloatingVideoCore.isDisabled(disabledHosts, [FloatingVideoCore.hostOf(tab.url)])};
  }
  async function scanTab(tab) {
    if (!/^https?:/.test(tab.url || '') || tab.discarded) return null;
    try {
      const {disabledHosts, allowed} = await enabledTab(tab);
      if (!allowed) return null;
      const frames = await chrome.scripting.executeScript({target:{tabId:tab.id,allFrames:true},
        func:() => globalThis.__fpipController?.snapshot() || null});
      const chosen = FloatingVideoCore.chooseFrame(frames.filter(f => f.result), disabledHosts, FloatingVideoCore.hostOf(tab.url));
      if (!chosen?.documentId || !chosen.result?.media) return null;
      return {tabId:tab.id, documentId:chosen.documentId, videoId:chosen.result.media.id, frameId:chosen.frameId,
        title:tab.title || FloatingVideoCore.hostOf(tab.url), host:FloatingVideoCore.hostOf(tab.url), media:chosen.result.media};
    } catch (_) { return null; }
  }
  async function scan() {
    const tabs = await chrome.tabs.query({});
    // Bound concurrent injections for people with many open tabs.
    const players = [];
    for (let i=0; i<tabs.length; i+=8) {
      players.push(...(await Promise.all(tabs.slice(i,i+8).map(scanTab))).filter(Boolean));
    }
    const saved = await records();
    for (const player of players) player.popped = saved[player.tabId]?.windowId === tabs.find(t => t.id === player.tabId)?.windowId;
    // A channel transition or site exclusion must not strand a source tab in a popup.
    for (const tab of tabs) {
      if (saved[tab.id]?.windowId !== tab.windowId || players.some(p => p.tabId === tab.id)) continue;
      players.push({tabId:tab.id,documentId:'',videoId:'',popped:true,title:tab.title || 'Player tab',
        host:FloatingVideoCore.hostOf(tab.url),status:'unavailable',message:'No controllable player. Return to tab is still available.'});
    }
    return {status:'ok',players};
  }
  async function control(target, action, value) {
    if (!validTarget(target)) return {status:'invalid'};
    try {
      const tab = await chrome.tabs.get(target.tabId);
      const {disabledHosts, allowed} = await enabledTab(tab);
      if (!allowed) return {status:'disabled'};
      const replies = await chrome.scripting.executeScript({target:{tabId:target.tabId,documentIds:[target.documentId]},
        func:async (id, action, value, disabledHosts, tabHost) => {
          const controller = globalThis.__fpipController;
          const snapshot = controller?.snapshot();
          if (!snapshot?.enabled || FloatingVideoCore.isDisabled(disabledHosts,[tabHost,...snapshot.ancestors])) return {status:'disabled'};
          return controller.mixer(id, action, value);
        }, args:[target.videoId,action,value ?? null,disabledHosts,FloatingVideoCore.hostOf(tab.url)]});
      return replies[0]?.result || error();
    } catch (_) { return error(); }
  }
  async function setMode(tabId, active) {
    try {
      await chrome.scripting.executeScript({target:{tabId,allFrames:true},
        func:async active => { await globalThis.__fpipController?.setMultiView(active); },args:[active]});
    } catch (_) {} // Navigation or tab closure: initialization reads session state.
  }
  async function focusTab(tab) {
    const window = await chrome.windows.get(tab.windowId);
    await chrome.tabs.update(tab.id,{active:true});
    // Restore minimized windows without changing a maximized/fullscreen layout.
    await chrome.windows.update(tab.windowId,window.state === 'minimized' ? {state:'normal',focused:true} : {focused:true});
  }
  async function openMixer({focus = true} = {}) {
    if (mixerOpen) return mixerOpen;
    mixerOpen = (async () => {
      const url = chrome.runtime.getURL('mixer.html');
      // tabs.query() can omit even our own extension URLs without "tabs" access.
      // Inspect only our extension contexts; older Chrome can ask the mixer itself.
      const existing = chrome.runtime.getContexts ?
        (await chrome.runtime.getContexts({contextTypes:['TAB'],documentUrls:[url]}))[0] :
        await chrome.runtime.sendMessage({type:'FIND_MIXER'}).catch(() => null);
      if (existing) {
        if (focus) await focusTab(await chrome.tabs.get(existing.tabId));
      } else await chrome.windows.create({url,type:'popup',width:620,height:820,focused:focus});
      return {status:'ok'};
    })();
    try { return await mixerOpen; } finally { mixerOpen = null; }
  }
  async function popout(target) {
    return serial(async () => {
      const check = await control(target,'inspect');
      if (check.status !== 'ok') return check;
      const tab = await chrome.tabs.get(target.tabId), saved = await records();
      if (saved[tab.id]?.windowId === tab.windowId) {
        await focusTab(tab);
        return {status:'ok'};
      }
      // Preserve identity, cookies, DRM sessions and playback: move the existing tab.
      const originalWindowId = tab.windowId, index = tab.index;
      await setMode(tab.id,true);
      let popup;
      try { popup = await chrome.windows.create({tabId:tab.id,type:'popup',width:720,height:480,focused:true}); }
      catch (e) { await setMode(tab.id,false); throw e; }
      saved[tab.id] = {windowId:popup.id,originalWindowId,index};
      await chrome.storage.session.set({multiViewWindows:saved});
      await setMode(tab.id,true);
      return {status:'ok',message:'Player tab moved to a pop-out. Return to tab keeps it open; the window’s X closes the stream.'};
    });
  }
  async function popoutTab(tabId) {
    const target = await scanTab(await chrome.tabs.get(tabId));
    if (!target) return {status:'no-video'};
    const result = await popout(target);
    // The requested player stays in front; its companion mixer must not cover it.
    if (result.status === 'ok') await openMixer({focus:false});
    return result;
  }
  async function restore(tabId) {
    if (!Number.isInteger(tabId)) return {status:'invalid'};
    return serial(async () => {
      const saved = await records(), entry = saved[tabId];
      if (!entry) return {status:'ok'};
      const tab = await chrome.tabs.get(tabId);
      if (tab.windowId === entry.windowId) {
        let destination;
        try { destination = await chrome.windows.get(entry.originalWindowId); } catch (_) {}
        if (destination?.type === 'normal' && destination.incognito === tab.incognito) {
          await chrome.tabs.move(tabId,{windowId:destination.id,index:entry.index});
        } else await chrome.windows.create({tabId,type:'normal'});
      }
      delete saved[tabId];
      await chrome.storage.session.set({multiViewWindows:saved});
      await setMode(tabId,false);
      // Return the optional cinema layout even if the source video has changed.
      await chrome.scripting.executeScript({target:{tabId,allFrames:true},func:() => globalThis.__fpipController?.run('close-layout')}).catch(() => {});
      return {status:'ok'};
    });
  }
  async function poll(targets) {
    if (!Array.isArray(targets) || targets.length > 100 || !targets.every(validTarget)) return {status:'invalid'};
    const saved = await records();
    const players = await Promise.all(targets.map(async target => {
      const result = target.documentId ? await control(target,'inspect') : {status:'unavailable',message:'No controllable player. Refresh after playback starts.'};
      let popped = false;
      try { popped = saved[target.tabId]?.windowId === (await chrome.tabs.get(target.tabId)).windowId; } catch (_) {}
      return {...target,...result,popped};
    }));
    return {status:'ok',players};
  }
  async function dispatch(msg) {
    if (msg.action === 'scan') return scan();
    if (msg.action === 'poll') return poll(msg.targets);
    if (msg.action === 'restore') return restore(msg.target?.tabId);
    if (msg.action === 'popout') return validTarget(msg.target) ? popout(msg.target) : {status:'invalid'};
    if (!validTarget(msg.target)) return {status:'invalid'};
    if (msg.action === 'focus') {
      const tab = await chrome.tabs.get(msg.target.tabId);
      await focusTab(tab);
      return {status:'ok'};
    }
    if (!['inspect','volume','mute','unmute','play','pause','seek','hold','cancel-hold','toggle-cinema'].includes(msg.action)) return {status:'invalid'};
    return control(msg.target,msg.action,msg.value);
  }
  chrome.runtime.onMessage.addListener((msg,sender,sendResponse) => {
    if (msg?.type !== 'MULTI_VIEW') return;
    if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('mixer.html')) {
      sendResponse({status:'forbidden'}); return;
    }
    dispatch(msg).then(sendResponse,() => sendResponse(error()));
    return true;
  });
  chrome.tabs.onRemoved.addListener(tabId => {
    serial(async () => { const saved = await records(); if (saved[tabId]) { delete saved[tabId]; await chrome.storage.session.set({multiViewWindows:saved}); } }).catch(() => {});
  });
  chrome.tabs.onAttached?.addListener(tabId => {
    serial(async () => {
      const saved=await records(), entry=saved[tabId];
      if (!entry) return;
      const tab=await chrome.tabs.get(tabId);
      if (tab.windowId !== entry.windowId) {
        delete saved[tabId]; await chrome.storage.session.set({multiViewWindows:saved}); await setMode(tabId,false);
      }
    }).catch(() => {});
  });
  root.FloatingVideoMultiView = {openMixer,popoutTab,scan,control,popout,restore,poll};
})(globalThis);
