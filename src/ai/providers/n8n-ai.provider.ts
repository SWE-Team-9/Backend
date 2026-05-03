import { Logger } from '@nestjs/common';
import { AiIntentResult, AllowedIntent, ALLOWED_INTENTS, N8nWebhookPayload } from '../types';
import { detectMockIntent } from './mock-ai.provider';

const logger = new Logger('N8nAiProvider');
const TIMEOUT_MS = 10_000;

export async function callN8nWebhook(
  webhookUrl: string,
  secret: string | undefined,
  payload: N8nWebhookPayload,
): Promise<AiIntentResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (secret) headers['X-IQA3-AI-SECRET'] = secret;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      logger.warn(`[N8N] Webhook returned HTTP ${res.status}`);
      return fallback(payload.message, payload.context);
    }

    const raw = await res.json() as unknown;
    return validateN8nResponse(raw, payload.message, payload.context);
  } catch (err) {
    clearTimeout(timer);
    logger.warn(`[N8N] Webhook call failed: ${String(err)} — falling back to mock`);
    return fallback(payload.message, payload.context);
  }
}

export function validateN8nResponse(raw: unknown, message: string, context: Record<string, unknown>): AiIntentResult {
  return validateStructuredAiResponse(raw, message, context);
}

export function validateStructuredAiResponse(raw: unknown, message: string, context: Record<string, unknown>): AiIntentResult {
  if (context?.pendingIntent) return fallback(message, context);

  if (!raw || typeof raw !== 'object') return safeClarification();
  const obj = raw as Record<string, unknown>;

  const responseType = obj['responseType'] as string | undefined;
  const intent = obj['intent'] as string | undefined;
  const confidence = typeof obj['confidence'] === 'number' ? obj['confidence'] : 0.5;
  const parameters = (obj['parameters'] && typeof obj['parameters'] === 'object') ? obj['parameters'] as Record<string, unknown> : {};
  const allowedResponseTypes = ['answer', 'action', 'clarification', 'refusal'];

  // Reject unknown or non-whitelisted intents
  if (!intent || !(ALLOWED_INTENTS as readonly string[]).includes(intent)) {
    logger.warn(`[N8N] Unknown intent "${intent}" — falling back to mock`);
    return {
      intent: 'unknown',
      responseType: 'refusal',
      parameters: {},
      replyDraft: 'I could not safely understand that request.',
      confidence: 1,
      needsConfirmation: false,
    };
  }

  // Low confidence → ask clarification
  if (confidence < 0.5) {
    const question = typeof obj['clarifyingQuestion'] === 'string' ? obj['clarifyingQuestion'] : 'Could you clarify what you\'d like to do?';
    return {
      intent: 'clarification_needed',
      responseType: 'clarification',
      parameters: {},
      replyDraft: question,
      confidence,
      needsConfirmation: true,
      clarifyingQuestion: question,
    };
  }

  return {
    intent: intent as AllowedIntent,
    responseType: allowedResponseTypes.includes(responseType ?? '')
      ? responseType as AiIntentResult['responseType']
      : undefined,
    parameters,
    replyDraft: typeof obj['replyDraft'] === 'string' ? obj['replyDraft'] : undefined,
    confidence,
    needsConfirmation: typeof obj['needsConfirmation'] === 'boolean' ? obj['needsConfirmation'] : false,
    clarifyingQuestion: typeof obj['clarifyingQuestion'] === 'string' ? obj['clarifyingQuestion'] : undefined,
  };
}

function fallback(message: string, context: Record<string, unknown>): AiIntentResult {
  return detectMockIntent(message, context);
}

function safeClarification(): AiIntentResult {
  return {
    intent: 'clarification_needed',
    responseType: 'clarification',
    parameters: {},
    replyDraft: 'Could you clarify what you would like me to do?',
    confidence: 0.4,
    needsConfirmation: true,
    clarifyingQuestion: 'Could you clarify what you would like me to do?',
  };
}
