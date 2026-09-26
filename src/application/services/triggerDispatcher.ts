import crypto from 'node:crypto';
import { ITriggerRepository } from '../../domain/ports/ITriggerRepository.js';
import { Trigger, TriggerDelivery, TriggerContext } from '../../domain/models/trigger.js';
import { DomainEventBus } from './domainEventBus.js';
import { evaluateTemplate } from './templateEngine.js';

export interface TestTriggerResult {
  success: boolean;
  statusCode: number | null;
  durationMs: number;
  payloadSent: any;
  responseBody: string | null;
  error: string | null;
}

export class TriggerDispatcher {
  private isProcessing = false;
  private queueInterval: NodeJS.Timeout | null = null;

  constructor(
    private readonly triggerRepo: ITriggerRepository,
    private readonly eventBus: DomainEventBus = DomainEventBus.getInstance()
  ) {}

  public start(pollIntervalMs: number = 5000): void {
    // Listen for incoming messages
    this.eventBus.onMessageReceived(this.handleIncomingMessage.bind(this));

    // Periodic check for delayed retries
    if (!this.queueInterval) {
      this.queueInterval = setInterval(() => {
        this.processQueue().catch((err) => {
          console.error('[TriggerDispatcher] Background queue processing error:', err);
        });
      }, pollIntervalMs);
    }
  }

  public stop(): void {
    if (this.queueInterval) {
      clearInterval(this.queueInterval);
      this.queueInterval = null;
    }
  }

  /**
   * Evaluates incoming message against active triggers and enqueues deliveries.
   */
  public async handleIncomingMessage(context: TriggerContext): Promise<void> {
    try {
      const activeTriggers = await this.triggerRepo.getActiveTriggersForChannel(context.channel.id);
      if (!activeTriggers || activeTriggers.length === 0) {
        return;
      }

      for (const trigger of activeTriggers) {
        // 1. Group filter
        if (trigger.filterIgnoreGroups && context.chat.isGroup) {
          continue;
        }

        // 2. Message type filter
        if (trigger.filterMessageType && trigger.filterMessageType !== 'all') {
          if (trigger.filterMessageType !== context.message.type) {
            continue;
          }
        }

        // 3. Keyword / text filter
        if (trigger.filterKeyword && trigger.filterKeyword.trim()) {
          const text = (context.message.text || '').toLowerCase();
          const keyword = trigger.filterKeyword.trim().toLowerCase();
          if (!text.includes(keyword)) {
            continue;
          }
        }

        // 4. Build payload
        let payload: any;
        if (trigger.payloadMode === 'custom' && trigger.payloadTemplate && Object.keys(trigger.payloadTemplate).length > 0) {
          payload = evaluateTemplate(trigger.payloadTemplate, context);
        } else {
          payload = {
            event: 'message.received',
            timestamp: context.receivedAt,
            channel: context.channel,
            sender: context.sender,
            chat: context.chat,
            message: context.message,
          };
        }

        const deliveryId = crypto.randomUUID();
        await this.triggerRepo.createDelivery({
          id: deliveryId,
          triggerId: trigger.id,
          messageId: context.message.id,
          channelId: context.channel.id,
          payloadJson: typeof payload === 'string' ? payload : JSON.stringify(payload),
          status: 'pending',
          attempts: 0,
          maxRetries: trigger.maxRetries ?? 3,
          nextRetryAt: Date.now(),
          lastStatusCode: null,
          lastError: null,
        });
      }

      // Trigger immediate asynchronous queue processing
      setImmediate(() => {
        this.processQueue().catch((err) => {
          console.error('[TriggerDispatcher] Error during immediate dispatch:', err);
        });
      });
    } catch (err) {
      console.error('[TriggerDispatcher] Error in handleIncomingMessage:', err);
    }
  }

