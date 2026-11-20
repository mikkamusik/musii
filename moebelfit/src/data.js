/* MöbelFit – Inventar, Übungen, Workouts, Adventskalender, Dart-Belegung. */

const EQUIP = {
  stuhl:   { name: "Esszimmerstuhl", count: "4×", note: "weiß gepolstert, Holzbeine: Lehne immer an die Wand", photo: "chair" },
  sofa:    { name: "Sofa", count: "1×", note: "grau und standfest: perfekt für Po und Bauch", photo: "sofa" },
  kueche:  { name: "Küchenzeile", count: "2×", note: "Arbeitsplatte, fest verbaut: deine stabilste Stütze", photo: "counter" },
  wand:    { name: "Freie Wand", count: "", note: "neben dem Esstisch, unter der Dartscheibe", photo: "wall" },
  handtuch:{ name: "Geschirrtuch", count: "", note: "gleitet auf deinem Holzboden wie ein Slider", photo: "towel" },
  kissen:  { name: "Kissen", count: "", note: "lila gestreift: Polster und Squeeze-Ball", photo: "pillow" },
  hantel:  { name: "Kurzhantel", count: "1×", note: "einarmig oder als Goblet mit beiden Händen", photo: "dumbbell" },
  baender: { name: "Widerstandsbänder", count: "3×", note: "rot, blau, schwarz, mit Griffen und Türanker", photo: "bands" },
  griffe:  { name: "Liegestützgriffe", count: "2×", note: "schonen die Handgelenke, mehr Bewegungsweg", photo: "bars" },
  seil:    { name: "Springseil", count: "1×", note: "Cardio im langen Wohnraum", photo: "rope" },
  boden:   { name: "Holzboden", count: "", note: "lange Bahn vom Esstisch bis zum Fenster", photo: "floor" },
  dart:    { name: "Dartscheibe", count: "1×", note: "Dart-Roulette: dein Treffer bestimmt die Wiederholungen", photo: "dart" },
  advent:  { name: "Adventskalender", count: "24", note: "Fit-Adventskalender ab 1. Dezember", photo: "advent" },
};

const L = (x, y) => [x, y];

