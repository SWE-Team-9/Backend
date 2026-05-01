import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';

export interface FcmPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

@Injectable()
export class FcmService implements OnModuleInit {
  private readonly logger = new Logger(FcmService.name);
  private app: admin.app.App | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const projectId = this.config.get<string>('firebase.projectId');
    const clientEmail = this.config.get<string>('firebase.clientEmail');
    const privateKeyRaw = this.config.get<string>('firebase.privateKey');
    const privateKey = privateKeyRaw ? privateKeyRaw.replace(/\\n/g, '\n') : undefined;

    if (!projectId || !clientEmail || !privateKey) {
      this.logger.warn('Firebase credentials not configured — FCM push notifications disabled');
      return;
    }

    // Re-use existing app if already initialized (e.g. hot-reload in dev)
    if (admin.apps.length > 0) {
      this.app = admin.apps[0]!;
      return;
    }

    try {
      this.app = admin.initializeApp({
        credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
      });
      this.logger.log('Firebase Admin SDK initialized');
    } catch (err) {
      this.logger.error('Failed to initialize Firebase Admin SDK — FCM disabled', err as any);
      this.app = null;
    }
  }

  /**
   * Send a push notification to multiple device tokens.
   * Returns the list of tokens that are no longer valid (should be deactivated).
   */
  async sendMulticast(tokens: string[], payload: FcmPayload): Promise<string[]> {
    if (!this.app || tokens.length === 0) return [];

    const messaging = admin.messaging(this.app);

    const message: admin.messaging.MulticastMessage = {
      tokens,
      notification: {
        title: payload.title,
        body: payload.body,
      },
      data: payload.data,
      android: {
        priority: 'high',
        notification: { sound: 'default' },
      },
      apns: {
        payload: { aps: { sound: 'default' } },
      },
    };

    let response: admin.messaging.BatchResponse;
    try {
      response = await messaging.sendEachForMulticast(message);
    } catch (err) {
      this.logger.error('FCM sendEachForMulticast failed', err);
      return [];
    }

    const invalidTokens: string[] = [];
    response.responses.forEach((res, idx) => {
      if (!res.success) {
        const code = res.error?.code;
        if (
          code === 'messaging/registration-token-not-registered' ||
          code === 'messaging/invalid-registration-token'
        ) {
          invalidTokens.push(tokens[idx]);
        } else {
          this.logger.warn(`FCM send failed for token[${idx}]: ${code}`);
        }
      }
    });

    return invalidTokens;
  }
}
