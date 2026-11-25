import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.MUSII_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'musii-free-test-'));

const hf = await import('../server/providers/hfspace.js');
const { parseCfResponse } = await import('../server/providers/cloudflare.js');
const { classicImageUrl } = await import('../server/providers/pollinations.js');
const { parseOpenRouterFree } = await import('../server/providers/compat.js');
const catalog = await import('../server/catalog.js');
const { db } = await import('../server/store.js');
const { FREE_PRESETS, HF_SPACES, COMFY_TEMPLATES } = await import('../server/free.js');
const { fillTemplate } = await import('../server/providers/template.js');

// Echte Schnittstellen (gekürzt) aus /gradio_api/info, Stand Nov. 2026
const P = (name: string, component: string, def?: unknown) => ({ parameter_name: name, component, parameter_has_default: def !== undefined, parameter_default: def });
const FLUX_INFO = {
  named_endpoints: {
    '/infer': {
      parameters: [P('prompt', 'Textbox'), P('seed', 'Slider', 0), P('randomize_seed', 'Checkbox', true), P('width', 'Slider', 1024), P('height', 'Slider', 1024), P('num_inference_steps', 'Slider', 4)],
      returns: [{ component: 'Image' }, { component: 'Slider' }],
    },
  },
};
const LTX_INFO = {
  named_endpoints: {
    '/handle_image_upload_for_dims': { parameters: [P('image_filepath', 'Image', null), P('current_h', 'Slider', 512), P('current_w', 'Slider', 704)], returns: [{ component: 'Slider' }, { component: 'Slider' }] },
    '/text_to_video': {
      parameters: [P('prompt', 'Textbox', 'A dragon'), P('negative_prompt', 'Textbox', 'worst quality'), P('input_image_filepath', 'Textbox', null), P('height_ui', 'Slider', 512), P('width_ui', 'Slider', 704), P('mode', 'Dropdown', 'image-to-video'), P('duration_ui', 'Slider', 2), P('seed_ui', 'Number', 42), P('randomize_seed', 'Checkbox', true)],
      returns: [{ component: 'Video' }, { component: 'Number' }],
    },
    '/image_to_video': {
      parameters: [P('prompt', 'Textbox', 'x'), P('negative_prompt', 'Textbox', 'y'), P('input_image_filepath', 'Image', null), P('height_ui', 'Slider', 512), P('width_ui', 'Slider', 704), P('mode', 'Dropdown', 'image-to-video')],
      returns: [{ component: 'Video' }, { component: 'Number' }],
    },
  },
};
const WAN_PARAMS = [
  P('input_image', 'Image', null),
  P('prompt', 'Textbox', 'make this image come alive'),
  P('steps', 'Slider', 6),
  P('negative_prompt', 'Textbox', 'blurry'),
  P('duration_seconds', 'Slider', 3.5),
  P('seed', 'Slider', 42),
  P('randomize_seed', 'Checkbox', true),
];

test('Space-Host wird aus ID oder URL gebildet', () => {
  assert.equal(hf.spaceHost('black-forest-labs/FLUX.1-schnell'), 'https://black-forest-labs-flux-1-schnell.hf.space');
  assert.equal(hf.spaceHost('https://huggingface.co/spaces/Tongyi-MAI/Z-Image-Turbo'), 'https://tongyi-mai-z-image-turbo.hf.space');
  assert.equal(hf.spaceHost('https://my.custom.space/'), 'https://my.custom.space');
});

test('Endpunkt-Erkennung wählt den passenden Space-Endpunkt', () => {
  assert.equal(hf.pickEndpoint(FLUX_INFO as any, 'text-to-image', false), '/infer');
  assert.equal(hf.pickEndpoint(LTX_INFO as any, 'text-to-video', false), '/text_to_video');
  assert.equal(hf.pickEndpoint(LTX_INFO as any, 'image-to-video', true), '/image_to_video');
  assert.equal(hf.pickEndpoint(LTX_INFO as any, 'text-to-video', false, 'image_to_video'), '/image_to_video');
  assert.throws(() => hf.pickEndpoint(LTX_INFO as any, 'tts', false));
});

