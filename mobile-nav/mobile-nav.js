"use strict";

const TREEHERDER = "https://treeherder.mozilla.org";
const TASKCLUSTER = "https://firefox-ci-tc.services.mozilla.com/api/queue/v1";
const REPO = "try";
const FRAMEWORK = 15;
const SIGNATURE_INTERVAL = 120 * 24 * 60 * 60;

const TESTS = {
  "urlbar-nav": {
    label: "URL bar navigation",
    suite: "newssite-urlbar-nav",
    metric: "urlbar_nav",
    blurb: "ubne-newssite.sh — typed URL in a running browser, to the urlbar_nav_end frame.",
  },
  "hot-applink": {
    label: "Hot applink",
    suite: "newssite-hot-applink",
    metric: "hot_applink",
    blurb: "hvne-newssite.sh — VIEW intent at a running browser, to the hot_view_nav_end frame.",
  },
};

const APPS = [
  { id: "fenix", label: "Fenix", color: "--fenix", cls: "fenix" },
  { id: "chrome-m", label: "Chrome", color: "--chrome", cls: "chrome" },
];

// Perfherder has no cheap way to enumerate platforms, so probe a known short list;
// only those that come back with signatures are offered.
const CANDIDATE_PLATFORMS = [
  { id: "android-hw-a55-14-0-aarch64-shippable", label: "Samsung A55 (Android 14)" },
  { id: "android-hw-p6-13-0-aarch64-shippable", label: "Pixel 6 (Android 13)" },
];

const state = {
  test: "urlbar-nav",
  platform: null,
  selectedRevisions: new Set(),
  signatures: [],
  runs: [],
  pushes: new Map(),
  platforms: [],
};

const $ = (id) => document.getElementById(id);

/* ---------------------------------------------------------------- fetching */

const jsonCache = new Map();

