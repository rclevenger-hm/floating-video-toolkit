const test=require('node:test');
const assert=require('node:assert/strict');
const {content,environment,flush}=require('./helpers/dom.cjs');

test('embedded players inherit the top-page exclusion before modifying video flags',async t=>{
  const e=await content({url:'https://player.example/embed',tabHost:'top.example',settings:{disabledHosts:['top.example']}});t.after(e.close);
  assert.equal(e.w.__fpipController.snapshot().enabled,false);
  assert.equal(e.intervals.size,0);
  assert.equal((await e.w.__fpipController.run('toggle-pip')).status,'disabled');
});
test('disabling restores original video styles, flags, caption modes, and auto-PiP hook',async t=>{
  const e=environment({settings:{ccPip:true,videoAdjust:{zoom:1.5,brightness:1.2}},html:'<video style="opacity:1;filter:sepia(1);transform:rotate(4deg)" disablepictureinpicture></video>'});t.after(e.close);
  const video=e.w.document.querySelector('video');const track={kind:'captions',label:'English',mode:'hidden',cues:[{}]};
  Object.defineProperty(video,'textTracks',{value:[track]});
  e.load(['pip-core.js','page-state.js','player-layout.js','content.js']);await flush();
  assert.equal(video.hasAttribute('disablepictureinpicture'),false);
  assert.equal((await e.w.__fpipController.run('toggle-pip')).status,'ok');
  assert.equal(track.mode,'showing');
  await e.w.chrome.storage.sync.set({disabledHosts:['top.example']});
  assert.equal(video.style.filter,'sepia(1)');assert.equal(video.style.transform,'rotate(4deg)');
  assert.equal(video.hasAttribute('disablepictureinpicture'),true);assert.equal(track.mode,'hidden');
  assert.equal(e.mediaHandlers.get('enterpictureinpicture'),null);assert.equal(e.intervals.size,0);
  await e.w.chrome.storage.sync.set({disabledHosts:[]});
  assert.equal(e.w.__fpipController.snapshot().enabled,true);
  assert.equal(video.hasAttribute('disablepictureinpicture'),false);
});
test('playback actions affect only the selected video and explicit mute/unmute are idempotent',async t=>{
  const e=await content();t.after(e.close);const c=e.w.__fpipController;const v=e.w.document.querySelector('video');
  await c.run('pause');assert.equal(v.paused,true);await c.run('play');assert.equal(v.paused,false);
  await c.run('mute');await c.run('mute');assert.equal(v.muted,true);
  await c.run('unmute');await c.run('unmute');assert.equal(v.muted,false);
});
test('mini-player snaps to four corners and close returns the same video to its original parent',async t=>{
  const e=await content();t.after(e.close);const c=e.w.__fpipController;const v=e.w.document.querySelector('video'),parent=v.parentNode;
  for(const [corner,top,left] of [[1,true,true],[2,true,false],[3,false,true],[4,false,false]]) {
    assert.equal((await c.run('snap-'+corner)).status,'ok');
    const panel=e.w.document.getElementById('fpip-player');
    assert.ok(panel);assert.equal(v.parentNode,panel);
    assert.equal(panel.style.top,top?'16px':'auto');assert.equal(panel.style.left,left?'16px':'auto');
  }
  await c.run('close-layout');assert.equal(v.parentNode,parent);assert.equal(v.style.position,'');
  assert.equal(e.w.document.getElementById('fpip-player'),null);
});
test('corner number keys ignore text fields and can be disabled',async t=>{
  const e=await content();t.after(e.close);await e.w.__fpipController.run('snap-4');
  const input=e.w.document.querySelector('input');
  const key=()=>new e.w.KeyboardEvent('keydown',{key:'1',bubbles:true,cancelable:true});
  input.dispatchEvent(key());await flush();assert.equal(e.sync.viewSettings.corner,4);
  e.w.document.dispatchEvent(key());await flush();assert.equal(e.sync.viewSettings.corner,1);
  await e.w.chrome.storage.sync.set({viewSettings:{...e.sync.viewSettings,miniKeys:false}});
  e.w.document.dispatchEvent(new e.w.KeyboardEvent('keydown',{key:'2',bubbles:true}));await flush();assert.equal(e.sync.viewSettings.corner,1);
});
test('legacy Alt+P listener does not override browser shortcut remapping',async t=>{
  const e=await content();t.after(e.close);
  const event=new e.w.KeyboardEvent('keydown',{key:'p',code:'KeyP',altKey:true,bubbles:true,cancelable:true});
  e.w.document.dispatchEvent(event);await flush();
  assert.equal(event.defaultPrevented,false);assert.equal(e.w.document.pictureInPictureElement,null);
});
test('ultrawide crop updates live and reset restores the page video',async t=>{
  const e=await content();t.after(e.close);const c=e.w.__fpipController;const v=e.w.document.querySelector('video');
  await e.w.chrome.storage.sync.set({viewSettings:{fit:'fill',ratio:'21:9',panX:25,panY:70},videoAdjust:{zoom:1.5}});
  assert.equal(v.style.objectFit,'cover');assert.equal(v.style.objectPosition,'25% 70%');assert.equal(v.style.transform,'scale(1.5)');
  await c.run('toggle-cinema');
  assert.equal(e.w.document.getElementById('fpip-player').shadowRoot.querySelector('.stage').style.aspectRatio,String(21/9));
  await c.run('close-layout');await c.run('reset-view');assert.equal(v.style.transform,'');assert.equal(v.style.objectFit,'');
});
test('disabled site closes the mini-player and cancels its page changes',async t=>{
  const e=await content();t.after(e.close);const v=e.w.document.querySelector('video'),parent=v.parentNode;
  await e.w.__fpipController.run('snap-3');
  await e.w.chrome.storage.sync.set({disabledHosts:['top.example']});
  assert.equal(v.parentNode,parent);assert.equal(e.w.document.getElementById('fpip-player'),null);
});

