/* Shared, dependency-free policy for the worker, content scripts, and tests. */
(function (root) {
  "use strict";
  function hostOf(value) {
    try { return new URL(value).hostname.toLowerCase().replace(/\.$/, ""); }
    catch { return ""; }
  }
  function normalizeHost(value) {
    const text = String(value || "").trim();
    if (!text || /[\s*]/.test(text)) throw new Error("Enter a hostname or an http(s) URL.");
    const url = new URL(text.includes("://") ? text : "https://" + text);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || !url.hostname)
      throw new Error("Enter a hostname or an http(s) URL.");
    return hostOf(url.href);
  }
  function isDisabled(disabledHosts, hosts) {
    const blocked = new Set((Array.isArray(disabledHosts) ? disabledHosts : [])
      .filter(h => typeof h === "string").map(h => h.toLowerCase().replace(/\.$/, "")));
    return hosts.some(h => h && blocked.has(h.toLowerCase().replace(/\.$/, "")));
  }
  function compareCandidates(a, b) {
    // A user's explicit choice wins, then visible playing video and display area.
    return (b.selectedAt || 0) - (a.selectedAt || 0) ||
      Number(b.playing) - Number(a.playing) || b.area - a.area ||
      b.pixels - a.pixels || (a.frameId || 0) - (b.frameId || 0);
  }
  function describeVideo(video, selectedAt = 0) {
    if (!video.isConnected || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return null;
    const rect = video.getBoundingClientRect();
    const style = video.ownerDocument.defaultView.getComputedStyle(video);
    if (!rect.width || !rect.height || style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return null;
    return { selectedAt, playing: !video.paused && !video.ended,
      area: rect.width * rect.height, pixels: video.videoWidth * video.videoHeight };
  }
  function pickVideo(videos, selectedVideo, selectedAt = 0) {
    return Array.from(videos).map(video => ({video, info: describeVideo(video, video === selectedVideo ? selectedAt : 0)}))
      .filter(item => item.info).sort((a,b) => compareCandidates(a.info,b.info))[0]?.video || null;
  }
  function chooseFrame(results, disabledHosts, tabHost) {
    if (isDisabled(disabledHosts, [tabHost])) return null;
    const eligible = results.filter(item => item.result && !isDisabled(disabledHosts,
      [item.result.host, ...(item.result.ancestors || [])]));
    return eligible.find(item => item.result.inPip) || eligible.find(item => item.result.inLayout) || eligible.filter(item => item.result.candidate)
      .sort((a,b) => compareCandidates({...a.result.candidate, frameId:a.frameId}, {...b.result.candidate, frameId:b.frameId}))[0] || null;
  }
  const VIEW_DEFAULTS = {fit:"original",ratio:"auto",panX:50,panY:50,miniWidth:420,corner:4,miniKeys:true};
  function clamp(value, min, max, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(max,Math.max(min,n)) : fallback;
  }
  function normalizeView(value = {}) {
    value = value && typeof value === "object" ? value : {};
    return {fit:["original","fit","fill","stretch"].includes(value.fit) ? value.fit : "original",
      ratio:["auto","16:9","21:9","32:9","4:3"].includes(value.ratio) ? value.ratio : "auto",
      panX:clamp(value.panX,0,100,50),panY:clamp(value.panY,0,100,50),
      miniWidth:clamp(value.miniWidth,240,960,420),corner:Math.round(clamp(value.corner,1,4,4)),miniKeys:value.miniKeys !== false};
  }
  function normalizeAdjust(value = {}) {
    value = value && typeof value === "object" ? value : {};
    return {brightness:clamp(value.brightness,0.5,1.5,1),contrast:clamp(value.contrast,0.5,1.5,1),
      saturation:clamp(value.saturation,0,2,1),sharpen:clamp(value.sharpen,0,1,0),zoom:clamp(value.zoom,1,3,1)};
  }
  function aspectRatio(value, fallback = 16/9) {
    const pair = String(value).split(":").map(Number);
    return pair.length === 2 && pair[0] > 0 && pair[1] > 0 ? pair[0]/pair[1] : fallback || 16/9;
  }
  const api = {VIEW_DEFAULTS, normalizeAdjust, normalizeView, aspectRatio, clamp, hostOf, normalizeHost, isDisabled, compareCandidates, describeVideo, pickVideo, chooseFrame};
  root.FloatingVideoCore = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
