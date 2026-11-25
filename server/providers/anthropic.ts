import Anthropic from '@anthropic-ai/sdk';
import type { Connection, ModelDef } from '../types.js';
import { ProviderError } from '../util.js';
import type { LlmCall, ProviderAdapter } from './types.js';

const VISION_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

// Modelle, für die serverseitige Refusal-Fallbacks verfügbar sind
const FALLBACK_MODELS = /^claude-(fable-5|mythos-5|opus-5|sonnet-5-5)/;

function client(conn: Connection, apiKey: string) {
  return new Anthropic({
    apiKey,
    ...(conn.baseUrl ? { baseURL: conn.baseUrl } : {}),
    maxRetries: 2,
    timeout: 5 * 60_000,
  });
}

export const anthropicAdapter: ProviderAdapter = {
  info: {
    type: 'anthropic',
    label: 'Anthropic Claude',
    description: 'Claude als Prompt-Regisseur (Prompt-Verbesserung, Varianten, Bild-zu-Prompt) und als KI-Jury, die Ergebnisse bewertet.',
    website: 'https://platform.claude.com',
    keyUrl: 'https://platform.claude.com/settings/keys',
    tasks: ['llm'],
    needsKey: true,
    baseUrl: {},
  },
  async run() {
    throw new ProviderError('Claude erzeugt keine Medien – wird als Prompt-Assistent und KI-Jury genutzt.', 400, false);
  },
  async llm(conn: Connection, apiKey: string, model: ModelDef, call: LlmCall, signal?: AbortSignal) {
    const c = client(conn, apiKey);
    const content: Anthropic.Beta.Messages.BetaContentBlockParam[] = [];
    for (const img of call.images || []) {
      if (!VISION_TYPES.has(img.mime)) continue;
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: img.mime as 'image/png', data: img.base64() },
      });
    }
    content.push({ type: 'text', text: call.prompt });

    const useFallbacks = FALLBACK_MODELS.test(model.model);
    const response = await c.beta.messages.create(
      {
        model: model.model,
        max_tokens: call.maxTokens ?? 16000,
        ...(call.system ? { system: call.system } : {}),
        messages: [{ role: 'user', content }],
        output_config: { effort: call.effort ?? 'low' },
        ...(useFallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      },
      { signal },
    );
    if (response.stop_reason === 'refusal') {
      throw new ProviderError(
        `Claude hat die Anfrage abgelehnt${response.stop_details?.explanation ? ': ' + response.stop_details.explanation : ''}`,
        undefined,
        false,
      );
    }
    const text = response.content
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('')
      .trim();
    if (!text) throw new ProviderError('Leere Antwort von Claude');
    return text;
  },
  async test(conn, apiKey) {
    const c = client(conn, apiKey);
    const page = await c.models.list({ limit: 50 });
    return `Verbunden – ${page.data.length} Claude-Modelle verfügbar`;
  },
};
