/* MIKKA STUDIO REMOTE – Mobile Remote App (PWA, ohne Build-Schritt) */
"use strict";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "style") Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false)
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return el;
}

const store = {
  get(k, d) { try { const v = localStorage.getItem("mikka." + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("mikka." + k, JSON.stringify(v)); } catch (e) { /* privat */ } },
  del(k) { try { localStorage.removeItem("mikka." + k); } catch (e) { /* */ } },
};

function toast(msg, isErr) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast" + (isErr ? " err" : "");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add("hidden"), isErr ? 5000 : 2500);
}

const liveColor = (c) => "#" + ((c || 0x555555) & 0xffffff).toString(16).padStart(6, "0");
const uid = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "") :
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join(""));

/* ------------------------------------------------------------------ */
/* Zustand                                                              */
/* ------------------------------------------------------------------ */
const S = {
  song: null, tracks: null, scenes: [], clips: [], meters: null,
  status: {}, features: {}, device: null,
  wsOpen: false, latency: null,
  hold: new Map(), // Controls, die gerade bedient werden: key -> Zeitstempel
};
const HOLD_MS = 700;
function holding(key) { const t = S.hold.get(key); return t === Infinity || (t && Date.now() - t < HOLD_MS); }

/* ------------------------------------------------------------------ */
/* Verbindung                                                           */
/* ------------------------------------------------------------------ */
const Conn = {
  ws: null, pending: new Map(), retry: 0, timer: null, pingTimer: null,

  connect() {
    const token = store.get("token");
    if (!token) { showPair(); return; }
    clearTimeout(this.timer);
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(proto + "//" + location.host + "/api/ws");
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: "auth", token }));
    ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch (e) { return; } this.onMessage(m); };
    ws.onclose = (ev) => {
      S.wsOpen = false;
      this.failAll("Verbindung zum Mac unterbrochen – Befehl nicht ausgeführt");
      clearInterval(this.pingTimer);
      if (ev.code === 4401) { store.del("token"); showPair("Gerät nicht mehr freigegeben. Bitte neu koppeln."); renderStatus(); return; }
      renderStatus();
      const delay = Math.min(10000, 500 * Math.pow(1.6, this.retry++));
      this.timer = setTimeout(() => this.connect(), delay);
    };
    ws.onerror = () => { /* onclose folgt */ };
  },

  onMessage(m) {
    switch (m.type) {
      case "welcome":
        S.wsOpen = true; this.retry = 0; S.device = m.device; S.features = m.features || {};
        hidePair(); renderStatus(); renderFeatures();
        clearInterval(this.pingTimer);
        this.pingTimer = setInterval(() => this.ping(), 4000); this.ping();
        break;
      case "auth_failed":
        store.del("token"); showPair(m.error); break;
      case "status":
        S.status = m; renderStatus(); break;
      case "state_reset":
        S.song = null; S.tracks = null; S.scenes = []; S.clips = []; S.meters = null; renderAll(); break;
      case "state":
        S[m.section] = m.data; onSection(m.section); break;
      case "pong":
        if (m.t) { S.latency = Math.round(performance.now() - m.t); renderLatency(); } break;
      case "result": {
        const p = this.pending.get(m.id);
        if (p) { this.pending.delete(m.id); clearTimeout(p.timer); p.resolve(m); }
        break;
      }
    }
  },

  ping() { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ type: "ping", t: performance.now() })); },

  failAll(msg) {
    for (const [id, p] of this.pending) { clearTimeout(p.timer); p.resolve({ ok: false, error: msg, id }); }
    this.pending.clear();
  },

  /* Befehle werden NIE zwischengespeichert: ohne Verbindung schlagen sie sofort fehl. */
  send(cmd, args, opts = {}) {
    if (!this.ws || this.ws.readyState !== 1 || !S.wsOpen) {
      if (!opts.silent && !opts.quiet) toast("Nicht verbunden – Befehl nicht gesendet", true);
      return Promise.resolve({ ok: false, error: "nicht verbunden" });
    }
    const id = uid();
    const msg = { type: "cmd", id, cmd, args: args || {} };
    if (opts.noreply) { msg.noreply = true; this.ws.send(JSON.stringify(msg)); return Promise.resolve({ ok: true }); }
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.pending.delete(id); resolve({ ok: false, error: "Zeitüberschreitung – Ergebnis unbekannt" }); }, opts.timeout || 8000);
      this.pending.set(id, { resolve, timer });
      this.ws.send(JSON.stringify(msg));
    });
  },
};

async function cmd(name, args, opts = {}) {
  const r = await Conn.send(name, args, opts);
  if (!r.ok && !opts.quiet && !opts.noreply) toast(r.error || "Fehler", true);
  return r;
}

/* Gedrosseltes Senden für kontinuierliche Regler (max. ~25/s, letzter Wert gewinnt). */
const throttles = new Map();
function throttled(key, fn, ms = 40) {
  let t = throttles.get(key);
  if (!t) { t = { last: 0, timer: null, fn: null }; throttles.set(key, t); }
  t.fn = fn;
  const now = Date.now();
  const run = () => { t.last = Date.now(); t.timer = null; const f = t.fn; t.fn = null; if (f) f(); };
  if (now - t.last >= ms) run();
  else if (!t.timer) t.timer = setTimeout(run, ms - (now - t.last));
}

/* ------------------------------------------------------------------ */
/* Kopplung                                                             */
/* ------------------------------------------------------------------ */
function showPair(msg) { $("#pair").classList.remove("hidden"); $("#pair-msg").textContent = msg || ""; }
function hidePair() { $("#pair").classList.add("hidden"); }
$("#pair-go").addEventListener("click", async () => {
  const code = $("#pair-code").value.trim();
  const name = $("#pair-name").value.trim();
  $("#pair-msg").textContent = "";
  try {
    const r = await fetch("/api/pair", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, name }) });
    const j = await r.json();
    if (!j.ok) { $("#pair-msg").textContent = j.error || "Fehler"; return; }
    store.set("token", j.token);
    $("#pair-code").value = "";
    Conn.retry = 0; Conn.connect();
  } catch (e) { $("#pair-msg").textContent = "Mac nicht erreichbar"; }
});

