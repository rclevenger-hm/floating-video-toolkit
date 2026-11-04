const {test,expect,chromium}=require('@playwright/test');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');

test('generated release ZIP loads as an unpacked Chromium extension',async()=>{
 const root=path.resolve(__dirname,'../..');
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'fvt-release-'));
 let context;
 try {
  const output=path.join(temp,'artifacts'), unpacked=path.join(temp,'extension');
  execFileSync('python3',['scripts/package.py','--release-run','123','--sha','a'.repeat(40),'--output-dir',output],{cwd:root});
  const metadata=JSON.parse(await fs.readFile(path.join(output,'release.json'),'utf8'));
  execFileSync('python3',['-m','zipfile','-e',path.join(output,metadata.archive),unpacked]);
  context=await chromium.launchPersistentContext('',{channel:'chromium',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging']});
  const cdp=await context.browser().newBrowserCDPSession();
  await cdp.send('Extensions.loadUnpacked',{path:unpacked});
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  const manifest=await worker.evaluate(()=>chrome.runtime.getManifest());
  expect(manifest.version).toBe(metadata.version);
  expect(manifest.version).toMatch(/^\d+\.\d+\.\d+\.123$/);
  expect(manifest.name).toBe('Floating Video Toolkit');
  const page=await context.newPage();
  await page.goto(`chrome-extension://${worker.url().split('/')[2]}/options.html`);
  await expect(page.locator('#ccPip')).toBeVisible();
  expect(await fs.readFile(path.join(unpacked,'INSTALL.md'),'utf8')).toContain('Load unpacked');
 } finally {
  await context?.close();await fs.rm(temp,{recursive:true,force:true});
 }
});