test('Parameter-Belegung: Prompt, Seed, Format, Datei', () => {
  const flux = hf.mapParams(FLUX_INFO.named_endpoints['/infer'].parameters as any, 'text-to-image', { prompt: 'Katze', aspectRatio: '16:9' } as any, {});
  assert.equal(flux[0], 'Katze');
  assert.equal(flux[2], true, 'ohne Seed zufällig');
  assert.ok((flux[3] as number) > (flux[4] as number), 'Querformat');
  assert.equal(((flux[3] as number) * (flux[4] as number)) / (1024 * 1024) > 0.9, true, 'Pixelfläche bleibt erhalten');

  const file = { path: '/tmp/x.png', meta: { _type: 'gradio.FileData' } };
  const wan = hf.mapParams(WAN_PARAMS as any, 'image-to-video', { prompt: 'Wind', seed: 7, negativePrompt: 'Text' } as any, { image: file });
  assert.deepEqual(wan[0], file);
  assert.equal(wan[1], 'Wind');
  assert.equal(wan[3], 'Text');
  assert.equal(wan[4], 3.5, 'Videodauer bleibt beim sicheren Standard');
  assert.equal(wan[5], 7);
  assert.equal(wan[6], false, 'fester Seed -> nicht zufällig');

  const ltx = hf.mapParams(LTX_INFO.named_endpoints['/text_to_video'].parameters as any, 'text-to-video', { prompt: 'Drache' } as any, {});
  assert.equal(ltx[5], 'text-to-video', 'Modus wird an die Aufgabe angepasst');

  const ace = hf.mapParams([P('audio_duration', 'Slider', -1), P('prompt', 'Textbox', 'funk'), P('lyrics', 'Textbox', '[verse] …')] as any, 'music', { prompt: 'lofi', duration: 30 } as any, {});
  assert.deepEqual(ace, [30, 'lofi', '[instrumental]']);
});

test('Gradio-Stream: Ergebnis, Fehler und Kontingent-Hinweis', () => {
  const ok = 'event: generating\ndata: null\n\nevent: complete\ndata: [{"url":"https://x.hf.space/gradio_api/file=/tmp/a.webp","path":"/tmp/a.webp"}, 123]\n\n';
  assert.deepEqual(hf.parseGradioStream(ok)[1], 123);
  assert.throws(() => hf.parseGradioStream('event: error\ndata: null\n\n'), /Kontingent/);
  assert.throws(() => hf.parseGradioStream('event: error\ndata: "You have exceeded your GPU quota"\n\n'), /HF-Token/);
});

test('Ausgaben: Bild, Galerie, Vorher/Nachher-Slider', () => {
  const img = hf.extractSpaceOutputs([{ url: 'https://a/1.webp' }, 5], [{ component: 'Image' }, { component: 'Slider' }], 'text-to-image');
  assert.deepEqual(img, ['https://a/1.webp']);
  const gal = hf.extractSpaceOutputs([[{ image: { url: 'https://a/1.png' } }, { image: { url: 'https://a/2.png' } }], 'x'], [{ component: 'Gallery' }, { component: 'Textbox' }], 'text-to-image');
  assert.equal(gal.length, 2);
  const slider = hf.extractSpaceOutputs([[{ url: 'https://a/vorher.png' }, { url: 'https://a/nachher.png' }]], [{ component: 'Imageslider' }], 'remove-bg');
  assert.deepEqual(slider, ['https://a/nachher.png']);
  const vid = hf.extractSpaceOutputs([{ video: { url: 'https://a/v.mp4' }, subtitles: null }, 1], [{ component: 'Video' }, { component: 'Number' }], 'image-to-video');
  assert.deepEqual(vid, ['https://a/v.mp4']);
});

test('Cloudflare: JSON-Base64 und Binärantworten werden gelesen', async () => {
  const json = new Response(JSON.stringify({ success: true, result: { image: 'aGFsbG8=' } }), { headers: { 'content-type': 'application/json' } });
  assert.deepEqual(await parseCfResponse(json, 'image'), [{ b64: 'aGFsbG8=', mime: undefined }]);
  const bin = new Response(new Uint8Array([0xff, 0xd8, 0xff]), { headers: { 'content-type': 'image/jpeg' } });
  const out = await parseCfResponse(bin, 'image');
  assert.equal(out[0].mime, 'image/jpeg');
  const audio = new Response(JSON.stringify({ result: { audio: 'AAAA' } }), { headers: { 'content-type': 'application/json' } });
  assert.equal((await parseCfResponse(audio, 'audio'))[0].mime, 'audio/mpeg');
  const err = new Response(JSON.stringify({ success: false, errors: [{ message: 'Kontingent erschöpft' }] }), { headers: { 'content-type': 'application/json' } });
  await assert.rejects(() => parseCfResponse(err, 'image'), /Kontingent/);
});