/* ------------------------------------------------------------------ */
/* Navigation                                                           */
/* ------------------------------------------------------------------ */
let currentTab = store.get("tab", "studio");
function showTab(name) {
  currentTab = name; store.set("tab", name);
  $$("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  $$(".tab").forEach((s) => s.classList.toggle("active", s.id === "tab-" + name));
  const btn = $(`#tabs button[data-tab="${name}"]`); if (btn) btn.scrollIntoView({ inline: "center", block: "nearest" });
  if (name === "mastering") loadExports();
  if (name === "settings") loadDevices();
  if (name === "devices") renderDeviceTracks();
  if (name === "ai") loadHistory();
  renderAll();
}
$("#tabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) showTab(b.dataset.tab); });
document.addEventListener("click", (e) => { const a = e.target.closest("[data-goto]"); if (a) { e.preventDefault(); showTab(a.dataset.goto); } });

/* ------------------------------------------------------------------ */
/* Status                                                               */
/* ------------------------------------------------------------------ */
function renderStatus() {
  $("#pill-agent").className = "pill " + (S.wsOpen ? "on" : "off");
  const live = S.wsOpen && S.status.live_connected;
  $("#pill-live").className = "pill " + (live ? "on" : "off");
  const b = $("#banner");
  let msg = "";
  if (!S.wsOpen) msg = "Keine Verbindung zum Mac. Verbinde neu … (Tailscale aktiv?)";
  else if (!S.status.live_connected) {
    msg = S.status.ableton_running === false ? "Ableton Live läuft nicht auf dem Mac." :
      "Ableton nicht verbunden: " + (S.status.live_error || "Control Surface „MikkaRemote“ in Live aktivieren.");
  }
  b.textContent = msg; b.classList.toggle("hidden", !msg);
  renderSettingsConn();
}
function renderLatency() { $("#pill-latency").textContent = (S.latency ?? "–") + " ms"; renderSettingsConn(); }

function onSection(name) {
  if (name === "song") { renderStudio(); renderArrangement(); }
  else if (name === "tracks") { renderMixer(); renderSessionGrid(); if (currentTab === "devices") renderDeviceTracks(); renderStudio(); }
  else if (name === "clips" || name === "scenes") renderSessionGrid();
  else if (name === "meters") scheduleMeters();
}
function renderAll() { renderStudio(); renderMixer(); renderSessionGrid(); renderArrangement(); }

/* ------------------------------------------------------------------ */
/* STUDIO                                                               */
/* ------------------------------------------------------------------ */
function fmtPos(beats, num, den) {
  const q = 4 / den, bpb = num * q;
  const bar = Math.floor(beats / bpb) + 1;
  const rem = beats - (bar - 1) * bpb;
  const beat = Math.floor(rem / q) + 1;
  const six = Math.floor((rem - (beat - 1) * q) / (q / 4)) + 1;
  return `${bar}.${beat}.${six}`;
}
function setOn(sel, on) { const el = typeof sel === "string" ? $(sel) : sel; if (el) el.classList.toggle("on", !!on); }

function renderStudio() {
  const s = S.song;
  const dis = !s;
  $$("#tab-studio .tbtn, #tab-studio .tog:not(#mon-toggle):not(#mon-mute), #tab-studio .step").forEach((b) => { if (!b.closest("#project-keys")) b.disabled = dis; });
  if (!s) { $("#pos-bars").textContent = "–"; $("#pos-sig").textContent = ""; $("#project-info").textContent = "Ableton nicht verbunden"; return; }
  $("#pos-bars").textContent = fmtPos(s.position, s.signature_numerator, s.signature_denominator);
  $("#pos-sig").textContent = `${s.signature_numerator}/${s.signature_denominator}`;
  setOn("#btn-play", s.is_playing); setOn("#btn-rec", s.record_mode);
  setOn("#btn-metro", s.metronome); setOn("#btn-loop", s.loop);
  setOn("#btn-srec", s.session_record); setOn("#btn-overdub", s.overdub);
  $("#btn-undo").disabled = !s.can_undo; $("#btn-redo").disabled = !s.can_redo;
  if (!holding("tempo") && document.activeElement !== $("#tempo")) $("#tempo").value = s.tempo.toFixed(2);
  if (document.activeElement !== $("#sig-num")) $("#sig-num").value = s.signature_numerator;
  if (document.activeElement !== $("#sig-den")) $("#sig-den").value = s.signature_denominator;
  const t = S.tracks;
  $("#project-info").textContent = t ? `Live ${S.status.live_version || "?"} · ${t.tracks.length} Spuren · ${t.returns.length} Returns · ${S.scenes.length} Szenen · ${s.cue_points.length} Marker` : "";
}

const tbind = (id, fn) => $(id).addEventListener("click", fn);
tbind("#btn-play", () => cmd("transport.play"));
tbind("#btn-stop", () => cmd("transport.stop"));
tbind("#btn-continue", () => cmd("transport.continue"));
tbind("#btn-rec", () => S.song && cmd("song.set", { record_mode: !S.song.record_mode }));
tbind("#btn-metro", () => S.song && cmd("song.set", { metronome: !S.song.metronome }));
tbind("#btn-loop", () => S.song && cmd("song.set", { loop: !S.song.loop }));
tbind("#arr-loop", () => S.song && cmd("song.set", { loop: !S.song.loop }));
tbind("#btn-srec", () => S.song && cmd("song.set", { session_record: !S.song.session_record }));
tbind("#btn-overdub", () => S.song && cmd("song.set", { overdub: !S.song.overdub }));
tbind("#btn-undo", () => cmd("song.undo"));
tbind("#btn-redo", () => cmd("song.redo"));
tbind("#btn-tap", () => cmd("transport.tap_tempo"));

async function setTempo(v) {
  v = Math.max(20, Math.min(999, Math.round(v * 100) / 100));
  S.hold.set("tempo", Date.now());
  $("#tempo").value = v.toFixed(2);
  const r = await cmd("song.set", { tempo: v });
  if (r.ok && r.data) $("#tempo").value = Number(r.data.tempo).toFixed(2);
}
$$("[data-tempo]").forEach((b) => b.addEventListener("click", () => S.song && setTempo(S.song.tempo + parseFloat(b.dataset.tempo))));
$$("[data-settempo]").forEach((b) => b.addEventListener("click", () => setTempo(parseFloat(b.dataset.settempo))));
$("#tempo").addEventListener("change", (e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) setTempo(v); });
$("#sig-num").addEventListener("change", (e) => cmd("song.set", { signature_numerator: parseInt(e.target.value, 10) }));
$("#sig-den").addEventListener("change", (e) => cmd("song.set", { signature_denominator: parseInt(e.target.value, 10) }));

/* Monitor ------------------------------------------------------------ */
const Mon = {
  audio: new Audio(), want: false, quality: store.get("monq", "medium"), stalls: [], restarting: false,
  init() {
    const a = this.audio;
    a.preload = "none";
    a.volume = store.get("monvol", 0.9);
    $("#mon-volume").value = a.volume;
    a.addEventListener("playing", () => this.status("Läuft"));
    a.addEventListener("waiting", () => { this.status("Puffert …"); this.onStall(); });
    a.addEventListener("error", () => this.retry("Stream-Fehler"));
    a.addEventListener("ended", () => this.retry("Stream beendet"));
    setInterval(() => this.watch(), 1000);
    $("#mon-toggle").addEventListener("click", () => (this.want ? this.stop() : this.start()));
    $("#mon-mute").addEventListener("click", () => { a.muted = !a.muted; setOn("#mon-mute", a.muted); });
    $("#mon-volume").addEventListener("input", (e) => { a.volume = parseFloat(e.target.value); store.set("monvol", a.volume); });
    $("#mon-quality").addEventListener("change", (e) => { this.quality = e.target.value; store.set("monq", this.quality); if (this.want) this.restart(); });
  },
  status(t) { $("#mon-status").textContent = t + (this.want ? ` · Qualität: ${this.quality}` : ""); },
  async start() {
    this.want = true; $("#mon-toggle").textContent = "■ Stopp"; setOn("#mon-toggle", true);
    this.status("Verbinde …");
    const r = await cmd("audio.ticket", { quality: this.quality });
    if (!r.ok || !this.want) { if (!r.ok) this.stop(); return; }
    this.audio.src = r.data.url;
    try { await this.audio.play(); } catch (e) { this.status("Wiedergabe blockiert – erneut tippen"); }
  },
  stop() {
    this.want = false; $("#mon-toggle").textContent = "▶ Abhören"; setOn("#mon-toggle", false);
    this.audio.pause(); this.audio.removeAttribute("src"); this.audio.load(); this.status("Aus");
  },
  async restart() { if (this.restarting) return; this.restarting = true; this.audio.pause(); await this.start(); this.restarting = false; },
  retry(why) {
    if (!this.want || this.restarting) return;
    this.status(why + " – neuer Versuch …");
    setTimeout(() => this.want && this.restart(), 1500);
  },
  onStall() {
    const now = Date.now();
    this.stalls = this.stalls.filter((t) => now - t < 20000); this.stalls.push(now);
    const order = ["high", "medium", "low"];
    if (this.stalls.length >= 3 && order.indexOf(this.quality) < 2) {
      this.quality = order[order.indexOf(this.quality) + 1];
      $("#mon-quality").value = this.quality; this.stalls = [];
      toast("Schwache Verbindung – Monitoring-Qualität reduziert");
      this.restart();
    }
  },
  watch() {
    const a = this.audio;
    if (!this.want || !a.buffered.length) return;
    const lag = a.buffered.end(a.buffered.length - 1) - a.currentTime;
    if (lag > 2.5) a.currentTime = a.buffered.end(a.buffered.length - 1) - 0.3; // Latenz begrenzen
    if (!a.paused) this.status(`Läuft · Puffer ${lag.toFixed(1)} s`);
  },
};

/* ------------------------------------------------------------------ */
/* Fader & Knobs                                                        */
/* ------------------------------------------------------------------ */
const ZERO_DB = 0.85; // Ableton: 0 dB entspricht Fader-Wert 0.85

function makeFader(key, onChange) {
  const cap = h("div", { class: "cap" });
  const el = h("div", { class: "fader" }, h("div", { class: "track" }), h("div", { class: "zero" }), cap);
  const pad = 10;
  const setPos = (v) => {
    const H = el.clientHeight || 230;
    cap.style.top = (pad + (1 - v) * (H - 2 * pad)) + "px";
  };
  el._set = (v) => { el._v = v; setPos(v); };
  let startY = 0, startV = 0, lastTap = 0;
  el.addEventListener("pointerdown", (e) => {
    e.preventDefault(); el.setPointerCapture(e.pointerId);
    const now = Date.now();
    if (now - lastTap < 300) { el._set(ZERO_DB); onChange(ZERO_DB, true); lastTap = 0; return; }
    lastTap = now;
    startY = e.clientY; startV = el._v || 0;
    el.classList.add("drag"); S.hold.set(key, Infinity);
  });
  el.addEventListener("pointermove", (e) => {
    if (!el.hasPointerCapture(e.pointerId)) return;
    const H = el.clientHeight - 2 * pad;
    // Feinmodus: Finger seitlich weit vom Fader wegziehen = 4x feiner
    const fine = Math.abs(e.clientX - (el.getBoundingClientRect().left + 20)) > 80 ? 0.25 : 1;
    const v = Math.max(0, Math.min(1, startV + ((startY - e.clientY) / H) * fine));
    el._set(v); onChange(v, false);
  });
  const end = (e) => { if (el.hasPointerCapture && el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId); el.classList.remove("drag"); S.hold.set(key, Date.now()); onChange(el._v, true); };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
  return el;
}

function arcPath(v, bipolar) {
  const r = 12, cx = 16, cy = 16, a0 = -225, a1 = 45;
  const ang = (d) => (d * Math.PI) / 180;
  const pt = (d) => [cx + r * Math.cos(ang(d)), cy + r * Math.sin(ang(d))];
  const from = bipolar ? -90 : a0, to = a0 + (a1 - a0) * v;
  const [s, e] = [Math.min(from, to), Math.max(from, to)];
  const [x0, y0] = pt(s), [x1, y1] = pt(e);
  return { d: `M${x0} ${y0} A${r} ${r} 0 ${e - s > 180 ? 1 : 0} 1 ${x1} ${y1}`, ptr: pt(to) };
}
function makeKnob(key, label, bipolar, onChange) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg"); svg.setAttribute("viewBox", "0 0 32 32");
  const ring = document.createElementNS(ns, "path"); ring.setAttribute("class", "ring"); ring.setAttribute("d", arcPath(1, false).d);
  const val = document.createElementNS(ns, "path"); val.setAttribute("class", "val");
  const ptr = document.createElementNS(ns, "line"); ptr.setAttribute("class", "ptr"); ptr.setAttribute("x1", 16); ptr.setAttribute("y1", 16);
  svg.append(ring, val, ptr);
  const lbl = h("div", { class: "kl", text: label });
  const el = h("div", { class: "knob" }, svg, lbl);
  el._set = (v, txt) => {
    el._v = v; const a = arcPath(v, bipolar);
    val.setAttribute("d", a.d); ptr.setAttribute("x2", a.ptr[0]); ptr.setAttribute("y2", a.ptr[1]);
    if (txt !== undefined) lbl.textContent = txt || label;
  };
  let sy = 0, sv = 0, lastTap = 0;
  el.addEventListener("pointerdown", (e) => {
    e.preventDefault(); el.setPointerCapture(e.pointerId);
    const now = Date.now();
    if (now - lastTap < 300) { const d = bipolar ? 0.5 : 0; el._set(d); onChange(d, true); lastTap = 0; return; }
    lastTap = now; sy = e.clientY; sv = el._v || 0; S.hold.set(key, Infinity);
  });
  el.addEventListener("pointermove", (e) => {
    if (!el.hasPointerCapture(e.pointerId)) return;
    const v = Math.max(0, Math.min(1, sv + (sy - e.clientY) / 150));
    el._set(v); onChange(v, false);
  });
  const end = () => { S.hold.set(key, Date.now()); onChange(el._v, true); };
  el.addEventListener("pointerup", end); el.addEventListener("pointercancel", end);
  return el;
}

