const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const {environment}=require('./helpers/dom.cjs');
async function setup(t, {supported=true, result=true}={}) {
 const env=environment({url:'https://www.youtube.com/shorts/example'});
 const {w}=env, source=w.document, original=source.querySelector('video');
 const floating=new JSDOM('',{url:source.URL,pretendToBeVisual:true});
 const pw=floating.window; let closed=false;
 Object.defineProperty(pw,'closed',{get:()=>closed});
 pw.close=()=>{closed=true;pw.dispatchEvent(new pw.Event('pagehide'));};
 w.documentPictureInPicture={requestWindow:async()=>pw};
 const calls=[], states=[], timers=[];
 w.setTimeout=fn=>{timers.push(fn);return timers.length;};
 w.clearTimeout=()=>{};
 env.load(['feed-window.js']);
 const player=w.FloatingVideoFeedWindow.create({getVideo:()=>source.querySelector('video'),navigation:{isSupported:()=>supported,navigate:(...args)=>{calls.push(args);return result;}},onState:s=>states.push(s)});
 t.after(()=>{player.close();env.close();floating.window.document.body.innerHTML='';});
 assert.equal(await player.open(original),supported);
 return {env,w,pw,source,original,player,calls,states,timers};
}
function key(pw,key,options={}){const event=new pw.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...options});pw.document.body.dispatchEvent(event);return event;}
function wheel(pw,options={}){const event=new pw.WheelEvent('wheel',{deltaY:80,bubbles:true,cancelable:true,...options});pw.document.body.dispatchEvent(event);return event;}
test('arrows use source controls and return video for site controller before advancing',async t=>{
 const x=await setup(t);assert.equal(x.original.ownerDocument,x.pw.document);
 assert.equal(key(x.pw,'ArrowDown').defaultPrevented,true);
 assert.equal(x.calls[0][0],'next');assert.equal(x.calls[0][1],x.original);assert.equal(x.original.ownerDocument,x.source);
 x.original.src='https://www.youtube.com/changed.mp4';x.timers[0]();assert.equal(x.original.ownerDocument,x.pw.document);
 // A held/repeated key cannot skip multiple feed items.
 key(x.pw,'ArrowDown',{repeat:true});assert.equal(x.calls.length,1);
});
test('up arrow chooses previous; wheel directions and delta modes work',async t=>{
 const x=await setup(t);key(x.pw,'ArrowUp');assert.equal(x.calls[0][0],'previous');
 const y=await setup(t);wheel(y.pw,{deltaY:-4,deltaMode:1});assert.equal(y.calls[0][0],'previous');
 const z=await setup(t);wheel(z.pw,{deltaY:1,deltaMode:2});assert.equal(z.calls[0][0],'next');
});
test('wheel threshold, horizontal scrolling and modified shortcuts are respected',async t=>{
 const x=await setup(t);wheel(x.pw,{deltaY:10,deltaX:100});wheel(x.pw,{ctrlKey:true});key(x.pw,'ArrowDown',{altKey:true});key(x.pw,'ArrowUp',{shiftKey:true});
 assert.equal(x.calls.length,0);wheel(x.pw,{deltaY:30});assert.equal(x.calls.length,0);wheel(x.pw,{deltaY:30});assert.equal(x.calls.length,1);
});
test('editable and slider controls keep arrow keys and wheel',async t=>{
 const x=await setup(t);
 for(const html of ['<input>','<textarea></textarea>','<select></select>','<div role="slider"></div>','<div contenteditable="true"></div>']){
 const host=x.pw.document.createElement('div');host.innerHTML=html;x.pw.document.body.append(host);
 host.firstChild.dispatchEvent(new x.pw.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));host.firstChild.dispatchEvent(new x.pw.WheelEvent('wheel',{deltaY:100,bubbles:true,cancelable:true}));
 }
 assert.equal(x.calls.length,0);
});
test('missing site control does not consume input or strand video',async t=>{
 const x=await setup(t,{result:false});assert.equal(key(x.pw,'ArrowDown').defaultPrevented,false);assert.equal(x.player.video,x.original);assert.equal(x.original.ownerDocument,x.pw.document);
});
test('close restores exact position and inline styles, cancels stale navigation',async t=>{
 const x=await setup(t);key(x.pw,'ArrowDown');x.player.close();x.timers[0]();
 assert.equal(x.player.active,false);assert.equal(x.original.ownerDocument,x.source);assert.equal(x.source.body.firstChild,x.original);assert.equal(x.original.getAttribute('style'),'opacity:1');assert.equal(x.env.intervals.size,0);
});
test('window close restores video, unsupported pages do not request Document PiP',async t=>{
 const x=await setup(t);x.pw.close();assert.equal(x.player.active,false);assert.equal(x.original.ownerDocument,x.source);
 const y=await setup(t,{supported:false});assert.equal(y.original.ownerDocument,y.source);
});
test('disabled while requestWindow pending does not reopen floating player',async t=>{
 const x=await setup(t);x.player.close();let resolve;
 x.w.documentPictureInPicture.requestWindow=()=>new Promise(r=>resolve=r);
 const pending=x.player.open(x.original);x.player.close();resolve(x.pw);
 assert.equal(await pending,false);assert.equal(x.player.active,false);assert.equal(x.original.ownerDocument,x.source);
});