async function getJSON(url) {
  if (!jsonCache.has(url)) {
    const pending = fetch(url).then((res) => {
      if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText}`);
      }
      return res.json();
    });
    // Do not cache a failure: a transient error would poison every later read.
    pending.catch(() => jsonCache.delete(url));
    jsonCache.set(url, pending);
  }
  return jsonCache.get(url);
}

/** Resolve promises a few at a time so we do not open 40 sockets at once. */
async function pooled(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/* ------------------------------------------------------------------- stats */

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

function describe(values) {
  if (!values.length) {
    return null;
  }
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = n > 1 ? values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0;
  const stddev = Math.sqrt(variance);
  return {
    n,
    mean,
    median: median(values),
    stddev,
    cv: mean ? (stddev / mean) * 100 : 0,
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

const fmtMs = (v) => `${v.toFixed(1)} ms`;
const fmtPct = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`;
const shortRev = (rev) => rev.slice(0, 7);

function fmtDate(seconds) {
  return new Date(seconds * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* -------------------------------------------------------------- data load */

async function loadSignatures() {
  const wanted = new Set(Object.values(TESTS).map((t) => t.suite));
  const found = [];

  await pooled(CANDIDATE_PLATFORMS, 2, async (platform) => {
    const url =
      `${TREEHERDER}/api/project/${REPO}/performance/signatures/` +
      `?framework=${FRAMEWORK}&platform=${platform.id}&interval=${SIGNATURE_INTERVAL}`;
    let byId;
    try {
      byId = await getJSON(url);
    } catch (e) {
      console.warn("signature fetch failed", platform.id, e);
      return;
    }
    for (const sig of Object.values(byId)) {
      const isProfiling = (sig.extra_options || []).some(
        (o) => o === "gecko-profile" || o === "simpleperf"
      );
      if (wanted.has(sig.suite) && !isProfiling && APPS.some((a) => a.id === sig.application)) {
        found.push({ ...sig, platform: platform.id });
      }
    }
  });

  state.signatures = found;
  state.platforms = CANDIDATE_PLATFORMS.filter((p) => found.some((s) => s.platform === p.id));
}

async function loadRuns() {
  const perSignature = await pooled(state.signatures, 6, async (sig) => {
    const url =
      `${TREEHERDER}/api/performance/summary/` +
      `?repository=${REPO}&signature=${sig.id}&framework=${FRAMEWORK}` +
      `&interval=${SIGNATURE_INTERVAL}&all_data=true`;
    let series;
    try {
      series = await getJSON(url);
    } catch (e) {
      console.warn("summary fetch failed", sig.id, e);
      return [];
    }
    const points = (series[0] && series[0].data) || [];
    const testId = Object.keys(TESTS).find((k) => TESTS[k].suite === sig.suite);
    return points.map((p) => ({
      test: testId,
      app: sig.application,
      platform: sig.platform,
      revision: p.revision,
      jobId: p.job_id,
      value: p.value,
      pushTimestamp: Math.floor(new Date(p.push_timestamp + "Z").getTime() / 1000),
      machine: p.machine_name,
    }));
  });

  state.runs = perSignature.flat();
}

/** Commit messages are cosmetic, so fetch them in the background and re-render. */
async function loadPushMetadata(revisions) {
  await pooled(revisions, 4, async (rev) => {
    try {
      const data = await getJSON(
        `${TREEHERDER}/api/project/${REPO}/push/?revision=${rev}`
      );
      const push = data.results && data.results[0];
      if (push) {
        state.pushes.set(rev, {
          author: push.author,
          comment: (push.revisions[0]?.comments || "").split("\n")[0],
        });
      }
    } catch (e) {
      console.warn("push fetch failed", rev, e);
    }
  });
}

/* ---------------------------------------------------------------- slicing */

const testRuns = () => state.runs.filter((r) => r.test === state.test && r.platform === state.platform);

const selectedRuns = () => testRuns().filter((r) => state.selectedRevisions.has(r.revision));

/**
 * The run a browser's video panel defaults to: the one sitting at the median of
 * that browser's selected runs. With an even count there is no run exactly at the
 * median, so take the upper of the two middle runs — a real job we can play,
 * within a hair of the number in the headline.
 */
function medianRun(appId) {
  const runs = selectedRuns()
    .filter((r) => r.app === appId)
    .sort((a, b) => a.value - b.value);
  return runs.length ? runs[runs.length >> 1] : null;
}

/** Revisions available for the current test+platform, newest push first. */
function availableRevisions() {
  const byRev = new Map();
  for (const run of testRuns()) {
    if (!byRev.has(run.revision)) {
      byRev.set(run.revision, { revision: run.revision, pushTimestamp: run.pushTimestamp, count: 0 });
    }
    byRev.get(run.revision).count++;
  }
  return [...byRev.values()].sort((a, b) => b.pushTimestamp - a.pushTimestamp);
}

/** One lane per (app, revision) that has runs, apps in fixed order. */
function lanes() {
  const runs = selectedRuns();
  const out = [];
  for (const app of APPS) {
    const revs = availableRevisions().filter((r) => state.selectedRevisions.has(r.revision));
    for (const rev of revs) {
      const values = runs
        .filter((r) => r.app === app.id && r.revision === rev.revision)
        .sort((a, b) => a.value - b.value);
      if (values.length) {
        out.push({ app, revision: rev.revision, pushTimestamp: rev.pushTimestamp, runs: values });
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------- chart */

const SVG_NS = "http://www.w3.org/2000/svg";

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  return el;
}

/** Round tick step to 1/2/5 x a power of ten. */
function niceTicks(min, max, target = 5) {
  const span = Math.max(max - min, 1e-6);
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].find((m) => raw <= m * mag) * mag;
  const ticks = [];
  for (let t = Math.ceil(min / step) * step; t <= max + step / 1e6; t += step) {
    ticks.push(t);
  }
  return ticks;
}

/**
 * Beeswarm offsets: y carries no meaning, it only stops equal-ish values from
 * hiding behind each other. Values must arrive sorted ascending.
 */
function beeswarm(xs, spacing, maxRows) {
  const rowLastX = [];
  return xs.map((x) => {
    let row = rowLastX.findIndex((last) => x - last >= spacing);
    if (row === -1) {
      row = rowLastX.length < maxRows ? rowLastX.length : 0;
    }
    rowLastX[row] = x;
    // 0, +1, -1, +2, -2 ... so the swarm grows symmetrically about the lane centre.
    const step = Math.ceil(row / 2);
    return row % 2 ? step : -step;
  });
}

function renderStripPlot() {
  const wrap = $("strip-wrap");
  wrap.textContent = "";

  const laneList = lanes();
  if (!laneList.length) {
    const empty = document.createElement("p");
    empty.className = "card-sub";
    empty.textContent = "No runs selected.";
    wrap.append(empty);
    return;
  }

  const padLeft = 200;
  const padRight = 20;
  const padTop = 28;
  const padBottom = 40;
  const laneH = 46;
  const width = Math.max(wrap.clientWidth || 900, 520);
  const height = padTop + laneList.length * laneH + padBottom;
  const plotW = width - padLeft - padRight;

  const all = laneList.flatMap((l) => l.runs.map((r) => r.value));
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const pad = Math.max((hi - lo) * 0.08, 5);
  const d0 = Math.max(0, lo - pad);
  const d1 = hi + pad;
  const x = (v) => padLeft + ((v - d0) / (d1 - d0)) * plotW;

  const svg = svgEl("svg", {
    viewBox: `0 0 ${width} ${height}`,
    width,
    height,
    role: "img",
    "aria-label": `Every run of ${TESTS[state.test].label}, one dot per CI job`,
  });

  for (const tick of niceTicks(d0, d1)) {
    svg.append(
      svgEl("line", {
        x1: x(tick),
        x2: x(tick),
        y1: padTop,
        y2: height - padBottom,
        stroke: "var(--grid)",
        "stroke-width": 1,
      })
    );
    const label = svgEl("text", {
      x: x(tick),
      y: height - padBottom + 18,
      "text-anchor": "middle",
      class: "axis-label",
    });
    label.textContent = Math.round(tick).toLocaleString();
    svg.append(label);
  }

  svg.append(
    svgEl("line", {
      x1: padLeft,
      x2: width - padRight,
      y1: height - padBottom,
      y2: height - padBottom,
      stroke: "var(--axis)",
      "stroke-width": 1,
    })
  );

  const axisTitle = svgEl("text", {
    x: padLeft + plotW / 2,
    y: height - 6,
    "text-anchor": "middle",
    class: "axis-title",
  });
  axisTitle.textContent = "ms — lower is better";
  svg.append(axisTitle);

  // Chrome is the baseline, so mark its pooled median across every lane: anything
  // to the right of this rule is slower than Chrome.
  const chromeValues = selectedRuns()
    .filter((r) => r.app === "chrome-m")
    .map((r) => r.value);
  if (chromeValues.length) {
    const baseline = median(chromeValues);
    svg.append(
      svgEl("line", {
        x1: x(baseline),
        x2: x(baseline),
        y1: padTop - 6,
        y2: height - padBottom,
        stroke: "var(--chrome)",
        "stroke-width": 1,
        opacity: 0.55,
      })
    );
    const key = svgEl("line", {
      x1: x(baseline) + 6,
      x2: x(baseline) + 18,
      y1: padTop - 14,
      y2: padTop - 14,
      stroke: "var(--chrome)",
      "stroke-width": 2,
    });
    const caption = svgEl("text", { x: x(baseline) + 22, y: padTop - 10, class: "lane-meta" });
    caption.textContent = `Chrome median ${baseline.toFixed(0)} ms`;
    svg.append(key, caption);
  }

  laneList.forEach((lane, i) => {
    const top = padTop + i * laneH;
    const mid = top + laneH / 2;
    const color = `var(${lane.app.color})`;
    const values = lane.runs.map((r) => r.value);
    const med = median(values);

    const name = svgEl("text", { x: 0, y: mid - 3, class: "lane-name" });
    name.textContent = `${lane.app.label} · ${shortRev(lane.revision)}`;
    svg.append(name);

    const meta = svgEl("text", { x: 0, y: mid + 13, class: "lane-meta" });
    meta.textContent = `n=${values.length} · median ${med.toFixed(1)}`;
    svg.append(meta);

    svg.append(
      svgEl("line", {
        x1: x(med),
        x2: x(med),
        y1: top + 8,
        y2: top + laneH - 8,
        stroke: color,
        "stroke-width": 2,
        "stroke-linecap": "round",
      })
    );

    const offsets = beeswarm(values, 11, 3);
    lane.runs.forEach((run, j) => {
      const cx = x(run.value);
      const cy = mid + offsets[j] * 10;
      svg.append(svgEl("circle", { cx, cy, r: 4, fill: color, class: "dot" }));

      const hit = svgEl("circle", { cx, cy, r: 12, class: "hit", tabindex: "0", role: "button" });
      hit.setAttribute(
        "aria-label",
        `${lane.app.label} ${shortRev(run.revision)} ${run.value.toFixed(1)} milliseconds, open in video inspector`
      );
      const show = (ev) => showRunTooltip(ev, run, lane.app);
      hit.addEventListener("pointerenter", show);
      hit.addEventListener("pointermove", show);
      hit.addEventListener("focus", show);
      hit.addEventListener("pointerleave", hideTooltip);
      hit.addEventListener("blur", hideTooltip);
      hit.addEventListener("click", () => selectJobInPane(lane.app.id, run.jobId));
      hit.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          selectJobInPane(lane.app.id, run.jobId);
        }
      });
      svg.append(hit);
    });
  });

  wrap.append(svg);
}

/* ----------------------------------------------------------------- tooltip */

function showRunTooltip(event, run, app) {
  const tip = $("tooltip");
  tip.textContent = "";

  const value = document.createElement("div");
  const key = document.createElement("span");
  key.className = "tip-key";
  key.style.background = `var(${app.color})`;
  const number = document.createElement("span");
  number.className = "tip-value";
  number.textContent = fmtMs(run.value);
  value.append(key, number);

  const meta = document.createElement("div");
  meta.textContent = `${app.label} · ${shortRev(run.revision)} · ${run.machine}`;

  tip.append(value, meta);
  tip.hidden = false;

  const rect = tip.getBoundingClientRect();
  const px = "clientX" in event ? event.clientX : event.target.getBoundingClientRect().left;
  const py = "clientY" in event ? event.clientY : event.target.getBoundingClientRect().top;
  tip.style.left = `${Math.min(px + 14, window.innerWidth - rect.width - 8)}px`;
  tip.style.top = `${Math.max(py - rect.height - 12, 8)}px`;
}

function hideTooltip() {
  $("tooltip").hidden = true;
}

/* ------------------------------------------------------------------ tables */

function appCell(app) {
  const span = document.createElement("span");
  span.className = "cell-app";
  const key = document.createElement("span");
  key.className = `key key-${app.cls}`;
  span.append(key, document.createTextNode(app.label));
  return span;
}

/**
 * The two browsers do not always run on the same pushes, and a pooled median
 * that quietly mixes 99 Fenix runs with 3 Chrome runs from one push would read
 * as a like-for-like comparison. Flag it, tersely.
 */
function renderHeadlineCaveat(runs) {
  const box = $("headline-caveat");
  const revsOf = (appId) => new Set(runs.filter((r) => r.app === appId).map((r) => r.revision));
  const fenixRevs = revsOf("fenix");
  const chromeRevs = revsOf("chrome-m");
  const shared = [...fenixRevs].filter((rev) => chromeRevs.has(rev));
  const notes = [];

  if (fenixRevs.size && chromeRevs.size && shared.length !== fenixRevs.size) {
    notes.push(
      `pushes differ (Fenix ${fenixRevs.size}, Chrome ${chromeRevs.size}, ${shared.length} shared)`
    );
  }
  for (const app of APPS) {
    const n = runs.filter((r) => r.app === app.id).length;
    if (n > 0 && n < 5) {
      notes.push(`${app.label} n=${n}`);
    }
  }

  box.hidden = !notes.length;
  box.textContent = notes.length ? `Not like-for-like: ${notes.join("; ")}.` : "";
}

function renderHeadline() {
  const runs = selectedRuns();
  renderHeadlineCaveat(runs);
  const stats = {};
  for (const app of APPS) {
    stats[app.id] = describe(runs.filter((r) => r.app === app.id).map((r) => r.value));
  }

  for (const app of APPS) {
    const s = stats[app.id];
    $(`stat-${app.cls}`).textContent = s ? fmtMs(s.median) : "–";
    $(`stat-${app.cls}-sub`).textContent = s
      ? `n=${s.n} · mean ${s.mean.toFixed(1)} · CV ${s.cv.toFixed(1)}%`
      : "no runs";
  }

  const fenix = stats.fenix;
  const chrome = stats["chrome-m"];
  const hero = $("hero-value");
  const verdict = $("hero-verdict");

  if (!fenix || !chrome) {
    hero.className = "hero-value neutral";
    hero.textContent = "–";
    verdict.textContent = "Needs runs from both browsers.";
    return;
  }

  // Lower is better, so a positive gap means Fenix took longer than Chrome.
  const gapMs = fenix.median - chrome.median;
  const delta = (gapMs / chrome.median) * 100;
  const kind = Math.abs(delta) < 1 ? "neutral" : delta > 0 ? "critical" : "good";
  const arrow = kind === "neutral" ? "" : kind === "critical" ? "▲ " : "▼ ";

  hero.className = `hero-value ${kind}`;
  hero.textContent = "";
  if (arrow) {
    const glyph = document.createElement("span");
    glyph.className = "hero-arrow";
    glyph.textContent = arrow;
    hero.append(glyph);
  }
  hero.append(document.createTextNode(fmtPct(delta)));
  // Names the direction in words so it never rests on the colour alone.
  verdict.textContent =
    kind === "neutral"
      ? `Level, ${Math.abs(gapMs).toFixed(1)} ms apart`
      : `Fenix ${Math.abs(gapMs).toFixed(1)} ms ${kind === "critical" ? "slower" : "faster"}`;
}

/** Signed gap of a Fenix median against the pooled Chrome median. */
function deltaCell(fenixMedian, chromeMedian) {
  const td = document.createElement("td");
  td.className = "num";
  if (chromeMedian === null) {
    td.classList.add("muted");
    td.textContent = "–";
    return td;
  }
  const delta = ((fenixMedian - chromeMedian) / chromeMedian) * 100;
  const kind = Math.abs(delta) < 1 ? "" : delta > 0 ? "critical" : "good";
  const arrow = kind === "critical" ? "▲ " : kind === "good" ? "▼ " : "";
  td.className = `num delta-cell ${kind}`;
  td.textContent = `${arrow}${fmtPct(delta)}`;
  td.title =
    delta > 0
      ? `${(fenixMedian - chromeMedian).toFixed(1)} ms slower than the Chrome median`
      : `${(chromeMedian - fenixMedian).toFixed(1)} ms faster than the Chrome median`;
  return td;
}

function renderSummaryTable() {
  const tbody = $("summary-table").querySelector("tbody");
  tbody.textContent = "";
  const runs = selectedRuns();
  const chromeStats = describe(runs.filter((r) => r.app === "chrome-m").map((r) => r.value));
  const chromeMedian = chromeStats ? chromeStats.median : null;

  const addRow = (labelNode, values, isGroup, app) => {
    const s = describe(values);
    if (!s) {
      return;
    }
    const tr = document.createElement("tr");
    if (isGroup) {
      tr.className = `group-row ${app.cls}`;
    }
    const th = document.createElement("td");
    th.append(labelNode);
    tr.append(th);

    for (const v of [String(s.n), s.median.toFixed(1)]) {
      const td = document.createElement("td");
      td.className = "num";
      td.textContent = v;
      tr.append(td);
    }

    if (app.id === "chrome-m") {
      const td = document.createElement("td");
      td.className = "num muted";
      td.textContent = isGroup ? "baseline" : "–";
      tr.append(td);
    } else {
      tr.append(deltaCell(s.median, chromeMedian));
    }

    for (const v of [
      s.mean.toFixed(1),
      s.stddev.toFixed(1),
      `${s.cv.toFixed(1)}%`,
      s.min.toFixed(1),
      s.max.toFixed(1),
    ]) {
      const td = document.createElement("td");
      td.className = "num";
      td.textContent = v;
      tr.append(td);
    }
    tbody.append(tr);
  };

  for (const app of APPS) {
    addRow(appCell(app), runs.filter((r) => r.app === app.id).map((r) => r.value), true, app);
    for (const lane of lanes().filter((l) => l.app.id === app.id)) {
      const label = document.createElement("span");
      label.className = "muted";
      label.textContent = ` ${shortRev(lane.revision)}`;
      addRow(label, lane.runs.map((r) => r.value), false, app);
    }
  }
}

/* --------------------------------------------------- artifact extraction */

/** Minimal tar reader: 512-byte headers, octal size at offset 124. */
function parseTar(buffer) {
  const bytes = new Uint8Array(buffer);
  const decoder = new TextDecoder();
  const files = [];
  let offset = 0;

  const str = (start, length) =>
    decoder.decode(bytes.subarray(offset + start, offset + start + length)).replace(/\0.*$/s, "");

  while (offset + 512 <= bytes.length) {
    if (bytes.subarray(offset, offset + 512).every((b) => b === 0)) {
      break;
    }
    const name = str(0, 100);
    const prefix = str(345, 155);
    const size = parseInt(str(124, 12).trim() || "0", 8) || 0;
    const type = String.fromCharCode(bytes[offset + 156]);
    offset += 512;
    if (type === "0" || type === "\0") {
      files.push({ name: prefix ? `${prefix}/${name}` : name, buffer: buffer.slice(offset, offset + size) });
    }
    offset += Math.ceil(size / 512) * 512;
  }
  return files;
}

async function fetchAndUngzip(url, onProgress) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("this browser has no DecompressionStream, so the archive cannot be unpacked");
  }
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`artifact unavailable (HTTP ${res.status})`);
  }
  const total = Number(res.headers.get("content-length")) || 0;
  let received = 0;
  const counter = new TransformStream({
    transform(chunk, controller) {
      received += chunk.byteLength;
      onProgress(received, total);
      controller.enqueue(chunk);
    },
  });
  const stream = res.body.pipeThrough(counter).pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

/** taskId/retryId -> { videos: Map<iteration, objectURL>, replicates: number[] } */
const artifactCache = new Map();
const ARTIFACT_CACHE_MAX = 4;

function cacheArtifacts(key, entry) {
  artifactCache.set(key, entry);
  while (artifactCache.size > ARTIFACT_CACHE_MAX) {
    const [oldestKey, oldest] = artifactCache.entries().next().value;
    for (const url of oldest.videos.values()) {
      URL.revokeObjectURL(url);
    }
    artifactCache.delete(oldestKey);
  }
}

async function loadJobArtifacts(jobId, onProgress) {
  const jobData = await getJSON(`${TREEHERDER}/api/project/${REPO}/jobs/?id=${jobId}`);
  const job = jobData.results && jobData.results[0];
  if (!job || !job.task_id) {
    throw new Error("could not resolve the Treeherder job to a task");
  }
  const taskId = job.task_id;
  const retryId = job.retry_id || 0;
  const key = `${taskId}/${retryId}`;
  if (artifactCache.has(key)) {
    return { ...artifactCache.get(key), taskId, retryId };
  }

  const base = `${TASKCLUSTER}/task/${taskId}/runs/${retryId}/artifacts`;
  const listing = await getJSON(base);
  const names = listing.artifacts.map((a) => a.name);
  const tgzName = names.find((n) => n.startsWith("public/build/") && n.endsWith(".tgz"));
  const perfName = names.find(
    (n) => n.startsWith("public/build/perfherder-data-") && n.endsWith(".json")
  );
  if (!tgzName) {
    throw new Error("no video archive on this task (artifacts expire ~4 weeks after the push)");
  }

  let replicates = [];
  if (perfName) {
    try {
      const perf = await getJSON(`${base}/${perfName}`);
      const test = TESTS[state.test];
      const suite = perf.suites.find((s) => s.name === test.suite) || perf.suites[0];
      const subtest =
        suite.subtests.find((s) => s.name === test.metric) || suite.subtests[0];
      replicates = subtest.replicates || [];
    } catch (e) {
      console.warn("perfherder artifact unreadable", e);
    }
  }

  const tar = await fetchAndUngzip(`${base}/${tgzName}`, onProgress);
  const videos = new Map();
  for (const file of parseTar(tar)) {
    const match = file.name.match(/vid(\d+)_[^/]*\.mp4$/i);
    if (match) {
      videos.set(
        Number(match[1]),
        URL.createObjectURL(new Blob([file.buffer], { type: "video/mp4" }))
      );
    }
  }
  if (!videos.size) {
    throw new Error("archive contained no videos");
  }

  const entry = { videos, replicates };
  cacheArtifacts(key, entry);
  return { ...entry, taskId, retryId };
}

/* --------------------------------------------------------- video inspector */

const panes = new Map();

function buildVideoPanes() {
  const container = $("video-panes");
  container.textContent = "";
  panes.clear();

  for (const app of APPS) {
    const pane = document.createElement("div");
    pane.className = "video-pane";

    const title = document.createElement("h3");
    const key = document.createElement("span");
    key.className = `key key-${app.cls}`;
    title.append(key, document.createTextNode(app.label));

    // The pair of numbers sits directly above the pair of videos: the score first,
    // then whether it is the median run or one picked by hand.
    const figure = document.createElement("div");
    figure.className = "pane-figure";
    const value = document.createElement("span");
    value.className = "pane-value";
    const note = document.createElement("span");
    note.className = "pane-note";
    figure.append(value, note);

    const progress = document.createElement("div");
    progress.className = "progress";
    const bar = document.createElement("i");
    progress.append(bar);
    progress.hidden = true;

    const video = document.createElement("video");
    video.controls = true;
    video.playsInline = true;
    video.preload = "metadata";

    const status = document.createElement("p");
    status.className = "pane-status";

    // Overrides, so they sit under the capture rather than above it.
    const pickers = document.createElement("div");
    pickers.className = "pane-pickers";
    const jobLabel = document.createElement("label");
    jobLabel.textContent = "Job";
    const jobSelect = document.createElement("select");
    jobLabel.htmlFor = jobSelect.id = `job-select-${app.cls}`;
    const iterLabel = document.createElement("label");
    iterLabel.textContent = "Iteration";
    const iterSelect = document.createElement("select");
    iterLabel.htmlFor = iterSelect.id = `iter-select-${app.cls}`;
    iterSelect.disabled = true;

    const jobLink = document.createElement("a");
    jobLink.target = "_blank";
    jobLink.rel = "noopener";
    jobLink.textContent = "Treeherder";
    jobLink.hidden = true;

    const jobField = document.createElement("div");
    jobField.append(jobLabel, jobSelect);
    const iterField = document.createElement("div");
    iterField.append(iterLabel, iterSelect);
    pickers.append(jobField, iterField);

    pane.append(title, figure, progress, video, status, pickers, jobLink);
    container.append(pane);

    // `pinned` means the job was chosen by hand, so the median default leaves it alone.
    const record = {
      app, value, note, jobSelect, iterSelect, status, progress, bar, video, jobLink,
      entry: null,
      pinned: false,
    };
    panes.set(app.id, record);

    jobSelect.addEventListener("change", () => {
      record.pinned = Boolean(jobSelect.value);
      loadPaneJob(app.id, Number(jobSelect.value));
      updatePaneNote(app.id);
    });
    iterSelect.addEventListener("change", () => showIteration(app.id, Number(iterSelect.value)));
  }
}

function refreshPaneJobLists() {
  for (const app of APPS) {
    const pane = panes.get(app.id);
    const runs = selectedRuns()
      .filter((r) => r.app === app.id)
      .sort((a, b) => b.pushTimestamp - a.pushTimestamp || a.value - b.value);

    const previous = pane.jobSelect.value;
    pane.jobSelect.textContent = "";

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = runs.length
      ? `${runs.length} job${runs.length === 1 ? "" : "s"}…`
      : "No runs";
    pane.jobSelect.append(placeholder);

    for (const run of runs) {
      const option = document.createElement("option");
      option.value = String(run.jobId);
      option.textContent = `${shortRev(run.revision)} · ${run.value.toFixed(1)} ms · ${run.machine}`;
      pane.jobSelect.append(option);
    }

    pane.jobSelect.disabled = !runs.length;
    if (pane.pinned && runs.some((r) => String(r.jobId) === previous)) {
      pane.jobSelect.value = previous;
    } else {
      loadMedianRun(app.id);
    }
    updatePaneNote(app.id);
  }
}

/**
 * Put the pane back on the median run. Reloading the same job would re-download
 * 20 MB for nothing, so only act when the median has actually moved.
 */
function loadMedianRun(appId) {
  const pane = panes.get(appId);
  pane.pinned = false;
  const run = medianRun(appId);
  if (!run) {
    pane.jobSelect.value = "";
    resetPane(appId);
    return;
  }
  if (Number(pane.jobSelect.value) === run.jobId) {
    return;
  }
  pane.jobSelect.value = String(run.jobId);
  loadPaneJob(appId, run.jobId);
}

function updatePaneNote(appId) {
  const pane = panes.get(appId);
  const runs = selectedRuns().filter((r) => r.app === appId);
  const med = medianRun(appId);
  if (!med) {
    pane.value.textContent = "–";
    pane.note.textContent = "No runs selected";
    return;
  }
  const showing = runs.find((r) => r.jobId === Number(pane.jobSelect.value)) || med;
  const which = showing.jobId === med.jobId ? "Median" : "Hand-picked";
  pane.value.textContent = fmtMs(showing.value);
  pane.note.textContent =
    `${which} of ${runs.length} run${runs.length === 1 ? "" : "s"} · ${shortRev(showing.revision)}`;
}

function resetPane(appId) {
  const pane = panes.get(appId);
  pane.entry = null;
  pane.pinned = false;
  pane.iterSelect.textContent = "";
  pane.iterSelect.disabled = true;
  pane.video.removeAttribute("src");
  pane.video.load();
  pane.status.textContent = "";
  pane.status.classList.remove("error");
  pane.jobLink.hidden = true;
}

function selectJobInPane(appId, jobId) {
  const pane = panes.get(appId);
  if (!pane) {
    return;
  }
  pane.pinned = true;
  pane.jobSelect.value = String(jobId);
  loadPaneJob(appId, jobId);
  updatePaneNote(appId);
  $("video-panes").scrollIntoView({ behavior: "smooth", block: "center" });
}

async function loadPaneJob(appId, jobId) {
  const pane = panes.get(appId);
  if (!jobId) {
    resetPane(appId);
    return;
  }

  pane.status.classList.remove("error");
  pane.status.textContent = "Fetching…";
  pane.progress.hidden = false;
  pane.bar.style.width = "0%";
  pane.iterSelect.disabled = true;
  pane.iterSelect.textContent = "";

  let lastPaint = 0;
  const onProgress = (received, total) => {
    const now = performance.now();
    if (now - lastPaint < 100) {
      return;
    }
    lastPaint = now;
    const mb = (received / 1048576).toFixed(1);
    if (total) {
      pane.bar.style.width = `${(received / total) * 100}%`;
      pane.status.textContent = `${mb} / ${(total / 1048576).toFixed(1)} MB`;
    } else {
      pane.status.textContent = `${mb} MB`;
    }
  };

  try {
    const entry = await loadJobArtifacts(jobId, onProgress);
    // A later selection may have superseded this one while we were downloading.
    if (Number(pane.jobSelect.value) !== jobId) {
      return;
    }
    pane.entry = entry;
    pane.progress.hidden = true;

    const iterations = [...entry.videos.keys()].sort((a, b) => a - b);
    for (const i of iterations) {
      const option = document.createElement("option");
      option.value = String(i);
      const replicate = entry.replicates[i];
      option.textContent =
        replicate === undefined
          ? `Iteration ${i + 1}`
          : `Iteration ${i + 1} — ${replicate.toFixed(1)} ms`;
      pane.iterSelect.append(option);
    }
    pane.iterSelect.disabled = false;

    pane.jobLink.href = `${TREEHERDER}/jobs?repo=${REPO}&selectedTaskRun=${entry.taskId}.${entry.retryId}`;
    pane.jobLink.hidden = false;

    // Default to the iteration closest to this job's median, not just the first.
    let pick = iterations[0];
    if (entry.replicates.length) {
      const target = median(entry.replicates);
      pick = iterations.reduce((best, i) =>
        Math.abs(entry.replicates[i] - target) < Math.abs(entry.replicates[best] - target) ? i : best
      );
    }
    pane.iterSelect.value = String(pick);
    showIteration(appId, pick);
  } catch (e) {
    pane.progress.hidden = true;
    pane.status.classList.add("error");
    pane.status.textContent = `Could not load video: ${e.message}`;
  }
}

function showIteration(appId, index) {
  const pane = panes.get(appId);
  if (!pane.entry) {
    return;
  }
  const url = pane.entry.videos.get(index);
  if (!url) {
    pane.status.textContent = "No video for that iteration";
    return;
  }
  pane.video.src = url;
  pane.video.load();
  const replicate = pane.entry.replicates[index];
  pane.status.textContent =
    replicate === undefined
      ? `Iteration ${index + 1}`
      : `Iteration ${index + 1} · ${replicate.toFixed(1)} ms`;
  if ($("autoplay-toggle").checked) {
    pane.video.play().catch(() => {});
  }
}

/* ---------------------------------------------------------------- controls */

function renderRevChips() {
  const container = $("rev-chips");
  container.textContent = "";

  for (const rev of availableRevisions()) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "rev-chip";
    const on = state.selectedRevisions.has(rev.revision);
    chip.setAttribute("aria-pressed", String(on));

    const check = document.createElement("span");
    check.className = "check";
    check.textContent = on ? "✓" : "";

    const code = document.createElement("code");
    code.textContent = shortRev(rev.revision);

    const date = document.createElement("span");
    date.className = "rev-date";
    date.textContent = `${fmtDate(rev.pushTimestamp)} · ${rev.count} runs`;

    const push = state.pushes.get(rev.revision);
    chip.title = push ? `${push.comment} — ${push.author}` : rev.revision;

    chip.append(check, code, date);
    chip.addEventListener("click", () => {
      if (state.selectedRevisions.has(rev.revision)) {
        state.selectedRevisions.delete(rev.revision);
      } else {
        state.selectedRevisions.add(rev.revision);
      }
      render();
    });
    container.append(chip);
  }
}