/* ------------------------------------------------------------------ */
/* MIXER                                                                */
/* ------------------------------------------------------------------ */
let mixerSig = "";
const strips = new Map();
const SEND_NAMES = "ABCDEFGHIJKL";
const refOf = (t) => (t.kind === "master" ? { kind: "master", index: 0 } : { kind: t.kind, index: t.index, name: t.name });
const keyOf = (t) => t.kind + ":" + t.index;

function sendTrack(t, field, value, final) {
  const key = keyOf(t) + ":" + field;
  const args = { track: refOf(t) };
  if (field.startsWith("send")) args.send = { index: parseInt(field.slice(4), 10), value };
  else args[field] = value;
  throttled(key, () => Conn.send("track.set", args, { noreply: !final, silent: true }).then((r) => {
    if (final && r && !r.ok && r.error) toast(r.error, true);
    if (final && r && r.ok && r.data && r.data.volume_str) { const st = strips.get(keyOf(t)); if (st) st.db.textContent = r.data.volume_str; }
  }));
  // Nach dem Loslassen den von Ableton gemeldeten Zustand wieder uebernehmen
  if (final) setTimeout(renderMixer, HOLD_MS + 50);
}

function buildStrip(t, nSends) {
  const k = keyOf(t);
  const fader = makeFader(k + ":volume", (v, fin) => { db.textContent = fin ? db.textContent : "…"; sendTrack(t, "volume", v, fin); });
  const ml = h("div", { class: "mv" }), mr = h("div", { class: "mv" });
  const db = h("div", { class: "db" });
  const pan = makeKnob(k + ":pan", "Pan", true, (v, fin) => sendTrack(t, "pan", v * 2 - 1, fin));
  const sends = [];
  const knobs = h("div", { class: "knobs" }, pan);
  if (t.kind !== "master") for (let i = 0; i < Math.min(nSends, t.sends.length); i++) {
    const kn = makeKnob(k + ":send" + i, SEND_NAMES[i] || String(i + 1), false, (v, fin) => sendTrack(t, "send" + i, v, fin));
    sends.push(kn); knobs.append(kn);
  }
  const name = h("div", { class: "name", text: t.name, title: t.name });
  if (t.kind !== "master") name.addEventListener("click", () => {
    const n = prompt("Spur umbenennen", t.name);
    if (n && n.trim() && n !== t.name) cmd("track.set", { track: refOf(t), name: n.trim() });
  });
  let btns = null, m, s, a;
  if (t.kind !== "master") {
    m = h("button", { class: "m", text: "M", onclick: () => cmd("track.set", { track: refOf(t), mute: !t.mute }) });
    s = h("button", { class: "s", text: "S", onclick: () => cmd("track.set", { track: refOf(t), solo: !t.solo }) });
    a = h("button", { class: "a", text: "●", disabled: !t.can_arm, onclick: () => cmd("track.set", { track: refOf(t), arm: !t.arm }) });
    btns = h("div", { class: "btn3" }, m, s, a);
  }
  const cbar = h("div", { class: "cbar" });
  const el = h("div", { class: "strip " + t.kind + (t.is_grouped ? " grouped" : "") },
    cbar, name, knobs, h("div", { class: "fwrap" }, fader, h("div", { class: "vmeter" }, ml, mr)), db, btns);
  const strip = { el, t, fader, pan, sends, db, ml, mr, m, s, a, cbar, name };
  return strip;
}

