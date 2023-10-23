const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../pip-core.js');
const frame = (frameId, values = {}) => ({frameId, result: {host:'player.example', candidate:{playing:true, area:100, pixels:100, selectedAt:0}, ...values}});

test('hostnames are canonical and exclusions match exactly', () => {
  assert.equal(core.normalizeHost(' HTTPS://Example.COM./watch?v=1 '), 'example.com');
  assert.equal(core.normalizeHost('localhost:8000'), 'localhost');
  assert.equal(core.isDisabled(['example.com'], ['player.example.com']), false);
  assert.equal(core.isDisabled(['EXAMPLE.COM.'], ['example.com']), true);
  for (const invalid of ['', '*.example.com', 'bad host', 'javascript:alert(1)', 'https://user:pass@example.com']) {
    assert.throws(() => core.normalizeHost(invalid));
  }
});
test('top page exclusions block all frames; frame exclusions only block that frame', () => {
  assert.equal(core.chooseFrame([frame(0),frame(2)], ['top.example'], 'top.example'), null);
  const other = frame(3, {host:'other.example'});
  assert.equal(core.chooseFrame([frame(2),other], ['player.example'], 'top.example'), other);
  assert.equal(core.chooseFrame([frame(2,{ancestors:['blocked.example']})], ['blocked.example'], 'top.example'), null);
});
test('existing PiP owner wins so a second toggle exits instead of moving the window', () => {
  const owner = frame(2,{inPip:true,candidate:null});
  assert.equal(core.chooseFrame([frame(0), owner], [], 'top.example'), owner);
});
test('explicit video choice outranks a larger playing video in another frame', () => {
  const selected = frame(3,{candidate:{selectedAt:123,playing:false,area:10,pixels:10}});
  assert.equal(core.chooseFrame([frame(0), selected], [], 'top.example'), selected);
});
test('playing then displayed size breaks ties deterministically', () => {
  const paused = frame(0,{candidate:{playing:false,area:9999,pixels:9999}});
  const bigger = frame(4,{candidate:{playing:true,area:400,pixels:400}});
  assert.equal(core.chooseFrame([paused, frame(2), bigger], [], 'top.example'), bigger);
  assert.equal(core.chooseFrame([frame(4), frame(0)], [], 'top.example').frameId, 0);
  assert.equal(core.chooseFrame([{frameId:0}], [], 'top.example'), null);
});
test('unloaded, hidden, and detached videos cannot win selection', () => {
  const video = {isConnected:true, readyState:3, videoWidth:640, videoHeight:360, paused:false,
    ownerDocument:{defaultView:{getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'})}},
    getBoundingClientRect:()=>({width:320,height:180})};
  assert.equal(core.pickVideo([video], null), video);
  assert.equal(core.pickVideo([{...video,readyState:0}], null), null);
  assert.equal(core.pickVideo([{...video,isConnected:false}], null), null);
  assert.equal(core.pickVideo([{...video,getBoundingClientRect:()=>({width:0,height:0})}], null), null);
});
