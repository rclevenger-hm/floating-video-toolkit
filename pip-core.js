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
    return eligible.find(item => item.result.inPip) || eligible.filter(item => item.result.candidate)
      .sort((a,b) => compareCandidates({...a.result.candidate, frameId:a.frameId}, {...b.result.candidate, frameId:b.frameId}))[0] || null;
  }
  const api = {hostOf, normalizeHost, isDisabled, compareCandidates, describeVideo, pickVideo, chooseFrame};
  root.FloatingVideoCore = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