test('slow site transitions stay in the source page until the next video appears',async t=>{
 const x=await setup(t);key(x.pw,'ArrowDown');x.w.history.replaceState(null,'','/shorts/next');x.timers[0]();x.timers[1]();assert.equal(x.original.ownerDocument,x.source);
 x.original.src='https://www.youtube.com/later.mp4';x.timers[2]();assert.equal(x.original.ownerDocument,x.pw.document);
});
test('content integration exits mini layout, prevents native auto-PiP, and restores on disable',async t=>{
 const {flush}=require('./helpers/dom.cjs');
 const env=environment({url:'https://www.youtube.com/shorts/example',tabHost:'www.youtube.com',html:'<ytd-shorts><video id="video"></video><button id="navigation-button-down">Next</button></ytd-shorts>'});
 const {w}=env;const floating=new JSDOM('',{url:w.location.href,pretendToBeVisual:true});const pw=floating.window;
 let closed=false;Object.defineProperty(pw,'closed',{get:()=>closed});pw.close=()=>{closed=true;pw.dispatchEvent(new pw.Event('pagehide'));};
 w.documentPictureInPicture={requestWindow:async()=>pw};
 const track={kind:'captions',label:'English',mode:'hidden',cues:[{}]};Object.defineProperty(w.document.querySelector('video'),'textTracks',{value:[track]});
 env.load(['pip-core.js','page-state.js','player-layout.js','stream-sync.js','feed-navigation.js','feed-window.js','content.js']);await flush();
 await w.chrome.storage.sync.set({ccPip:true});
 t.after(env.close);const controller=w.__fpipController;const video=w.document.querySelector('video');
 await controller.run('toggle-mini');assert.equal(controller.snapshot().inLayout,true);
 assert.equal((await controller.run('toggle-pip')).status,'ok');assert.equal(controller.snapshot().inLayout,false);assert.equal(controller.snapshot().inPip,true);assert.equal(video.ownerDocument,pw.document);assert.equal(track.mode,'showing');
 let nativeRequested=false;video.requestPictureInPicture=async()=>{nativeRequested=true;};await env.mediaHandlers.get('enterpictureinpicture')?.();assert.equal(nativeRequested,false);
 await w.chrome.storage.sync.set({disabledHosts:['www.youtube.com']});assert.equal(closed,true);assert.equal(track.mode,'hidden');assert.equal(video.parentElement.tagName,'YTD-SHORTS');assert.equal(controller.snapshot().inPip,false);
});