function updateStrip(st, t) {
  st.t = t;
  const k = keyOf(t);
  st.cbar.style.background = liveColor(t.color);
  st.name.textContent = t.name;
  if (!holding(k + ":volume")) { st.fader._set(t.volume); st.db.textContent = t.volume_str; }
  if (!holding(k + ":pan")) st.pan._set((t.pan + 1) / 2, t.pan_str);
  st.sends.forEach((kn, i) => { if (t.sends[i] && !holding(k + ":send" + i)) kn._set(t.sends[i].value, SEND_NAMES[i] + " " + t.sends[i].str.replace(" dB", "")); });
  if (st.m) { setOn(st.m, t.mute); setOn(st.s, t.solo); setOn(st.a, t.arm); }
  if (t.is_grouped && t.group !== null && S.tracks && S.tracks.tracks[t.group]) st.el.style.borderTopColor = liveColor(S.tracks.tracks[t.group].color);
}

function renderMixer() {
  const box = $("#mixer");
  if (!S.tracks) { box.replaceChildren(h("p", { class: "muted", text: "Ableton nicht verbunden." })); mixerSig = ""; strips.clear(); return; }
  if (currentTab !== "mixer" && mixerSig) { /* im Hintergrund nur Werte aktualisieren */ }
  const nSends = parseInt($("#mix-sends").value, 10);
  const showRet = $("#mix-returns").checked;
  const list = [...S.tracks.tracks.filter((t) => t.visible !== false), ...(showRet ? S.tracks.returns : []), S.tracks.master];
  const sig = nSends + "|" + list.map((t) => keyOf(t) + t.name + t.sends.length).join("|");
  if (sig !== mixerSig) {
    mixerSig = sig; strips.clear();
    box.replaceChildren(...list.map((t) => { const st = buildStrip(t, nSends); strips.set(keyOf(t), st); return st.el; }));
  }
  for (const t of list) { const st = strips.get(keyOf(t)); if (st) updateStrip(st, t); }
  scheduleMeters();
}
$("#mix-sends").addEventListener("change", () => { store.set("sends", $("#mix-sends").value); mixerSig = ""; renderMixer(); });
$("#mix-returns").addEventListener("change", () => { mixerSig = ""; renderMixer(); });
$("#mix-sends").value = store.get("sends", "2");

