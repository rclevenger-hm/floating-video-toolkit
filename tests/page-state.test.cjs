const test = require('node:test');
const assert = require('node:assert/strict');
const {createStyleLedger} = require('../page-state.js');
function element(initial = {}) {
  const values=new Map(Object.entries(initial).map(([k,v])=>[k,{value:v,priority:''}]));
  return {style:{getPropertyValue:k=>values.get(k)?.value||'',getPropertyPriority:k=>values.get(k)?.priority||'',
    setProperty:(k,value,priority='')=>values.set(k,{value,priority}), removeProperty:k=>values.delete(k)}};
}
test('disable restores original styles including priority without deleting unrelated properties',()=>{
  const video=element({transform:'rotate(5deg)',color:'red'});
  video.style.setProperty('filter','sepia(1)','important');
  const ledger=createStyleLedger();
  ledger.set(video,'filter','brightness(1.2)');
  ledger.set(video,'transform','scale(1.2)');
  ledger.set(video,'transform-origin','center');
  ledger.restoreAll();
  assert.equal(video.style.getPropertyValue('filter'),'sepia(1)');
  assert.equal(video.style.getPropertyPriority('filter'),'important');
  assert.equal(video.style.getPropertyValue('transform'),'rotate(5deg)');
  assert.equal(video.style.getPropertyValue('transform-origin'),'');
  assert.equal(video.style.getPropertyValue('color'),'red');
});
test('switching videos restores the old selection and preserves later site changes',()=>{
  const old=element({filter:'none'}), active=element();
  const ledger=createStyleLedger();
  ledger.set(old,'filter','brightness(1.2)');
  ledger.set(active,'filter','brightness(1.2)');
  old.style.setProperty('filter','contrast(2)');
  ledger.restoreExcept(active);
  assert.equal(old.style.getPropertyValue('filter'),'contrast(2)');
  assert.equal(active.style.getPropertyValue('filter'),'brightness(1.2)');
  ledger.restoreAll();
  assert.equal(active.style.getPropertyValue('filter'),'');
});
