/**
 * Preset-Bibliothek: Kamerafahrten, Video-Effekte und Bildstile.
 * prompt  = Regieanweisung, die an den Prompt angehängt wird
 * motion  = Parameter für die kostenlose „Local Motion“-Engine im Browser
 *           z = Zoom, x/y = Versatz (Anteil der Bildbreite/-höhe), r = Rotation (Grad), sx = horizontale Stauchung (Orbit-Illusion)
 */

export interface MotionKey {
  z?: number;
  x?: number;
  y?: number;
  r?: number;
  sx?: number;
}

export interface CameraPreset {
  id: string;
  name: string;
  category: 'Basis' | 'Dynamisch' | 'Drohne & Kran' | 'Spezial';
  description: string;
  prompt: string;
  motion: { from: MotionKey; to: MotionKey; ease?: 'linear' | 'in' | 'out' | 'inout' | 'expo-in' | 'expo-out'; shake?: number; blur?: number; loop?: boolean };
}

export interface EffectPreset {
  id: string;
  name: string;
  category: 'Elemente' | 'Verwandlung' | 'Licht & Atmosphäre' | 'Stilisiert';
  description: string;
  prompt: string;
  /** Effekt-Overlay in der Local-Motion-Engine */
  localFx?: 'glitch' | 'flash' | 'grain' | 'leak' | 'shake' | 'fade' | 'chroma' | 'pulse';
}

export interface StylePreset {
  id: string;
  name: string;
  prompt: string;
  negative?: string;
  swatch: string;
}

