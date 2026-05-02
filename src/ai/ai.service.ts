import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiChatDto } from './dto/chat.dto';
import { AiResponse, N8nWebhookPayload, ALLOWED_INTENTS } from './types';
import { AiActionService } from './ai-action.service';
import { detectMockIntent } from './providers/mock-ai.provider';
import { callN8nWebhook, validateN8nResponse } from './providers/n8n-ai.provider';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly actionService: AiActionService,
  ) {}

  private get provider(): string {
    return this.config.get<string>('AI_PROVIDER') ?? process.env.AI_PROVIDER ?? 'mock';
  }

  async chat(userId: string, dto: AiChatDto): Promise<AiResponse> {
    const p = this.provider;
    switch (p) {
      case 'n8n': return this.chatN8n(userId, dto);
      case 'openai': return this.chatOpenAI(userId, dto);
      case 'ollama': return this.chatOllama(userId, dto);
      default: return this.chatMock(userId, dto);
    }
  }

  private async chatMock(userId: string, dto: AiChatDto): Promise<AiResponse> {
    const intentResult = detectMockIntent(dto.message, dto.context as Record<string, unknown> | undefined);
    return this.actionService.execute(userId, intentResult, 'mock');
  }

  private async chatN8n(userId: string, dto: AiChatDto): Promise<AiResponse> {
    const webhookUrl =
      this.config.get<string>('N8N_AI_WEBHOOK_URL') ?? process.env.N8N_AI_WEBHOOK_URL;
    if (!webhookUrl) {
      this.logger.warn('[AI] N8N_AI_WEBHOOK_URL not set — falling back to mock');
      return this.chatMock(userId, dto);
    }
    const secret =
      this.config.get<string>('N8N_AI_WEBHOOK_SECRET') ?? process.env.N8N_AI_WEBHOOK_SECRET;
    const payload: N8nWebhookPayload = {
      message: dto.message,
      context: (dto.context as Record<string, unknown>) ?? {},
      user: { id: userId },
      allowedActions: ALLOWED_INTENTS,
      schemaVersion: 1,
    };
    const intentResult = await callN8nWebhook(webhookUrl, secret, payload);
    return this.actionService.execute(userId, intentResult, 'n8n');
  }

  private async chatOpenAI(userId: string, dto: AiChatDto): Promise<AiResponse> {
    const apiKey =
      this.config.get<string>('OPENAI_API_KEY') ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
      this.logger.warn('[AI] OPENAI_API_KEY not set — falling back to mock');
      return this.chatMock(userId, dto);
    }
    try {
      // Dynamic import — avoids crashing if openai package is not installed
      const OpenAI = (await import(/* webpackIgnore: true */ 'openai' as any)).default;
      const client = new OpenAI({ apiKey });
      const model =
        this.config.get<string>('OPENAI_MODEL') ?? process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
      const response = await client.chat.completions.create({
        model,
        messages: [
          {
            role: 'system',
            content: `You are a music streaming app assistant. Respond with JSON only: { "intent": one of [${ALLOWED_INTENTS.join(',')}], "parameters": {}, "confidence": 0-1, "needsConfirmation": false, "replyDraft": "..." }`,
          },
          { role: 'user', content: dto.message },
        ],
        response_format: { type: 'json_object' },
        max_tokens: parseInt(process.env.AI_CHAT_MAX_TOKENS ?? '300'),
        temperature: parseFloat(process.env.AI_CHAT_TEMPERATURE ?? '0.3'),
      });
      const raw = JSON.parse(response.choices[0]?.message?.content ?? '{}');
      const intentResult = validateN8nResponse(raw, dto.message, (dto.context as Record<string, unknown>) ?? {});
      return this.actionService.execute(userId, intentResult, 'openai');
    } catch (err) {
      this.logger.error(`[AI] OpenAI failed: ${err}`);
    }
    return this.chatMock(userId, dto);
  }

  private async chatOllama(userId: string, dto: AiChatDto): Promise<AiResponse> {
    const ollamaUrl =
      this.config.get<string>('OLLAMA_URL') ?? process.env.OLLAMA_URL ?? 'http://localhost:11434';
    const ollamaModel =
      this.config.get<string>('OLLAMA_MODEL') ?? process.env.OLLAMA_MODEL ?? 'llama3';
    try {
      const res = await fetch(`${ollamaUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: ollamaModel,
          messages: [
            {
              role: 'system',
              content: `You are a music streaming app assistant. Respond with JSON only: { "intent": one of [${ALLOWED_INTENTS.join(',')}], "parameters": {}, "confidence": 0-1, "needsConfirmation": false, "replyDraft": "..." }`,
            },
            { role: 'user', content: dto.message },
          ],
          stream: false,
          format: 'json',
        }),
        signal: AbortSignal.timeout(12_000),
      });
      if (res.ok) {
        const data = await res.json() as any;
        const content = data?.message?.content ?? data?.response ?? '';
        const raw: unknown = typeof content === 'string' ? JSON.parse(content) : content;
        const intentResult = validateN8nResponse(raw, dto.message, (dto.context as Record<string, unknown>) ?? {});
        return this.actionService.execute(userId, intentResult, 'ollama');
      }
    } catch (err) {
      this.logger.warn(`[AI] Ollama failed: ${err}`);
    }
    return this.chatMock(userId, dto);
  }
}
