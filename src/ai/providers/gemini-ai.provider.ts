import { Logger } from '@nestjs/common';
import { AiIntentResult, ALLOWED_INTENTS, N8nWebhookPayload } from '../types';
import { detectMockIntent } from './mock-ai.provider';
import { validateStructuredAiResponse } from './n8n-ai.provider';

const logger = new Logger('GeminiAiProvider');
const GEMINI_TIMEOUT_MS = 10_000;

export async function callGeminiStructuredParser(
  apiKey: string,
  payload: N8nWebhookPayload,
  model = 'gemini-1.5-flash',
): Promise<AiIntentResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json',
          },
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: buildGeminiPrompt(payload),
                },
              ],
            },
          ],
        }),
      },
    );
    clearTimeout(timer);

    if (!res.ok) {
      logger.warn(`[Gemini] HTTP ${res.status}; falling back to local parser`);
      return detectMockIntent(payload.message, payload.context);
    }

    const data = await res.json() as any;
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
    const raw = JSON.parse(text);
    return validateStructuredAiResponse(raw, payload.message, payload.context);
  } catch (err) {
    clearTimeout(timer);
    logger.warn(`[Gemini] parser failed: ${String(err)}; falling back to local parser`);
    return detectMockIntent(payload.message, payload.context);
  }
}

function buildGeminiPrompt(payload: N8nWebhookPayload): string {
  return JSON.stringify({
    instruction:
      'You are IQA3 NLU only. Return strict JSON only. Never execute actions or claim database changes. Backend will validate and execute.',
    schema: {
      responseType: ['answer', 'action', 'clarification', 'refusal'],
      intent: ALLOWED_INTENTS,
      parameters: 'object',
      replyDraft: 'short string',
      confidence: 'number 0..1',
      needsConfirmation: 'boolean',
      clarifyingQuestion: 'optional string',
    },
    rules: [
      'Unsafe delete/admin/payment/password/security requests must be responseType refusal, intent unknown.',
      'profile/user/person names are profileName, not genre.',
      'create playlist with profile mohan tracks => create_playlist_from_profile {profileName:"mohan",limit:10,playlistName:"Mohan Mix"}',
      'create playlist with mohan tracks => create_playlist_from_profile {profileName:"mohan",limit:10}',
      'find me mohan tracks => search_tracks {profileName:"mohan",limit:10}',
      'best track by user maryam => search_tracks {profileName:"maryam",mode:"artist_best",limit:1}',
      'send/play this require context.trackId.',
    ],
    allowedActions: payload.allowedActions,
    context: payload.context,
    user: { id: payload.user.id },
    message: payload.message,
  });
}
