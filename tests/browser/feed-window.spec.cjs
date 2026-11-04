const {test,expect}=require('@playwright/test');
const path=require('node:path');
test('real Document PiP handles arrows and wheel then returns the video',async({page})=>{
 await page.goto('http://127.0.0.1:43123/player.html');
 await page.addScriptTag({path:path.resolve(__dirname,'../../feed-window.js')});
 await page.evaluate(()=>{
  const video=document.querySelector('#main');window.changes=[];
  window.feed=FloatingVideoFeedWindow.create({getVideo:()=>video,navigation:{isSupported:()=>true,navigate:direction=>{changes.push(direction);video.src=`sample.webm?item=${changes.length}`;return true;}}});
  const button=document.createElement('button');button.id='open-feed';button.textContent='Open feed';button.onclick=()=>feed.open(video);document.body.append(button);
 });
 const popupPromise=page.context().waitForEvent('page');await page.locator('#open-feed').click();const popup=await popupPromise;
 await expect(popup.locator('video')).toHaveCount(1);
 await popup.keyboard.press('ArrowDown');await expect.poll(()=>page.evaluate(()=>changes.slice())).toEqual(['next']);
 await expect(popup.locator('video')).toHaveCount(1);
 await page.waitForTimeout(700);await popup.mouse.move(100,100);await popup.mouse.wheel(0,-120);
 await expect.poll(()=>page.evaluate(()=>changes.slice())).toEqual(['next','previous']);
 await expect(popup.locator('video')).toHaveCount(1);
 await popup.getByRole('button',{name:'Close',exact:true}).click();
 await expect(page.locator('#main')).toHaveCount(1);expect(await page.evaluate(()=>feed.active)).toBe(false);
});
