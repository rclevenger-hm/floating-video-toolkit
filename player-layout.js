/* An in-page player. Native PiP placement remains controlled by the browser. */
(function (root) {
  "use strict";
  function create({getVideo, getSettings, onAction}) {
    let video = null, placeholder = null, panel = null, mode = null, corner = 4;
    let returnFocus = null;
    const styles = FloatingVideoState.createStyleLedger();
    function move(node, parent, before = null) {
      const playing = !node.paused;
      if (parent.moveBefore && node.isConnected && parent.isConnected) parent.moveBefore(node, before);
      else parent.insertBefore(node, before);
      if (playing && node.paused) node.play().catch(() => {});
    }
    function close() {
      const oldPanel = panel;
      if (video && placeholder?.parentNode) move(video, placeholder.parentNode, placeholder);
      placeholder?.remove();
      styles.restoreAll();
      oldPanel?.remove();
      video = placeholder = panel = mode = null;
      if (returnFocus?.isConnected) returnFocus.focus({preventScroll:true});
      returnFocus = null;
    }
    function render() {
      if (!panel || !video) return;
      if (!placeholder?.isConnected) { close(); return; }
      const settings = getSettings();
      const ratio = FloatingVideoCore.aspectRatio(settings.ratio,
        mode === 'cinema' ? innerWidth / innerHeight : video.videoWidth / video.videoHeight);
      const width = mode === 'mini' ? Math.min(settings.miniWidth, innerWidth - 32, (innerHeight - 88) * ratio)
        : Math.min(innerWidth - 24, (innerHeight - 64) * ratio);
      panel.style.width = Math.max(80,width) + 'px';
      panel.shadowRoot.querySelector('.stage').style.aspectRatio = String(ratio);
      const top = corner === 1 || corner === 2, left = corner === 1 || corner === 3;
      panel.style.top = mode === 'cinema' ? '50%' : top ? '16px' : 'auto';
      panel.style.bottom = mode === 'cinema' || top ? 'auto' : '16px';
      panel.style.left = mode === 'cinema' ? '50%' : left ? '16px' : 'auto';
      panel.style.right = mode === 'cinema' || left ? 'auto' : '16px';
      panel.style.transform = mode === 'cinema' ? 'translate(-50%, -50%)' : 'none';
      panel.setAttribute('aria-label',mode === 'mini' ? 'Mini-player' : 'Cinema player');
      const controls = panel.shadowRoot;
      controls.querySelector('[data-action="play-pause"]').textContent = video.paused ? 'Play' : 'Pause';
      controls.querySelector('[data-action="toggle-mute"]').textContent = video.muted ? 'Unmute' : 'Mute';
      for (const button of controls.querySelectorAll('[data-corner]'))
        button.setAttribute('aria-pressed',String(mode === 'mini' && Number(button.dataset.corner) === corner));
    }
    function open(nextMode, nextCorner = getSettings().corner) {
      const chosen = video || getVideo();
      if (!chosen) return false;
      if (chosen.ownerDocument.defaultView !== chosen.ownerDocument.defaultView.top) return false;
      if (panel) { mode = nextMode; corner = nextCorner; render(); return true; }
      video = chosen;
      mode = nextMode;
      corner = nextCorner;
      returnFocus = document.activeElement;
      placeholder = document.createComment('floating-video-return');
      video.before(placeholder);
      panel = document.createElement('div');
      panel.id = 'fpip-player';
      panel.setAttribute('popover','manual');
      panel.setAttribute('role','region');
      panel.style.cssText = 'position:fixed!important;inset:auto;margin:0;padding:0;border:1px solid #526276;border-radius:12px;overflow:hidden;background:#070b12;color:white;z-index:2147483646;box-shadow:0 12px 48px #0008;';
      const shadow = panel.attachShadow({mode:'open'});
      shadow.innerHTML = `<style>
        :host{color-scheme:dark}.stage{overflow:hidden;background:#000;width:100%}slot{display:contents}
        .controls{display:flex;gap:5px;align-items:center;flex-wrap:wrap;padding:8px;background:#142033;font:12px system-ui;color:#fff}
        button{font:inherit;color:inherit;background:#25344b;border:1px solid #526276;border-radius:5px;padding:5px 7px;cursor:pointer}
        button:hover,button[aria-pressed=true]{background:#345c86}button:focus-visible{outline:2px solid #90dcff;outline-offset:2px}
        .spacer{flex:1}::slotted(video){display:block!important}
      </style><div class="stage"><slot></slot></div><div class="controls">
        <button data-action="play-pause">Pause</button><button data-action="toggle-mute">Mute</button>
        <button data-action="cycle-fit" title="Cycle original, fit, fill, and stretch">Fit</button>
        <span class="spacer"></span>
        <button data-corner="1" title="Top left" aria-label="Top left">1</button>
        <button data-corner="2" title="Top right" aria-label="Top right">2</button>
        <button data-corner="3" title="Bottom left" aria-label="Bottom left">3</button>
        <button data-corner="4" title="Bottom right" aria-label="Bottom right">4</button>
        <button data-action="close-layout" aria-label="Return video to page">Close</button></div>`;
      shadow.addEventListener('click', event => {
        const button = event.target.closest('button');
        if (!button) return;
        onAction(button.dataset.corner ? 'snap-' + button.dataset.corner : button.dataset.action);
      });
      document.documentElement.append(panel);
      try { panel.showPopover(); } catch (_) {} // Older Chromium: fixed overlay fallback.
      move(video,panel);
      for (const [property,value] of Object.entries({position:'relative',inset:'auto',width:'100%',height:'100%',
        'max-width':'none','max-height':'none',margin:'0',display:'block'})) styles.set(video,property,value,'important');
      render();
      shadow.querySelector('button').focus({preventScroll:true});
      return true;
    }
    function toggle(nextMode) {
      if (mode === nextMode) { close(); return true; }
      return open(nextMode);
    }
    window.addEventListener('resize',render);
    document.addEventListener('play',render,true);
    document.addEventListener('pause',render,true);
    document.addEventListener('volumechange',render,true);
    return {get video(){return video;},get mode(){return mode;},open,toggle,close,render};
  }
  root.FloatingVideoLayout = {create};
})(globalThis);
