// Status & control page. Reads learned data from storage and offers resets.
// All writes go back to storage; the content scripts live-apply via onChanged.

const ADJ_DEFAULTS = {
  brightness: 1,
  contrast: 1,
  saturation: 1,
  sharpen: 0,
  zoom: 1,
};
const SYNC_DEFAULTS = {
  disabledHosts: [],
  adComfort: true,
  adSpeed: "auto",
  autoPip: true,
  showButton: false,
  videoAdjust: ADJ_DEFAULTS,
  smartSpeed: false,
  smartSpeedRates: { talk: 1.25, quiet: 1.5 },
  ccPip: true,
  hidePaidOverlay: true,
};
const ADJ_KEYS = ["brightness", "contrast", "saturation", "sharpen", "zoom"];
const LOCAL_DEFAULTS = {
  adRateByHost: {},
  ytSkipLearned: [],
  ytSkipLearnedAt: 0,
  adStatsByHost: {},
};

const $ = (id) => document.getElementById(id);

function getAll() {
  return Promise.all([
    chrome.storage.sync.get(SYNC_DEFAULTS),
    chrome.storage.local.get(LOCAL_DEFAULTS),
  ]).then(([sync, local]) => ({ ...sync, ...local }));
}

function render(d) {
  // ---- global ----
  $("autoPip").checked = d.autoPip !== false;
  $("showButton").checked = d.showButton === true;
  $("ccPip").checked = d.ccPip !== false;
  $("hidePaidOverlay").checked = d.hidePaidOverlay !== false;
  $("adComfort").checked = d.adComfort !== false;
  $("adSpeed").value = String(d.adSpeed ?? "auto");
  $("speedNote").textContent =
    String(d.adSpeed) === "auto"
      ? "Tunes per site automatically."
      : "Fixed — overrides Auto everywhere.";

  // ---- smart speed ----
  $("smartSpeed").checked = d.smartSpeed === true;
  const rates = { talk: 1.25, quiet: 1.5, ...(d.smartSpeedRates || {}) };
  $("ssTalk").value = String(rates.talk);
  $("ssQuiet").value = String(rates.quiet);

  // ---- display adjustments ----
  const adj = { ...ADJ_DEFAULTS, ...(d.videoAdjust || {}) };
  for (const k of ADJ_KEYS) {
    $("adj-" + k).value = adj[k];
    $("val-" + k).textContent =
      k === "zoom" ? Math.round(adj[k] * 100) + "%" : adj[k];
  }

  // ---- per-site ----
  const hosts = new Set([
    ...Object.keys(d.adRateByHost || {}),
    ...Object.keys(d.adStatsByHost || {}),
    ...(d.disabledHosts || []),
  ]);
  const body = $("sitesBody");
  body.textContent = "";
  const sorted = [...hosts].sort(
    (a, b) => (d.adStatsByHost[b] || 0) - (d.adStatsByHost[a] || 0)
  );
  $("sitesEmpty").hidden = sorted.length > 0;
  $("sitesTable").hidden = sorted.length === 0;

  for (const host of sorted) {
    const tr = document.createElement("tr");

    const tdHost = document.createElement("td");
    tdHost.textContent = host;
    tr.appendChild(tdHost);

    const tdRate = document.createElement("td");
    const rec = d.adRateByHost[host];
    if (rec && typeof rec.rate === "number") {
      const pill = document.createElement("span");
      pill.className = "pill";
      pill.textContent = rec.rate + "×";
      tdRate.appendChild(pill);
    } else {
      tdRate.innerHTML = '<span class="muted">—</span>';
    }
    tr.appendChild(tdRate);

    const tdCount = document.createElement("td");
    tdCount.className = "num";
    tdCount.textContent = String(d.adStatsByHost[host] || 0);
    tr.appendChild(tdCount);

    const tdFloat = document.createElement("td");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !(d.disabledHosts || []).includes(host);
    cb.title = "Floating enabled on this site";
    cb.addEventListener("change", () => toggleSite(host, cb.checked));
    tdFloat.appendChild(cb);
    tr.appendChild(tdFloat);

    const tdAct = document.createElement("td");
    const acts = document.createElement("div");
    acts.className = "actions";
    const reprobe = document.createElement("button");
    reprobe.textContent = "Re-probe speed";
    reprobe.addEventListener("click", () => reprobeSite(host));
    const forget = document.createElement("button");
    forget.textContent = "Forget";
    forget.addEventListener("click", () => forgetSite(host));
    acts.append(reprobe, forget);
    tdAct.appendChild(acts);
    tr.appendChild(tdAct);

    body.appendChild(tr);
  }

  // ---- learned skip selectors ----
  const list = $("skipList");
  list.textContent = "";
  const skips = d.ytSkipLearned || [];
  if (!skips.length) {
    const p = document.createElement("div");
    p.className = "empty";
    p.textContent = "None learned yet.";
    list.appendChild(p);
  } else {
    for (const sel of skips) {
      const row = document.createElement("div");
      row.className = "row";
      const code = document.createElement("code");
      code.textContent = sel;
      row.appendChild(code);
      list.appendChild(row);
    }
    const btn = document.createElement("button");
    btn.className = "danger";
    btn.textContent = "Forget skip selectors";
    btn.style.marginTop = "10px";
    btn.addEventListener("click", () =>
      chrome.storage.local.set({ ytSkipLearned: [], ytSkipLearnedAt: 0 })
    );
    list.appendChild(btn);
  }
}