function render() {
  renderRevChips();
  renderHeadline();
  renderStripPlot();
  renderSummaryTable();
  refreshPaneJobLists();
  writeUrlState();
}

function onTestOrPlatformChange() {
  state.selectedRevisions = new Set(availableRevisions().map((r) => r.revision));
  $("test-blurb").textContent = TESTS[state.test].blurb;
  for (const app of APPS) {
    resetPane(app.id);
  }
  render();
}

function writeUrlState() {
  const url = new URL(window.location.href);
  url.searchParams.set("test", state.test);
  if (state.platform) {
    url.searchParams.set("platform", state.platform);
  }
  window.history.replaceState({}, "", url);
}

function readUrlState() {
  const params = new URLSearchParams(window.location.search);
  const test = params.get("test");
  if (test && TESTS[test]) {
    state.test = test;
  }
  return params.get("platform");
}

function setupThemeToggle() {
  const button = $("theme-toggle");
  const label = $("theme-toggle-label");
  const sync = () => {
    const dark =
      document.documentElement.dataset.theme === "dark" ||
      (!document.documentElement.dataset.theme &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    label.textContent = dark ? "Light" : "Dark";
  };
  button.addEventListener("click", () => {
    const dark =
      document.documentElement.dataset.theme === "dark" ||
      (!document.documentElement.dataset.theme &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "light" : "dark";
    sync();
    renderStripPlot();
  });
  sync();
}

/* -------------------------------------------------------------------- init */

async function init() {
  setupThemeToggle();
  buildVideoPanes();

  const preferredPlatform = readUrlState();

  const testSelect = $("test-select");
  for (const [id, test] of Object.entries(TESTS)) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = test.label;
    testSelect.append(option);
  }
  testSelect.value = state.test;
  testSelect.addEventListener("change", () => {
    state.test = testSelect.value;
    onTestOrPlatformChange();
  });

  try {
    await loadSignatures();
    if (!state.signatures.length) {
      throw new Error(
        "no matching Perfherder signatures. Try pushes older than 120 days are expired."
      );
    }
    await loadRuns();
  } catch (e) {
    const status = $("status");
    status.classList.add("error");
    status.textContent = `No data: ${e.message}`;
    return;
  }

  const platformSelect = $("platform-select");
  for (const platform of state.platforms) {
    const option = document.createElement("option");
    option.value = platform.id;
    option.textContent = platform.label;
    platformSelect.append(option);
  }
  state.platform =
    state.platforms.find((p) => p.id === preferredPlatform)?.id ||
    (state.platforms[0] && state.platforms[0].id);
  platformSelect.value = state.platform;
  platformSelect.addEventListener("change", () => {
    state.platform = platformSelect.value;
    onTestOrPlatformChange();
  });

  $("revs-all").addEventListener("click", () => {
    state.selectedRevisions = new Set(availableRevisions().map((r) => r.revision));
    render();
  });
  $("revs-none").addEventListener("click", () => {
    state.selectedRevisions.clear();
    render();
  });

  $("play-both").addEventListener("click", () => {
    for (const pane of panes.values()) {
      if (pane.video.src) {
        pane.video.currentTime = 0;
        pane.video.play().catch(() => {});
      }
    }
  });
  $("pause-both").addEventListener("click", () => {
    for (const pane of panes.values()) {
      pane.video.pause();
    }
  });
  $("reset-medians").addEventListener("click", () => {
    for (const app of APPS) {
      loadMedianRun(app.id);
      updatePaneNote(app.id);
    }
  });

  const legend = $("legend");
  for (const app of APPS) {
    const item = document.createElement("span");
    const key = document.createElement("span");
    key.className = `key key-${app.cls}`;
    item.append(key, document.createTextNode(app.label));
    legend.append(item);
  }

  $("status").hidden = true;
  $("dashboard").hidden = false;
  onTestOrPlatformChange();

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderStripPlot, 150);
  });

  const revisions = [...new Set(state.runs.map((r) => r.revision))];
  loadPushMetadata(revisions).then(renderRevChips);
}

init();
