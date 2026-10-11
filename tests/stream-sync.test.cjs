const test=require('node:test');
const assert=require('node:assert/strict');
const {create,seekWindow}=require('../stream-sync.js');
function setup(ranges=[[100,200]],time=160) {
  const video=new EventTarget();
  Object.assign(video,{isConnected:true,currentSrc:'stream',currentTime:time,paused:false,ended:false,volume:1,muted:false,
    seekable:{length:ranges.length,start:i=>ranges[i][0],end:i=>ranges[i][1]},
    pause(){this.paused=true;},async play(){this.paused=false;this.dispatchEvent(new Event('play'));}});
  let selected=video,clock=1000,next=0;const timers=new Map();
  const sync=create({getVideo:()=>selected,now:()=>clock,schedule:fn=>{timers.set(++next,fn);return next;},unschedule:id=>timers.delete(id)});
  return {video,sync,timers,select:v=>selected=v,tick:async seconds=>{clock+=seconds*1000;for(const callback of [...timers.values()])await callback();}};
}
test('DVR rewind uses current playback position, rejects eviction and discontinuity gaps',async()=>{
  const {video,sync}=setup([[100,150],[160,200]],180);
  assert.equal(seekWindow(video).back,20);
  assert.equal((await sync.run(video,'seek',-30)).status,'no-buffer');assert.equal(video.currentTime,180);
  assert.equal((await sync.run(video,'seek',-15)).status,'ok');assert.equal(video.currentTime,165);
  assert.equal((await sync.run(video,'seek',40)).status,'no-buffer');
  assert.equal((await sync.run(video,'seek',NaN)).status,'invalid');
});
test('unseekable streams expose zero rewind without claiming a buffer',async()=>{
  const {video,sync}=setup([],0);
  assert.equal(sync.snapshot().back,0);assert.equal((await sync.run(video,'seek',-10)).status,'no-buffer');
});
test('hold resumes the same player after its deadline, independent of mixer lifetime',async()=>{
  const s=setup();assert.equal((await s.sync.run(s.video,'hold',30)).status,'ok');
  assert.equal(s.video.paused,true);assert.equal(s.sync.snapshot().holdRemaining,30);
  assert.equal((await s.sync.run(s.video,'hold',5)).status,'busy');
  await s.tick(30);assert.equal(s.video.paused,false);assert.equal(s.sync.snapshot().holding,false);
});
test('cancel, manual resume, source changes and disconnected players never get a late resume',async()=>{
  for (const action of ['cancel','play','emptied','disconnect','replace']) {
    const s=setup();let plays=0;
    s.video.play=async()=>{plays++;s.video.paused=false;s.video.dispatchEvent(new Event('play'));};
    await s.sync.run(s.video,'hold',30);
    if(action==='cancel') await s.sync.run(s.video,'cancel-hold');
    if(action==='play') await s.video.play();
    if(action==='emptied') s.video.dispatchEvent(new Event('emptied'));
    if(action==='disconnect') s.video.isConnected=false;
    if(action==='replace') s.select(setup().video);
    await s.tick(30);assert.equal(plays,action==='play'?1:0,action);
    assert.equal(s.sync.snapshot()?.holding || false,false);
  }
});
test('blocked resume is reported; already paused streams and invalid durations stay unchanged',async()=>{
  const s=setup();s.video.play=async()=>{throw new Error('autoplay');};
  assert.equal((await s.sync.run(s.video,'hold',601)).status,'invalid');
  await s.sync.run(s.video,'hold',2);await s.tick(2);
  assert.match(s.sync.snapshot().notice,/blocked/);assert.equal(s.video.paused,true);
  assert.equal((await s.sync.run(s.video,'hold',30)).status,'paused');
});
test('video identity changes rather than redirecting a stale mixer action',()=>{
  const s=setup();const first=s.sync.snapshot().id;
  s.select(setup().video);assert.equal(s.sync.resolve(first),null);assert.notEqual(s.sync.snapshot().id,first);
});

test('reusing the same element for a new source invalidates old mixer tokens',()=>{
  const s=setup();const first=s.sync.snapshot().id;
  s.video.currentSrc='new-stream';assert.equal(s.sync.resolve(first),null);
  const second=s.sync.snapshot().id;
  s.video.dispatchEvent(new Event('emptied'));assert.equal(s.sync.resolve(second),null);
});