/* Meter (per requestAnimationFrame) */
let meterQueued = false;
function scheduleMeters() { if (!meterQueued) { meterQueued = true; requestAnimationFrame(drawMeters); } }
const pct = (v) => Math.round((1 - Math.min(1, v)) * 100) + "%";
function drawMeters() {
  meterQueued = false;
  const m = S.meters; if (!m || !$("#opt-meters").checked) return;
  $("#master-meter-l").style.clipPath = `inset(0 ${pct(m.master[0])} 0 0)`;
  $("#master-meter-r").style.clipPath = `inset(0 ${pct(m.master[1])} 0 0)`;
  if (currentTab !== "mixer") return;
  const put = (st, lr) => { if (!st || !lr) return; st.ml.style.clipPath = `inset(${pct(lr[0])} 0 0 0)`; st.mr.style.clipPath = `inset(${pct(lr[1])} 0 0 0)`; };
  m.tracks.forEach((lr, i) => put(strips.get("track:" + i), lr));
  m.returns.forEach((lr, i) => put(strips.get("return:" + i), lr));
  put(strips.get("master:0"), m.master);
}

/* ------------------------------------------------------------------ */
/* SESSION                                                              */
/* ------------------------------------------------------------------ */
const QUANT = ["Keine", "8 Takte", "4 Takte", "2 Takte", "1 Takt", "1/2", "1/2T", "1/4", "1/4T", "1/8", "1/8T", "1/16", "1/16T", "1/32"];
$("#quant").replaceChildren(...QUANT.map((q, i) => h("option", { value: i, text: q })));
$("#quant").addEventListener("change", (e) => cmd("song.set", { quantization: parseInt(e.target.value, 10) }));
tbind("#btn-stopall", () => cmd("song.stop_all_clips"));
tbind("#btn-newscene", () => cmd("song.create_scene", { index: -1 }));

function renderSessionGrid() {
  if (currentTab !== "session") return;
  const box = $("#session");
  if (!S.tracks || !S.clips) { box.replaceChildren(h("p", { class: "muted", text: "Ableton nicht verbunden." })); return; }
  if (S.song) $("#quant").value = S.song.quantization;
  const tracks = S.tracks.tracks;
  const head = h("tr", null, h("th", { class: "sc", text: "Szene" }), ...tracks.map((t) => h("th", { title: t.name, style: { color: liveColor(t.color) } }, t.name)));
  const rows = S.scenes.map((sc, si) => h("tr", null,
    h("td", { class: "sc" }, h("button", { class: "scene-btn" + (sc.triggered ? " triggered" : ""), text: "▶ " + (sc.name || si + 1), onclick: () => cmd("scene.fire", { scene: si }) })),
    ...tracks.map((t, ti) => {
      const c = (S.clips[ti] || [])[si];
      let el;
      if (Array.isArray(c)) {
        const st = ["", "playing", "triggered", "recording"][c[2]];
        el = h("button", { class: "slot " + st, style: { background: liveColor(c[1]) }, title: c[0], onclick: () => cmd("clip.fire", { track: ti, scene: si, name: t.name }) },
          c[0] || "Clip", h("span", { class: "st", text: c[2] === 1 ? "▶" : c[2] === 3 ? "●" : "" }));
      } else {
        el = h("button", { class: "slot empty" + (c === null ? "" : " nostop") + (t.arm ? " armable" : ""), onclick: () => {
          if (t.arm) cmd("clip.fire", { track: ti, scene: si, name: t.name }); else if (c === null) cmd("clip.stop", { track: ti, scene: si, name: t.name });
        } });
      }
      return h("td", null, el);
    })));
  const stopRow = h("tr", null, h("td", { class: "sc" }), ...tracks.map((t) => h("td", null, h("button", { class: "stop-btn", text: "■", onclick: () => cmd("track.stop_clips", { track: refOf(t) }) }))));
  box.replaceChildren(h("table", { class: "sgrid" }, h("thead", null, head), h("tbody", null, ...rows, stopRow)));
}

/* ------------------------------------------------------------------ */
/* ARRANGEMENT                                                          */
/* ------------------------------------------------------------------ */
function renderArrangement() {
  const s = S.song;
  if (!s) { $("#cues").replaceChildren(h("p", { class: "muted", text: "Ableton nicht verbunden." })); return; }
  setOn("#arr-loop", s.loop);
  $("#loop-start").textContent = fmtPos(s.loop_start, s.signature_numerator, s.signature_denominator);
  $("#loop-len").textContent = (s.loop_length / (s.signature_numerator * 4 / s.signature_denominator)).toFixed(2) + " T";
  if (currentTab !== "arrangement") return;
  const sig = JSON.stringify(s.cue_points);
  if ($("#cues")._sig === sig) return;
  $("#cues")._sig = sig;
  $("#cues").replaceChildren(...(s.cue_points.length ? s.cue_points.map((c, i) => h("div", { class: "item" },
    h("span", { class: "grow", text: (c.name || "Marker " + (i + 1)) }),
    h("span", { class: "sub", text: fmtPos(c.time, s.signature_numerator, s.signature_denominator) }),
    h("button", { class: "tog small", text: "Springen", onclick: () => cmd("song.jump_to_cue", { index: i }) }))) :
    [h("p", { class: "muted", text: "Keine Marker im Projekt." })]));
}
$$("[data-jump]").forEach((b) => b.addEventListener("click", () => {
  const s = S.song; if (!s) return;
  const bars = parseFloat(b.dataset.jump) / 4;
  cmd("song.jump_by", { beats: bars * s.signature_numerator * 4 / s.signature_denominator });
}));
tbind("#btn-tostart", () => cmd("song.set", { position: 0 }));
tbind("#btn-cue", () => cmd("song.toggle_cue"));
$$("[data-loopstart]").forEach((b) => b.addEventListener("click", () => S.song && cmd("song.set", { loop_start: Math.max(0, S.song.loop_start + parseFloat(b.dataset.loopstart)) })));
$$("[data-looplen]").forEach((b) => b.addEventListener("click", () => S.song && cmd("song.set", { loop_length: Math.max(1, S.song.loop_length + parseFloat(b.dataset.looplen)) })));
tbind("#loop-here", () => S.song && cmd("song.set", { loop_start: Math.floor(S.song.position), loop: true }));