export const CAMERA: CameraPreset[] = [
  // ---------------- Basis ----------------
  { id: 'static', name: 'Statisch', category: 'Basis', description: 'Ruhige, fest montierte Kamera', prompt: 'locked-off static camera on a tripod, no camera movement', motion: { from: { z: 1.02 }, to: { z: 1.04 }, ease: 'linear' } },
  { id: 'dolly-in', name: 'Dolly In', category: 'Basis', description: 'Langsame Fahrt auf das Motiv zu', prompt: 'smooth slow dolly-in towards the subject, steady camera push', motion: { from: { z: 1 }, to: { z: 1.35 }, ease: 'inout' } },
  { id: 'dolly-out', name: 'Dolly Out', category: 'Basis', description: 'Fahrt vom Motiv weg', prompt: 'smooth dolly-out pulling away from the subject, revealing the environment', motion: { from: { z: 1.35 }, to: { z: 1 }, ease: 'inout' } },
  { id: 'pan-left', name: 'Schwenk links', category: 'Basis', description: 'Horizontaler Schwenk nach links', prompt: 'slow horizontal camera pan to the left', motion: { from: { z: 1.25, x: 0.1 }, to: { z: 1.25, x: -0.1 }, ease: 'inout' } },
  { id: 'pan-right', name: 'Schwenk rechts', category: 'Basis', description: 'Horizontaler Schwenk nach rechts', prompt: 'slow horizontal camera pan to the right', motion: { from: { z: 1.25, x: -0.1 }, to: { z: 1.25, x: 0.1 }, ease: 'inout' } },
  { id: 'tilt-up', name: 'Tilt hoch', category: 'Basis', description: 'Kamera neigt sich nach oben', prompt: 'camera tilts up slowly, revealing what is above', motion: { from: { z: 1.25, y: 0.1 }, to: { z: 1.25, y: -0.1 }, ease: 'inout' } },
  { id: 'tilt-down', name: 'Tilt runter', category: 'Basis', description: 'Kamera neigt sich nach unten', prompt: 'camera tilts down slowly', motion: { from: { z: 1.25, y: -0.1 }, to: { z: 1.25, y: 0.1 }, ease: 'inout' } },
  { id: 'truck-left', name: 'Seitwärts links', category: 'Basis', description: 'Seitliche Parallelfahrt (Trucking)', prompt: 'camera trucks sideways to the left, parallel tracking shot with parallax', motion: { from: { z: 1.3, x: 0.12, sx: 1 }, to: { z: 1.32, x: -0.12, sx: 0.98 }, ease: 'inout' } },
  { id: 'truck-right', name: 'Seitwärts rechts', category: 'Basis', description: 'Seitliche Parallelfahrt nach rechts', prompt: 'camera trucks sideways to the right, parallel tracking shot with parallax', motion: { from: { z: 1.3, x: -0.12, sx: 1 }, to: { z: 1.32, x: 0.12, sx: 0.98 }, ease: 'inout' } },
  { id: 'zoom-in', name: 'Zoom In', category: 'Basis', description: 'Optischer Zoom (ohne Positionswechsel)', prompt: 'slow optical zoom in, lens compression', motion: { from: { z: 1 }, to: { z: 1.6 }, ease: 'inout' } },
  { id: 'zoom-out', name: 'Zoom Out', category: 'Basis', description: 'Optischer Zoom heraus', prompt: 'slow optical zoom out', motion: { from: { z: 1.6 }, to: { z: 1 }, ease: 'inout' } },
  { id: 'pedestal-up', name: 'Steigen', category: 'Basis', description: 'Kamera fährt senkrecht nach oben', prompt: 'camera pedestals straight up vertically', motion: { from: { z: 1.3, y: 0.12 }, to: { z: 1.3, y: -0.12 }, ease: 'inout' } },
  { id: 'dutch-roll', name: 'Dutch Roll', category: 'Basis', description: 'Langsames Kippen der Horizontlinie', prompt: 'slow dutch angle roll, horizon tilting', motion: { from: { z: 1.3, r: -6 }, to: { z: 1.3, r: 6 }, ease: 'inout' } },

  // ---------------- Dynamisch ----------------
  { id: 'crash-zoom', name: 'Crash Zoom', category: 'Dynamisch', description: 'Explosiver, schneller Zoom aufs Motiv', prompt: 'sudden aggressive crash zoom into the subject, fast snap zoom, motion blur', motion: { from: { z: 1 }, to: { z: 2.4 }, ease: 'expo-in', blur: 6 } },
  { id: 'crash-zoom-out', name: 'Crash Zoom Out', category: 'Dynamisch', description: 'Ruckartiges Herauszoomen', prompt: 'violent fast zoom out from the subject, whip of motion', motion: { from: { z: 2.4 }, to: { z: 1 }, ease: 'expo-out', blur: 6 } },
  { id: 'whip-pan', name: 'Whip Pan', category: 'Dynamisch', description: 'Reißschwenk mit Bewegungsunschärfe', prompt: 'fast whip pan with heavy motion blur', motion: { from: { z: 1.4, x: -0.18 }, to: { z: 1.4, x: 0.18 }, ease: 'expo-in', blur: 10 } },
  { id: 'dolly-zoom', name: 'Dolly Zoom', category: 'Dynamisch', description: 'Vertigo-Effekt: Hintergrund „atmet“', prompt: 'vertigo dolly zoom effect, background stretching while subject stays the same size', motion: { from: { z: 1, sx: 1 }, to: { z: 1.45, sx: 0.9 }, ease: 'inout' } },
  { id: 'super-dolly', name: 'Super Dolly', category: 'Dynamisch', description: 'Lange, kraftvolle Fahrt aufs Motiv', prompt: 'long powerful dolly push in, epic cinematic approach, accelerating', motion: { from: { z: 1 }, to: { z: 1.9 }, ease: 'in' } },
  { id: 'arc-left', name: 'Bogen links', category: 'Dynamisch', description: 'Halbkreis um das Motiv nach links', prompt: 'camera arcs around the subject to the left, half orbit', motion: { from: { z: 1.3, x: 0.1, sx: 0.94, r: 1 }, to: { z: 1.35, x: -0.1, sx: 1.02, r: -1 }, ease: 'inout' } },
  { id: 'arc-right', name: 'Bogen rechts', category: 'Dynamisch', description: 'Halbkreis um das Motiv nach rechts', prompt: 'camera arcs around the subject to the right, half orbit', motion: { from: { z: 1.3, x: -0.1, sx: 0.94, r: -1 }, to: { z: 1.35, x: 0.1, sx: 1.02, r: 1 }, ease: 'inout' } },
  { id: 'orbit-360', name: '360° Orbit', category: 'Dynamisch', description: 'Volle Umkreisung des Motivs', prompt: 'continuous 360 degree orbit around the subject, smooth circular tracking', motion: { from: { z: 1.35, x: -0.12, sx: 0.9 }, to: { z: 1.35, x: 0.12, sx: 0.9 }, ease: 'linear', loop: true } },
  { id: 'bullet-time', name: 'Bullet Time', category: 'Dynamisch', description: 'Eingefrorene Zeit, Kamera kreist', prompt: 'bullet time effect, time frozen mid-action while the camera sweeps around the subject', motion: { from: { z: 1.4, x: -0.1, sx: 0.92 }, to: { z: 1.45, x: 0.1, sx: 0.92 }, ease: 'inout' } },
  { id: 'handheld', name: 'Handkamera', category: 'Dynamisch', description: 'Natürliches Wackeln, dokumentarisch', prompt: 'handheld camera, subtle natural shake, documentary feel', motion: { from: { z: 1.12 }, to: { z: 1.15 }, ease: 'linear', shake: 0.6 } },
  { id: 'run-and-gun', name: 'Verfolgung', category: 'Dynamisch', description: 'Kamera rennt hinterher, starkes Wackeln', prompt: 'frantic run-and-gun handheld chase camera following the subject', motion: { from: { z: 1.2 }, to: { z: 1.35 }, ease: 'linear', shake: 1.6 } },
  { id: 'snorricam', name: 'Körperkamera', category: 'Dynamisch', description: 'Kamera am Körper befestigt, Motiv bleibt fix', prompt: 'snorricam body-mounted camera, subject fixed in frame while the world moves around', motion: { from: { z: 1.25, r: -3 }, to: { z: 1.25, r: 3 }, ease: 'inout', shake: 0.4 } },
  { id: 'head-tracking', name: 'Kopf-Tracking', category: 'Dynamisch', description: 'Kamera folgt dem Gesicht', prompt: 'camera tracks the head of the subject closely, following its movement', motion: { from: { z: 1.4, x: -0.04 }, to: { z: 1.45, x: 0.04 }, ease: 'inout', shake: 0.25 } },
  { id: 'car-tracking', name: 'Fahrzeug-Tracking', category: 'Dynamisch', description: 'Tiefe Fahrt neben einem Fahrzeug', prompt: 'low tracking shot alongside a moving vehicle, speed and motion blur', motion: { from: { z: 1.3, x: 0.08 }, to: { z: 1.3, x: -0.08 }, ease: 'linear', shake: 0.5, blur: 3 } },
  { id: 'rack-focus', name: 'Schärfe-Verlagerung', category: 'Dynamisch', description: 'Fokus wandert vom Vorder- in den Hintergrund', prompt: 'rack focus pulling from foreground to background, shallow depth of field', motion: { from: { z: 1.15 }, to: { z: 1.18 }, ease: 'inout', blur: 2 } },

  // ---------------- Drohne & Kran ----------------
  { id: 'crane-up', name: 'Kran hoch', category: 'Drohne & Kran', description: 'Kran hebt ab, majestätischer Überblick', prompt: 'crane shot rising up and over the scene, majestic reveal', motion: { from: { z: 1.4, y: 0.12 }, to: { z: 1.1, y: -0.08 }, ease: 'inout' } },
  { id: 'crane-down', name: 'Kran runter', category: 'Drohne & Kran', description: 'Kran senkt sich zum Motiv', prompt: 'crane shot descending down towards the subject', motion: { from: { z: 1.1, y: -0.08 }, to: { z: 1.4, y: 0.1 }, ease: 'inout' } },
  { id: 'drone-flyover', name: 'Drohnen-Überflug', category: 'Drohne & Kran', description: 'Weiter Flug über die Landschaft', prompt: 'aerial drone flyover, sweeping cinematic landscape shot', motion: { from: { z: 1.25, y: 0.12 }, to: { z: 1.45, y: -0.12 }, ease: 'linear' } },
  { id: 'fpv-dive', name: 'FPV Sturzflug', category: 'Drohne & Kran', description: 'Rasante FPV-Drohne stürzt hinab', prompt: 'FPV drone dives down at high speed, aggressive acrobatic flight', motion: { from: { z: 1.1, y: -0.15, r: -8 }, to: { z: 1.8, y: 0.1, r: 4 }, ease: 'in', blur: 4 } },
  { id: 'fpv-through', name: 'FPV Durchflug', category: 'Drohne & Kran', description: 'Drohne fliegt durch eine Lücke', prompt: 'FPV drone flies through a narrow gap at high speed', motion: { from: { z: 1 }, to: { z: 2.6 }, ease: 'in', blur: 8 } },
  { id: 'aerial-pullback', name: 'Luftbild-Reveal', category: 'Drohne & Kran', description: 'Rückwärts aufsteigen, Umgebung enthüllen', prompt: 'aerial pull back and rise, revealing the vast surroundings', motion: { from: { z: 1.8 }, to: { z: 1 }, ease: 'out' } },
  { id: 'top-down', name: 'Vogelperspektive', category: 'Drohne & Kran', description: 'Senkrechter Blick von oben, langsame Drehung', prompt: 'overhead top-down bird’s-eye view, slowly rotating', motion: { from: { z: 1.4, r: 0 }, to: { z: 1.45, r: 12 }, ease: 'linear' } },
  { id: 'hyperlapse', name: 'Hyperlapse', category: 'Drohne & Kran', description: 'Zeitraffer in Bewegung', prompt: 'hyperlapse moving forward through the scene, time-lapse with camera movement', motion: { from: { z: 1 }, to: { z: 1.5 }, ease: 'linear', shake: 0.15 } },

  // ---------------- Spezial ----------------
  { id: 'through-object', name: 'Durch Objekt', category: 'Spezial', description: 'Kamera fliegt durch ein Objekt hindurch', prompt: 'camera moves through an object in the foreground, seamless pass-through transition', motion: { from: { z: 1 }, to: { z: 3 }, ease: 'expo-in', blur: 5 } },
  { id: 'eye-dive', name: 'Ins Auge', category: 'Spezial', description: 'Extremer Makro-Zoom ins Auge', prompt: 'extreme macro push into the eye of the subject, iris fills the frame', motion: { from: { z: 1.2 }, to: { z: 3.2 }, ease: 'expo-in' } },
  { id: 'earth-zoom-out', name: 'Bis ins All', category: 'Spezial', description: 'Herauszoomen bis zur Erdumlaufbahn', prompt: 'continuous zoom out from the subject to the city, then to the planet seen from space', motion: { from: { z: 3 }, to: { z: 1 }, ease: 'expo-out' } },
  { id: 'barrel-roll', name: 'Fassrolle', category: 'Spezial', description: 'Kamera dreht sich um die eigene Achse', prompt: 'camera barrel roll, rotating 360 degrees around its lens axis', motion: { from: { z: 1.5, r: 0 }, to: { z: 1.5, r: 360 }, ease: 'inout' } },
  { id: 'low-angle-hero', name: 'Helden-Untersicht', category: 'Spezial', description: 'Tiefe Perspektive, das Motiv wirkt mächtig', prompt: 'low-angle hero shot looking up at the subject, slow push in, powerful and epic', motion: { from: { z: 1.2, y: 0.08 }, to: { z: 1.4, y: 0.02 }, ease: 'inout' } },
  { id: 'slow-motion', name: 'Zeitlupe', category: 'Spezial', description: 'Extreme Zeitlupe mit sanfter Fahrt', prompt: 'ultra slow motion 240fps, gentle camera drift, every detail suspended', motion: { from: { z: 1.1 }, to: { z: 1.18 }, ease: 'linear' } },
  { id: 'timelapse', name: 'Zeitraffer', category: 'Spezial', description: 'Statischer Zeitraffer, Wolken & Licht ziehen', prompt: 'static timelapse, clouds and light moving rapidly, day to night transition', motion: { from: { z: 1.05 }, to: { z: 1.08 }, ease: 'linear' } },
  { id: 'glam-turntable', name: 'Drehteller', category: 'Spezial', description: 'Produkt dreht sich, Kamera fix', prompt: 'product slowly rotating on a turntable, studio lighting, locked camera', motion: { from: { z: 1.15, sx: 0.96 }, to: { z: 1.15, sx: 1 }, ease: 'inout', loop: true } },
];