const EXERCISES = [
  /* ---------- Stuhl ---------- */
  {
    id: "chair-squat", name: "Stuhl-Kniebeuge", equip: ["stuhl"], muscles: "Beine · Po", level: 1, met: 5,
    unit: "reps", reps: 15,
    steps: ["Stell dich mit dem Rücken vor einen deiner weißen Stühle, Füße hüftbreit.",
      "Po nach hinten schieben, bis er die Sitzfläche nur antippt. Nicht hinsetzen.",
      "Über die Fersen kraftvoll hochdrücken, Arme gehen mit nach vorn."],
    tip: "Stuhllehne an die Wand stellen, dann rutscht nichts weg.",
    cue: "Po zum Stuhl, antippen, hoch.",
    props: [{ type: "wall", x: 130, flip: true }, { type: "chair", x: 170 }],
    anim: {
      keys: [
        { hip: L(216, 158), t: 2, f: L(222, 246), h: L(220, 163) },
        { hip: L(195, 188), t: 38, f: L(222, 246), h: L(292, 140) },
      ], move: [1.0, 0.9], hold: [0.3, 0.15],
    },
  },
  {
    id: "chair-dips", name: "Stuhl-Dips", equip: ["stuhl", "wand"], muscles: "Trizeps · Schultern", level: 2, met: 5,
    unit: "reps", reps: 10,
    steps: ["Stuhl mit der Lehne fest an die Wand. Hände an die vordere Sitzkante, Finger nach vorn.",
      "Po vor den Stuhl, Beine angewinkelt (leichter) oder gestreckt (schwerer).",
      "Ellbogen nach hinten beugen bis etwa 90°, dann wieder hochdrücken."],
    tip: "Die Polsterstühle haben Holzbeine: nur mit Wandkontakt benutzen.",
    cue: "Ellbogen nach hinten, Schultern weg von den Ohren.",
    props: [{ type: "wall", x: 122, flip: true }, { type: "chair", x: 150 }],
    anim: {
      keys: [
        { hip: L(187, 189), sh: L(180, 127), f: L(250, 246), h: L(172, 194) },
        { hip: L(192, 222), sh: L(186, 160), f: L(250, 246), h: L(172, 194) },
      ], move: [1.0, 0.8], hold: [0.25, 0.1],
    },
  },
  {
    id: "decline-pushup", name: "Füße-hoch-Liegestütz", equip: ["stuhl", "boden"], muscles: "Brust · Schultern · Core", level: 3, met: 8,
    unit: "reps", reps: 8,
    steps: ["Füße auf die Sitzfläche eines Stuhls, Hände schulterbreit auf den Boden.",
      "Körper bildet eine Linie von Kopf bis Ferse, Bauch fest.",
      "Brust Richtung Boden senken und kräftig wegdrücken."],
    tip: "Stuhl mit der Lehne an die Wand. Zu schwer? Knie auf den Boden.",
    cue: "Brett-Körper, Brust runter, wegdrücken.",
    props: [{ type: "wall", x: 72, flip: true }, { type: "chair", x: 100 }],
    anim: {
      keys: [
        { ...bodyLine([110, 184], 2.3), f: L(110, 184), ft: 55, h: L(262, 246), hd: -6 },
        { ...bodyLine([110, 184], -10), f: L(110, 184), ft: 55, h: L(262, 246), hd: -6 },
      ], move: [1.0, 0.8], hold: [0.1, 0.25],
    },
  },
  {
    id: "chair-knee-tuck", name: "Stuhl-Knieheben", equip: ["stuhl"], muscles: "Bauch · Hüftbeuger", level: 2, met: 4,
    unit: "reps", reps: 12,
    steps: ["Vorn auf die Stuhlkante setzen, Hände greifen seitlich die Sitzfläche.",
      "Oberkörper leicht zurücklehnen, Beine gestreckt anheben.",
      "Knie zur Brust ziehen und wieder strecken, ohne die Füße abzusetzen."],
    tip: "Rücken lang lassen, nicht in die Lehne fallen.",
    cue: "Knie zur Brust, lang machen.",
    props: [{ type: "wall", x: 100, flip: true }, { type: "chair", x: 150 }],
    anim: {
      keys: [
        { hip: L(170, 186), t: -20, f: L(254, 206), ft: -20, h: L(162, 194) },
        { hip: L(170, 186), t: -30, f: L(204, 188), ft: 10, h: L(162, 194) },
      ], move: [0.8, 0.8], hold: [0.2, 0.2],
    },
  },
  {
    id: "db-row", name: "Einarmiges Rudern", equip: ["stuhl", "hantel"], muscles: "Rücken · Bizeps", level: 2, met: 5,
    unit: "reps", reps: 12, sides: true,
    steps: ["Eine Hand auf die Sitzfläche, Rücken gerade, Knie leicht gebeugt.",
      "Die Kurzhantel hängt locker unter der Schulter.",
      "Ellbogen eng am Körper zur Hüfte ziehen und langsam ablassen."],
    tip: "Nicht mit Schwung arbeiten. Oben kurz die Schulterblätter zusammendrücken.",
    cue: "Ellbogen zur Hüfte, langsam ab.",
    props: [{ type: "chair", x: 290, flip: true }],
    att: ["db"],
    anim: {
      keys: [
        { hip: L(196, 166), t: 68, hd: -12, f: [[228, 246], [180, 246]], h: [[276, 194], [248, 208]] },
        { hip: L(196, 166), t: 68, hd: -12, f: [[228, 246], [180, 246]], h: [[276, 194], [216, 166]] },
      ], move: [0.8, 1.0], hold: [0.35, 0.2],
    },
  },

  /* ---------- Sofa ---------- */
  {
    id: "hip-thrust", name: "Sofa-Hip-Thrust", equip: ["sofa", "hantel"], muscles: "Po · Oberschenkelrückseite", level: 2, met: 5,
    unit: "reps", reps: 15,
    steps: ["Oberer Rücken an die vordere Sofakante, Füße hüftbreit auf dem Boden.",
      "Kurzhantel auf die Hüfte legen und mit beiden Händen festhalten (optional).",
      "Hüfte hochschieben, bis Knie, Hüfte und Schultern eine Linie bilden. Oben den Po anspannen."],
    tip: "Kinn zur Brust, Blick nach vorn. So bleibt der untere Rücken entspannt.",
    cue: "Hüfte hoch, oben Po fest.",
    props: [{ type: "sofa", x: 150 }],
    att: ["dbhip"],
    anim: {
      keys: [
        { hip: L(196, 232), sh: L(146, 196), hd: -6, f: L(262, 246), h: L(194, 218), eb: [-1, -1] },
        { hip: L(208, 190), t: -90, hd: -14, f: L(262, 246), h: L(206, 176), eb: [-1, -1] },
      ], move: [0.9, 1.0], hold: [0.15, 0.45],
    },
  },
  {
    id: "bulgarian", name: "Bulgarische Kniebeuge", equip: ["sofa", "hantel"], muscles: "Beine · Po", level: 3, met: 6,
    unit: "reps", reps: 10, sides: true,
    steps: ["Rücken zum Sofa, ein Fußrücken liegt hinten auf der Sitzfläche.",
      "Der vordere Fuß steht einen großen Schritt vor dem Sofa.",
      "Hinteres Knie Richtung Boden senken und über die vordere Ferse hochdrücken."],
    tip: "Das weiche Sofa ist ideal: Der hintere Fuß rutscht nicht und liegt bequem.",
    cue: "Hinteres Knie runter, vordere Ferse drückt.",
    props: [{ type: "sofa", x: 130 }],
    att: ["db"],
    anim: {
      keys: [
        { hip: L(206, 160), t: 8, f: [[124, 190], [222, 246]], ft: [165, 0], h: L(217, 166) },
        { hip: L(190, 198), t: 14, f: [[124, 190], [222, 246]], ft: [165, 0], h: L(208, 205) },
      ], move: [1.1, 0.9], hold: [0.2, 0.15],
    },
  },
  {
    id: "sofa-situp", name: "Sofa-Sit-up", equip: ["sofa", "kissen"], muscles: "Bauch", level: 2, met: 4,
    unit: "reps", reps: 12,
    steps: ["Rückenlage, Füße unter die Sofakante haken, Knie angewinkelt.",
      "Arme vor der Brust kreuzen.",
      "Wirbel für Wirbel aufrollen und langsam wieder ablegen."],
    tip: "Kissen unter den unteren Rücken, falls der Holzboden drückt.",
    cue: "Aufrollen, langsam ablegen.",
    props: [{ type: "sofa", x: 280, flip: true, front: true }],
    anim: {
      keys: [
        { hip: L(200, 236), t: -84, f: L(276, 243), ft: -40, h: L(160, 224), eb: [-1, -1] },
        { hip: L(200, 236), t: -12, f: L(276, 243), ft: -40, h: L(202, 186), eb: [-1, -1] },
      ], move: [1.1, 1.0], hold: [0.15, 0.2],
    },
  },

  /* ---------- Küchenzeile ---------- */
  {
    id: "counter-pushup", name: "Küchen-Liegestütz", equip: ["kueche"], muscles: "Brust · Trizeps", level: 1, met: 4,
    unit: "reps", reps: 12,
    steps: ["Hände schulterbreit an die Kante der Arbeitsplatte.",
      "Füße nach hinten setzen, bis der Körper schräg und gerade ist.",
      "Brust zur Kante senken und kräftig wegdrücken."],
    tip: "Die Arbeitsplatte ist fest verbaut und damit die sicherste Stütze in deiner Wohnung.",
    cue: "Brust zur Kante, wegdrücken.",
    props: [{ type: "counter", x: 290 }],
    anim: {
      keys: [
        { ...bodyLine([155, 238], 56.9), f: L(155, 238), ft: 40, h: L(290, 152) },
        { ...bodyLine([155, 238], 46), f: L(155, 238), ft: 40, h: L(290, 152) },
      ], move: [0.9, 0.8], hold: [0.15, 0.2],
    },
  },
  {
    id: "calf-raise", name: "Wadenheben", equip: ["kueche"], muscles: "Waden", level: 1, met: 3,
    unit: "reps", reps: 20,
    steps: ["Vor die Küchenzeile stellen, Fingerspitzen auf die Arbeitsplatte.",
      "Auf die Zehenspitzen drücken und oben kurz halten.",
      "Langsam absenken, Fersen tippen nur kurz auf."],
    tip: "Mehr Reiz: einbeinig oder mit der Kurzhantel in der freien Hand.",
    cue: "Hoch auf die Zehen, halten, langsam runter.",
    props: [{ type: "counter", x: 262 }],
    anim: {
      keys: [
        { hip: L(226, 158), t: 7, f: L(228, 246), h: L(262, 152) },
        { hip: L(226, 146), t: 9, f: L(227, 234), ft: 52, h: L(260, 150) },
      ], move: [0.6, 0.8], hold: [0.1, 0.4],
    },
  },
  {
    id: "glute-kickback", name: "Beinheben nach hinten", equip: ["kueche"], muscles: "Po", level: 1, met: 3.5,
    unit: "reps", reps: 15, sides: true,
    steps: ["Hände auf die Arbeitsplatte, Oberkörper leicht nach vorn.",
      "Ein Bein gestreckt nach hinten oben führen.",
      "Bauch bleibt fest, die Bewegung kommt aus dem Po. Kein Hohlkreuz."],
    tip: "Langsam zurück, Fuß nur kurz abstellen.",
    cue: "Bein lang nach hinten, Po fest.",
    props: [{ type: "counter", x: 290 }],
    anim: {
      keys: [
        { hip: L(214, 162), t: 30, f: [[222, 246], [206, 246]], h: L(290, 152) },
        { hip: L(212, 162), t: 34, f: [[222, 246], [128, 198]], ft: [0, 95], h: L(290, 152) },
      ], move: [0.8, 0.8], hold: [0.1, 0.35],
    },
  },

  /* ---------- Wand ---------- */
  {
    id: "wall-sit", name: "Wandsitzen", equip: ["wand"], muscles: "Oberschenkel", level: 1, met: 4,
    unit: "time", secs: 40,
    steps: ["Rücken flach an eine freie Wand lehnen.",
      "Runterrutschen, bis die Knie etwa 90° gebeugt sind.",
      "Halten und ruhig weiteratmen."],
    tip: "Knie bleiben über den Fersen. Hände locker auf den Oberschenkeln.",
    cue: "Halten. Ruhig atmen.",
    props: [{ type: "wall", x: 120, flip: true }],
    anim: {
      keys: [
        { hip: L(134, 198), t: 0, f: L(182, 246), h: L(166, 192) },
        { hip: L(134, 200), t: 0, hd: 3, f: L(182, 246), h: L(167, 194) },
      ], move: [1.6, 1.6], hold: [0.4, 0.4],
    },
  },
  {
    id: "wall-pushup", name: "Wand-Liegestütz", equip: ["wand"], muscles: "Brust · Schultern", level: 1, met: 3.5,
    unit: "reps", reps: 15,
    steps: ["Eine Armlänge vor der Wand stehen, Hände auf Schulterhöhe an die Wand.",
      "Füße einen Schritt zurück, Körper gerade.",
      "Brust zur Wand beugen und wegdrücken."],
    tip: "Der perfekte Einstieg. Je weiter die Füße weg sind, desto schwerer.",
    cue: "Brust zur Wand, wegdrücken.",
    props: [{ type: "wall", x: 300 }],
    anim: {
      keys: [
        { ...bodyLine([190, 238], 72.9), f: L(190, 238), ft: 40, h: L(298, 118) },
        { ...bodyLine([190, 238], 64), f: L(190, 238), ft: 40, h: L(298, 118) },
      ], move: [0.8, 0.8], hold: [0.15, 0.2],
    },
  },

  /* ---------- Handtuch auf Holzboden ---------- */
  {
    id: "towel-mountain", name: "Handtuch-Bergsteiger", equip: ["handtuch", "boden"], muscles: "Core · Cardio", level: 2, met: 8,
    unit: "time", secs: 30,
    steps: ["Geschirrtuch unter die Fußspitzen, Hände unter die Schultern.",
      "Abwechselnd ein Knie Richtung Brust gleiten lassen.",
      "Hüfte bleibt tief, Tempo hoch."],
    tip: "Funktioniert auf deinem Holzboden perfekt, auf Teppich nicht.",
    cue: "Knie zur Brust, gleiten, Tempo.",
    props: [],
    att: ["towel"],
    anim: {
      keys: [
        { hip: L(210, 203), sh: L(274, 180), f: [[222, 238], [130, 240]], ft: [40, 60], h: L(276, 246) },
        { hip: L(210, 203), sh: L(274, 180), f: [[128, 240], [224, 238]], ft: [60, 40], h: L(276, 246) },
      ], move: [0.38, 0.38], hold: [0.04, 0.04],
    },
  },
  {
    id: "towel-curl", name: "Handtuch-Beincurl", equip: ["handtuch", "boden"], muscles: "Oberschenkelrückseite · Po", level: 2, met: 4,
    unit: "reps", reps: 10,
    steps: ["Rückenlage, Fersen auf dem Handtuch, Beine lang.",
      "Hüfte anheben.",
      "Fersen zum Po ziehen und wieder wegschieben. Die Hüfte bleibt oben."],
    tip: "Langsam wegschieben, da passiert die Arbeit.",
    cue: "Hüfte oben, Fersen ran, lang machen.",
    props: [],
    att: ["towelheel"],
    anim: {
      keys: [
        { hip: L(180, 230), sh: L(118, 238), f: L(268, 240), ft: -75, h: L(186, 244), eb: [-1, -1] },
        { hip: L(188, 198), sh: L(134, 232), f: L(232, 240), ft: -60, h: L(196, 244), eb: [-1, -1] },
      ], move: [1.0, 1.2], hold: [0.15, 0.15],
    },
  },
  {
    id: "towel-lunge", name: "Gleitender Ausfallschritt", equip: ["handtuch", "boden"], muscles: "Beine · Po", level: 2, met: 5,
    unit: "reps", reps: 10, sides: true,
    steps: ["Ein Fuß steht auf dem Geschirrtuch, Hände in die Hüfte.",
      "Den Handtuch-Fuß nach hinten gleiten lassen und tief in den Ausfallschritt gehen.",
      "Über die vordere Ferse zurückziehen."],
    tip: "Vorderes Knie bleibt über dem Fuß.",
    cue: "Nach hinten gleiten, tief, zurück.",
    props: [],
    att: ["towelrear"],
    anim: {
      keys: [
        { hip: L(226, 157), t: 4, f: [[224, 246], [232, 246]], h: L(234, 148) },
        { hip: L(200, 198), t: 6, f: [[138, 240], [232, 246]], ft: [40, 0], h: L(208, 189) },
      ], move: [1.0, 0.9], hold: [0.15, 0.2],
    },
  },

  /* ---------- Kissen ---------- */
  {
    id: "pillow-bridge", name: "Kissen-Brücke", equip: ["kissen", "boden"], muscles: "Po · Innenschenkel", level: 1, met: 3.5,
    unit: "reps", reps: 15,
    steps: ["Rückenlage, Kissen zwischen die Knie klemmen.",
      "Füße hüftbreit aufstellen.",
      "Hüfte hoch, Kissen fest zusammendrücken, oben 2 Sekunden halten."],
    tip: "Ideal nach einem langen Tag am Laptop.",
    cue: "Hüfte hoch, Kissen drücken.",
    props: [],
    att: ["pillow"],
    anim: {
      keys: [
        { hip: L(182, 234), sh: L(120, 238), f: L(252, 246), h: L(178, 244), eb: [-1, -1] },
        { hip: L(196, 196), sh: L(140, 232), f: L(252, 246), h: L(190, 244), eb: [-1, -1] },
      ], move: [0.9, 0.9], hold: [0.15, 0.6],
    },
  },

  /* ---------- Kurzhantel ---------- */
  {
    id: "goblet-squat", name: "Goblet Squat", equip: ["hantel"], muscles: "Beine · Po · Core", level: 2, met: 5.5,
    unit: "reps", reps: 12,
    steps: ["Kurzhantel senkrecht vor der Brust halten, Füße etwas breiter als hüftbreit.",
      "Tief in die Hocke, Ellbogen zwischen die Knie.",
      "Brust bleibt oben, kraftvoll hochdrücken."],
    tip: "Fersen bleiben am Boden. Ein Buch unter den Fersen hilft bei steifen Waden.",
    cue: "Brust raus, tief, hoch.",
    props: [],
    att: ["dbv"],
    anim: {
      keys: [
        { hip: L(214, 157), t: 4, f: L(222, 246), h: L(232, 112) },
        { hip: L(186, 200), t: 32, f: L(222, 246), h: L(236, 160) },
      ], move: [1.1, 0.9], hold: [0.25, 0.15],
    },
  },
  {
    id: "db-press", name: "Schulterdrücken", equip: ["hantel"], muscles: "Schultern · Trizeps", level: 2, met: 4,
    unit: "reps", reps: 10, sides: true,
    steps: ["Aufrecht stehen, Kurzhantel auf Schulterhöhe.",
      "Bauch und Po anspannen.",
      "Die Hantel senkrecht nach oben drücken und kontrolliert zurückführen."],
    tip: "Nicht ins Hohlkreuz fallen, Rippen bleiben unten.",
    cue: "Nach oben drücken, Bauch fest.",
    props: [],
    att: ["db"],
    anim: {
      keys: [
        { hip: L(212, 158), t: 2, f: [[206, 246], [218, 246]], h: [[220, 152], [228, 92]] },
        { hip: L(212, 158), t: 0, f: [[206, 246], [218, 246]], h: [[220, 152], [220, 30]] },
      ], move: [0.9, 1.0], hold: [0.2, 0.2],
    },
  },

  /* ---------- Widerstandsbänder ---------- */
  {
    id: "band-row", name: "Band-Rudern", equip: ["baender"], muscles: "Rücken · hintere Schulter", level: 1, met: 4,
    unit: "reps", reps: 15,
    steps: ["Türanker auf Brusthöhe in die Tür klemmen und die Tür schließen.",
      "Griffe fassen und zurückgehen, bis das Band leicht gespannt ist.",
      "Ellbogen nach hinten ziehen, Schulterblätter zusammen."],
    tip: "Stell dich so, dass die Tür sich von dir weg öffnet. Dann zieht dein Zug sie nur fester zu.",
    cue: "Ellbogen nach hinten, Brust raus.",
    props: [{ type: "door", x: 330 }],
    att: ["banddoor"],
    anchor: 330,
    anim: {
      keys: [
        { hip: L(200, 166), t: 8, f: [[196, 246], [212, 246]], h: L(270, 128) },
        { hip: L(198, 166), t: 6, f: [[196, 246], [212, 246]], h: L(222, 136) },
      ], move: [0.8, 1.1], hold: [0.35, 0.15],
    },
  },
  {
    id: "band-curl", name: "Band-Bizepscurl", equip: ["baender"], muscles: "Bizeps", level: 1, met: 3.5,
    unit: "reps", reps: 15,
    steps: ["Mittig auf das Band stellen, Griffe in den Händen.",
      "Ellbogen bleiben eng am Körper.",
      "Hände zu den Schultern beugen und langsam zurück."],
    tip: "Probier aus, mit welchem deiner drei Bänder 12 saubere Wiederholungen gerade so klappen.",
    cue: "Ellbogen fest, hoch, langsam runter.",
    props: [],
    att: ["bandfoot"],
    anim: {
      keys: [
        { hip: L(210, 158), t: 2, f: [[208, 246], [216, 246]], h: L(216, 163) },
        { hip: L(210, 158), t: 0, f: [[208, 246], [216, 246]], h: L(230, 104) },
      ], move: [0.8, 1.1], hold: [0.25, 0.2],
    },
  },

  /* ---------- Liegestützgriffe ---------- */
  {
    id: "bar-pushup", name: "Griff-Liegestütz", equip: ["griffe", "boden"], muscles: "Brust · Trizeps", level: 2, met: 7,
    unit: "reps", reps: 10,
    steps: ["Liegestützgriffe schulterbreit auf den Boden, fest greifen.",
      "Körper in eine gerade Linie bringen.",
      "Brust tiefer als die Griffe senken und hochdrücken."],
    tip: "Die Griffe schonen die Handgelenke und geben dir mehr Bewegungsweg.",
    cue: "Tief zwischen die Griffe, hoch.",
    props: [{ type: "bars", x: 272 }],
    anim: {
      keys: [
        { ...bodyLine([130, 238], 25.7), f: L(130, 238), ft: 55, h: [[268, 236], [274, 236]] },
        { ...bodyLine([130, 238], 12), f: L(130, 238), ft: 55, h: [[268, 236], [274, 236]] },
      ], move: [1.0, 0.8], hold: [0.1, 0.25],
    },
  },

  /* ---------- Springseil ---------- */
  {
    id: "jump-rope", name: "Seilspringen", equip: ["seil"], muscles: "Cardio · Waden", level: 2, met: 10,
    unit: "time", secs: 45,
    steps: ["Griffe locker auf Hüfthöhe, Ellbogen nah am Körper.",
      "Das Seil aus den Handgelenken drehen.",
      "Klein und leicht auf den Fußballen springen."],
    tip: "Zwischen Esstisch und Fenster ist am meisten Platz. Vorher kurz zur Decke schauen.",
    cue: "Locker aus den Handgelenken, leicht springen.",
    props: [],
    att: ["rope"],
    anim: {
      keys: [
        { hip: L(205, 157), t: 2, f: [[203, 244], [210, 244]], ft: 15, h: [[222, 165], [226, 166]] },
        { hip: L(205, 157), t: 2, f: [[203, 244], [210, 244]], ft: 32, h: [[222, 165], [226, 166]], off: [0, -14] },
      ], move: [0.24, 0.24], hold: [0.01, 0.01],
    },
  },

  /* ---------- Boden ---------- */
  {
    id: "march", name: "Marschieren auf der Stelle", equip: ["boden"], muscles: "Aufwärmen", level: 1, met: 3.5,
    unit: "time", secs: 45, warmup: true,
    steps: ["Aufrecht stehen und locker auf der Stelle gehen.",
      "Knie abwechselnd auf Hüfthöhe heben.",
      "Arme gegengleich mitschwingen."],
    tip: "Langsam starten und das Tempo steigern.",
    cue: "Knie hoch, Arme schwingen.",
    props: [],
    anim: {
      keys: [
        { hip: L(210, 157), t: 2, f: [[206, 246], [226, 214]], ft: [0, 20], h: [[234, 152], [194, 160]] },
        { hip: L(210, 157), t: 2, f: [[222, 214], [212, 246]], ft: [20, 0], h: [[196, 160], [236, 150]] },
      ], move: [0.45, 0.45], hold: [0.05, 0.05],
    },
  },
  {
    id: "bear-crawl", name: "Bärengang", equip: ["boden"], muscles: "Ganzkörper · Core", level: 2, met: 8,
    unit: "time", secs: 30,
    steps: ["Vierfüßlerstand, Knie schweben zwei Fingerbreit über dem Boden.",
      "Diagonal krabbeln: rechte Hand und linker Fuß gleichzeitig.",
      "Rücken flach wie ein Tisch, Blick nach unten."],
    tip: "Dein langer Wohnraum ist perfekt: vom Esstisch bis zum Fenster und zurück.",
    cue: "Knie schweben, Rücken flach.",
    props: [],
    anim: {
      keys: [
        { hip: L(172, 196), t: 84, hd: 6, f: [[182, 240], [160, 240]], ft: 60, h: [[226, 246], [246, 246]], off: [-6, 0] },
        { hip: L(172, 196), t: 84, hd: 6, f: [[160, 240], [182, 240]], ft: 60, h: [[246, 246], [226, 246]], off: [6, 0] },
      ], move: [0.5, 0.5], hold: [0.05, 0.05],
    },
  },
  {
    id: "burpee", name: "Burpee", equip: ["boden"], muscles: "Ganzkörper · Cardio", level: 3, met: 10,
    unit: "reps", reps: 8,
    steps: ["Aus dem Stand in die Hocke, Hände auf den Boden.",
      "Füße nach hinten in den Liegestütz springen und zurück.",
      "Explosiv nach oben springen, Arme über den Kopf."],
    tip: "Leiser landen ist besser für die Nachbarn: weich in den Knien abfedern.",
    cue: "Runter, raus, ran, hoch.",
    props: [],
    anim: {
      keys: [
        { hip: L(210, 157), t: 2, f: [[208, 246], [216, 246]], h: [[214, 164], [218, 164]] },
        { hip: L(196, 212), t: 55, hd: 10, f: [[208, 246], [216, 246]], h: L(262, 246) },
        { ...bodyLine([120, 240], 24), f: L(120, 240), ft: 55, h: L(262, 246) },
        { hip: L(196, 212), t: 55, hd: 10, f: [[208, 246], [216, 246]], h: L(262, 246) },
        { hip: L(210, 140), t: 0, f: [[208, 228], [214, 228]], ft: 40, h: [[214, 12], [220, 12]] },
      ],
      move: [0.45, 0.3, 0.3, 0.35, 0.35], hold: [0.1, 0.15, 0.05, 0.0, 0.25],
    },
  },
  {
    id: "plank", name: "Unterarmstütz", equip: ["boden", "kissen"], muscles: "Core · Schultern", level: 1, met: 4,
    unit: "time", secs: 30,
    steps: ["Unterarme auf den Boden, Ellbogen unter den Schultern.",
      "Füße hüftbreit, Körper bildet eine Linie.",
      "Bauch und Po fest, ruhig weiteratmen."],
    tip: "Kissen unter die Unterarme, wenn der Holzboden hart ist.",
    cue: "Lang machen, Bauch fest, atmen.",
    props: [],
    anim: {
      keys: [
        { hip: L(187.5, 223.7), sh: L(250, 212), hd: 4, f: L(100, 240), ft: 55, h: L(284, 242) },
        { hip: L(187.5, 221.5), sh: L(250, 211), hd: 2, f: L(100, 240), ft: 55, h: L(284, 242) },
      ], move: [1.5, 1.5], hold: [0.3, 0.3],
    },
  },
];