/* ------------------------------------------------------------------ */
/* DEVICES                                                              */
/* ------------------------------------------------------------------ */
let devSel = null; // {ref, path}
function allTracks() { if (!S.tracks) return []; return [...S.tracks.tracks, ...S.tracks.returns, S.tracks.master]; }
function renderDeviceTracks() {
  const sel = $("#dev-track");
  const list = allTracks();
  const sig = list.map((t) => keyOf(t) + t.name).join("|");
  if (sel._sig === sig) return;
  sel._sig = sig;
  const prev = sel.value || store.get("devtrack", "");
  sel.replaceChildren(...list.map((t) => h("option", { value: keyOf(t), text: (t.kind === "return" ? "↩ " : t.kind === "master" ? "◎ " : "") + t.name })));
  if (list.some((t) => keyOf(t) === prev)) sel.value = prev;
  loadDevices2();
}
$("#dev-track").addEventListener("change", () => { store.set("devtrack", $("#dev-track").value); loadDevices2(); });
tbind("#dev-refresh", () => loadDevices2());
function selTrack() { const k = $("#dev-track").value; return allTracks().find((t) => keyOf(t) === k); }

async function loadDevices2() {
  const t = selTrack();
  $("#dev-params").replaceChildren();
  if (!t) { $("#dev-list").replaceChildren(h("p", { class: "muted", text: "Ableton nicht verbunden." })); return; }
  const r = await cmd("device.list", { track: refOf(t) }, { quiet: true });
  if (!r.ok) { $("#dev-list").replaceChildren(h("p", { class: "err", text: r.error })); return; }
  const items = [];
  const walk = (devs, path, depth) => devs.forEach((d) => {
    const p = [...path, d.index];
    items.push(h("div", { class: "item dev-item", style: { marginLeft: depth * 14 + "px" }, onclick: (e) => { $$(".dev-item").forEach((x) => x.classList.remove("sel")); e.currentTarget.classList.add("sel"); loadParams(t, p); } },
      h("span", { class: "grow" }, d.name, h("div", { class: "sub", text: d.class_name + (d.is_active ? "" : " · aus") }))));
    d.chains.forEach((c) => { items.push(h("div", { class: "sub", style: { marginLeft: (depth + 1) * 14 + "px" }, text: "⛓ " + c.name })); walk(c.devices, [...p, c.index], depth + 2); });
  });
  walk(r.data.devices, [], 0);
  if (!items.length) items.push(h("p", { class: "muted", text: "Keine Geräte auf dieser Spur." }));
  $("#dev-list").replaceChildren(...items);
}

async function loadParams(t, path) {
  devSel = { ref: refOf(t), path };
  const r = await cmd("device.params", { track: refOf(t), path });
  if (!r.ok) return;
  const box = $("#dev-params");
  const els = r.data.parameters.map((p) => {
    const v = h("div", { class: "pv", text: p.str });
    let input;
    if (p.quantized && p.items && p.items.length && p.items.length <= 12) {
      input = h("select", null, ...p.items.map((it, i) => h("option", { value: p.min + i, text: it })));
      input.value = String(Math.round(p.value));
      input.addEventListener("change", async () => { const rr = await cmd("device.set_param", { track: devSel.ref, path, param: p.index, value: parseFloat(input.value) }); if (rr.ok) v.textContent = rr.data.str; });
    } else {
      input = h("input", { type: "range", min: p.min, max: p.max, step: p.quantized ? 1 : (p.max - p.min) / 1000, value: p.value });
      const send = (final) => throttled("dp" + p.index, async () => {
        const rr = await Conn.send("device.set_param", { track: devSel.ref, path, param: p.index, value: parseFloat(input.value) }, { silent: true });
        if (rr.ok && rr.data) v.textContent = rr.data.str; else if (final && rr.error) toast(rr.error, true);
      }, 60);
      input.addEventListener("input", () => send(false));
      input.addEventListener("change", () => send(true));
    }
    if (!p.enabled) input.disabled = true;
    return h("div", { class: "param" + (p.enabled ? "" : " disabled") }, h("div", { class: "pn", text: p.name, title: p.name }), v, input);
  });
  box.replaceChildren(h("h3", { text: r.data.name + " (" + r.data.class_name + ")" }), ...els);
  box.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ------------------------------------------------------------------ */
/* AI ENGINEER                                                          */
/* ------------------------------------------------------------------ */
const EXAMPLES = ["Stelle das Projekt auf 145 BPM", "Die Hi-Hats sind zu laut", "Kick 1 dB lauter", "Bass stumm", "Metronom an", "Starte Szene 1", "Analysiere meinen Track", "Rückgängig"];
$("#ai-examples").replaceChildren(...EXAMPLES.map((e) => h("button", { class: "tog", text: e, onclick: () => { $("#ai-text").value = e; aiPlan(); } })));
$("#opt-autoexec").checked = store.get("autoexec", false);
$("#opt-autoexec").addEventListener("change", (e) => store.set("autoexec", e.target.checked));
tbind("#ai-send", () => aiPlan());
$("#ai-text").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); aiPlan(); } });