export const EFFECTS: EffectPreset[] = [
  { id: 'disintegrate', name: 'Zerfallen', category: 'Verwandlung', description: 'Motiv zerfällt zu Staub', prompt: 'the subject slowly disintegrates into thousands of drifting dust particles carried away by the wind', localFx: 'fade' },
  { id: 'explosion', name: 'Explosion', category: 'Elemente', description: 'Gewaltige Explosion im Hintergrund', prompt: 'a massive fiery explosion erupts behind the subject, shockwave, debris and embers', localFx: 'flash' },
  { id: 'levitate', name: 'Schweben', category: 'Verwandlung', description: 'Motiv hebt vom Boden ab', prompt: 'the subject begins to levitate and float weightlessly above the ground', localFx: 'pulse' },
  { id: 'melt', name: 'Schmelzen', category: 'Verwandlung', description: 'Alles schmilzt surreal', prompt: 'the subject melts like hot wax in a surreal flowing way' },
  { id: 'freeze', name: 'Vereisen', category: 'Elemente', description: 'Wird zu Eis', prompt: 'frost spreads rapidly and the subject freezes into crystal-clear ice' },
  { id: 'on-fire', name: 'In Flammen', category: 'Elemente', description: 'Flammen umhüllen das Motiv', prompt: 'the subject is engulfed in roaring flames, glowing embers swirling', localFx: 'leak' },
  { id: 'metal', name: 'Metall-Haut', category: 'Verwandlung', description: 'Verwandlung in Chrom', prompt: 'the subject transforms into polished liquid chrome metal, reflections rippling' },
  { id: 'statue', name: 'Zu Stein', category: 'Verwandlung', description: 'Wird zur Marmorstatue', prompt: 'the subject turns into a white marble statue, cracks forming' },
  { id: 'shatter', name: 'Zersplittern', category: 'Elemente', description: 'Zerbricht wie Glas', prompt: 'the scene shatters like glass into floating shards, slow motion', localFx: 'flash' },
  { id: 'inflate', name: 'Aufblasen', category: 'Stilisiert', description: 'Motiv bläht sich wie ein Ballon auf', prompt: 'the subject inflates like a balloon in a playful cartoonish way', localFx: 'pulse' },
  { id: 'glitch', name: 'Glitch', category: 'Stilisiert', description: 'Digitale Bildstörungen', prompt: 'digital glitch distortion, RGB channel split, datamosh artifacts', localFx: 'glitch' },
  { id: 'hologram', name: 'Hologramm', category: 'Stilisiert', description: 'Blaues Hologramm mit Scanlines', prompt: 'the subject becomes a flickering blue holographic projection with scanlines', localFx: 'chroma' },
  { id: 'neon', name: 'Neon-Glühen', category: 'Licht & Atmosphäre', description: 'Neonlicht-Konturen', prompt: 'vibrant neon light outlines glow around the subject, synthwave colors', localFx: 'leak' },
  { id: 'lightning', name: 'Blitzschlag', category: 'Elemente', description: 'Blitze zucken durch die Szene', prompt: 'bright lightning bolts strike around the subject, electric arcs crackling', localFx: 'flash' },
  { id: 'smoke-reveal', name: 'Rauch-Enthüllung', category: 'Licht & Atmosphäre', description: 'Motiv tritt aus dichtem Rauch', prompt: 'the subject emerges from thick swirling smoke', localFx: 'fade' },
  { id: 'paint-splash', name: 'Farbexplosion', category: 'Stilisiert', description: 'Farbe spritzt in Zeitlupe', prompt: 'vivid paint splashes burst around the subject in slow motion' },
  { id: 'petals', name: 'Blütenwirbel', category: 'Licht & Atmosphäre', description: 'Blütenblätter wirbeln umher', prompt: 'cherry blossom petals swirl around the subject in a gentle breeze' },
  { id: 'water-splash', name: 'Wasserwelle', category: 'Elemente', description: 'Eine Welle bricht über die Szene', prompt: 'a huge wave of water crashes through the scene, droplets frozen in the air' },
  { id: 'portal', name: 'Portal', category: 'Stilisiert', description: 'Ein leuchtendes Portal öffnet sich', prompt: 'a glowing magical portal tears open in the air behind the subject', localFx: 'pulse' },
  { id: 'afterimage', name: 'Nachbilder', category: 'Stilisiert', description: 'Geisterhafte Bewegungs-Spuren', prompt: 'ghostly afterimage trails follow every movement of the subject', localFx: 'chroma' },
  { id: 'time-freeze', name: 'Zeit anhalten', category: 'Verwandlung', description: 'Alles friert ein, nur das Motiv bewegt sich', prompt: 'time freezes, everything around stops mid-motion while only the subject keeps moving' },
  { id: 'rainstorm', name: 'Gewittersturm', category: 'Licht & Atmosphäre', description: 'Starkregen & Wind', prompt: 'heavy rainstorm with wind, wet reflective surfaces, dramatic atmosphere', localFx: 'grain' },
  { id: 'snowfall', name: 'Schneefall', category: 'Licht & Atmosphäre', description: 'Sanfter Schnee fällt', prompt: 'soft snowflakes gently falling, cold winter atmosphere', localFx: 'grain' },
  { id: 'lens-flare', name: 'Lens Flare', category: 'Licht & Atmosphäre', description: 'Anamorphe Lichtreflexe', prompt: 'anamorphic lens flares streak across the frame, golden hour sun', localFx: 'leak' },
  { id: 'xray', name: 'Röntgenblick', category: 'Stilisiert', description: 'Röntgen-/Wärmebild-Look', prompt: 'x-ray vision effect revealing the inner structure, glowing skeleton', localFx: 'chroma' },
];

