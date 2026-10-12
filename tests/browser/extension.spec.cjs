const {test:base,expect,chromium}=require('@playwright/test');
const path=require('node:path');
const test=base.extend({extension:async({},use)=>{
  const root=path.resolve(__dirname,'../..');
  const context=await chromium.launchPersistentContext('',{channel:'chromium',headless:true,viewport:{width:1280,height:960},
    ignoreDefaultArgs:['--disable-extensions'],
    args:['--enable-unsafe-extension-debugging']});
  const browserCDP=await context.browser().newBrowserCDPSession();
  await browserCDP.send('Extensions.loadUnpacked',{path:root});
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  await use({context,worker,id:worker.url().split('/')[2]});await context.close();
}});
const playerURL='http://127.0.0.1:43123/player.html';
async function player(extension){
  const page=await extension.context.newPage();
  await page.goto(playerURL);
  await page.locator('#main').evaluate(video=>video.play());
  const tabId=await extension.worker.evaluate(async()=> (await chrome.tabs.query({url:'http://127.0.0.1:43123/*'}))[0].id);
  await expect.poll(()=>extension.worker.evaluate(async id=>{
    const result=await chrome.scripting.executeScript({target:{tabId:id},func:()=>globalThis.__fpipController?.snapshot().enabled});
    return result[0]?.result;
  },tabId)).toBe(true);
  return {page,tabId};
}
async function command(extension,tabId,action){return extension.worker.evaluate(async({tabId,action})=>callToggle(tabId,action),{tabId,action});}

for (const showButton of [false,true]) test(`toolbar opens and closes native PiP without a page gesture (page button ${showButton})`,async({extension})=>{
  await extension.worker.evaluate(value=>chrome.storage.sync.set({showButton:value,autoPip:false}),showButton);
  const {page,tabId}=await player(extension);
  await page.bringToFront();
  await extension.worker.evaluate(id=>chrome.tabs.update(id,{active:true}),tabId);
  const cdp=await extension.context.newCDPSession(page);
  const browserCDP=await extension.context.browser().newBrowserCDPSession();
  const {targetInfos}=await browserCDP.send('Target.getTargets',{filter:[{type:'tab',exclude:false}]});
  const targetInfo=targetInfos.find(target=>target.url===page.url());
  expect(targetInfo).toBeTruthy();
  const read=async expression=>(await cdp.send('Runtime.evaluate',{expression,returnByValue:true,userGesture:false})).result.value;
  // Playwright evaluate() supplies a gesture by default. Let setup gestures
  // expire and use raw CDP reads so they cannot hide toolbar activation bugs.
  await expect.poll(()=>read('navigator.userActivation.isActive'),{timeout:8000}).toBe(false);
  await browserCDP.send('Extensions.triggerAction',{id:extension.id,targetId:targetInfo.targetId});
  try { await expect.poll(()=>read('!!document.pictureInPictureElement')).toBe(true); }
  catch (error) {
    console.log('Toolbar result',await extension.worker.evaluate(async id=>({title:await chrome.action.getTitle({tabId:id}),active:(await chrome.tabs.query({active:true,currentWindow:true})).map(t=>({id:t.id,url:t.url}))}),tabId));
    throw error;
  }
  await browserCDP.send('Extensions.triggerAction',{id:extension.id,targetId:targetInfo.targetId});
  await expect.poll(()=>read('!!document.pictureInPictureElement')).toBe(false);
});

