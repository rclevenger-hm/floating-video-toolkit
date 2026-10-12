const test=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
const core=require('../pip-core.js');
function worker(session={}) {
  const calls=[],listeners={},tabs=new Map([[1,{id:1,index:0,windowId:10,incognito:false,url:'https://one.example/watch',title:'One'}],[2,{id:2,index:1,windowId:10,incognito:false,url:'https://two.example/watch',title:'Two'}]]);
  const windows=new Map([[10,{id:10,type:'normal',incognito:false,state:'normal',focused:true}]]);let next=20,blocked=[];
  function updateWindow(id,info) {
    const win=windows.get(id);if(!win)throw Error('closed');
    if(info.focused) for(const other of windows.values()) other.focused=false;
    Object.assign(win,info);return win;
  }
  const event=key=>({addListener:fn=>listeners[key]=fn});
  const mixerContext=()=>[...tabs.values()].filter(t=>t.url==='chrome-extension://extension/mixer.html').map(t=>({tabId:t.id,windowId:t.windowId}));
  const chrome={runtime:{id:'extension',getURL:path=>'chrome-extension://extension/'+path,onMessage:event('message'),
    getContexts:async()=>mixerContext(),sendMessage:async()=>mixerContext()[0]||null},
    storage:{sync:{get:async()=>({disabledHosts:blocked})},session:{get:async()=>structuredClone(session),set:async value=>Object.assign(session,structuredClone(value))}},
    tabs:{query:async()=>[...tabs.values()].map(t=>t.url?.startsWith('chrome-extension:')?{...t,url:undefined}:t),get:async id=>{if(!tabs.has(id))throw Error('closed');return tabs.get(id);},
      move:async(id,info)=>{calls.push(['move',id,info]);tabs.get(id).windowId=info.windowId;listeners.attached?.(id);},
      update:async(id,info)=>{calls.push(['tab-update',id,info]);Object.assign(tabs.get(id),info);return tabs.get(id);},onRemoved:event('removed'),onAttached:event('attached')},
    windows:{get:async id=>{if(!windows.has(id))throw Error('closed');return windows.get(id);},
      update:async(id,info)=>{calls.push(['window-update',id,info]);return updateWindow(id,info);},
      create:async info=>{
        calls.push(['create',info]);const win={id:next++,type:info.type,incognito:false,state:'normal'};windows.set(win.id,win);
        updateWindow(win.id,{focused:info.focused!==false});
        if(info.tabId){Object.assign(tabs.get(info.tabId),{windowId:win.id,active:true});listeners.attached?.(info.tabId);}
        else if(info.url) tabs.set(win.id,{id:win.id,url:info.url,windowId:win.id,active:true});
        return win;
      }},
    scripting:{executeScript:async info=>{calls.push(['script',info]);if(info.target.documentIds)return [{result:{status:'ok',media:{id:'v1'}}}];
      if(info.args)return [];
      return [{documentId:'doc'+info.target.tabId,frameId:0,result:{enabled:true,host:'one.example',candidate:{playing:true,area:100,pixels:100},media:{id:'v1'}}}];}}};
  const context=vm.createContext({chrome,FloatingVideoCore:core,console});
  vm.runInContext(fs.readFileSync(require.resolve('../multi-view.js'),'utf8'),context);
  return {api:context.FloatingVideoMultiView,chrome,calls,tabs,windows,session,listeners,block:hosts=>blocked=hosts};
}
const target=id=>({tabId:id,documentId:'doc'+id,videoId:'v1'});
const foreground=w=>[...w.windows.values()].find(win=>win.focused)?.id;
function mixerAction(w,action,id=1) {
  return new Promise(resolve=>w.listeners.message({type:'MULTI_VIEW',action,target:target(id)},
    {id:w.chrome.runtime.id,url:w.chrome.runtime.getURL('mixer.html')},resolve));
}
test('a mixer popout opens in front and requesting it again restores a minimized player',async()=>{
  const w=worker();await w.api.popout(target(1));const id=w.tabs.get(1).windowId;
  assert.equal(foreground(w),id);
  await w.chrome.windows.update(id,{state:'minimized',focused:false});
  await w.chrome.windows.update(10,{focused:true});
  await w.api.popout(target(1));
  assert.equal(w.windows.get(id).state,'normal');assert.equal(foreground(w),id);
  assert.equal(w.calls.filter(c=>c[0]==='create').length,1);
});
test('popout command keeps the player in front with a new or existing mixer',async()=>{
  const w=worker(),create=w.chrome.windows.create;
  // Some window managers activate a new companion window despite focused:false.
  w.chrome.windows.create=async info=>{const win=await create(info);if(info.url)await w.chrome.windows.update(win.id,{focused:true});return win;};
  await w.api.popoutTab(1);
  assert.equal(foreground(w),w.tabs.get(1).windowId);
  const mixer=[...w.tabs.values()].find(t=>t.url===w.chrome.runtime.getURL('mixer.html'));
  assert.ok(mixer);
  await w.api.openMixer();assert.equal(foreground(w),mixer.windowId);
  await w.api.popoutTab(2);assert.equal(foreground(w),w.tabs.get(2).windowId);
  assert.equal(w.calls.filter(c=>c[0]==='create'&&c[1].url).length,1);
});
test('Focus restores a minimized player and preserves maximized player windows',async()=>{
  const w=worker();await w.api.popout(target(1));const id=w.tabs.get(1).windowId;
  for(const state of ['minimized','maximized']) {
    await w.chrome.windows.update(id,{state});await w.chrome.windows.update(10,{focused:true});
    w.tabs.get(1).active=false;
    assert.equal((await mixerAction(w,'focus')).status,'ok');
    assert.equal(foreground(w),id);assert.equal(w.tabs.get(1).active,true);
    assert.equal(w.windows.get(id).state,state==='minimized'?'normal':state);
  }
});
test('explicitly opening the mixer restores its minimized window',async()=>{
  const w=worker();await w.api.openMixer();const id=foreground(w);
  await w.chrome.windows.update(id,{state:'minimized'});await w.chrome.windows.update(10,{focused:true});
  await w.api.openMixer();assert.equal(foreground(w),id);assert.equal(w.windows.get(id).state,'normal');
  assert.equal(w.calls.filter(c=>c[0]==='create').length,1);
});
test('older Chrome can find its mixer without extension URLs from tabs.query',async()=>{
  const w=worker();delete w.chrome.runtime.getContexts;
  await w.api.openMixer();const id=foreground(w);
  await w.chrome.windows.update(10,{focused:true});
  await w.api.openMixer();assert.equal(foreground(w),id);
  assert.equal(w.calls.filter(c=>c[0]==='create').length,1);
});
test('two popouts move existing tabs once and survive service-worker restarts',async()=>{
  const w=worker();await Promise.all([w.api.popout(target(1)),w.api.popout(target(2)),w.api.popout(target(1))]);
  assert.equal(w.calls.filter(c=>c[0]==='create').length,2);
  assert.notEqual(w.tabs.get(1).windowId,w.tabs.get(2).windowId);
  const creation=w.calls.find(c=>c[0]==='create')[1];assert.equal(creation.url,undefined);assert.equal(creation.tabId,1);
  const reloaded=worker(w.session);reloaded.tabs.get(1).windowId=w.session.multiViewWindows[1].windowId;
  await reloaded.api.restore(1);assert.equal(reloaded.tabs.get(1).windowId,10);assert.equal(w.session.multiViewWindows[1],undefined);
});
test('restore creates a normal window if the original window no longer exists',async()=>{
  const w=worker();await w.api.popout(target(1));w.windows.delete(10);await w.api.restore(1);
  assert.equal(w.calls.filter(c=>c[0]==='create').at(-1)[1].type,'normal');assert.equal(w.session.multiViewWindows[1],undefined);
});
test('site exclusions block discovery and controls but allow returning an already popped tab',async()=>{
  const w=worker();await w.api.popout(target(1));w.block(['one.example']);w.calls.length=0;
  assert.equal((await w.api.control(target(1),'mute')).status,'disabled');assert.equal(w.calls.length,0);
  const scanned=await w.api.scan();assert.equal(scanned.players.find(p=>p.tabId===1).status,'unavailable');
  await w.api.restore(1);assert.equal(w.tabs.get(1).windowId,10);
});
test('commands pin the probed document and reject malformed targets',async()=>{
  const w=worker();await w.api.control(target(1),'mute');
  assert.deepEqual(Array.from(w.calls[0][1].target.documentIds),['doc1']);assert.equal(w.calls[0][1].target.allFrames,undefined);
  w.calls.length=0;assert.equal((await w.api.control({tabId:1},'mute')).status,'invalid');assert.equal(w.calls.length,0);
});
test('untrusted content scripts cannot request privileged mixer actions',async()=>{
  const w=worker();let result;
  w.listeners.message({type:'MULTI_VIEW',action:'scan'},{id:'extension',url:'https://one.example/watch'},r=>result=r);
  assert.equal(result.status,'forbidden');assert.equal(w.calls.length,0);
});
test('failed window creation restores per-tab feature mode',async()=>{
  const w=worker();w.chrome.windows.create=async()=>{throw Error('failed');};
  await assert.rejects(w.api.popout(target(1)));
  const modes=w.calls.filter(c=>c[0]==='script'&&c[1].args?.length===1).map(c=>c[1].args[0]);
  assert.deepEqual(modes,[true,false]);assert.equal(w.session.multiViewWindows,undefined);
});