test('Pollinations Classic: URL mit max. 768² Fläche und Seitenverhältnis', () => {
  const u = new URL(classicImageUrl('Ein Haus am See', '16:9', 5));
  assert.equal(u.hostname, 'image.pollinations.ai');
  const w = Number(u.searchParams.get('width'));
  const h = Number(u.searchParams.get('height'));
  assert.ok(w > h && w * h <= 768 * 768 * 1.05);
  assert.equal(u.searchParams.get('seed'), '5');
  assert.match(decodeURIComponent(u.pathname), /Ein Haus am See/);
});

test('OpenRouter: nur kostenlose Text-Modelle werden übernommen', () => {
  const list = parseOpenRouterFree(
    [
      { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', name: 'Nemotron Ultra', pricing: { prompt: '0', completion: '0' }, architecture: { input_modalities: ['text'], output_modalities: ['text'] } },
      { id: 'google/gemma-4-31b-it:free', name: 'Gemma 4', pricing: { prompt: '0', completion: '0' }, architecture: { input_modalities: ['image', 'text'], output_modalities: ['text'] } },
      { id: 'openai/gpt-5', name: 'GPT-5', pricing: { prompt: '0.00001', completion: '0.00003' }, architecture: { input_modalities: ['text'], output_modalities: ['text'] } },
      { id: 'google/lyria-3-pro-preview', name: 'Lyria', pricing: { prompt: '0', completion: '0' }, architecture: { input_modalities: ['text'], output_modalities: ['text', 'audio'] } },
    ],
    'cn_or',
  );
  assert.deepEqual(
    list.map((m) => m.model),
    ['nvidia/nemotron-3-ultra-550b-a55b:free', 'google/gemma-4-31b-it:free'],
  );
  assert.ok(list.every((m) => m.free === 'quota' && m.cost === 0));
  assert.equal(list[1].features?.vision, true);
  assert.ok(list[0].quality > list[1].quality, 'größeres Modell -> höhere Qualität');
});

test('Router: „Nur gratis“ und „Gratis zuerst“', () => {
  db.connections.push(
    { id: 'cn_fal', type: 'fal', name: 'fal', enabled: true, apiKey: 'plain-key', createdAt: 0 },
    { id: 'cn_pol', type: 'pollinations', name: 'Pollinations', enabled: true, createdAt: 0 },
  );
  const req = { task: 'text-to-image' } as any;
  const best = catalog.rankModels('text-to-image', req, 'quality');
  assert.equal(best[0].provider, 'fal', 'Qualität: bezahltes Top-Modell vorn');
  const free = catalog.rankModels('text-to-image', req, 'free');
  assert.ok(free.length > 0 && free.every(catalog.isFree), 'Nur gratis: ausschließlich kostenlose Modelle');
  assert.equal(free[0].id, 'pollinations:text-to-image:classic');
  const freeFirst = catalog.rankModels('text-to-image', req, 'free-first');
  assert.ok(catalog.isFree(freeFirst[0]), 'Gratis zuerst');
  assert.ok(freeFirst.some((m) => !catalog.isFree(m)), 'bezahlte Modelle bleiben als Ersatz');
});

test('Gratis-Vorlagen und ComfyUI-Workflows sind vollständig', () => {
  assert.ok(FREE_PRESETS.length >= 8);
  for (const p of FREE_PRESETS) assert.ok(p.title && p.limits && p.tasks.length, p.id);
  assert.ok(HF_SPACES.some((s) => s.task === 'image-to-video'));
  for (const t of COMFY_TEMPLATES) {
    const json = JSON.parse(fillTemplate(JSON.stringify(t.workflow), { prompt: 'Test "x"', negative_prompt: '', seed: 1, width: 1024, height: 576, image: 'in.png' }));
    const nodes = Object.values(json) as { class_type: string; inputs: Record<string, unknown> }[];
    assert.ok(nodes.some((n) => /Save/.test(n.class_type)), `${t.id}: Speicher-Node fehlt`);
    // Alle Verknüpfungen zeigen auf existierende Nodes
    for (const n of nodes) for (const v of Object.values(n.inputs)) if (Array.isArray(v) && typeof v[0] === 'string') assert.ok(json[v[0]], `${t.id}: Node ${v[0]} fehlt`);
    const sampler = nodes.find((n) => n.class_type === 'KSampler')!;
    assert.equal(sampler.inputs.seed, 1, 'Seed als Zahl eingesetzt');
  }
});