export const STYLES: StylePreset[] = [
  { id: 'cinematic', name: 'Kino', prompt: 'cinematic film still, anamorphic lens, dramatic lighting, rich color grading, shallow depth of field', swatch: 'linear-gradient(135deg,#0f2027,#2c5364)' },
  { id: 'photoreal', name: 'Fotorealistisch', prompt: 'ultra photorealistic, natural light, true-to-life textures, shot on a full-frame camera, 85mm lens', negative: 'cartoon, illustration, painting, cgi', swatch: 'linear-gradient(135deg,#8e9eab,#eef2f3)' },
  { id: 'film-35mm', name: '35mm Analog', prompt: 'shot on 35mm film, Kodak Portra 400, visible film grain, soft halation, nostalgic tones', swatch: 'linear-gradient(135deg,#c79081,#dfa579)' },
  { id: 'editorial', name: 'Editorial Fashion', prompt: 'high-fashion editorial photography, magazine cover quality, studio strobe lighting, bold styling', swatch: 'linear-gradient(135deg,#232526,#414345)' },
  { id: 'product', name: 'Produkt-Studio', prompt: 'premium product photography, seamless studio backdrop, softbox lighting, crisp reflections, commercial', swatch: 'linear-gradient(135deg,#e0eafc,#cfdef3)' },
  { id: 'anime', name: 'Anime', prompt: 'anime key visual, cel shading, vibrant colors, detailed background art', swatch: 'linear-gradient(135deg,#ff9a9e,#fad0c4)' },
  { id: '3d', name: '3D-Render', prompt: 'high-end 3D render, global illumination, octane-style materials, subsurface scattering', swatch: 'linear-gradient(135deg,#4facfe,#00f2fe)' },
  { id: 'watercolor', name: 'Aquarell', prompt: 'delicate watercolor painting, soft bleeding pigments, textured paper', swatch: 'linear-gradient(135deg,#a1c4fd,#c2e9fb)' },
  { id: 'oil', name: 'Ölgemälde', prompt: 'classical oil painting, visible brush strokes, chiaroscuro, museum quality', swatch: 'linear-gradient(135deg,#603813,#b29f94)' },
  { id: 'ink', name: 'Comic / Tusche', prompt: 'bold ink comic illustration, strong linework, halftone shading', swatch: 'linear-gradient(135deg,#000,#434343)' },
  { id: 'cyberpunk', name: 'Cyberpunk', prompt: 'cyberpunk aesthetic, neon-lit rainy streets, holographic signs, teal and magenta palette', swatch: 'linear-gradient(135deg,#fc00ff,#00dbde)' },
  { id: 'noir', name: 'Film Noir', prompt: 'black and white film noir, hard shadows, venetian blind light, smoky atmosphere', swatch: 'linear-gradient(135deg,#000,#777)' },
  { id: 'polaroid', name: 'Sofortbild', prompt: 'vintage instant photo, faded colors, light leaks, soft flash', swatch: 'linear-gradient(135deg,#f6d365,#fda085)' },
  { id: 'minimal', name: 'Minimalistisch', prompt: 'minimalist composition, negative space, clean geometry, muted palette', swatch: 'linear-gradient(135deg,#f5f7fa,#c3cfe2)' },
  { id: 'fantasy', name: 'Fantasy-Concept', prompt: 'epic fantasy concept art, sweeping vista, volumetric god rays, painterly detail', swatch: 'linear-gradient(135deg,#5f2c82,#49a09d)' },
  { id: 'clay', name: 'Knetfigur', prompt: 'claymation style, handmade plasticine textures, stop-motion look, soft studio light', swatch: 'linear-gradient(135deg,#f093fb,#f5576c)' },
  { id: 'pixel', name: 'Pixel-Art', prompt: '16-bit pixel art, limited palette, crisp pixels', swatch: 'linear-gradient(135deg,#43e97b,#38f9d7)' },
  { id: 'documentary', name: 'Dokumentarisch', prompt: 'documentary photojournalism, candid moment, available light, authentic', swatch: 'linear-gradient(135deg,#536976,#292e49)' },
  { id: 'luxury', name: 'Luxus', prompt: 'luxury brand campaign, gold accents, elegant lighting, opulent textures', swatch: 'linear-gradient(135deg,#bf953f,#fcf6ba)' },
  { id: 'isometric', name: 'Isometrisch', prompt: 'isometric 3D diorama, miniature world, tilt-shift', swatch: 'linear-gradient(135deg,#667eea,#764ba2)' },
];

export function cameraById(id: string) {
  return CAMERA.find((c) => c.id === id);
}
export function effectById(id: string) {
  return EFFECTS.find((e) => e.id === id);
}
export function styleById(id: string) {
  return STYLES.find((s) => s.id === id);
}
