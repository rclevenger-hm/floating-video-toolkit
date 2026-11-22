/* Controllable always-on-top player for social feeds (Document PiP). */
(function(root) {
  'use strict';
  function create({sourceWindow = window, getVideo, navigation, onState = () => {}, onVideo = () => {}}) {
    const doc = sourceWindow.document;
    let pip = null, video = null, marker = null, originalStyle = null, controls = null;
    let sourceRect = null;
    let generation = 0, pending = false, switching = false, timer = null, poll = null;
    let lastInput = -Infinity, wheel = 0, wheelAt = 0;
    function restore() {
      if (!video) return;
      onVideo(null);
      const old = video, playing = !video.paused, canReturn = marker?.isConnected;
      if (canReturn) marker.parentNode.insertBefore(old, marker);
      else { try { old.pause(); } catch (_) {} old.remove(); }
      if (originalStyle === null) old.removeAttribute('style'); else old.setAttribute('style', originalStyle);
      sourceRect = null;
      marker?.remove(); marker = null; video = null; originalStyle = null;
      if (canReturn && playing && old.paused) old.play().catch(() => {});
    }
    function stopTimers() {
      sourceWindow.clearTimeout(timer); sourceWindow.clearInterval(poll);
      timer = poll = null;
    }
    function close() {
      generation++; pending = false; switching = false; stopTimers();
      const old = pip; pip = null;
      restore(); controls = null; wheel = 0;
      if (old && !old.closed) old.close();
      onState(false);
    }
    function mount(next) {
      if (!pip || pip.closed || !next?.isConnected || next.ownerDocument !== doc) return false;
      restore();
      marker = doc.createComment('floating-feed-return'); next.before(marker);
      sourceRect = next.getBoundingClientRect();
      video = next; originalStyle = next.getAttribute('style');
      const playing = !next.paused;
      pip.document.querySelector('.stage').append(next);
      next.style.cssText = 'display:block!important;position:static!important;width:100%!important;height:100%!important;max-width:none!important;max-height:none!important;object-fit:contain!important;margin:0!important;transform:none!important;';
      if (playing && next.paused) next.play().catch(() => {});
      onVideo(next);
      return true;
    }
    function navigate(direction) {
      if (!pip || pending || switching || !video || !navigation.isSupported()) return false;
      const now = Date.now();
      if (now - lastInput < 650) return true;
      const previous = video, container = marker?.parentElement;
      const source = previous.currentSrc || previous.getAttribute('src');
      const scope = container?.closest('ytd-shorts, #movie_player, [role=dialog], main, [role=main]') || container;
      // The site's controller must see its real video while advancing the feed.
      restore();
      let moved = false;
      try { moved = navigation.navigate(direction > 0 ? 'next' : 'previous', previous, container); } catch (_) {}
      if (!moved) {
        mount(previous);
        controls.textContent = 'No previous/next video control is available on this page.';
        return false;
      }
      lastInput = now; switching = true; controls.textContent = 'Changing video…';
      const id = generation;
      let attempts = 0;
      function settle() {
        if (id !== generation || !pip) return;
        const next = getVideo(scope?.isConnected ? scope : doc);
        const changed = next && (next !== previous || (next.currentSrc || next.getAttribute('src')) !== source);
        if (changed && mount(next)) {
          switching = false; controls.textContent = '↑ Previous · ↓ Next · Scroll to browse';
        } else if (++attempts < 16) timer = sourceWindow.setTimeout(settle, 500);
        else {
          switching = false;
          if (next) mount(next);
          controls.textContent = 'Video change could not be confirmed. Try again or use the page controls.';
        }
      }
      timer = sourceWindow.setTimeout(settle, 500);
      return true;
    }
    function editable(event) {
      const target = event.composedPath?.()[0] || event.target;
      return target?.isContentEditable || target?.closest?.('input,textarea,select,[role=textbox],[role=slider],[contenteditable=true]');
    }
    async function open(chosen = getVideo()) {
      if (pip) return true;
      const api = sourceWindow.documentPictureInPicture;
      if (pending || !chosen || !api?.requestWindow || sourceWindow.top !== sourceWindow || !navigation.isSupported()) return false;
      const id = ++generation; pending = true;
      let opened;
      try {
        opened = await api.requestWindow({width:420,height:640});
        if (id !== generation) { opened.close(); return false; }
        pip = opened;
        const d = pip.document;
        d.title = 'Floating video';
        const style = d.createElement('style');
        style.textContent = 'html,body{margin:0;height:100%;background:#080b10;color:#fff;font:13px system-ui}body{display:flex;flex-direction:column}.stage{flex:1;min-height:0;overflow:hidden;display:flex;align-items:center;justify-content:center}.buttons{display:flex;gap:6px;padding:8px}button{color:white;background:#25344b;border:1px solid #75849a;border-radius:5px;padding:8px;cursor:pointer}button:focus-visible{outline:2px solid #90dcff}.status{padding:0 8px 8px;font-size:12px}';
        d.head.append(style);
        d.body.innerHTML = '<div class="stage"></div><div class="buttons"><button data-action="previous" aria-label="Previous video">↑ Previous</button><button data-action="play">Play / pause</button><button data-action="next" aria-label="Next video">↓ Next</button><button data-action="close">Close</button></div><div class="status" role="status" aria-live="polite">↑ Previous · ↓ Next · Scroll to browse</div>';
        controls = d.querySelector('.status');
        d.addEventListener('click', event => {
          const action = event.target.closest('button')?.dataset.action;
          if (action === 'next' || action === 'previous') navigate(action === 'next' ? 1 : -1);
          else if (action === 'close') close();
          else if (action === 'play' && video) { if (video.paused) video.play().catch(() => {}); else video.pause(); }
        });
        d.addEventListener('keydown', event => {
          if (event.defaultPrevented || event.repeat || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || editable(event)) return;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            if (navigate(event.key === 'ArrowDown' ? 1 : -1)) { event.preventDefault(); event.stopPropagation(); }
          }
        }, true);
        d.addEventListener('wheel', event => {
          if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || editable(event) || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
          const now = Date.now(), amount = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 300 : 1);
          if (!Number.isFinite(amount) || !amount) return;
          if (now - wheelAt > 250 || Math.sign(wheel) !== Math.sign(amount)) wheel = 0;
          wheelAt = now; wheel += amount;
          if (Math.abs(wheel) >= 60) {
            const direction = Math.sign(wheel); wheel = 0;
            if (navigate(direction)) { event.preventDefault(); event.stopPropagation(); }
          }
        }, {capture:true,passive:false});
        pip.addEventListener('pagehide', () => { if (id === generation) close(); }, {once:true});
        if (!mount(chosen)) { close(); return false; }
        lastInput = -Infinity;
        poll = sourceWindow.setInterval(() => {
          if (id !== generation || !pip || switching) return;
          if (video && marker?.isConnected) return;
          const next = getVideo();
          if (next && mount(next)) controls.textContent = '↑ Previous · ↓ Next · Scroll to browse';
        }, 500);
        onState(true); return true;
      } catch (_) {
        if (id === generation) close(); else opened?.close();
        return false;
      } finally { if (id === generation) pending = false; }
    }
    sourceWindow.addEventListener('pagehide', close);
    return {open,close,navigate,get supported(){return !!sourceWindow.documentPictureInPicture?.requestWindow && sourceWindow.top === sourceWindow && navigation.isSupported();},get active(){return !!pip && !pip.closed;},get video(){return video;},get sourceRect(){return sourceRect;}};
  }
  root.FloatingVideoFeedWindow = {create};
})(globalThis);
