const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const core = require('../pip-core.js');

function worker({disabledHosts = [], results = []} = {}) {
  const calls = [];
  const listeners = {};
  const event = key => ({addListener:fn => {listeners[key] = fn;}});
  const noop = () => Promise.resolve();
  let callbackGesture=false, inCallback=false;
  const gestures=[];
  const reply=(value,callback)=>{
    const canForward=!inCallback;
    if(callback) queueMicrotask(()=>{inCallback=true;callbackGesture=canForward;try {callback(value);} finally {callbackGesture=false;inCallback=false;}});
    return Promise.resolve(value);
  };
  const context = vm.createContext({URL, console, setTimeout, clearTimeout, importScripts(){}, FloatingVideoCore:core,
    chrome: {
      action:{onClicked:event('click'),setBadgeText:noop,setBadgeBackgroundColor:noop,setTitle:noop},
      commands:{onCommand:event('command')},
      runtime:{getManifest:()=>JSON.parse(fs.readFileSync(require.resolve('../manifest.json'))),onMessage:event('message'),onInstalled:event('install'),onStartup:event('startup'),openOptionsPage:noop},
      tabs:{get:(_id,callback)=>reply({id:7,url:'https://top.example/watch'},callback),query:(_query,callback)=>reply([{id:7}],callback),onRemoved:event('remove'),onUpdated:event('update'),onActivated:event('activate')},
      storage:{sync:{get:(defaults,callback)=>reply({...defaults,disabledHosts},callback)},local:{get:async d=>d,set:noop},session:{get:async()=>({}),set:noop},onChanged:{addListener(){}}},
      contextMenus:{onClicked:event('menu'),update:noop},
      scripting:{executeScript:(args,callback)=>{calls.push(args);gestures.push(callbackGesture);return reply(typeof results==='function'?results(args):results,callback);}}
    }});
  vm.runInContext(fs.readFileSync(require.resolve('../background.js'),'utf8'), context);
  return {context,calls,listeners,gestures};
}

test('toolbar does not inject anything into a disabled top page', async()=>{
  const w=worker({disabledHosts:['top.example']});
  await vm.runInContext('callToggle(7)',w.context);
  assert.equal(w.calls.length,0);
});
test('frame-side guard stops activation on an excluded embedded hostname', async()=>{
  const w=worker();
  Object.assign(w.context,{location:{hostname:'blocked.example',ancestorOrigins:[]}});
  const result=await vm.runInContext('injectedToggle(["blocked.example"], "top.example")',w.context);
  assert.equal(result.status,'disabled');
});

test('multi-frame activation probes once and only executes in the selected document', async()=>{
  const results=[{frameId:0,documentId:'top',result:{host:'top.example',candidate:{playing:true,area:100,pixels:100}}},
    {frameId:2,documentId:'child',result:{host:'player.example',candidate:{playing:true,area:400,pixels:400}}}];
  const w=worker({results});
  await vm.runInContext('callToggle(7)',w.context);
  assert.equal(w.calls.length,2);
  assert.equal(w.calls[0].target.allFrames,true);
  assert.deepEqual(Array.from(w.calls[1].target.documentIds),['child']);
  assert.equal(w.calls[1].target.allFrames,undefined);
  assert.deepEqual(w.gestures,[true,false]);
});
test('simultaneous requests collapse to one frame action', async()=>{
  const w=worker({results:[{frameId:0,result:{host:'top.example',candidate:{playing:true,area:100,pixels:100}}}]});
  await Promise.all([vm.runInContext('callToggle(7)',w.context),vm.runInContext('callToggle(7)',w.context)]);
  assert.equal(w.calls.length,2);
});

test('media commands follow the native PiP owner instead of the active tab',async()=>{
  const w=worker();
  w.context.chrome.storage.session.get=async()=>({pipOwner:{tabId:12}});
  assert.equal(await vm.runInContext('commandTarget("pause")',w.context),12);
  assert.equal(await vm.runInContext('commandTarget("toggle-cinema")',w.context),7);
});


test('toolbar initializes missing documents and re-probes before opening PiP',async()=>{
  let probes=0;
  const w=worker({results:args=>{
    if(args.func?.name==='inspectFrame') return [{frameId:0,documentId:'top',result:++probes===1 ?
      {host:'top.example',missingController:true} : {host:'top.example',candidate:{playing:true,area:100,pixels:100}}}];
    return [{result:{status:'ok'}}];
  }});
  assert.equal((await vm.runInContext('callToggle(7)',w.context)).status,'ok');
  assert.equal(probes,2);assert.equal(w.calls.length,4);
  assert.ok(w.calls[1].files.includes('content.js'));
  assert.deepEqual(Array.from(w.calls[1].target.documentIds),['top']);
  assert.deepEqual(w.gestures,[true,false,false,false]);
});
test('a failed injection releases the toolbar lock and reports the failure',async()=>{
  const w=worker();
  w.context.chrome.scripting.executeScript=(_args,callback)=>{
    w.context.chrome.runtime.lastError={message:'Cannot access this page'};
    callback();delete w.context.chrome.runtime.lastError;
  };
  assert.equal((await vm.runInContext('callToggle(7)',w.context)).status,'unavailable');
  assert.equal((await vm.runInContext('callToggle(7)',w.context)).status,'unavailable');
});
test('frame inspection waits for controller initialization before reading enabled state',async()=>{
  const w=worker();let finish;let ready=false;
  w.context.__fpipController={ready:new Promise(resolve=>{finish=()=>{ready=true;resolve();};}),snapshot:()=>({enabled:ready})};
  const pending=vm.runInContext('inspectFrame()',w.context);
  finish();assert.equal((await pending).enabled,true);
});


test('native PiP shortcut retains the command gesture through tab selection',async()=>{
  const w=worker({results:[{frameId:0,result:{host:'top.example',candidate:{playing:true,area:100,pixels:100}}}]});
  w.listeners.command('toggle-pip',{id:7,url:'https://top.example/watch'});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(w.calls.length,2);assert.deepEqual(w.gestures,[true,false]);
});