test('late caption fetch cannot recreate tracks after disabling the site',async t=>{
  const e=environment({url:'https://www.youtube.com/watch?v=example',tabHost:'www.youtube.com',settings:{ccPip:true}});t.after(e.close);
  let release;const pending=new Promise(resolve=>{release=resolve;});let tracksAdded=0;
  e.w.fetch=async url=>{if(url.includes('watch?')) {await pending;return {text:async()=>'{"captionTracks":[{"baseUrl":"https://captions.example/?a=1","languageCode":"en"}],"x":1}'};}return {json:async()=>({events:[{tStartMs:0,dDurationMs:1000,segs:[{utf8:'hello'}]}]})};};
  const video=e.w.document.querySelector('video');video.addTextTrack=()=>{tracksAdded++;throw new Error('Unexpected track creation');};
  e.load(['pip-core.js','page-state.js','player-layout.js','content.js']);await flush();
  await e.w.__fpipController.run('toggle-pip');await e.w.chrome.storage.sync.set({disabledHosts:['www.youtube.com']});
  release();await flush();await flush();assert.equal(tracksAdded,0);
});

test('smart speed disable restores the user rate and keeps an audible bypass',async t=>{
  const e=environment({settings:{smartSpeed:true,ssExtraHosts:['top.example']}});t.after(e.close);
  const edges=[];const source={connect:node=>edges.push(['source',node]),disconnect:()=>edges.push(['disconnect-source'])};
  const analyser={frequencyBinCount:1024,fftSize:2048,connect:node=>edges.push(['analyser',node]),disconnect:()=>edges.push(['disconnect-analyser']),getByteFrequencyData:buffer=>buffer.fill(70)};
  e.w.AudioContext=class {constructor(){this.state='running';this.sampleRate=48000;this.destination='speaker';}createMediaElementSource(){return source;}createAnalyser(){return analyser;}};
  const video=e.w.document.querySelector('video');video.src='https://top.example/movie.webm';
  e.load(['pip-core.js','page-state.js','player-layout.js','content.js']);await flush();
  [...e.intervals.values()].find(i=>i.ms===150).fn();assert.equal(video.playbackRate,1.25);
  await e.w.chrome.storage.sync.set({smartSpeed:false});assert.equal(video.playbackRate,1);
  assert.deepEqual(edges.at(-1),['source','speaker']);
});