test('settings persist crop and exclusions; all shortcuts are visible',async({extension},testInfo)=>{
  const page=await extension.context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`chrome-extension://${extension.id}/options.html`);
  await expect(page.locator('.shortcut')).toHaveCount(19);
  await page.locator('#view-fit').selectOption('fill');await page.locator('#view-ratio').selectOption('21:9');
  await page.locator('#siteHost').fill('https://EXAMPLE.COM/watch');await page.getByRole('button',{name:'Add exclusion'}).click();
  await expect(page.locator('#sitesBody')).toContainText('example.com');
  await page.reload();await expect(page.locator('#view-fit')).toHaveValue('fill');await expect(page.locator('#view-ratio')).toHaveValue('21:9');
  expect(errors).toEqual([]);
  await page.screenshot({path:testInfo.outputPath('settings-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('settings-mobile.png'),fullPage:true});
});

test('single-owner commands pause and mute the main video without changing the iframe',async({extension})=>{
  const {page,tabId}=await player(extension);
  const child=page.frameLocator('iframe').locator('video');await child.evaluate(v=>v.play());
  expect((await command(extension,tabId,'pause')).status).toBe('ok');
  await expect.poll(()=>page.locator('#main').evaluate(v=>v.paused)).toBe(true);
  expect(await child.evaluate(v=>v.paused)).toBe(false);
  // Click the main video to keep it selected even while it is paused.
  await page.locator('#main').click({position:{x:20,y:20}});
  await command(extension,tabId,'mute');expect(await page.locator('#main').evaluate(v=>v.muted)).toBe(true);
  await command(extension,tabId,'unmute');expect(await page.locator('#main').evaluate(v=>v.muted)).toBe(false);
});

test('top-page exclusion also disables the cross-origin iframe',async({extension})=>{
  const {page,tabId}=await player(extension);
  await page.frameLocator('iframe').locator('video').waitFor();
  await extension.worker.evaluate(()=>chrome.storage.sync.set({disabledHosts:['127.0.0.1']}));
  await expect.poll(()=>extension.worker.evaluate(async id=>{
    const frames=await chrome.scripting.executeScript({target:{tabId:id,allFrames:true},func:()=>globalThis.__fpipController?.snapshot().enabled});
    return frames.length>=2&&frames.every(f=>f.result===false);
  },tabId)).toBe(true);
  expect((await command(extension,tabId,'toggle-pip')).status).toBe('disabled');
});

test('four mini-player corners, typing protection, and disable restore the same video',async({extension},testInfo)=>{
  const {page,tabId}=await player(extension);
  for(const [corner,top,left] of [[1,true,true],[2,true,false],[3,false,true],[4,false,false]]){
    expect((await command(extension,tabId,'snap-'+corner)).status).toBe('ok');
    const box=await page.locator('#fpip-player').boundingBox();
    expect(top?box.y<30:box.y>500).toBe(true);expect(left?box.x<30:box.x>700).toBe(true);
  }
  await page.screenshot({path:testInfo.outputPath('mini-player.png')});
  await page.locator('#typing').fill('1234');
  expect(await page.locator('#fpip-player').evaluate(el=>el.style.right)).toBe('16px');
  await extension.worker.evaluate(()=>chrome.storage.sync.set({disabledHosts:['127.0.0.1']}));
  await expect(page.locator('#fpip-player')).toHaveCount(0);
  expect(await page.locator('#main').evaluate(v=>v.parentElement.tagName)).toBe('BODY');
  expect(await page.locator('#main').evaluate(v=>v.style.filter)).toBe('sepia(0.2)');
});

test('ultrawide cinema applies fill and zoom and restores the original layout',async({extension},testInfo)=>{
  const {page,tabId}=await player(extension);
  await extension.worker.evaluate(()=>chrome.storage.sync.set({viewSettings:{fit:'fill',ratio:'21:9',panX:25,panY:50},videoAdjust:{zoom:1.3}}));
  expect((await command(extension,tabId,'toggle-cinema')).status).toBe('ok');
  await expect(page.locator('#main')).toHaveCSS('object-fit','cover');
  const stage=await page.locator('#fpip-player .stage').boundingBox();
  expect(stage.width/stage.height).toBeCloseTo(21/9,1);
  await page.screenshot({path:testInfo.outputPath('ultrawide.png')});
  await command(extension,tabId,'close-layout');await command(extension,tabId,'reset-view');
  expect(await page.locator('#main').evaluate(v=>v.style.transform)).toBe('');
});

test('page-button native PiP follows playback shortcuts across tabs',async({extension})=>{
  const {page,tabId}=await player(extension);
  await extension.worker.evaluate(()=>chrome.storage.sync.set({showButton:true}));
  await page.getByRole('button',{name:'Toggle floating video',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>Boolean(document.pictureInPictureElement))).toBe(true);
  const other=await extension.context.newPage();await other.goto('about:blank');
  await expect.poll(()=>extension.worker.evaluate(async()=>commandTarget('pause'))).toBe(tabId);
  expect((await command(extension,tabId,'pause')).status).toBe('ok');
  expect(await page.locator('#main').evaluate(v=>v.paused)).toBe(true);
  await page.bringToFront();await page.getByRole('button',{name:'Toggle floating video',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>Boolean(document.pictureInPictureElement))).toBe(false);
});

test('page buttons follow visible players, including cross-origin embeds, without leaking onto empty pages',async({extension})=>{
  await extension.worker.evaluate(()=>chrome.storage.sync.set({showButton:true,autoPip:false}));
  const {page}=await player(extension);
  const button=page.locator('#fpip-button');
  const child=page.frameLocator('iframe');
  await expect(button).toHaveCount(1);
  await expect(child.locator('#fpip-button')).toHaveCount(1);
  const box=await button.boundingBox(),videoBox=await page.locator('#main').boundingBox();
  expect(box.x).toBeGreaterThan(videoBox.x);expect(box.x+box.width).toBeLessThanOrEqual(videoBox.x+videoBox.width);
  expect(box.y).toBeGreaterThanOrEqual(videoBox.y);
  await page.locator('#main').evaluate(video=>video.style.opacity='0');
  await expect(button).toHaveCount(0);
  await page.locator('iframe').evaluate(frame=>frame.style.display='none');
  await expect(child.locator('#fpip-button')).toHaveCount(0);
  await page.locator('iframe').evaluate(frame=>frame.style.display='');
  await expect(child.locator('#fpip-button')).toHaveCount(1);
  await child.locator('#fpip-button').click();
  await expect.poll(()=>child.locator('video').evaluate(v=>v===document.pictureInPictureElement)).toBe(true);
  await child.locator('#fpip-button').click();
  await page.locator('iframe').evaluate(frame=>frame.remove());
  await page.locator('#main').evaluate(video=>{video.style.opacity='1';video.style.marginTop='1800px';});
  await expect(button).toHaveCount(0);
  await page.locator('#main').scrollIntoViewIfNeeded();await expect(button).toHaveCount(1);
  await page.locator('#main').evaluate(video=>video.remove());await expect(button).toHaveCount(0);
  await page.evaluate(()=>document.body.innerHTML='<h1>Job search</h1><p>No video here</p>');
  await expect(button).toHaveCount(0);
});

test('multi-view keeps two source tabs alive with independent mixer controls and returns them safely',async({extension},testInfo)=>{
  const {page:first,tabId:firstId}=await player(extension);
  const second=await extension.context.newPage();await second.goto(playerURL+'?second');
  await second.locator('#main').evaluate(v=>{v.dataset.identity='original';return v.play();});
  await first.evaluate(()=>document.title='RedZone fixture');await second.evaluate(()=>document.title='Chargers fixture');
  const secondId=await extension.worker.evaluate(async()=> (await chrome.tabs.query({})).find(t=>t.url?.endsWith('?second')).id);
  const originalWindowId=await extension.worker.evaluate(async id=>(await chrome.tabs.get(id)).windowId,firstId);
  const mixer=await extension.context.newPage();await mixer.goto(`chrome-extension://${extension.id}/mixer.html`);
  const redzone=mixer.locator('.player').filter({hasText:'RedZone fixture'}),chargers=mixer.locator('.player').filter({hasText:'Chargers fixture'});
  await expect(mixer.locator('.player')).toHaveCount(2);
  await redzone.getByRole('button',{name:'Pop out',exact:true}).click();
  await expect.poll(()=>extension.worker.evaluate(async({id,original})=>{
    const tab=await chrome.tabs.get(id);
    return tab.windowId!==original && (await chrome.windows.getLastFocused()).id===tab.windowId;
  },{id:firstId,original:originalWindowId})).toBe(true);
  await chargers.getByRole('button',{name:'Pop out',exact:true}).click();
  await expect.poll(()=>extension.worker.evaluate(async({id,original})=>{
    const tab=await chrome.tabs.get(id);
    return tab.windowId!==original && (await chrome.windows.getLastFocused()).id===tab.windowId;
  },{id:secondId,original:originalWindowId})).toBe(true);
  await expect.poll(()=>extension.worker.evaluate(async({ids,original})=>{
    const tabs=await Promise.all(ids.map(id=>chrome.tabs.get(id)));
    return tabs.every(t=>t.windowId!==original);
  },{ids:[firstId,secondId],original:originalWindowId})).toBe(true);
  const windowIds=await extension.worker.evaluate(async ids=>Promise.all(ids.map(async id=>(await chrome.tabs.get(id)).windowId)),[firstId,secondId]);
  expect(new Set(windowIds).size).toBe(2);expect(windowIds).not.toContain(originalWindowId);
  expect(await second.locator('#main').getAttribute('data-identity')).toBe('original');
  await redzone.getByRole('button',{name:'Unmute',exact:true}).click();
  await expect.poll(()=>first.locator('#main').evaluate(v=>v.muted)).toBe(false);
  expect(await second.locator('#main').evaluate(v=>v.muted)).toBe(true);
  await chargers.getByRole('slider').evaluate(input=>{input.value='25';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));});
  await expect.poll(()=>second.locator('#main').evaluate(v=>v.volume)).toBe(0.25);
  expect(await first.locator('#main').evaluate(v=>v.volume)).toBe(1);
  await redzone.getByRole('button',{name:'Pause',exact:true}).click();
  await expect.poll(()=>first.locator('#main').evaluate(v=>v.paused)).toBe(true);
  expect(await second.locator('#main').evaluate(v=>v.paused)).toBe(false);
  await chargers.getByRole('button',{name:'Video view',exact:true}).click();
  await expect(second.locator('#fpip-player')).toHaveCount(1);
  await mixer.screenshot({path:testInfo.outputPath('multi-view-mixer.png'),fullPage:true});
  await mixer.setViewportSize({width:390,height:844});
  expect(await mixer.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await mixer.screenshot({path:testInfo.outputPath('multi-view-mobile.png'),fullPage:true});
  await redzone.getByRole('button',{name:'Return to tab',exact:true}).click();
  await chargers.getByRole('button',{name:'Return to tab',exact:true}).click();
  await expect.poll(()=>extension.worker.evaluate(async id=>(await chrome.tabs.get(id)).windowId,secondId)).toBe(originalWindowId);
  await expect(second.locator('#fpip-player')).toHaveCount(0);
  expect(await second.locator('#main').getAttribute('data-identity')).toBe('original');
});

test('popout command keeps the player focused when creating or reusing the mixer',async({extension})=>{
  await extension.worker.evaluate(()=>chrome.storage.sync.set({autoPip:false}));
  const {page,tabId}=await player(extension);
  await page.locator('#main').evaluate(v=>v.dataset.identity='original');
  for (let attempt=0;attempt<2;attempt++) {
    const state=await extension.worker.evaluate(async id=>{
      // On the second attempt this puts the existing mixer in front first.
      const url=chrome.runtime.getURL('mixer.html');
      if ((await chrome.tabs.query({})).some(t=>t.url===url)) await FloatingVideoMultiView.openMixer();
      const result=await performAction(id,'popout-player');
      const tab=await chrome.tabs.get(id);
      return {status:result.status,player:tab.windowId,focused:(await chrome.windows.getLastFocused()).id};
    },tabId);
    expect(state.status).toBe('ok');expect(state.focused).toBe(state.player);
    // Window creation resolves before its tab finishes navigating to mixer.html.
    await expect.poll(()=>extension.worker.evaluate(async()=>
      (await chrome.tabs.query({})).filter(t=>t.url===chrome.runtime.getURL('mixer.html')).length)).toBe(1);
    expect(await extension.worker.evaluate(async()=> (await chrome.windows.getLastFocused()).id)).toBe(state.player);
  }
  expect(await page.locator('#main').getAttribute('data-identity')).toBe('original');
});

test('mixer requests valid seeks, rejects missing buffer, and holds survive panel closure',async({extension})=>{
  const {page}=await player(extension);
  await page.locator('iframe').evaluate(frame=>frame.remove());
  await page.locator('#main').evaluate(v=>{v.loop=true;v.pause();v.currentTime=2;});
  const mixer=await extension.context.newPage();await mixer.goto(`chrome-extension://${extension.id}/mixer.html`);
  const row=mixer.locator('.player');await expect(row).toHaveCount(1);
  await row.locator('summary').click();await row.locator('.seconds').fill('600');
  await row.getByRole('button',{name:'Rewind',exact:true}).click();
  await expect(row.locator('.row-status')).toContainText('outside');
  await page.locator('#main').evaluate(v=>{v.pause();v.currentTime=2;});
  await expect.poll(()=>page.locator('#main').evaluate(v=>!v.seeking && v.currentTime)).toBeCloseTo(2,1);
  await row.locator('.seconds').fill('1');await row.getByRole('button',{name:'Rewind',exact:true}).click();
  await expect.poll(()=>page.locator('#main').evaluate(v=>v.currentTime)).toBeCloseTo(1,1);
  await row.getByRole('button',{name:'Play',exact:true}).click();
  await expect.poll(()=>page.locator('#main').evaluate(v=>v.paused)).toBe(false);
  await row.locator('.seconds').fill('2');await row.getByRole('button',{name:'Timed hold',exact:true}).click();
  await expect.poll(()=>page.locator('#main').evaluate(v=>v.paused)).toBe(true);
  await mixer.close();
  await expect.poll(()=>page.locator('#main').evaluate(v=>v.paused)).toBe(false);
});

test('stale mixer documents cannot control a navigated source and source pages cannot invoke privileged window actions',async({extension})=>{
  const {page,tabId}=await player(extension);
  const target=await extension.worker.evaluate(async()=> (await FloatingVideoMultiView.scan()).players[0]);
  const denied=await extension.worker.evaluate(async id=>{
    return (await chrome.scripting.executeScript({target:{tabId:id},func:()=>chrome.runtime.sendMessage({type:'MULTI_VIEW',action:'scan'})}))[0].result;
  },tabId);
  expect(denied.status).toBe('forbidden');
  await page.reload();
  const result=await extension.worker.evaluate(async target=>FloatingVideoMultiView.control(target,'pause'),target);
  expect(result.status).not.toBe('ok');
  await expect.poll(()=>page.locator('#main').evaluate(v=>v.paused)).toBe(false);
});

test('toolbar recovers an existing video tab after reinstall without reloading its player',async({extension})=>{
  const {page}=await player(extension);
  await page.locator('#main').evaluate(v=>v.dataset.session='keep-playing');
  const browserCDP=await extension.context.browser().newBrowserCDPSession();
  const cdp=await extension.context.newCDPSession(page);
  const {targetInfos}=await browserCDP.send('Target.getTargets',{filter:[{type:'tab',exclude:false}]});
  const target=targetInfos.find(t=>t.url===page.url());
  await browserCDP.send('Extensions.uninstall',{id:extension.id});
  const loaded=extension.context.waitForEvent('serviceworker');
  const {id}=await browserCDP.send('Extensions.loadUnpacked',{path:path.resolve(__dirname,'../..')});
  const worker=await loaded;
  await worker.evaluate(()=>chrome.storage.sync.set({autoPip:false,showButton:true}));
  const read=async expression=>(await cdp.send('Runtime.evaluate',{expression,returnByValue:true,userGesture:false})).result.value;
  await expect.poll(()=>read('navigator.userActivation.isActive'),{timeout:8000}).toBe(false);
  await browserCDP.send('Extensions.triggerAction',{id,targetId:target.targetId});
  await expect.poll(()=>read('!!document.pictureInPictureElement')).toBe(true);
  expect(await read('document.querySelector("#main").dataset.session')).toBe('keep-playing');
  await expect(page.locator('#fpip-button')).toHaveCount(1);
});