  /**
   * Processes pending deliveries from SQLite Outbox.
   */
  public async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const pending = await this.triggerRepo.getPendingDeliveries(20);
      for (const delivery of pending) {
        const trigger = await this.triggerRepo.getTriggerById(delivery.triggerId);
        if (!trigger || !trigger.isActive) {
          await this.triggerRepo.updateDelivery(delivery.id, {
            status: 'failed',
            lastError: !trigger ? 'Trigger deleted' : 'Trigger inactive',
          });
          continue;
        }

        await this.executeDelivery(trigger, delivery);
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Executes a single HTTP delivery with timeout, status classification and retry backoff.
   */
  private async executeDelivery(trigger: Trigger, delivery: TriggerDelivery): Promise<void> {
    const attempts = delivery.attempts + 1;

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(trigger.targetHeaders || {}),
      };

      // Inyectar firma HMAC-SHA256 si hay secretToken configurado
      if (trigger.secretToken) {
        const hmac = crypto
          .createHmac('sha256', trigger.secretToken)
          .update(delivery.payloadJson, 'utf8')
          .digest('hex');
        headers['X-Hub-Signature-256'] = `sha256=${hmac}`;
      }

      const timeoutMs = Math.max(1000, Math.min(trigger.timeoutMs || 5000, 30000));
      const response = await fetch(trigger.targetUrl, {
        method: trigger.targetMethod || 'POST',
        headers,
        body: trigger.targetMethod !== 'GET' ? delivery.payloadJson : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });

      const statusCode = response.status;

      // 1. Éxito: 2xx
      if (statusCode >= 200 && statusCode < 300) {
        await this.triggerRepo.updateDelivery(delivery.id, {
          status: 'delivered',
          attempts,
          lastStatusCode: statusCode,
          lastError: null,
        });
        return;
      }

      // 2. Error permanente de cliente: 4xx (excepto 429)
      if (statusCode >= 400 && statusCode < 500 && statusCode !== 429) {
        await this.triggerRepo.updateDelivery(delivery.id, {
          status: 'failed',
          attempts,
          lastStatusCode: statusCode,
          lastError: `Permanent Client Error: HTTP ${statusCode}`,
        });
        return;
      }

      // 3. Error de servidor (5xx) o Rate Limit (429): Reintentable
      this.handleRetryableFailure(trigger, delivery, attempts, statusCode, `Server Error: HTTP ${statusCode}`);
    } catch (err) {
      const errorMsg = (err as Error).message || 'Network / Timeout error';
      this.handleRetryableFailure(trigger, delivery, attempts, null, errorMsg);
    }
  }

  private async handleRetryableFailure(
    trigger: Trigger,
    delivery: TriggerDelivery,
    attempts: number,
    statusCode: number | null,
    errorMsg: string
  ): Promise<void> {
    const maxRetries = trigger.maxRetries ?? 3;
    if (attempts >= maxRetries) {
      // Reintentos agotados -> Marcar failed
      await this.triggerRepo.updateDelivery(delivery.id, {
        status: 'failed',
        attempts,
        lastStatusCode: statusCode,
        lastError: errorMsg,
      });
    } else {
      // Calcular siguiente intento con backoff exponencial
      const baseDelay = trigger.retryDelayMs || 10000;
      const nextDelay = baseDelay * Math.pow(2, attempts - 1);
      await this.triggerRepo.updateDelivery(delivery.id, {
        status: 'pending',
        attempts,
        nextRetryAt: Date.now() + nextDelay,
        lastStatusCode: statusCode,
        lastError: errorMsg,
      });
    }
  }

  /**
   * Executes a simulated test of the trigger with mock context.
   */
  public async testTrigger(trigger: Trigger, mockContext?: Partial<TriggerContext>): Promise<TestTriggerResult> {
    const context: TriggerContext = {
      channel: {
        id: trigger.channelId || 'test_channel_01',
        name: 'Canal de Prueba',
        phoneNumber: '+5491100000000',
      },
      sender: {
        jid: '5491199887766@s.whatsapp.net',
        phoneNumber: '5491199887766',
        name: 'Contacto Mock',
      },
      chat: {
        jid: '5491199887766@s.whatsapp.net',
        isGroup: false,
        name: 'Contacto Mock',
      },
      message: {
        id: `TEST_${Date.now()}`,
        text: 'Mensaje de prueba para verificar disparador',
        type: 'text',
        timestamp: Date.now(),
        timestampISO: new Date().toISOString(),
      },
      receivedAt: new Date().toISOString(),
      ...mockContext,
    };

    let payload: any;
    if (trigger.payloadMode === 'custom' && trigger.payloadTemplate && Object.keys(trigger.payloadTemplate).length > 0) {
      payload = evaluateTemplate(trigger.payloadTemplate, context);
    } else {
      payload = {
        event: 'message.received',
        isTest: true,
        timestamp: context.receivedAt,
        channel: context.channel,
        sender: context.sender,
        chat: context.chat,
        message: context.message,
      };
    }

    const payloadJson = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Trigger-Test': 'true',
      ...(trigger.targetHeaders || {}),
    };

    if (trigger.secretToken) {
      const hmac = crypto
        .createHmac('sha256', trigger.secretToken)
        .update(payloadJson, 'utf8')
        .digest('hex');
      headers['X-Hub-Signature-256'] = `sha256=${hmac}`;
    }

    const startTime = Date.now();
    try {
      const timeoutMs = Math.max(1000, Math.min(trigger.timeoutMs || 5000, 30000));
      const response = await fetch(trigger.targetUrl, {
        method: trigger.targetMethod || 'POST',
        headers,
        body: trigger.targetMethod !== 'GET' ? payloadJson : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });

      const durationMs = Date.now() - startTime;
      let responseBody: string | null = null;
      try {
        responseBody = await response.text();
      } catch {}

      return {
        success: response.status >= 200 && response.status < 300,
        statusCode: response.status,
        durationMs,
        payloadSent: payload,
        responseBody,
        error: response.status >= 400 ? `HTTP ${response.status} ${response.statusText}` : null,
      };
    } catch (err) {
      const durationMs = Date.now() - startTime;
      return {
        success: false,
        statusCode: null,
        durationMs,
        payloadSent: payload,
        responseBody: null,
        error: (err as Error).message || 'Network / Timeout error',
      };
    }
  }
}
