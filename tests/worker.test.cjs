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
  const context = vm.createContext({URL, console, setTimeout, clearTimeout, importScripts(){}, FloatingVideoCore:core,
    chrome: {
      action:{onClicked:event('click'),setBadgeText:noop,setBadgeBackgroundColor:noop,setTitle:noop},
      commands:{onCommand:event('command')},
      runtime:{onMessage:event('message'),onInstalled:event('install'),onStartup:event('startup'),openOptionsPage:noop},
      tabs:{get:async()=>({id:7,url:'https://top.example/watch'}),query:async()=>[{id:7}],onRemoved:event('remove'),onUpdated:event('update'),onActivated:event('activate')},
      storage:{sync:{get:async defaults=>({...defaults,disabledHosts})},local:{get:async d=>d,set:noop},session:{set:noop}},
      contextMenus:{onClicked:event('menu'),update:noop},
      scripting:{executeScript:async args=>{calls.push(args); return results;}}
    }});
  vm.runInContext(fs.readFileSync(require.resolve('../background.js'),'utf8'), context);
  return {context,calls,listeners};
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
});
test('simultaneous requests collapse to one frame action', async()=>{
  const w=worker({results:[{frameId:0,result:{host:'top.example',candidate:{playing:true,area:100,pixels:100}}}]});
  await Promise.all([vm.runInContext('callToggle(7)',w.context),vm.runInContext('callToggle(7)',w.context)]);
  assert.equal(w.calls.length,2);
});
