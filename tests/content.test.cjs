const test=require('node:test');
const assert=require('node:assert/strict');
const {content,environment,flush}=require('./helpers/dom.cjs');

test('page button needs visible loaded video and follows its bounds',async t=>{
  const empty=await content({settings:{showButton:true},html:'<h1>Job search</h1>'});t.after(async()=>{await empty.w.chrome.storage.sync.set({showButton:false});empty.close();});
  assert.equal(empty.w.document.getElementById('fpip-button'),null);
  const e=await content({settings:{showButton:true}});t.after(async()=>{await e.w.chrome.storage.sync.set({showButton:false});e.close();});
  const doc=e.w.document,v=doc.querySelector('video');
  const refresh=()=>[...e.intervals.values()].find(i=>i.ms===2000).fn();
  assert.ok(doc.getElementById('fpip-button'));
  v.getBoundingClientRect=()=>({width:640,height:360,left:50,top:150,right:690,bottom:510});
  refresh();assert.equal(doc.getElementById('fpip-button').style.top,'156px');
  assert.equal(doc.getElementById('fpip-button').style.left,'614px');
  const parent=doc.createElement('div');v.before(parent);parent.append(v);
  parent.style.opacity='0';refresh();assert.equal(doc.getElementById('fpip-button'),null);
  parent.style.opacity='1';refresh();assert.ok(doc.getElementById('fpip-button'));
  v.getBoundingClientRect=()=>({width:640,height:360,left:50,top:2000,right:690,bottom:2360});
  refresh();assert.equal(doc.getElementById('fpip-button'),null);
  v.remove();refresh();assert.equal(doc.getElementById('fpip-button'),null);
});

test('page button opens PiP synchronously from its click without a worker round trip',async t=>{
  const e=await content({settings:{showButton:true}});t.after(async()=>{await e.w.chrome.storage.sync.set({showButton:false});e.close();});
  let clicked=false,requested=false;
  e.w.document.querySelector('video').requestPictureInPicture=async()=>{assert.equal(clicked,true);requested=true;};
  e.w.chrome.runtime.sendMessage=async()=>{throw Error('Unexpected worker round trip');};
  clicked=true;e.w.document.getElementById('fpip-button').click();clicked=false;
  assert.equal(requested,true);await flush();
  await e.w.chrome.storage.sync.set({showButton:false});
  assert.equal(e.w.document.getElementById('fpip-button'),null);
});

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
  e.load(['pip-core.js','page-state.js','player-layout.js','stream-sync.js','content.js']);await flush();
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
  e.load(['pip-core.js','page-state.js','player-layout.js','stream-sync.js','content.js']);await flush();
  await e.w.__fpipController.run('toggle-pip');await e.w.chrome.storage.sync.set({disabledHosts:['www.youtube.com']});
  release();await flush();await flush();assert.equal(tracksAdded,0);
});

test('smart speed disable restores the user rate and keeps an audible bypass',async t=>{
  const e=environment({settings:{smartSpeed:true,ssExtraHosts:['top.example']}});t.after(e.close);
  const edges=[];const source={connect:node=>edges.push(['source',node]),disconnect:()=>edges.push(['disconnect-source'])};
  const analyser={frequencyBinCount:1024,fftSize:2048,connect:node=>edges.push(['analyser',node]),disconnect:()=>edges.push(['disconnect-analyser']),getByteFrequencyData:buffer=>buffer.fill(70)};
  e.w.AudioContext=class {constructor(){this.state='running';this.sampleRate=48000;this.destination='speaker';}createMediaElementSource(){return source;}createAnalyser(){return analyser;}};
  const video=e.w.document.querySelector('video');video.src='https://top.example/movie.webm';
  e.load(['pip-core.js','page-state.js','player-layout.js','stream-sync.js','content.js']);await flush();
  [...e.intervals.values()].find(i=>i.ms===150).fn();assert.equal(video.playbackRate,1.25);
  await e.w.chrome.storage.sync.set({smartSpeed:false});assert.equal(video.playbackRate,1);
  assert.deepEqual(edges.at(-1),['source','speaker']);
});

