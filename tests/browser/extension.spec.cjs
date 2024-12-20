const {test:base,expect,chromium}=require('@playwright/test');
const path=require('node:path');
const test=base.extend({extension:async({},use)=>{
  const root=path.resolve(__dirname,'../..');
  const context=await chromium.launchPersistentContext('',{channel:'chromium',headless:true,viewport:{width:1280,height:960},
    args:['--disable-extensions-except='+root,'--load-extension='+root]});
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

test('settings persist crop and exclusions; all shortcuts are visible',async({extension},testInfo)=>{
  const page=await extension.context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`chrome-extension://${extension.id}/options.html`);
  await expect(page.locator('.shortcut')).toHaveCount(17);
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