async function aiPlan() {
  const text = $("#ai-text").value.trim(); if (!text) return;
  const r = await cmd("assistant.plan", { text });
  if (!r.ok) return;
  const p = r.data;
  const box = $("#ai-plan");
  const card = h("div", { class: "card plan" }, h("div", { class: "card-h", text: "Plan" }), h("div", { class: "msg", text: p.message }));
  p.actions.forEach((a) => card.append(h("div", { class: "act", text: a.label })));
  if (p.actions.length) {
    const exec = h("button", { class: "tog primary", text: p.destructive ? "Bestätigen & ausführen" : "Ausführen" });
    const discard = h("button", { class: "tog", text: "Verwerfen", onclick: () => box.replaceChildren() });
    exec.addEventListener("click", () => aiExecute(p, card, exec));
    card.append(h("div", { class: "row" }, exec, discard));
    box.replaceChildren(card);
    if (!p.requires_confirmation && !p.destructive && store.get("autoexec", false)) aiExecute(p, card, exec);
  } else box.replaceChildren(card);
}

async function aiExecute(p, card, btn, isRevert) {
  btn.disabled = true;
  const actions = isRevert ? p.revert : p.actions;
  const r = await cmd("assistant.execute", { actions, input: (isRevert ? "Rückgängig: " : "") + p.input }, { timeout: 120000 });
  if (!r.ok) { btn.disabled = false; return; }
  const rep = h("div", null, h("div", { class: "card-h", text: isRevert ? "Wiederhergestellt" : "Ergebnis" }));
  r.data.report.forEach((e) => {
    let detail = "";
    if (e.ok && e.data) {
      if (e.data.volume_str) detail = " → Ableton meldet: " + e.data.volume_str;
      else if (e.data.tempo !== undefined) detail = " → Ableton meldet: " + e.data.tempo + " BPM";
      else if (e.data.integrated_lufs !== undefined) { detail = ""; showAnalysis(e.data); }
    }
    const state = e.ok ? (e.confirmed ? "✓ bestätigt" : "✓ gesendet (nicht bestätigbar)") : "✗ " + (e.error || "fehlgeschlagen");
    rep.append(h("div", { class: "act " + (e.ok ? "ok" : "fail"), text: `${e.label}: ${state}${detail}` }));
  });
  if (!isRevert && p.revert && p.revert.length && r.data.report.some((e) => e.ok)) {
    const rb = h("button", { class: "tog", text: "Vorher-Zustand wiederherstellen (A/B)" });
    rb.addEventListener("click", () => aiExecute(p, card, rb, true));
    rep.append(h("div", { class: "row" }, rb));
  }
  card.append(rep);
  loadHistory();
}

tbind("#ai-history", () => loadHistory());
async function loadHistory() {
  const r = await cmd("history.list", {}, { quiet: true });
  if (!r.ok) return;
  $("#ai-log").replaceChildren(...(r.data.entries.length ? r.data.entries.map((e) => h("div", { class: "item" },
    h("span", { class: "grow" }, new Date(e.time * 1000).toLocaleString("de-DE"), " · ", e.device || "", h("div", { class: "sub", text:
      e.type === "keystroke" ? "Tastaturkürzel: " + e.shortcut :
        (e.input || "") + " — " + (e.report || []).map((x) => (x.ok ? "✓ " : "✗ ") + x.label).join("; ") })))) :
    [h("p", { class: "muted", text: "Noch keine Einträge." })]));
}

/* Spracheingabe (optional, Web Speech API von Chrome) */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!SR) $("#ai-mic").classList.add("hidden");
else tbind("#ai-mic", () => {
  const rec = new SR(); rec.lang = "de-DE"; rec.interimResults = false;
  setOn("#ai-mic", true);
  rec.onresult = (e) => { $("#ai-text").value = e.results[0][0].transcript; aiPlan(); };
  rec.onend = () => setOn("#ai-mic", false);
  rec.onerror = (e) => toast("Spracheingabe: " + e.error, true);
  rec.start();
});

/* ------------------------------------------------------------------ */
/* MASTERING / EXPORTE                                                  */
/* ------------------------------------------------------------------ */
tbind("#exp-refresh", () => loadExports());
const fmtSize = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.round(b / 1024) + " kB");
async function loadExports() {
  const r = await cmd("exports.list", {}, { quiet: true });
  if (!r.ok) { $("#exp-list").replaceChildren(h("p", { class: "err", text: r.error || "Fehler" })); return; }
  $("#exp-dir").textContent = "Ordner am Mac: " + r.data.dir;
  const fmts = S.features.export_formats || {};
  $("#exp-list").replaceChildren(...(r.data.files.length ? r.data.files.map((f) => {
    const fsel = h("select", null, ...Object.entries(fmts).map(([k, v]) => h("option", { value: k, text: v })));
    const srsel = h("select", null, h("option", { value: "", text: "Original-SR" }), ...[44100, 48000, 96000].map((s) => h("option", { value: s, text: s / 1000 + " kHz" })));
    return h("div", { class: "item", style: { flexWrap: "wrap" } },
      h("span", { class: "grow" }, f.name, h("div", { class: "sub", text: fmtSize(f.size) + " · " + new Date(f.mtime * 1000).toLocaleString("de-DE") })),
      h("button", { class: "tog small", text: "Messen", onclick: async (e) => { e.target.disabled = true; e.target.textContent = "misst …"; const rr = await cmd("exports.analyze", { name: f.name }, { timeout: 900000 }); e.target.disabled = false; e.target.textContent = "Messen"; if (rr.ok) showAnalysis(rr.data); } }),
      h("button", { class: "tog small", text: "Anhören", onclick: async () => { const rr = await cmd("exports.ticket", { name: f.name, inline: true }); if (rr.ok) { const pl = $("#exp-player"); pl.classList.remove("hidden"); pl.src = rr.data.url; pl.play().catch(() => {}); } } }),
      h("button", { class: "tog small", text: "Download", onclick: async () => { const rr = await cmd("exports.ticket", { name: f.name }); if (rr.ok) location.href = rr.data.url; } }),
      h("button", { class: "tog small", text: "Teilen", onclick: () => shareFile(f) }),
      h("div", { class: "row", style: { width: "100%" } }, fsel, srsel, h("button", { class: "tog small", text: "Konvertieren", onclick: async (e) => {
        e.target.disabled = true; e.target.textContent = "läuft …";
        const rr = await cmd("exports.convert", { name: f.name, format: fsel.value, sample_rate: srsel.value ? parseInt(srsel.value, 10) : null }, { timeout: 900000 });
        e.target.disabled = false; e.target.textContent = "Konvertieren";
        if (rr.ok) { toast("Erstellt: " + rr.data.name); loadExports(); }
      } })));
  }) : [h("p", { class: "muted", text: "Keine Audiodateien im Exportordner." })]));
}

