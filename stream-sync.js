/* Source-player controls: no capture, recording, media extraction, or Web Audio. */
(function (root) {
  'use strict';
  function seekWindow(video) {
    const time = video.currentTime;
    const ranges = video.seekable;
    for (let i = 0; i < ranges.length; i++) {
      const start = ranges.start(i), end = ranges.end(i);
      if (Number.isFinite(time) && Number.isFinite(start) && Number.isFinite(end) && time >= start && time <= end)
        return {back: Math.max(0, time - start), forward: Math.max(0, end - time), start, end};
    }
    return {back: 0, forward: 0};
  }
  function create({getVideo, now = Date.now, schedule = setTimeout, unschedule = clearTimeout}) {
    const ids = new WeakMap();
    let sequence = 0, hold = null, notice = '';
    function id(video) {
      if (!ids.has(video)) {
        ids.set(video, {value:String(++sequence), source:video.currentSrc});
        video.addEventListener('emptied', () => ids.set(video, {value:String(++sequence), source:video.currentSrc}));
      }
      const record = ids.get(video);
      if (record.source !== video.currentSrc) { record.value=String(++sequence); record.source=video.currentSrc; }
      return record.value;
    }
    function cancel(message = '') {
      if (hold) {
        unschedule(hold.timer);
        hold.video.removeEventListener('play', hold.onPlay);
        hold.video.removeEventListener('emptied', hold.onEmpty);
      }
      hold = null;
      notice = message;
    }
    function snapshot(video = getVideo()) {
      if (hold && (hold.video !== video || !hold.video.isConnected)) cancel('Player changed; timed hold canceled.');
      if (!video) return null;
      return {id:id(video), paused:video.paused, muted:video.muted, volume:video.volume,
        ...seekWindow(video), holding:!!hold, holdRemaining:hold ? Math.max(0, (hold.until-now())/1000) : 0,
        notice};
    }
    function resolve(token) {
      const video = getVideo();
      return video && video.isConnected && id(video) === token ? video : null;
    }
    async function run(video, action, value) {
      if (action === 'cancel-hold') { cancel('Hold canceled; player remains paused.'); return {status:'ok'}; }
      if (action === 'seek') {
        if (!Number.isFinite(value) || value === 0 || Math.abs(value) > 600) return {status:'invalid'};
        const range = seekWindow(video);
        if (range.start === undefined || (value < 0 ? -value > range.back : value > range.forward))
          return {status:'no-buffer', message:'That position is outside this player’s available seek range. Try a shorter rewind or a timed hold.'};
        cancel();
        try { video.currentTime += value; }
        catch (_) { return {status:'unavailable',message:'The service rejected seeking.'}; }
        return {status:'ok',message:'Seek requested. Check the picture; services can override the position.'};
      }
      if (action !== 'hold') return {status:'unsupported'};
      if (!Number.isFinite(value) || value < 1 || value > 600) return {status:'invalid'};
      if (hold) return {status:'busy',message:'Cancel the current hold before starting another.'};
      if (video.paused || video.ended) return {status:'paused',message:'Start playback before adding a timed hold.'};
      video.pause();
      const entry = {video, until:now()+value*1000, source:video.currentSrc};
      entry.onPlay = () => cancel('Playback resumed before the hold ended; check sync.');
      entry.onEmpty = () => cancel('Source changed; timed hold canceled.');
      hold = entry;
      notice = '';
      video.addEventListener('play', entry.onPlay);
      video.addEventListener('emptied', entry.onEmpty);
      entry.timer = schedule(async () => {
        if (hold !== entry) return;
        const valid = video.isConnected && getVideo() === video && video.currentSrc === entry.source && video.paused;
        cancel(valid ? 'Hold finished. Check sync; some services return to live.' : 'Player changed; timed hold canceled.');
        if (valid) {
          try { await video.play(); }
          catch (_) { notice = 'Automatic resume was blocked. Press Play in the source player.'; }
        }
      }, value*1000);
      return {status:'ok',message:'Timed hold started. The source decides whether delayed playback is retained.'};
    }
    return {snapshot, resolve, run, cancel};
  }
  root.FloatingVideoSync = {seekWindow, create};
  if (typeof module !== 'undefined') module.exports = root.FloatingVideoSync;
})(globalThis);
