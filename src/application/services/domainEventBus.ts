import { EventEmitter } from 'node:events';
import { TriggerContext } from '../../domain/models/trigger.js';

export class DomainEventBus extends EventEmitter {
  private static instance: DomainEventBus;

  private constructor() {
    super();
    // Allow ample listeners for multiple triggers/modules without warning
    this.setMaxListeners(50);
  }

  public static getInstance(): DomainEventBus {
    if (!DomainEventBus.instance) {
      DomainEventBus.instance = new DomainEventBus();
    }
    return DomainEventBus.instance;
  }

  public emitMessageReceived(context: TriggerContext): boolean {
    return this.emit('message:received', context);
  }

  public onMessageReceived(handler: (context: TriggerContext) => void | Promise<void>): this {
    return this.on('message:received', (context: TriggerContext) => {
      Promise.resolve(handler(context)).catch((err) => {
        console.error('[DomainEventBus] Error handling message:received event:', err);
      });
    });
  }
}