const EX = Object.fromEntries(EXERCISES.map((e) => [e.id, e]));

/* Workouts = Videos. Einträge: [Übung, Arbeitssekunden] */
const WORKOUTS = [
  {
    id: "stuhl-zirkel", title: "Stuhl-Zirkel", sub: "Vier weiße Stühle, ein Ganzkörperplan", level: 2,
    rounds: 3, rest: 20, roundRest: 60, warmup: 60,
    items: [["chair-squat", 40], ["chair-dips", 30], ["decline-pushup", 30], ["chair-knee-tuck", 30], ["db-row", 30]],
    hero: "chair-dips",
  },
  {
    id: "kuechen-kraft", title: "Küchen-Kraft", sub: "Die Arbeitsplatte als Hantelbank", level: 1,
    rounds: 3, rest: 20, roundRest: 45, warmup: 60,
    items: [["counter-pushup", 40], ["calf-raise", 40], ["glute-kickback", 25], ["goblet-squat", 40], ["wall-sit", 40]],
    hero: "counter-pushup",
  },
  {
    id: "sofa-po", title: "Sofa, Po & Beine", sub: "Couch gegen Couchpotato", level: 2,
    rounds: 3, rest: 20, roundRest: 60, warmup: 60,
    items: [["hip-thrust", 40], ["bulgarian", 30], ["pillow-bridge", 40], ["towel-curl", 40], ["sofa-situp", 40]],
    hero: "hip-thrust",
  },
  {
    id: "wohnzimmer-hiit", title: "Wohnzimmer-HIIT", sub: "Springseil, Handtuch, Bärengang", level: 3,
    rounds: 3, rest: 20, roundRest: 60, warmup: 60,
    items: [["jump-rope", 40], ["bear-crawl", 30], ["towel-mountain", 30], ["burpee", 30], ["towel-lunge", 25]],
    hero: "jump-rope",
  },
  {
    id: "band-hantel", title: "Band & Hantel", sub: "Oberkörper mit Türanker und Kurzhantel", level: 2,
    rounds: 3, rest: 20, roundRest: 60, warmup: 60,
    items: [["band-row", 40], ["band-curl", 40], ["db-press", 30], ["bar-pushup", 30], ["db-row", 30]],
    hero: "band-row",
  },
  {
    id: "sieben-minuten", title: "7 Minuten Feierabend", sub: "Einmal quer durch die Wohnung", level: 1,
    rounds: 1, rest: 8, roundRest: 0, warmup: 0,
    items: [["jump-rope", 30], ["wall-sit", 30], ["counter-pushup", 30], ["sofa-situp", 30], ["chair-squat", 30], ["chair-dips", 30],
      ["plank", 30], ["march", 30], ["towel-lunge", 15], ["bar-pushup", 30], ["pillow-bridge", 30], ["towel-mountain", 30]],
    hero: "wall-sit",
  },
  {
    id: "erster-schritt", title: "Erster Schritt", sub: "Sanfter Einstieg mit Wand und Stuhl", level: 1,
    rounds: 2, rest: 30, roundRest: 45, warmup: 60,
    items: [["wall-pushup", 30], ["chair-squat", 30], ["pillow-bridge", 30], ["calf-raise", 30], ["plank", 20]],
    hero: "wall-pushup",
  },
];
const WO = Object.fromEntries(WORKOUTS.map((w) => [w.id, w]));

