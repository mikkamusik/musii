/* MöbelFit – App */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const params = new URLSearchParams(location.search);
  const RENDER = params.get("render");
  const reduceMotion = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const PHOTOS = window.HOME_PHOTOS || {};
  const DAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
  const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
  const now = () => new Date();
  const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const fmtTime = (s) => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
  const levelDots = (n) => `<span class="lvl" aria-label="Level ${n} von 3">${[1, 2, 3].map((i) => `<i class="${i <= n ? "on" : ""}"></i>`).join("")}</span>`;
  const LEVEL = ["", "Einsteiger", "Mittel", "Fortgeschritten"];

  /* ---------- Speicher: Browser + (falls vorhanden) privates Claude-db ---------- */
  const Store = {
    data: { entries: [], advent: [] },
    ref: null, migrated: false,
    load() {
      try { const raw = localStorage.getItem("moebelfit.v1"); if (raw) Object.assign(this.data, JSON.parse(raw)); } catch (e) { /* leer */ }
    },
    saveLocal() { try { localStorage.setItem("moebelfit.v1", JSON.stringify(this.data)); } catch (e) { /* ignorieren */ } },
    async connect() {
      try {
        if (!window.claude || !window.claude.use) return;
        const [db, user] = await Promise.all([window.claude.use("db"), window.claude.use("user")]);
        if (!db || !user) return;
        const id = await user.id();
        if (!id) return;
        this.ref = db.doc("data/users/" + id + "/moebelfit");
        this.ref.onSnapshot((snap) => {
          const remote = snap.exists ? snap.data() : { entries: [], advent: [] };
          const changed = this.merge(remote);
          if (changed.local) { this.saveLocal(); refresh(); }
          if (changed.remoteMissing && !this.migrated && !snap.metadata.fromCache) {
            this.migrated = true;
            setTimeout(() => this.push(), 400);
          }
        }, () => { this.ref = null; });
      } catch (e) { this.ref = null; }
    },
    merge(remote) {
      const ids = new Set(this.data.entries.map((e) => e.id));
      const rids = new Set((remote.entries || []).map((e) => e.id));
      let local = false;
      (remote.entries || []).forEach((e) => { if (!ids.has(e.id)) { this.data.entries.push(e); local = true; } });
      (remote.advent || []).forEach((d) => { if (!this.data.advent.includes(d)) { this.data.advent.push(d); local = true; } });
      const remoteMissing = this.data.entries.some((e) => !rids.has(e.id)) || this.data.advent.some((d) => !(remote.advent || []).includes(d));
      this.data.entries.sort((a, b) => a.date.localeCompare(b.date));
      return { local, remoteMissing };
    },
    async push() {
      if (!this.ref) return;
      try { await this.ref.set({ entries: this.data.entries.slice(-400), advent: this.data.advent, v: 1 }); } catch (e) { /* offline */ }
    },
    async addEntry(entry) {
      this.data.entries.push(entry);
      this.data.entries = this.data.entries.slice(-400);
      this.saveLocal(); refresh(); await this.push();
    },
    async toggleAdvent(day) {
      const a = this.data.advent;
      const i = a.indexOf(day);
      if (i >= 0) a.splice(i, 1); else a.push(day);
      this.saveLocal(); refresh(); await this.push();
    },
  };

  /* ---------- Animierte Bühnen ---------- */
  const Anim = {
    visible: new Set(),
    io: "IntersectionObserver" in window ? new IntersectionObserver((ents) => {
      ents.forEach((e) => { if (e.isIntersecting) Anim.visible.add(e.target); else Anim.visible.delete(e.target); });
    }, { rootMargin: "60px" }) : null,
    last: 0,
    draw(svg, t) {
      const ex = EX[svg.dataset.ex];
      if (!ex) return;
      const inner = staticStage(ex) + sceneSVG(ex, t + (+svg.dataset.off || 0));
      svg.innerHTML = svg.dataset.mirror === "1" ? `<g transform="translate(400 0) scale(-1 1)">${inner}</g>` : inner;
    },
    restTime(ex) { const P = prepAnim(ex); return P.move[0] + P.hold[0] * 0.5; },
    scan(root) {
      $$("svg.stage[data-ex]", root).forEach((svg, i) => {
        if (!svg.dataset.off) svg.dataset.off = String((i * 0.37) % 2);
        this.draw(svg, this.restTime(EX[svg.dataset.ex]));
        if (!reduceMotion) { if (this.io) this.io.observe(svg); else this.visible.add(svg); }
      });
    },
    tick(ts) {
      if (ts - Anim.last > 33) {
        Anim.last = ts;
        Anim.visible.forEach((svg) => { if (!svg.isConnected) { Anim.visible.delete(svg); return; } Anim.draw(svg, ts / 1000); });
      }
      requestAnimationFrame(Anim.tick);
    },
  };
  const stage = (exId, extra = "") => `<svg class="stage" viewBox="0 0 400 300" data-ex="${exId}" ${extra} role="img" aria-label="Animation: ${esc(EX[exId].name)}"></svg>`;

  /* ---------- Icons für Geräte (falls kein Foto) ---------- */
  const ICON = {
    stuhl: '<path d="M15 6v36M15 26h20v16M15 26h20" /><path d="M15 6h4v20"/>',
    sofa: '<path d="M6 36V20a4 4 0 0 1 8 0v6h20v-6a4 4 0 0 1 8 0v16zM14 26V14h20v12M9 36v4M39 36v4"/>',
    kueche: '<path d="M4 18h40M7 18v24h34V18M24 18v24M18 26v6M30 26v6M32 6v12M28 10h8"/>',
    wand: '<path d="M8 6v36M8 42h34M14 12h22M14 20h22M14 28h22M14 36h22"/>',
    handtuch: '<path d="M10 14h28v24H10zM10 20h28M10 32h28M18 14v24M30 14v24"/>',
    kissen: '<path d="M8 14q16-6 32 0q-4 10 0 20q-16 6-32 0q4-10 0-20z"/><path d="M28 12v24"/>',
    hantel: '<path d="M6 18v12M11 14v20M37 14v20M42 18v12M11 24h26"/>',
    baender: '<path d="M8 10q30 4 8 16t24 12"/><path d="M6 8h6v6H6zM36 36h6v6h-6z"/>',
    griffe: '<path d="M6 40q8-18 16 0M26 40q8-18 16 0M10 26h8M30 26h8"/>',
    seil: '<path d="M14 8v10M34 8v10M14 18q10 30 20 0"/>',
    boden: '<path d="M4 16h40M4 26h40M4 36h40M14 16v10M30 26v10M22 36v8M36 6v10"/>',
    dart: '<circle cx="24" cy="24" r="17"/><circle cx="24" cy="24" r="10"/><circle cx="24" cy="24" r="3"/>',
    advent: '<path d="M8 8h32v32H8zM8 18h32M8 29h32M19 8v10M30 18v11M22 29v11"/>',
  };
  const equipVisual = (key) => {
    const ph = PHOTOS[EQUIP[key].photo];
    return ph ? `<img src="${ph}" alt="Dein ${esc(EQUIP[key].name)}" loading="lazy">`
      : `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[key]}</svg>`;
  };

  /* ---------- Workouts ---------- */
  const TL = {};
  const timeline = (w) => (TL[w.id] = TL[w.id] || buildTimeline(w));
  const workEquip = (w) => Array.from(new Set(w.items.flatMap(([id]) => EX[id].equip)));
  const exCount = (w) => new Set(w.items.map(([id]) => id)).size;
  const RECO = ["erster-schritt", "stuhl-zirkel", "kuechen-kraft", "sofa-po", "band-hantel", "sieben-minuten", "wohnzimmer-hiit"];
  const kcalOf = (segs) => Math.round(segs.reduce((s, g) => s + (g.kind === "work" ? (g.ex.met || 4) : 2) * 1.225 * (g.done ?? g.dur) / 60, 0));

  /* ---------- Statistik ---------- */
  function weekInfo() {
    const d = now();
    const dow = (d.getDay() + 6) % 7; // Mo = 0
    const mon = new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow);
    const days = [];
    for (let i = 0; i < 7; i++) days.push(new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + i));
    const keys = days.map(dayKey);
    const ents = Store.data.entries.filter((e) => keys.includes(e.date.slice(0, 10)));
    const set = new Set(Store.data.entries.map((e) => e.date.slice(0, 10)));
    let streak = 0;
    const c = new Date(d);
    if (!set.has(dayKey(c))) c.setDate(c.getDate() - 1);
    while (set.has(dayKey(c))) { streak++; c.setDate(c.getDate() - 1); }
    const onejan = new Date(d.getFullYear(), 0, 4);
    const kw = 1 + Math.round(((mon - onejan) / 864e5 + ((onejan.getDay() + 6) % 7)) / 7);
    return { days, keys, ents, streak, kw, mins: Math.round(ents.reduce((s, e) => s + e.secs, 0) / 60), active: new Set(ents.map((e) => e.date.slice(0, 10))) };
  }

  /* ---------- Ansicht: Start ---------- */
  const HERO = [
    ["chair-dips", "Stuhl-Dips · dein weißer Stuhl"],
    ["hip-thrust", "Hip Thrust · dein graues Sofa"],
    ["counter-pushup", "Liegestütz · deine Küchenzeile"],
    ["band-row", "Rudern · Band mit Türanker"],
    ["towel-mountain", "Bergsteiger · Geschirrtuch auf Holz"],
    ["jump-rope", "Seilspringen · dein Springseil"],
  ];
  let heroIdx = 0;

  function renderStart() {
    const d = now();
    const w = WO[RECO[d.getDay()]];
    const tl = timeline(w);
    const wk = weekInfo();
    const inv = Object.keys(EQUIP).filter((k) => k !== "advent");
    const dec1 = new Date(d.getFullYear(), 11, 1);
    const daysToAdvent = Math.ceil((dec1 - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
    const inDec = d.getMonth() === 11 && d.getDate() <= 24;
    $("#v-start").innerHTML = `
      <div class="hero">
        <div class="eyebrow">Aus 6 Fotos deiner Wohnung</div>
        <h1>Dein Wohnzimmer <em>ist dein Gym</em></h1>
        <p class="lead">${inv.length + 1} Dinge aus deinen Bildern werden zu Trainingsgeräten: Stühle, Sofa, Küchenzeile, Handtuch, Kissen und dein Equipment vom Boden. Dazu ${EXERCISES.length} Übungen, ${WORKOUTS.length} Video-Workouts, Dart-Roulette und ein Fit-Adventskalender.</p>
        <div class="hero-stage">${stage(HERO[heroIdx][0], 'id="hero-stage"')}<span class="tag" id="hero-tag">${HERO[heroIdx][1]}</span></div>
        <div class="today">
          <div><div class="t1">Heute, ${DAYS[d.getDay()]}</div><div class="t2">${esc(w.title)}</div>
          <div class="t3">${Math.round(tl.total / 60)} Min · ${LEVEL[w.level]} · ${exCount(w)} Übungen</div></div>
          <button class="btn play" data-play="${w.id}" aria-label="${esc(w.title)} als Video starten"><svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M8 5v14l11-7z"/></svg></button>
        </div>
      </div>
      <section class="sec">
        <div class="sec-head"><h2>Deine Woche</h2><span class="muted">KW ${wk.kw}</span></div>
        <div class="stats">
          <div class="stat"><div class="v">${wk.ents.length}</div><div class="k">Workouts</div></div>
          <div class="stat"><div class="v">${wk.mins}</div><div class="k">Minuten</div></div>
          <div class="stat"><div class="v">${wk.streak}</div><div class="k">Tage in Folge</div></div>
        </div>
        <div class="week">${wk.days.map((x, i) => `<div class="d ${wk.active.has(wk.keys[i]) ? "on" : ""} ${wk.keys[i] === dayKey(d) ? "today-d" : ""}"><span class="dot">${wk.active.has(wk.keys[i]) ? "✓" : x.getDate()}</span>${["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"][i]}</div>`).join("")}</div>
        ${wk.ents.length ? "" : `<p class="muted">Noch kein Workout diese Woche. Der Vorschlag oben dauert ${Math.round(tl.total / 60)} Minuten, danach ist der erste Punkt grün.</p>`}
      </section>
      <section class="sec">
        <div class="sec-head"><h2>Dein Gym</h2><span class="muted">Tippen zeigt die Übungen</span></div>
        <div class="inv">${inv.map((k) => {
          const n = EXERCISES.filter((e) => e.equip.includes(k)).length;
          const go = k === "dart" ? 'data-go="dart"' : k === "advent" ? 'data-go="advent"' : `data-filter="${k}"`;
          return `<button class="item" ${go}><div class="ph">${equipVisual(k)}</div><div class="tx">
            <div class="nm">${esc(EQUIP[k].name)}<span>${esc(EQUIP[k].count)}</span></div>
            <div class="nt">${esc(EQUIP[k].note)}</div>
            <div class="cnt">${k === "dart" ? "Spiel" : k === "advent" ? "24 Türen" : n + " Übung" + (n === 1 ? "" : "en")}</div></div></button>`;
        }).join("")}</div>
      </section>
      <button class="teaser" data-go="advent">
        <span class="big num">${inDec ? d.getDate() : daysToAdvent > 0 ? daysToAdvent : "24"}</span>
        <span><b>${inDec ? `Heute öffnet Tür ${d.getDate()}` : daysToAdvent > 0 ? `Tage bis zum Fit-Adventskalender` : "Fit-Adventskalender"}</b><br><span class="muted">Wie der Kalender über deiner Spüle, nur mit Kniebeugen statt Schokolade.</span></span>
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg>
      </button>
      <section class="note">
        <h3>Sicher trainieren zu Hause</h3>
        <ul>
          <li><b>Glastisch:</b> nie draufstützen oder draufsetzen. Er ist nur Ablage für Wasser und Handy.</li>
          <li><b>Stühle:</b> mit der Lehne an die Wand stellen, bevor du dich draufstützt.</li>
          <li><b>Platz schaffen:</b> Shisha, Ladekabel und Kerzen vor dem Training zur Seite.</li>
          <li><b>Schuhe:</b> Für Seilspringen und Burpees Turnschuhe statt Badelatschen.</li>
          <li>Bei Schmerzen abbrechen. Die App ersetzt keine ärztliche Beratung.</li>
        </ul>
      </section>`;
    Anim.scan($("#v-start"));
  }
  setInterval(() => {
    const svg = $("#hero-stage");
    if (!svg || document.hidden || reduceMotion) return;
    heroIdx = (heroIdx + 1) % HERO.length;
    svg.dataset.ex = HERO[heroIdx][0];
    svg.setAttribute("aria-label", "Animation: " + EX[HERO[heroIdx][0]].name);
    $("#hero-tag").textContent = HERO[heroIdx][1];
    Anim.draw(svg, performance.now() / 1000);
  }, 6500);

  /* ---------- Ansicht: Workouts ---------- */
  function renderWorkouts() {
    $("#v-workouts").innerHTML = `
      <section class="sec">
        <div class="sec-head"><h2>Video-Workouts</h2><span class="muted">${WORKOUTS.length} Videos</span></div>
        <p class="muted">Jedes Workout läuft wie ein Video: Vorturner, Timer und Sprachansage. Handy an die Wand lehnen und mitmachen.</p>
      </section>
      <div class="wlist">${WORKOUTS.map((w) => {
        const tl = timeline(w);
        return `<article class="wcard">
          <div class="top-row"><div class="mini">${stage(w.hero)}</div>
          <div class="info"><h3>${esc(w.title)}</h3><p class="muted">${esc(w.sub)}</p>
            <div class="meta"><span class="num">${Math.round(tl.total / 60)} Min</span>${levelDots(w.level)}<span>${exCount(w)} Übungen</span><span>${w.rounds > 1 ? w.rounds + " Runden" : "1 Durchgang"}</span></div>
          </div></div>
          <div class="actions"><button class="btn red" data-play="${w.id}"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>Video starten</button>
            <div class="chips" style="align-self:center">${workEquip(w).map((k) => `<span class="chip">${esc(EQUIP[k].name)}</span>`).join("")}</div></div>
          <details><summary>Ablauf</summary><ol>
            ${w.warmup ? `<li>Marschieren (Aufwärmen) <span class="s">${w.warmup} s</span></li>` : ""}
            ${w.items.map(([id, s]) => `<li><a href="#uebungen" data-ex="${id}">${esc(EX[id].name)}</a> <span class="s">${s} s${EX[id].sides ? " pro Seite" : ""}</span></li>`).join("")}
          </ol><p class="muted" style="padding:0 14px 14px">${w.rounds > 1 ? `${w.rounds} Runden, ${w.rest} s Pause zwischen den Übungen, ${w.roundRest} s zwischen den Runden.` : `${w.rest} s Pause zwischen den Übungen.`}</p></details>
        </article>`;
      }).join("")}</div>`;
    Anim.scan($("#v-workouts"));
  }

  /* ---------- Ansicht: Übungen ---------- */
  let exFilter = "alle";
  try { exFilter = localStorage.getItem("moebelfit.filter") || "alle"; } catch (e) { /* egal */ }
  function renderUebungen() {
    const keys = Object.keys(EQUIP).filter((k) => EXERCISES.some((e) => e.equip.includes(k)));
    if (exFilter !== "alle" && !keys.includes(exFilter)) exFilter = "alle";
    const list = EXERCISES.filter((e) => exFilter === "alle" || e.equip.includes(exFilter));
    $("#v-uebungen").innerHTML = `
      <section class="sec">
        <div class="sec-head"><h2>Übungen</h2><span class="muted">${list.length} von ${EXERCISES.length}</span></div>
        <div class="filters" role="group" aria-label="Nach Gerät filtern">
          <button class="chip" data-f="alle" aria-pressed="${exFilter === "alle"}">Alle</button>
          ${keys.map((k) => `<button class="chip" data-f="${k}" aria-pressed="${exFilter === k}">${esc(EQUIP[k].name)} · ${EXERCISES.filter((e) => e.equip.includes(k)).length}</button>`).join("")}
        </div>
      </section>
      <div class="exgrid">${list.map((e) => `<button class="excard" data-ex="${e.id}">${stage(e.id)}<div class="tx"><div class="nm">${esc(e.name)}</div><div class="mu">${esc(e.muscles)}</div>
        <div class="meta">${levelDots(e.level)}<span>${e.equip.map((k) => EQUIP[k].name).join(" · ")}</span></div></div></button>`).join("")}</div>`;
    Anim.scan($("#v-uebungen"));
  }

  /* ---------- Ansicht: Dart ---------- */
  const dartState = { darts: [] };
  function boardSVG() {
    const R = { dO: 170, dI: 160, tO: 107, tI: 97, ob: 16, b: 6.4 };
    const arc = (r0, r1, a0, a1) => {
      const p = (r, a) => `${(r * Math.cos(a * D2R)).toFixed(2)} ${(r * Math.sin(a * D2R)).toFixed(2)}`;
      return `M${p(r1, a0)} A${r1} ${r1} 0 0 1 ${p(r1, a1)} L${p(r0, a1)} A${r0} ${r0} 0 0 0 ${p(r0, a0)}Z`;
    };
    let s = `<circle r="200" fill="var(--board)"/>`;
    DART_ORDER.forEach((n, i) => {
      const a0 = -90 - 9 + 18 * i, a1 = a0 + 18;
      const single = i % 2 === 0 ? "#1B1C1F" : "#EFE4CC";
      const ring = i % 2 === 0 ? "#C8322D" : "#17784A";
      s += `<path class="seg" data-n="${n}" data-m="2" d="${arc(R.dI, R.dO, a0, a1)}" fill="${ring}"/>`;
      s += `<path class="seg" data-n="${n}" data-m="1" d="${arc(R.tO, R.dI, a0, a1)}" fill="${single}"/>`;
      s += `<path class="seg" data-n="${n}" data-m="3" d="${arc(R.tI, R.tO, a0, a1)}" fill="${ring}"/>`;
      s += `<path class="seg" data-n="${n}" data-m="1" d="${arc(R.ob, R.tI, a0, a1)}" fill="${single}"/>`;
      const la = (a0 + 9) * D2R;
      s += `<text class="lbl" x="${(186 * Math.cos(la)).toFixed(1)}" y="${(186 * Math.sin(la)).toFixed(1)}">${n}</text>`;
    });
    s += `<circle class="seg" data-n="25" data-m="1" r="${R.ob}" fill="#17784A"/><circle class="seg" data-n="50" data-m="1" r="${R.b}" fill="#C8322D"/>`;
    s += `<g stroke="#9C9A93" stroke-width="0.8" fill="none" pointer-events="none"><circle r="${R.dO}"/><circle r="${R.dI}"/><circle r="${R.tO}"/><circle r="${R.tI}"/></g>`;
    s += dartState.darts.filter((d) => d.x !== undefined).map((d) => `<circle class="mark" cx="${d.x.toFixed(1)}" cy="${d.y.toFixed(1)}" r="7"/>`).join("");
    return `<svg class="board" id="board" viewBox="-205 -205 410 410" role="img" aria-label="Dartscheibe zum Antippen">${s}</svg>`;
  }
  function dartTask(n, m) {
    if (n === 0) return { title: "Daneben", ex: "towel-mountain", text: "20 s Bergsteiger", secs: 20 };
    if (n === 50) return { title: "Bullseye!", joker: true, text: "Joker: Streich eine Aufgabe dieser Runde." };
    if (n === 25) return { title: "Bull", ex: "wall-sit", text: "25 s Wandsitzen", secs: 25 };
    const ex = EX[DART_MAP[n]];
    const reps = n * m;
    return { title: (m === 3 ? "T" : m === 2 ? "D" : "") + n, ex: ex.id, reps, text: `${reps} × ${ex.name}${ex.sides ? " pro Seite" : ""}` };
  }
  function renderDart() {
    const ds = dartState.darts;
    const pts = ds.reduce((s, d) => s + (d.n === 50 || d.n === 25 ? d.n : d.n * d.m), 0);
    $("#v-dart").innerHTML = `
      <section class="sec">
        <div class="sec-head"><h2>Dart-Roulette</h2><span class="muted num">${pts} Punkte</span></div>
        <p class="muted">Wirf drei Pfeile auf deine Scheibe und tippe hier an, wo sie stecken. Die Zahl ist deine Wiederholungszahl. Double zählt doppelt, Triple dreifach.</p>
      </section>
      <div class="dartwrap">
        ${boardSVG()}
        <div class="darts">${[0, 1, 2].map((i) => {
          const d = ds[i];
          if (!d) return `<div class="dart empty">Pfeil ${i + 1}<br>tippe auf die Scheibe</div>`;
          const t = dartTask(d.n, d.m);
          return `<button class="dart" ${t.ex ? `data-ex="${t.ex}"` : ""}><div class="sc">${esc(t.title)}</div><div class="ex">${esc(t.ex ? EX[t.ex].name : "Joker")}</div><div class="rp">${esc(t.text)}</div></button>`;
        }).join("")}</div>
        <div class="dart-actions">
          <button class="btn" id="dart-miss" ${ds.length >= 3 ? "disabled" : ""}>Daneben</button>
          <button class="btn ghost" id="dart-undo" ${ds.length ? "" : "disabled"}>Rückgängig</button>
          <button class="btn red" id="dart-play" ${ds.length === 3 ? "" : "disabled"}><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>Runde als Video</button>
          <button class="btn ghost" id="dart-new" ${ds.length ? "" : "disabled"}>Neue Runde</button>
        </div>
        <details class="note"><summary><b>Welche Zahl ist welche Übung?</b></summary>
          <div class="legend">${Array.from({ length: 20 }, (_, i) => i + 1).map((n) => `<div><b>${n}</b><span>${esc(EX[DART_MAP[n]].name)}</span></div>`).join("")}
          <div><b>25</b><span>Bull: Wandsitzen</span></div><div><b>50</b><span>Bullseye: Joker</span></div><div><b>0</b><span>Daneben: Bergsteiger</span></div></div>
        </details>
      </div>`;
  }
  function addDart(n, m, x, y) {
    if (dartState.darts.length >= 3) { toast("Runde voll: starte das Video oder eine neue Runde."); return; }
    dartState.darts.push({ n, m, x, y });
    renderDart();
    const t = dartTask(n, m);
    toast(`${t.title}: ${t.text}`);
  }
  function dartTimeline() {
    const segs = [];
    const tasks = dartState.darts.map((d) => dartTask(d.n, d.m)).filter((t) => t.ex);
    if (!tasks.length) return null;
    segs.push({ kind: "prep", ex: EX[tasks[0].ex], dur: 8 });
    tasks.forEach((t, i) => {
      const ex = EX[t.ex];
      const sides = t.reps && ex.sides ? ["rechts", "links"] : [null];
      sides.forEach((side) => {
        if (segs[segs.length - 1].kind === "work") segs.push({ kind: "rest", ex, dur: 20, side, round: 1 });
        segs.push(t.reps ? { kind: "work", ex, reps: t.reps, dur: Math.max(20, t.reps * 2.5), side, round: 1 } : { kind: "work", ex, dur: t.secs, side, round: 1 });
      });
    });
    return { segs, rounds: 1 };
  }

  /* ---------- Ansicht: Advent ---------- */
  const DOOR_ORDER = [12, 7, 19, 3, 22, 9, 15, 1, 18, 5, 24, 11, 2, 16, 8, 21, 13, 4, 20, 10, 6, 17, 23, 14];
  function doorOpen(day) {
    const d = now();
    return (d.getMonth() === 11 && d.getDate() >= day) || (d.getMonth() === 0 && d.getDate() <= 6);
  }
  function renderAdvent() {
    const d = now();
    const dec1 = new Date(d.getFullYear(), 11, 1);
    const left = Math.ceil((dec1 - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
    const inDec = d.getMonth() === 11;
    const done = Store.data.advent;
    const calPhoto = PHOTOS[EQUIP.advent.photo];
    $("#v-advent").innerHTML = `
      ${calPhoto ? `<div class="adv-photo"><img src="${calPhoto}" alt="Dein Adventskalender über der Spüle"><span>Dein Kalender über der Spüle bekommt einen sportlichen Zwilling.</span></div>` : ""}
      <div class="adv-head"><span class="big">${inDec ? Math.min(d.getDate(), 24) : left > 0 ? left : 24}</span>
        <div><h2>Fit-Adventskalender</h2><p class="muted">${inDec ? `Tür ${Math.min(d.getDate(), 24)} ist offen. ${done.length} von 24 geschafft.` : left > 0 ? `Noch ${left} Tage. Ab 1. Dezember öffnet jeden Tag eine Tür mit einer Übung aus deiner Wohnung.` : "Alle Türen sind offen."}</p></div></div>
      <div class="doors">${DOOR_ORDER.map((n) => {
        const open = doorOpen(n);
        const cls = done.includes(n) ? "done" : open ? "open" : "";
        return `<button class="door ${cls}" data-door="${n}" aria-label="Tür ${n}${open ? "" : ", noch zu"}"><span class="n">${n}</span>${open ? "" : '<span class="lock">zu</span>'}</button>`;
      }).join("")}</div>
      <section class="note"><h3>So funktioniert's</h3><ul>
        <li>Jeden Tag eine Tür, wie bei deinem Kalender über der Spüle.</li>
        <li>An Wochenenden wartet ein ganzes Video-Workout.</li>
        <li>Erledigte Türen werden grün und zählen in deiner Woche.</li>
      </ul></section>`;
  }
  function openDoor(n) {
    if (!doorOpen(n)) {
      const d = new Date(now().getFullYear(), 11, n);
      toast(`Tür ${n} öffnet am ${DAYS[d.getDay()]}, ${n}. Dezember.`);
      return;
    }
    const a = ADVENT[n - 1];
    const w = a.workout ? WO[a.workout] : null;
    const ex = w ? EX[w.hero] : EX[a.ex];
    const isDone = Store.data.advent.includes(n);
    openSheet(`
      <div class="bar"><div><div class="eyebrow">Tür ${n} · ${n}. Dezember</div><h2 id="sheet-title">${esc(w ? w.title : ex.name)}</h2><div class="muted">${esc(a.amount)}${a.note ? " · " + esc(a.note) : ""}</div></div>${closeBtn}</div>
      <div class="stagebox">${stage(ex.id)}</div>
      <div class="chips">${(w ? workEquip(w) : ex.equip).map((k) => `<span class="chip">${esc(EQUIP[k].name)}</span>`).join("")}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${w ? `<button class="btn red" data-play="${w.id}">Video starten</button>` : `<button class="btn red" data-try="${ex.id}">Mitmachen</button><button class="btn" data-ex="${ex.id}">Anleitung</button>`}
        <button class="btn ghost" data-advent-done="${n}">${isDone ? "Doch nicht erledigt" : "Als erledigt markieren"}</button>
      </div>`);
  }

  /* ---------- Sheet ---------- */
  const closeBtn = `<button class="iconbtn" data-close aria-label="Schließen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`;
  let lastFocus = null;
  function openSheet(html) {
    lastFocus = document.activeElement;
    const p = $("#sheet-panel");
    p.innerHTML = html;
    $("#sheet").hidden = false;
    Anim.scan(p);
    const c = $("[data-close]", p);
    if (c) c.focus();
  }
  function closeSheet() { $("#sheet").hidden = true; $("#sheet-panel").innerHTML = ""; if (lastFocus && lastFocus.focus) lastFocus.focus(); }
  function openExercise(id) {
    const e = EX[id];
    const inW = WORKOUTS.filter((w) => w.items.some(([x]) => x === id));
    const amount = e.unit === "time" ? `${e.secs} s` : `${e.reps} Wdh.${e.sides ? " pro Seite" : ""}`;
    openSheet(`
      <div class="bar"><div><div class="eyebrow">${e.equip.map((k) => esc(EQUIP[k].name)).join(" · ")}</div><h2 id="sheet-title">${esc(e.name)}</h2>
        <div class="meta">${esc(e.muscles)} ${levelDots(e.level)} <span>${LEVEL[e.level]}</span></div></div>${closeBtn}</div>
      <div class="stagebox">${stage(id)}</div>
      <ol class="steps">${e.steps.map((s) => `<li><span>${esc(s)}</span></li>`).join("")}</ol>
      <div class="tipbox"><b>Tipp:</b> ${esc(e.tip)}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn red" data-try="${id}"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>Mitmachen: ${amount}</button></div>
      ${inW.length ? `<div class="sec"><div class="eyebrow">Kommt vor in</div><div class="chips">${inW.map((w) => `<button class="chip" data-play="${w.id}">▶ ${esc(w.title)}</button>`).join("")}</div></div>` : ""}`);
  }
  function tryTimeline(id) {
    const e = EX[id];
    const segs = [{ kind: "prep", ex: e, dur: 6 }];
    (e.sides ? ["rechts", "links"] : [null]).forEach((side, i) => {
      if (i) segs.push({ kind: "rest", ex: e, dur: 10, side, round: 1 });
      segs.push(e.unit === "time" ? { kind: "work", ex: e, dur: e.secs, side, round: 1 } : { kind: "work", ex: e, reps: e.reps, dur: Math.max(20, e.reps * 2.5), side, round: 1 });
    });
    return { segs, rounds: 1 };
  }

  /* ---------- Toast ---------- */
  let toastT = 0;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2600);
  }

  /* ---------- Video-Player ---------- */
  const Player = {
    tl: null, meta: null, idx: 0, lt: 0, playing: false, voice: true, render: false, raf: 0, lastTs: 0, wake: null, ac: null, spoken: {},
    open(tl, meta, opts = {}) {
      this.tl = tl; this.meta = meta; this.idx = 0; this.lt = 0; this.render = !!opts.render; this.spoken = {}; this.elapsed = 0;
      tl.segs.forEach((s) => { delete s.done; });
      try { this.voice = localStorage.getItem("moebelfit.voice") !== "0"; } catch (e) { this.voice = true; }
      $("#pl-voice").setAttribute("aria-pressed", String(this.voice));
      $("#pl-voice .wave").style.opacity = this.voice ? 1 : 0.15;
      $("#pl-wtitle").textContent = meta.title;
      $("#pl-prog").innerHTML = tl.segs.map((s) => `<i class="${s.kind === "work" ? "" : "rest"}"><b></b></i>`).join("");
      $("#pl-finish").hidden = true; $("#pl-confirm").hidden = true;
      $("#player").hidden = false;
      document.body.style.overflow = "hidden";
      if (!this.render) {
        try { this.ac = this.ac || new (window.AudioContext || window.webkitAudioContext)(); this.ac.resume(); } catch (e) { this.ac = null; }
        try { if (navigator.wakeLock) navigator.wakeLock.request("screen").then((w) => { this.wake = w; }).catch(() => {}); } catch (e) { /* egal */ }
        this.playing = true; this.enter(); this.lastTs = performance.now();
        cancelAnimationFrame(this.raf); this.raf = requestAnimationFrame((t) => this.loop(t));
        $("#pl-play").focus();
      }
      this.paint();
    },
    close() {
      this.playing = false; cancelAnimationFrame(this.raf);
      $("#player").hidden = true; document.body.style.overflow = "";
      try { speechSynthesis.cancel(); } catch (e) { /* egal */ }
      if (this.wake) { this.wake.release().catch(() => {}); this.wake = null; }
    },
    seg() { return this.tl.segs[this.idx]; },
    loop(ts) {
      const dt = Math.min(0.25, (ts - this.lastTs) / 1000); this.lastTs = ts;
      if (this.playing) this.advance(dt);
      this.paint();
      if (!$("#player").hidden) this.raf = requestAnimationFrame((t) => this.loop(t));
    },
    advance(dt) {
      const s = this.seg(); if (!s) return;
      const before = this.lt;
      this.lt += dt; this.elapsed += dt;
      if (!s.reps) {
        const rem0 = s.dur - before, rem1 = s.dur - this.lt;
        [3, 2, 1].forEach((k) => { if (rem0 > k && rem1 <= k) this.beep(660, 0.12); });
        if (s.kind === "work" && s.dur >= 30 && before < s.dur / 2 && this.lt >= s.dur / 2) this.say("Halbzeit.");
        if (this.lt >= s.dur) { s.done = s.dur; this.next(); }
      }
    },
    next() {
      const s = this.seg(); if (s && s.done === undefined) s.done = this.lt;
      if (this.idx >= this.tl.segs.length - 1) { this.finish(); return; }
      this.idx++; this.lt = 0; this.enter();
    },
    prev() {
      if (this.lt > 3 || this.idx === 0) { this.lt = 0; } else { this.idx--; this.lt = 0; }
      this.enter();
    },
    nextWork(from) { for (let i = from + 1; i < this.tl.segs.length; i++) if (this.tl.segs[i].kind === "work") return this.tl.segs[i]; return null; },
    sideWord(side) { return side ? `, ${side === "rechts" ? "rechte" : "linke"} Seite` : ""; },
    enter() {
      const s = this.seg(); if (!s || this.render) return;
      $("#player").classList.toggle("reps", !!s.reps);
      if (this.spoken[this.idx]) return;
      this.spoken[this.idx] = true;
      if (s.kind === "prep") { this.beep(520, 0.2); this.say(`Mach dich bereit. Als Erstes: ${s.ex.name}.`); }
      else if (s.kind === "rest") {
        this.beep(520, 0.3);
        this.say(`${s.roundBreak ? `Runde ${s.round - 1} geschafft. ` : ""}Pause. Als Nächstes: ${s.ex.name}${this.sideWord(s.side)}.`);
      } else {
        this.beep(990, 0.35);
        this.say(s.reps ? `${s.ex.name}${this.sideWord(s.side)}. ${s.reps} Wiederholungen.` : `Los! ${s.ex.name}${this.sideWord(s.side)}.`);
      }
    },
    beep(freq, len) {
      if (!this.ac || this.render) return;
      try {
        const o = this.ac.createOscillator(), g = this.ac.createGain(), t = this.ac.currentTime;
        o.type = "sine"; o.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
        o.connect(g).connect(this.ac.destination); o.start(t); o.stop(t + len + 0.02);
      } catch (e) { /* egal */ }
    },
    say(text) {
      if (!this.voice || this.render || !("speechSynthesis" in window)) return;
      try {
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = "de-DE"; u.rate = 1.03;
        const v = speechSynthesis.getVoices().find((x) => /^de/i.test(x.lang));
        if (v) u.voice = v;
        speechSynthesis.speak(u);
      } catch (e) { /* egal */ }
    },
    toggle() {
      this.playing = !this.playing;
      $("#pl-play").setAttribute("aria-label", this.playing ? "Pause" : "Weiter abspielen");
      $("#pl-play-ico").innerHTML = this.playing ? '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>' : '<path d="M8 5v14l11-7z"/>';
      if (this.ac) this.ac.resume();
    },
    finish() {
      this.playing = false;
      const segs = this.tl.segs;
      const work = segs.filter((s) => s.kind === "work" && s.done !== undefined);
      const secs = Math.round(this.render ? segs.reduce((s, g) => s + g.dur, 0) : this.elapsed);
      const kcal = kcalOf(segs.filter((s) => s.done !== undefined || this.render));
      const box = $("#pl-finish");
      const conf = reduceMotion || this.render ? "" : `<div class="confetti">${Array.from({ length: 40 }, (_, i) => `<i style="left:${(i * 37) % 100}%;background:${["#E2463D", "#2EA368", "#EFE4CC", "#F1F1EE"][i % 4]};animation-delay:${(i % 10) * 0.12}s"></i>`).join("")}</div>`;
      box.innerHTML = `${conf}<div class="box"><div class="eyebrow" style="color:#A4A9B0">${esc(this.meta.title)}</div><h2>Geschafft!</h2>
        <div class="stats"><div class="stat"><div class="v num">${fmtTime(secs)}</div><div class="k">Dauer</div></div>
        <div class="stat"><div class="v num">${work.length || segs.filter((s) => s.kind === "work").length}</div><div class="k">Sätze</div></div>
        <div class="stat"><div class="v num">≈${kcal}</div><div class="k">kcal</div></div></div>
        ${this.render ? `<p style="color:#C9CCD1">Mach mit in der MöbelFit-App.</p>` : `<button class="btn red" id="pl-finish-ok">Fertig</button>`}</div>`;
      box.hidden = false;
      if (!this.render) {
        this.say("Geschafft! Stark gemacht.");
        if (secs >= 20) Store.addEntry({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), wid: this.meta.id, title: this.meta.title, date: new Date().toISOString(), secs, kcal });
        if (this.meta.onDone) this.meta.onDone();
        const ok = $("#pl-finish-ok"); if (ok) ok.focus();
      }
    },
    paint() {
      const s = this.seg(); if (!s) return;
      const segs = this.tl.segs;
      const P = $("#player");
      const remaining = s.reps ? null : Math.max(0, s.dur - this.lt);
      const showEx = s.kind === "work" ? s.ex : (s.kind === "rest" ? s.ex : s.ex);
      const svg = $("#pl-stage");
      const mirror = s.side === "links";
      const inner = staticStage(showEx) + sceneSVG(showEx, s.kind === "work" ? this.lt : this.lt * 0.6);
      svg.innerHTML = mirror ? `<g transform="translate(400 0) scale(-1 1)">${inner}</g>` : inner;
      svg.style.opacity = s.kind === "work" ? 1 : 0.55;
      const badge = $("#pl-badge");
      const kindTxt = s.kind === "work" ? (s.label || (s.reps ? `× ${s.reps}` : "Los")) : s.kind === "rest" ? "Pause" : "Bereit machen";
      if (badge.textContent !== kindTxt) badge.textContent = kindTxt;
      badge.className = "pl-badge " + (s.kind === "work" ? "" : s.kind);
      const side = $("#pl-side");
      side.hidden = !s.side; if (s.side) side.textContent = s.side === "rechts" ? "Rechte Seite" : "Linke Seite";
      const name = s.kind === "work" ? s.ex.name : `Gleich: ${s.ex.name}`;
      if ($("#pl-name").textContent !== name) $("#pl-name").textContent = name;
      const cue = s.kind === "work" ? s.ex.cue : s.kind === "rest" ? (s.roundBreak ? `Runde ${s.round - 1} geschafft. Wasser trinken, gleich geht's weiter.` : "Durchatmen, Position einnehmen.") : `${segs.filter((x) => x.kind === "work").length} Sätze · ${fmtTime(segs.reduce((a, g) => a + (g.reps ? 30 : g.dur), 0))} Min`;
      if ($("#pl-cue").textContent !== cue) $("#pl-cue").textContent = cue;
      const ring = $("#pl-ring");
      ring.className = "pl-ring " + (s.kind === "work" ? "" : s.kind);
      const C = 326.7;
      $("#pl-arc").setAttribute("stroke-dashoffset", s.reps ? "0" : String(C * (1 - remaining / s.dur)));
      const tEl = $("#pl-time");
      const tTxt = s.reps ? fmtTime(this.lt) : String(Math.ceil(remaining - 0.001));
      if (tEl.textContent !== tTxt) tEl.textContent = tTxt;
      tEl.classList.toggle("reps", !!s.reps);
      const works = segs.filter((x) => x.kind === "work");
      const wi = segs.slice(0, this.idx + 1).filter((x) => x.kind === "work").length;
      const sub = `Satz ${Math.max(1, wi)} von ${works.length}${this.tl.rounds > 1 && s.round ? ` · Runde ${Math.max(1, s.round)} von ${this.tl.rounds}` : ""}`;
      if ($("#pl-wsub").textContent !== sub) $("#pl-wsub").textContent = sub;
      const nx = this.nextWork(this.idx);
      const nextTxt = s.kind === "work" ? (nx ? `<span>Als Nächstes:</span> <b>${esc(nx.ex.name)}${nx.side ? " (" + nx.side + ")" : ""}</b>` : "<b>Danach: geschafft!</b>")
        : `<span>${s.reps ? "" : "Dauer:"}</span> <b>${s.kind === "prep" || s.kind === "rest" ? (() => { const w = segs[this.idx + 1]; return w ? (w.reps ? w.reps + " Wiederholungen" : w.dur + " Sekunden") : ""; })() : ""}</b>`;
      const nEl = $("#pl-next");
      if (nEl.dataset.k !== nextTxt) { nEl.innerHTML = nextTxt; nEl.dataset.k = nextTxt; }
      const bars = $$("#pl-prog b");
      segs.forEach((g, i) => {
        const f = i < this.idx ? 1 : i > this.idx ? 0 : (g.reps ? 0.5 : Math.min(1, this.lt / g.dur));
        const w = (f * 100).toFixed(1) + "%";
        if (bars[i] && bars[i].style.width !== w) bars[i].style.width = w;
      });
      P.classList.toggle("reps", !!s.reps && !this.render);
    },
    setTime(T) { // nur Render-Modus
      const segs = this.tl.segs;
      const total = segs.reduce((a, g) => a + g.dur, 0);
      if (T >= total) {
        this.idx = segs.length - 1; this.lt = segs[this.idx].dur;
        if ($("#pl-finish").hidden) this.finish();
        return;
      }
      $("#pl-finish").hidden = true;
      let acc = 0;
      for (let i = 0; i < segs.length; i++) {
        if (T < acc + segs[i].dur) { this.idx = i; this.lt = T - acc; break; }
        acc += segs[i].dur;
      }
      this.paint();
    },
  };

  function playWorkout(id) {
    const w = WO[id];
    Player.open(timeline(w), { id: w.id, title: w.title });
  }

  /* ---------- Router & Events ---------- */
  const VIEWS = ["start", "workouts", "uebungen", "dart", "advent"];
  let current = "start";
  function show(v) {
    if (!VIEWS.includes(v)) v = "start";
    if (!$("#sheet").hidden) closeSheet();
    current = v;
    VIEWS.forEach((x) => { $("#v-" + x).hidden = x !== v; });
    $$(".tabs button").forEach((b) => { if (b.dataset.view === v) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
    ({ start: renderStart, workouts: renderWorkouts, uebungen: renderUebungen, dart: renderDart, advent: renderAdvent })[v]();
  }
  function go(v) {
    if (location.hash !== "#" + v) location.hash = v; else show(v);
    window.scrollTo(0, 0);
  }
  function refresh() { if (!RENDER) show(current); }

  document.addEventListener("click", (ev) => {
    const t = ev.target.closest("button, a, [data-close]");
    if (!t) {
      if (ev.target === $("#sheet")) closeSheet();
      return;
    }
    if (t.closest(".tabs") && t.dataset.view) { go(t.dataset.view); return; }
    if (t.hasAttribute("data-close")) { closeSheet(); return; }
    if (t.dataset.play) { ev.preventDefault(); closeSheet(); playWorkout(t.dataset.play); return; }
    if (t.dataset.try) { const e = EX[t.dataset.try]; closeSheet(); Player.open(tryTimeline(e.id), { id: "ex:" + e.id, title: e.name }); return; }
    if (t.dataset.adventDone) { const n = +t.dataset.adventDone; Store.toggleAdvent(n); closeSheet(); toast(Store.data.advent.includes(n) ? `Tür ${n} erledigt. Stark!` : `Tür ${n} wieder offen.`); return; }
    if (t.dataset.go) { go(t.dataset.go); return; }
    if (t.dataset.filter) { exFilter = t.dataset.filter; try { localStorage.setItem("moebelfit.filter", exFilter); } catch (e) { /* egal */ } go("uebungen"); return; }
    if (t.dataset.f) { exFilter = t.dataset.f; try { localStorage.setItem("moebelfit.filter", exFilter); } catch (e) { /* egal */ } renderUebungen(); return; }
    if (t.dataset.door) { openDoor(+t.dataset.door); return; }
    if (t.dataset.ex) { ev.preventDefault(); openExercise(t.dataset.ex); return; }
    switch (t.id) {
      case "dart-miss": addDart(0, 1); break;
      case "dart-undo": dartState.darts.pop(); renderDart(); break;
      case "dart-new": dartState.darts = []; renderDart(); break;
      case "dart-play": { const tl = dartTimeline(); if (tl) Player.open(tl, { id: "dart", title: "Dart-Roulette", onDone: () => { dartState.darts = []; } }); else toast("Nur Joker getroffen: heute frei!"); break; }
      case "pl-play": Player.toggle(); break;
      case "pl-nextbtn": Player.next(); break;
      case "pl-prev": Player.prev(); break;
      case "pl-done": Player.next(); break;
      case "pl-voice": {
        Player.voice = !Player.voice;
        try { localStorage.setItem("moebelfit.voice", Player.voice ? "1" : "0"); } catch (e) { /* egal */ }
        t.setAttribute("aria-pressed", String(Player.voice)); $("#pl-voice .wave").style.opacity = Player.voice ? 1 : 0.15;
        if (!Player.voice) try { speechSynthesis.cancel(); } catch (e) { /* egal */ }
        break;
      }
      case "pl-close": if ($("#pl-finish").hidden) { Player.wasPlaying = Player.playing; Player.playing = false; $("#pl-confirm").hidden = false; $("#pl-stay").focus(); } else Player.close(); break;
      case "pl-stay": $("#pl-confirm").hidden = true; Player.playing = Player.wasPlaying; break;
      case "pl-quit": Player.close(); break;
      case "pl-finish-ok": Player.close(); refresh(); break;
    }
  });
  document.addEventListener("pointerdown", (ev) => {
    const seg = ev.target.closest && ev.target.closest("#board .seg");
    if (!seg) return;
    const svg = $("#board");
    const pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    addDart(+seg.dataset.n, +seg.dataset.m, p.x, p.y);
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      if (!$("#player").hidden) { if (!$("#pl-confirm").hidden) { $("#pl-confirm").hidden = true; Player.playing = Player.wasPlaying; } else $("#pl-close").click(); ev.preventDefault(); }
      else if (!$("#sheet").hidden) { closeSheet(); ev.preventDefault(); }
    }
    if (ev.key === " " && !$("#player").hidden && ev.target === document.body) { Player.toggle(); ev.preventDefault(); }
  });
  window.addEventListener("hashchange", () => show(location.hash.slice(1)));
  document.addEventListener("visibilitychange", () => { if (document.hidden && Player.playing && !$("#player").hidden) Player.toggle(); });

  /* ---------- Start ---------- */
  const d0 = now();
  $("#today-date").textContent = `${DAYS[d0.getDay()]}, ${d0.getDate()}. ${MONTHS[d0.getMonth()]}`;
  if (RENDER) {
    document.body.classList.add("render");
    let tl, meta;
    if (RENDER === "bibliothek") {
      const segs = EXERCISES.map((e) => ({ kind: "work", ex: e, dur: 6, round: 1 }));
      tl = { segs, rounds: 1 }; meta = { id: "bibliothek", title: "Übungs-Bibliothek" };
    } else if (RENDER.startsWith("ex:")) {
      tl = tryTimeline(RENDER.slice(3)); meta = { id: RENDER, title: EX[RENDER.slice(3)].name };
    } else {
      const w = WO[RENDER]; tl = timeline(w); meta = { id: w.id, title: w.title };
    }
    tl.segs.forEach((s) => { if (s.reps) { delete s.reps; } });
    Player.open(tl, meta, { render: true });
    window.__render = { total: tl.segs.reduce((a, g) => a + g.dur, 0), setTime: (T) => Player.setTime(T), segs: tl.segs.map((s) => ({ kind: s.kind, dur: s.dur })) };
  } else {
    Store.load();
    show(location.hash.slice(1) || "start");
    requestAnimationFrame(Anim.tick);
    Store.connect();
  }
})();
