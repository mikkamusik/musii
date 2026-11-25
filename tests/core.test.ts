import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isoliertes Datenverzeichnis für die Tests
process.env.MUSII_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'musii-test-'));

const { buildGenericInput, falImageSize } = await import('../server/providers/generic-input.js');
const { fillTemplate, fillString } = await import('../server/providers/template.js');
const { nearestAspect, nearestDuration, dimsFor } = await import('../server/providers/types.js');
const catalog = await import('../server/catalog.js');
const { db, encrypt, decrypt, maskKey } = await import('../server/store.js');
const { composePrompt } = await import('../server/llm.js');
const { falAdapter } = await import('../server/providers/fal.js');

const fakeMedia = (name: string) =>
  ({
    mime: 'image/png',
    filename: name,
    size: 10,
    publicUrl: () => undefined,
    dataUri: () => `data:image/png;base64,${name}`,
    base64: () => name,
  }) as any;

function baseReq(extra: Record<string, unknown> = {}) {
  return { task: 'image-to-video', prompt: 'test', refImages: [], ...extra } as any;
}

test('Seitenverhältnisse und Dauer werden sinnvoll gerundet', () => {
  assert.equal(nearestAspect('16:9', ['1:1', '16:9', '9:16']), '16:9');
  assert.equal(nearestAspect('21:9', ['1:1', '16:9', '9:16']), '16:9');
  assert.equal(nearestAspect('4:5', ['1280x720', '720x1280']), '720x1280');
  assert.equal(nearestDuration(7, [5, 10]), 5);
  assert.equal(nearestDuration(9, [4, 8, 12]), 8);
  const d = dimsFor('16:9', 1);
  assert.ok(d.width > d.height && d.width % 64 === 0);
  assert.equal(falImageSize('9:16'), 'portrait_16_9');
});

test('fal: Kling bekommt image_url und Dauer als String', async () => {
  const model = catalog.STATIC_MODELS.find((m) => m.id === 'fal:image-to-video:fal-ai/kling-video/v2.1/pro/image-to-video')!;
  const input = await buildGenericInput(
    baseReq({ image: fakeMedia('start'), endImage: fakeMedia('end'), duration: 8, negativePrompt: 'blur', aspectRatio: '16:9' }),
    model,
    'fal',
    async (m: any) => m.dataUri(),
  );
  assert.equal(input.prompt, 'test');
  assert.equal(input.image_url, 'data:image/png;base64,start');
  assert.equal(input.tail_image_url, 'data:image/png;base64,end');
  assert.equal(input.duration, '10');
  assert.equal(input.negative_prompt, 'blur');
  assert.equal(input.aspect_ratio, undefined, 'bei Bild-zu-Video bestimmt das Startbild das Format');
});

test('Replicate: Feld-Umbenennung (start_image) und Weglassen von Feldern', async () => {
  const model = catalog.STATIC_MODELS.find((m) => m.id === 'replicate:image-to-video:kwaivgi/kling-v2.1')!;
  const input = await buildGenericInput(baseReq({ image: fakeMedia('a'), duration: 5, aspectRatio: '16:9' }), model, 'replicate', async (m: any) => m.dataUri());
  assert.equal(input.start_image, 'data:image/png;base64,a');
  assert.equal(input.image, undefined);
  assert.equal(input.mode, 'pro');
  assert.equal(input.aspect_ratio, undefined);
});

test('fal: Seedream nutzt image_size statt aspect_ratio', async () => {
  const model = catalog.STATIC_MODELS.find((m) => m.id === 'fal:text-to-image:fal-ai/bytedance/seedream/v4/text-to-image')!;
  const input = await buildGenericInput({ task: 'text-to-image', prompt: 'x', aspectRatio: '9:16', refImages: [], count: 2 } as any, model, 'fal', async () => '');
  assert.equal(input.image_size, 'portrait_16_9');
  assert.equal(input.aspect_ratio, undefined);
  assert.equal(input.num_images, 2);
});

test('Bearbeitung mit mehreren Referenzen sendet eine Bildliste', async () => {
  const model = catalog.STATIC_MODELS.find((m) => m.id === 'fal:image-edit:fal-ai/nano-banana/edit')!;
  const input = await buildGenericInput(
    { task: 'image-edit', prompt: 'x', image: fakeMedia('a'), refImages: [fakeMedia('b'), fakeMedia('c')] } as any,
    model,
    'fal',
    async (m: any) => m.filename,
  );
  assert.deepEqual(input.image_urls, ['a', 'b', 'c']);
});