// ---- mutations ----
async function toggleSite(host, enabled) {
  const { disabledHosts = [] } = await chrome.storage.sync.get({
    disabledHosts: [],
  });
  const set = new Set(disabledHosts);
  if (enabled) set.delete(host);
  else set.add(host);
  await chrome.storage.sync.set({ disabledHosts: [...set] });
}
async function reprobeSite(host) {
  const { adRateByHost = {} } = await chrome.storage.local.get({
    adRateByHost: {},
  });
  delete adRateByHost[host];
  await chrome.storage.local.set({ adRateByHost });
}
async function forgetSite(host) {
  const { adRateByHost = {}, adStatsByHost = {} } =
    await chrome.storage.local.get({ adRateByHost: {}, adStatsByHost: {} });
  delete adRateByHost[host];
  delete adStatsByHost[host];
  await chrome.storage.local.set({ adRateByHost, adStatsByHost });
}

// ---- global controls ----
$("adComfort").addEventListener("change", (e) =>
  chrome.storage.sync.set({ adComfort: e.target.checked })
);
$("adSpeed").addEventListener("change", (e) => {
  const v = e.target.value;
  chrome.storage.sync.set({ adSpeed: v === "auto" ? "auto" : Number(v) });
});
$("autoPip").addEventListener("change", (e) =>
  chrome.storage.sync.set({ autoPip: e.target.checked })
);
$("showButton").addEventListener("change", (e) =>
  chrome.storage.sync.set({ showButton: e.target.checked })
);
$("smartSpeed").addEventListener("change", (e) =>
  chrome.storage.sync.set({ smartSpeed: e.target.checked })
);
$("ccPip").addEventListener("change", (e) =>
  chrome.storage.sync.set({ ccPip: e.target.checked })
);
$("hidePaidOverlay").addEventListener("change", (e) =>
  chrome.storage.sync.set({ hidePaidOverlay: e.target.checked })
);
async function saveSsRates() {
  await chrome.storage.sync.set({
    smartSpeedRates: {
      talk: Number($("ssTalk").value) || 1.25,
      quiet: Number($("ssQuiet").value) || 1.5,
    },
  });
}
$("ssTalk").addEventListener("change", saveSsRates);
$("ssQuiet").addEventListener("change", saveSsRates);

async function saveAdj(key, value) {
  const { videoAdjust = {} } = await chrome.storage.sync.get({
    videoAdjust: ADJ_DEFAULTS,
  });
  await chrome.storage.sync.set({
    videoAdjust: { ...ADJ_DEFAULTS, ...videoAdjust, [key]: value },
  });
}
for (const k of ADJ_KEYS) {
  const el = $("adj-" + k);
  el.addEventListener("input", () => {
    $("val-" + k).textContent =
      k === "zoom" ? Math.round(el.value * 100) + "%" : el.value;
  });
  el.addEventListener("change", () => saveAdj(k, Number(el.value)));
}
$("adjReset").addEventListener("click", () =>
  chrome.storage.sync.set({ videoAdjust: ADJ_DEFAULTS })
);
$("resetAll").addEventListener("click", async () => {
  if (!confirm("Forget all learned speeds, skip selectors, and skip counts?"))
    return;
  await chrome.storage.local.set({
    adRateByHost: {},
    ytSkipLearned: [],
    ytSkipLearnedAt: 0,
    adStatsByHost: {},
  });
});

// ---- live refresh ----
chrome.storage.onChanged.addListener(() => getAll().then(render));
getAll().then(render);