/* Zeitachse eines Workouts für den Video-Player. */
function buildTimeline(w) {
  const segs = [];
  const first = EX[w.warmup ? "march" : w.items[0][0]];
  segs.push({ kind: "prep", ex: first, dur: 10 });
  if (w.warmup) segs.push({ kind: "work", ex: EX.march, dur: w.warmup, round: 0, label: "Aufwärmen" });
  for (let r = 1; r <= w.rounds; r++) {
    w.items.forEach(([id, secs], i) => {
      const ex = EX[id];
      const sides = ex.sides ? ["rechts", "links"] : [null];
      sides.forEach((side, si) => {
        const prev = segs[segs.length - 1];
        if (prev.kind === "work") {
          const isRoundBreak = i === 0 && si === 0 && r > 1;
          const rest = isRoundBreak ? w.roundRest || w.rest : (si === 1 ? Math.min(w.rest, 10) : w.rest);
          segs.push({ kind: "rest", ex, dur: rest, round: r, side, roundBreak: isRoundBreak });
        }
        segs.push({ kind: "work", ex, dur: secs, round: r, side });
      });
    });
  }
  let t = 0;
  segs.forEach((s) => { s.start = t; t += s.dur; });
  return { segs, total: t, rounds: w.rounds };
}

/* Fit-Adventskalender (Dezember). */
const ADVENT = [
  { ex: "chair-squat", amount: "24 Wiederholungen", note: "24 Türchen, 24 Kniebeugen" },
  { ex: "wall-sit", amount: "3 × 30 Sekunden" },
  { ex: "counter-pushup", amount: "3 × 10" },
  { ex: "jump-rope", amount: "5 × 1 Minute" },
  { workout: "erster-schritt", amount: "Samstag: ganzes Workout" },
  { ex: "burpee", amount: "Nikolaus: 6 Runden à 6", note: "Stiefel bleiben an" },
  { ex: "pillow-bridge", amount: "3 × 15" },
  { ex: "band-row", amount: "3 × 15" },
  { ex: "plank", amount: "3 × 40 Sekunden" },
  { ex: "towel-mountain", amount: "4 × 30 Sekunden" },
  { ex: "bulgarian", amount: "3 × 8 pro Bein" },
  { workout: "kuechen-kraft", amount: "Samstag: ganzes Workout" },
  { workout: "sofa-po", amount: "Sonntag: ganzes Workout" },
  { ex: "chair-dips", amount: "3 × 12" },
  { ex: "goblet-squat", amount: "3 × 12" },
  { ex: "bear-crawl", amount: "6 Bahnen durchs Wohnzimmer" },
  { ex: "hip-thrust", amount: "3 × 15" },
  { ex: "bar-pushup", amount: "3 × 10" },
  { workout: "wohnzimmer-hiit", amount: "Samstag: ganzes Workout" },
  { workout: "band-hantel", amount: "Sonntag: ganzes Workout" },
  { ex: "decline-pushup", amount: "3 × 8" },
  { ex: "towel-curl", amount: "3 × 10" },
  { workout: "sieben-minuten", amount: "Vor dem Packen der Geschenke" },
  { workout: "stuhl-zirkel", amount: "Heiligabend: Stuhl-Zirkel, dann Füße hoch", note: "Frohe Weihnachten" },
];

/* Dart-Roulette: Zahl auf der Scheibe = Wiederholungen. */
const DART_ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
const DART_MAP = {
  1: "burpee", 2: "decline-pushup", 3: "bar-pushup", 4: "chair-dips", 5: "bulgarian",
  6: "towel-curl", 7: "chair-knee-tuck", 8: "db-press", 9: "db-row", 10: "counter-pushup",
  11: "towel-lunge", 12: "sofa-situp", 13: "goblet-squat", 14: "band-row", 15: "hip-thrust",
  16: "band-curl", 17: "glute-kickback", 18: "pillow-bridge", 19: "chair-squat", 20: "calf-raise",
};