test('Vorlagen ersetzen Zahlen typgerecht und Strings sicher', () => {
  const tpl = '{"prompt":"{{prompt}}","seed":"{{seed}}","text":"Bild: {{prompt}}"}';
  const out = JSON.parse(fillTemplate(tpl, { prompt: 'Ein "Zitat"\nmit Umbruch', seed: 42 }));
  assert.equal(out.prompt, 'Ein "Zitat"\nmit Umbruch');
  assert.equal(out.seed, 42);
  assert.equal(out.text, 'Bild: Ein "Zitat"\nmit Umbruch');
  assert.equal(fillString('https://x/{{id}}', { id: 'abc' }), 'https://x/abc');
});

test('API-Schlüssel werden verschlüsselt gespeichert', () => {
  const enc = encrypt('sk-test-1234567890');
  assert.ok(enc.startsWith('enc:'));
  assert.ok(!enc.includes('sk-test'));
  assert.equal(decrypt(enc), 'sk-test-1234567890');
  assert.equal(maskKey(enc), 'sk-t••••7890');
});

test('Smart-Router: Demo ohne Schlüssel, beste Qualität mit Schlüssel, Endframe-Filter', () => {
  // Nur Demo verbunden
  let ranked = catalog.rankModels('image-to-video', { task: 'image-to-video' } as any, 'quality');
  assert.equal(ranked[0].provider, 'demo');

  // fal.ai verbinden
  db.connections.push({ id: 'cn_fal', type: 'fal', name: 'fal', enabled: true, apiKey: encrypt('key'), createdAt: Date.now() });
  ranked = catalog.rankModels('image-to-video', { task: 'image-to-video' } as any, 'quality');
  assert.equal(ranked[0].provider, 'fal');
  assert.ok(ranked[0].quality >= ranked[1].quality);

  // Endframe gewünscht -> nur Modelle mit endFrame
  const withEnd = catalog.rankModels('image-to-video', { task: 'image-to-video', endImage: 'x' } as any, 'quality');
  assert.ok(withEnd.length > 0);
  assert.ok(withEnd.every((m) => m.features?.endFrame));

  // Kosten-Modus bevorzugt günstige Modelle
  const cheap = catalog.rankModels('image-to-video', { task: 'image-to-video' } as any, 'cost');
  assert.ok(cheap[0].cost <= ranked[0].cost);

  // Deaktivierte Modelle werden ignoriert
  db.modelOverrides[ranked[0].id] = { disabled: true };
  const after = catalog.rankModels('image-to-video', { task: 'image-to-video' } as any, 'quality');
  assert.notEqual(after[0].id, ranked[0].id);
  delete db.modelOverrides[ranked[0].id];
});

test('Prompt-Komposition: Stil, Kamera-Mix, Effekt', () => {
  const { prompt, negative } = composePrompt({
    task: 'image-to-video',
    prompt: 'Eine Tänzerin',
    camera: ['dolly-in', 'crane-up'],
    effect: 'lens-flare',
    style: 'photoreal',
  } as any);
  assert.match(prompt, /Eine Tänzerin/);
  assert.match(prompt, /combined movement/);
  assert.match(prompt, /lens flares/);
  assert.match(prompt, /photorealistic/);
  assert.match(negative || '', /cartoon/);
});

test('fal-Adapter: Warteschlange wird abgefragt und Ergebnis ausgelesen', async () => {
  const calls: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method || 'GET'} ${url}`);
    const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url === 'https://queue.fal.run/fal-ai/test-model') {
      assert.equal((init?.headers as Record<string, string>).Authorization, 'Key secret');
      return json({ request_id: 'r1', status_url: 'https://queue.fal.run/s/r1', response_url: 'https://queue.fal.run/res/r1' });
    }
    if (url === 'https://queue.fal.run/s/r1') return json({ status: calls.filter((c) => c.includes('/s/r1')).length > 1 ? 'COMPLETED' : 'IN_PROGRESS' });
    if (url === 'https://queue.fal.run/res/r1') return json({ video: { url: 'https://cdn.fal.media/out.mp4' } });
    throw new Error('unerwartete URL ' + url);
  }) as typeof fetch;
  try {
    const out = await falAdapter.run({
      conn: { id: 'c', type: 'fal', name: 'fal', enabled: true, createdAt: 0 },
      apiKey: 'secret',
      model: { id: 'x', provider: 'fal', task: 'text-to-video', label: 'Test', model: 'fal-ai/test-model', quality: 1, speed: 1, cost: 0 },
      req: { task: 'text-to-video', prompt: 'hi', refImages: [] } as any,
      signal: new AbortController().signal,
      progress: () => undefined,
    });
    assert.deepEqual(out, [{ url: 'https://cdn.fal.media/out.mp4', mime: undefined }]);
    assert.ok(calls.length >= 4);
  } finally {
    globalThis.fetch = realFetch;
  }
});