test('a completed native PiP open can be closed immediately without a debounce delay',async t=>{
  const e=await content();t.after(e.close);const c=e.w.__fpipController;
  assert.equal((await c.run('toggle-pip')).status,'ok');assert.ok(e.w.document.pictureInPictureElement);
  assert.equal((await c.run('toggle-pip')).status,'ok');assert.equal(e.w.document.pictureInPictureElement,null);
});
test('panned zoom clips back to the original player bounds',async t=>{
  const e=await content();t.after(e.close);
  await e.w.chrome.storage.sync.set({viewSettings:{panX:0,panY:100},videoAdjust:{zoom:2}});
  assert.equal(e.w.document.querySelector('video').style.clipPath,'inset(50% 50% 0% 0%)');
});

test('mixer controls are bounded, pinned to a video, and obey exclusions',async t=>{
  const e=await content();t.after(e.close);const c=e.w.__fpipController,v=e.w.document.querySelector('video');
  const id=c.snapshot().media.id;
  assert.equal((await c.mixer(id,'volume',0.3)).status,'ok');assert.equal(v.volume,0.3);
  assert.equal((await c.mixer(id,'volume',2)).status,'invalid');assert.equal(v.volume,0.3);
  assert.equal((await c.mixer('stale','mute')).status,'stale-player');assert.equal(v.muted,false);
  await c.mixer(id,'mute');assert.equal(v.muted,true);
  await e.w.chrome.storage.sync.set({disabledHosts:['top.example']});
  assert.equal((await c.mixer(id,'unmute')).status,'disabled');assert.equal(v.muted,true);
});
test('pop-out mode suppresses automatic PiP and speed changes without altering preferences',async t=>{
  const e=await content({settings:{autoPip:true,smartSpeed:true,ssExtraHosts:['top.example']}});t.after(e.close);
  const c=e.w.__fpipController,v=e.w.document.querySelector('video');
  await c.setMultiView(true);
  assert.equal(v.autoPictureInPicture,false);assert.equal(e.mediaHandlers.get('enterpictureinpicture'),null);
  assert.equal([...e.intervals.values()].some(i=>i.ms===150),false);
  await e.w.chrome.storage.sync.set({smartSpeed:true,autoPip:true});
  assert.equal([...e.intervals.values()].some(i=>i.ms===150),false);
  await c.setMultiView(false);assert.equal(v.autoPictureInPicture,true);
  assert.equal(typeof e.mediaHandlers.get('enterpictureinpicture'),'function');
  assert.equal(e.sync.smartSpeed,true);assert.equal(e.sync.autoPip,true);
});
test('explicit pause and site disable cancel timed resume',async t=>{
  const e=await content();t.after(e.close);const c=e.w.__fpipController,v=e.w.document.querySelector('video');const id=c.snapshot().media.id;
  await c.mixer(id,'hold',30);assert.equal(c.snapshot().media.holding,true);
  await c.run('pause');assert.equal(c.snapshot().media.holding,false);assert.equal(v.paused,true);
  await c.run('play');await c.mixer(id,'hold',30);
  await e.w.chrome.storage.sync.set({disabledHosts:['top.example']});
  await e.w.chrome.storage.sync.set({disabledHosts:[]});
  assert.equal(c.snapshot().media.holding,false);assert.equal(v.paused,true);
});


test('PiP rejections report an actionable reason instead of silently failing',async t=>{
  const e=await content();t.after(e.close);const video=e.w.document.querySelector('video');
  for (const [name,status] of [['NotAllowedError','needs-gesture'],['SecurityError','pip-blocked'],['NotSupportedError','pip-unsupported']]) {
    video.requestPictureInPicture=async()=>{throw new e.w.DOMException('Test rejection',name);};
    assert.equal((await e.w.__fpipController.run('toggle-pip')).status,status);
  }
});