async function shareFile(f) {
  const rr = await cmd("exports.ticket", { name: f.name });
  if (!rr.ok) return;
  try {
    const blob = await (await fetch(rr.data.url)).blob();
    const file = new File([blob], f.name.split("/").pop(), { type: blob.type || "audio/wav" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: file.name });
    else toast("Teilen wird von diesem Browser nicht unterstützt – bitte Download verwenden", true);
  } catch (e) { if (e.name !== "AbortError") toast("Teilen fehlgeschlagen: " + e.message, true); }
}

function showAnalysis(a) {
  const fmt = (v, u) => (v === null || v === undefined ? "–" : v + " " + u);
  const M = [["Integrated", fmt(a.integrated_lufs, "LUFS")], ["Short-Term max", fmt(a.short_term_max_lufs, "LUFS")],
    ["Momentary max", fmt(a.momentary_max_lufs, "LUFS")], ["True Peak", fmt(a.true_peak_dbtp, "dBTP")],
    ["Sample Peak", fmt(a.sample_peak_dbfs, "dBFS")], ["RMS", fmt(a.rms_dbfs, "dBFS")],
    ["Loudness Range", fmt(a.loudness_range_lu, "LU")], ["Crest-Faktor", fmt(a.crest_factor_db, "dB")],
    ["Dauer", fmt(a.duration_s, "s")], ["Format", (a.codec || "?") + " · " + (a.sample_rate || "?") + " Hz"]];
  const card = h("div", { class: "card" }, h("div", { class: "card-h", text: "Messung: " + a.file }),
    h("div", { class: "metrics" }, ...M.map(([k, v]) => h("div", { class: "metric" }, h("div", { class: "mk", text: k }), h("div", { class: "mvv", text: v })))),
    ...(a.warnings || []).map((w) => h("p", { class: "err", text: "⚠ " + w })),
    h("p", { class: "hint", text: "Methode: " + a.method + ". Werte sind Messungen, keine Bewertung – Zielwerte hängen von Genre, Referenz und Ausspielweg ab." }));
  $("#exp-analysis").replaceChildren(card);
  if (currentTab === "mastering") card.scrollIntoView({ behavior: "smooth" });
}

/* ------------------------------------------------------------------ */
/* REMOTE DESKTOP / FEATURES                                            */
/* ------------------------------------------------------------------ */
function renderFeatures() {
  const f = S.features;
  const host = f.remote_desktop_host || location.hostname;
  $("#vnc-host").textContent = "vnc://" + host;
  $("#vnc-link").href = "vnc://" + host;
  const qsel = $("#mon-quality");
  qsel.replaceChildren(...Object.entries(f.audio_quality || {}).map(([k, v]) => h("option", { value: k, text: v })));
  qsel.value = Mon.quality;
  const mk = (box, keys) => box.replaceChildren(...(f.keystrokes ? keys.map((k) => h("button", { class: "tog", text: f.shortcuts[k], onclick: async () => {
    const r = await cmd("keys.send", { shortcut: k }); if (r.ok) toast("Gesendet: " + r.data.sent + " (nicht von Ableton bestätigt)");
  } })) : [h("p", { class: "hint", text: "Deaktiviert. Aktivieren: \"allow_keystrokes\": true in ~/.mikka-studio/config.json + macOS-Bedienungshilfen-Freigabe." })]));
  mk($("#desk-keys"), Object.keys(f.shortcuts || {}));
  mk($("#project-keys"), ["save", "save_as", "export_audio"].filter((k) => (f.shortcuts || {})[k]));
}

/* ------------------------------------------------------------------ */
/* SETTINGS                                                             */
/* ------------------------------------------------------------------ */
function renderSettingsConn() {
  const st = S.status;
  const kv = [["Mac-Agent", S.wsOpen ? "verbunden (v" + (st.agent_version || "?") + ")" : "getrennt"],
    ["Ableton Live", st.live_connected ? "verbunden (Live " + (st.live_version || "?") + ")" : "nicht verbunden"],
    ["Ableton-Prozess", st.ableton_running === null || st.ableton_running === undefined ? "unbekannt" : st.ableton_running ? "läuft" : "läuft nicht"],
    ["Latenz (Steuerung)", S.latency === null ? "–" : S.latency + " ms"],
    ["Verbindung", location.protocol === "https:" ? "HTTPS/WSS verschlüsselt" : "unverschlüsselt (nur lokal testen!)"],
    ["Dieses Gerät", S.device ? S.device.name + " (" + S.device.id + ")" : "–"],
    ["Verbundene Geräte", st.clients ?? "–"], ["Audio-Streams", st.audio_streams ?? "–"]];
  $("#set-conn").replaceChildren(...kv.flatMap(([k, v]) => [h("b", { text: k }), h("span", { text: String(v) })]));
}
tbind("#set-devrefresh", () => loadDevices());
async function loadDevices() {
  const r = await cmd("devices.list", {}, { quiet: true });
  if (!r.ok) return;
  $("#set-devices").replaceChildren(...r.data.devices.map((d) => h("div", { class: "item" },
    h("span", { class: "grow" }, d.name + (d.id === r.data.self ? " (dieses Gerät)" : ""), h("div", { class: "sub", text: "Zuletzt: " + new Date(d.last_seen * 1000).toLocaleString("de-DE") + (d.revoked ? " · widerrufen" : "") })),
    d.revoked ? null : h("button", { class: "tog small danger", text: "Widerrufen", onclick: async () => {
      if (!confirm(`Zugriff für „${d.name}“ widerrufen?`)) return;
      await cmd("devices.revoke", { id: d.id }); loadDevices();
    } }))));
}
tbind("#set-logout", () => { if (confirm("Dieses Gerät abmelden? Danach ist eine neue Kopplung nötig.")) { store.del("token"); if (Conn.ws) Conn.ws.close(); showPair(); } });
$("#opt-meters").addEventListener("change", () => scheduleMeters());

/* ------------------------------------------------------------------ */
/* Start                                                                */
/* ------------------------------------------------------------------ */
Mon.init();
showTab(currentTab);
renderStatus();
Conn.connect();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && (!Conn.ws || Conn.ws.readyState > 1)) { Conn.retry = 0; Conn.connect(); }
});
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("/sw.js").catch(() => {});
