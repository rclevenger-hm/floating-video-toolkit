const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const {environment,flush,root}=require('./helpers/dom.cjs');
async function options(){const e=environment({url:'https://settings.example/',html:fs.readFileSync(path.join(root,'options.html'),'utf8')});e.load(['pip-core.js','options.js']);await flush();return e;}
test('settings expose persisted ultrawide values and keep experiments opt-in',async t=>{
  const e=await options();t.after(e.close);const doc=e.w.document;
  assert.equal(doc.querySelector('#ccPip').checked,false);assert.equal(doc.querySelector('#adComfort').checked,false);
  const ratio=doc.querySelector('#view-ratio');ratio.value='32:9';ratio.dispatchEvent(new e.w.Event('change'));await flush();
  assert.equal(e.sync.viewSettings.ratio,'32:9');
  assert.match(doc.querySelector('#shortcutList').textContent,/Alt\+P/);
});
test('site form rejects malformed input and saves canonical host exclusions',async t=>{
  const e=await options();t.after(e.close);const doc=e.w.document;
  const submit=async value=>{doc.querySelector('#siteHost').value=value;doc.querySelector('#excludeForm').dispatchEvent(new e.w.Event('submit',{cancelable:true}));await flush();};
  await submit('*.example.com');assert.equal(e.sync.disabledHosts,undefined);assert.equal(doc.querySelector('#saveStatus').className,'error');
  await submit('https://EXAMPLE.com/watch?id=3');assert.deepEqual(Array.from(e.sync.disabledHosts),['example.com']);
  assert.match(doc.querySelector('#sitesBody').textContent,/example.com/);
});
test('storage failures are reported rather than claiming settings were saved',async t=>{
  const e=await options();t.after(e.close);
  e.w.chrome.storage.sync.set=async()=>{throw new Error('Quota exceeded');};
  const checkbox=e.w.document.querySelector('#showButton');checkbox.checked=true;checkbox.dispatchEvent(new e.w.Event('change'));await flush();
  assert.match(e.w.document.querySelector('#saveStatus').textContent,/Could not save: Quota exceeded/);
});
