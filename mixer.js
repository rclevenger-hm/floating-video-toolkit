(() => {
  'use strict';
  const list = document.querySelector('#players'), status = document.querySelector('#status');
  const rows = new Map();
  let busy = false;
  const key = target => `${target.tabId}:${target.documentId}:${target.videoId}`;
  const targetOf = player => ({tabId:player.tabId,documentId:player.documentId,videoId:player.videoId});
  async function request(action,target,value,targets) {
    try { return await chrome.runtime.sendMessage({type:'MULTI_VIEW',action,target,value,targets}); }
    catch (_) { return {status:'unavailable',message:'Connection lost. Reload the extension and source tabs.'}; }
  }
  function message(result) {
    return result?.message || ({ok:'Done.',disabled:'Extension disabled on this site.',invalid:'Enter a number from 1 to 600 seconds.',
      'embedded-layout':'Video view requires a top-page player. Use this service’s original layout.',
      'stale-player':'Player changed. Refresh players.'}[result?.status] || 'Player unavailable. Refresh players or reload its source tab.');
  }
  function update(row, player) {
    row.player = {...row.player,...player};
    const {media, popped, status:resultStatus} = row.player, el = row.el;
    const stale = resultStatus && resultStatus !== 'ok';
    el.classList.toggle('stale',!!stale);
    for (const control of el.querySelectorAll('button,input')) control.disabled = !!stale;
    // Returning a tab remains possible after the video or document changes.
    el.querySelector('[data-action="restore"]').disabled = !popped;
    el.querySelector('[data-action="focus"]').disabled = false;
    if (stale) { el.querySelector('.row-status').textContent = message(row.player); return; }
    el.querySelector('.play-state').textContent = media.holding ? `Holding · ${Math.ceil(media.holdRemaining)} s` : media.paused ? 'Paused' : 'Playing';
    el.querySelector('[data-action="playback"]').textContent = media.paused ? 'Play' : 'Pause';
    el.querySelector('[data-action="muting"]').textContent = media.muted ? 'Unmute' : 'Mute';
    el.querySelector('[data-action="muting"]').setAttribute('aria-pressed',String(media.muted));
    const slider = el.querySelector('.volume');
    if (document.activeElement !== slider) slider.value = Math.round(media.volume*100);
    el.querySelector('.volume-value').textContent = `${slider.value}%`;
    el.querySelector('[data-action="popout"]').textContent = popped ? 'Show pop-out' : 'Pop out';
    el.querySelector('[data-action="cancel-hold"]').disabled = !media.holding;
    el.querySelector('[data-action="hold"]').disabled = media.holding || media.paused;
    el.querySelector('.buffer').textContent = `Available seek: ${Math.floor(media.back)} s back / ${Math.floor(media.forward)} s forward.`;
    el.querySelector('.sync-state').textContent = media.holding ? `Holding for ${Math.ceil(media.holdRemaining)} more seconds. Play resumes now; Cancel leaves it paused.` : media.notice;
  }
  function add(player) {
    const el = document.querySelector('#player-template').content.firstElementChild.cloneNode(true);
    const row = {el,player};
    el.querySelector('h2').textContent = player.title;
    el.querySelector('.host').textContent = player.host;
    el.querySelector('.volume').setAttribute('aria-label',`Volume for ${player.title}`);
    el.addEventListener('click',async event => {
      const button = event.target.closest('button[data-action]');
      if (!button || row.pending) return;
      const p = row.player, target = targetOf(p);
      let action = button.dataset.action, value;
      if (action === 'playback') action = p.media.paused ? 'play' : 'pause';
      if (action === 'muting') action = p.media.muted ? 'unmute' : 'mute';
      if (['rewind','hold'].includes(action)) {
        const input = el.querySelector('.seconds');
        if (!input.reportValidity() || !input.value) return;
        value = Number(input.value);
        if (action === 'rewind') { action='seek'; value=-value; }
      }
      if (action === 'back-one' || action === 'forward-one') { value=action === 'back-one' ? -1 : 1; action='seek'; }
      row.pending = true; button.disabled = true;
      const result = await request(action,target,value);
      el.querySelector('.row-status').textContent = message(result);
      row.pending = false; button.disabled = false;
      await poll();
    });
    const volume = el.querySelector('.volume');
    volume.addEventListener('input',() => { el.querySelector('.volume-value').textContent = `${volume.value}%`; });
    // Change commits on release/keyboard input; do not flood the service worker during a drag.
    volume.addEventListener('change',async () => {
      const result = await request('volume',targetOf(row.player),Number(volume.value)/100);
      if (result.status !== 'ok') el.querySelector('.row-status').textContent = message(result);
      await poll();
    });
    list.append(el); rows.set(key(player),row); update(row,player);
  }
  async function refresh() {
    if (busy) return;
    busy = true;
    const button = document.querySelector('#refresh'); button.disabled=true;
    try {
      const result = await request('scan');
      if (result.status !== 'ok') { status.textContent=message(result); return; }
      const players = result.players.slice(0,100), found = new Set(players.map(key));
      for (const [id,row] of rows) if (!found.has(id)) { row.el.remove(); rows.delete(id); }
      for (const player of players) {
        const row=rows.get(key(player));
        if (row) update(row,{status:'ok',...player}); else add(player);
      }
      status.textContent = players.length ? `${players.length} player${players.length === 1 ? '' : 's'} ready. One selected video per tab. Refresh after changing channels.` : 'Start videos in your service tabs, then refresh. Reload tabs after installing; excluded sites are hidden.';
    } finally { busy=false; button.disabled=false; }
  }
  async function poll() {
    if (busy || !rows.size) return;
    busy=true;
    try {
      const result=await request('poll',undefined,undefined,Array.from(rows.values(),row=>targetOf(row.player)));
      if (result.status !== 'ok') { status.textContent=message(result); return; }
      for (const player of result.players) { const row=rows.get(key(player)); if (row && !row.pending) update(row,player); }
    } finally { busy=false; }
  }
  document.querySelector('#refresh').addEventListener('click',refresh);
  document.querySelector('#mute-all').addEventListener('click',async () => {
    const results=await Promise.all(Array.from(rows.values(),row=>request('mute',targetOf(row.player))));
    status.textContent=results.some(r=>r.status !== 'ok') ? 'Some players could not be muted. Refresh players.' : 'Listed players muted. Unmute the commentary you want.';
    await poll();
  });
  refresh();
  setInterval(poll,1500);
})();
