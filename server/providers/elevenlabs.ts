import { http, httpJson, ProviderError } from '../util.js';
import type { ProviderAdapter } from './types.js';

const BASE = 'https://api.elevenlabs.io/v1';

export async function listElevenVoices(baseUrl: string | undefined, apiKey: string) {
  const j = await httpJson(`${(baseUrl || BASE).replace(/\/$/, '')}/voices`, { headers: { 'xi-api-key': apiKey }, timeoutMs: 20_000 });
  return (j?.voices || []).map((v: any) => ({ id: v.voice_id, name: v.name, preview: v.preview_url, labels: v.labels }));
}

export const elevenlabsAdapter: ProviderAdapter = {
  info: {
    type: 'elevenlabs',
    label: 'ElevenLabs',
    description: 'Die natürlichsten Stimmen (mehrsprachig), Soundeffekte aus Text und Musik-Generierung – ideal für sprechende Avatare.',
    website: 'https://elevenlabs.io',
    keyUrl: 'https://elevenlabs.io/app/settings/api-keys',
    tasks: ['tts', 'sfx', 'music'],
    needsKey: true,
    baseUrl: { default: BASE },
  },
  async run(ctx) {
    const { model, req, apiKey, signal } = ctx;
    const base = (ctx.conn.baseUrl || BASE).replace(/\/$/, '');
    const headers = { 'xi-api-key': apiKey, Accept: 'audio/mpeg' };
    let res: Response;
    switch (model.task) {
      case 'tts': {
        let voice = req.voice;
        if (!voice) {
          const voices = await listElevenVoices(ctx.conn.baseUrl, apiKey);
          voice = voices[0]?.id;
        }
        if (!voice) throw new ProviderError('Keine ElevenLabs-Stimme verfügbar', 400, false);
        res = await http(`${base}/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, {
          json: { text: req.prompt, model_id: model.model, ...model.params, ...req.extraParams },
          headers,
          signal,
        });
        break;
      }
      case 'sfx':
        res = await http(`${base}/sound-generation`, {
          json: {
            text: req.prompt,
            ...(req.duration ? { duration_seconds: Math.min(Math.max(req.duration, 0.5), 30) } : {}),
            ...model.params,
            ...req.extraParams,
          },
          headers,
          signal,
        });
        break;
      case 'music':
        res = await http(`${base}/music`, {
          json: {
            prompt: req.prompt,
            music_length_ms: Math.round(Math.min(Math.max(req.duration || 30, 10), 300) * 1000),
            ...model.params,
            ...req.extraParams,
          },
          headers,
          signal,
          timeoutMs: 10 * 60_000,
        });
        break;
      default:
        throw new ProviderError(`ElevenLabs unterstützt ${model.task} nicht`, 400, false);
    }
    return [{ buffer: Buffer.from(await res.arrayBuffer()), mime: res.headers.get('content-type') || 'audio/mpeg' }];
  },
  async test(conn, apiKey) {
    const voices = await listElevenVoices(conn.baseUrl, apiKey);
    return `Verbunden – ${voices.length} Stimmen verfügbar`;
  },
};
