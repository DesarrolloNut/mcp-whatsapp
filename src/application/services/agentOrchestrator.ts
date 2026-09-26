import { IAgentBindingRepository } from '../../domain/ports/IAgentBindingRepository.js';
import { ChannelResolver } from './channelResolver.js';
import { AgentConnector } from './agentConnector.js';
import { MessageDebounceBuffer, DebounceDispatchContext } from './messageDebounceBuffer.js';
import { DomainEventBus } from './domainEventBus.js';
import { TriggerContext } from '../../domain/models/trigger.js';
import { BaileysSessionManager } from '../../infrastructure/providers/baileys/sessionManager.js';
import { AgentPayload } from '../../domain/models/agentBinding.js';

export class AgentOrchestrator {
  private readonly debounceBuffer: MessageDebounceBuffer;
  private isListening = false;

  constructor(
    private readonly bindingRepo: IAgentBindingRepository,
    private readonly channelResolver: ChannelResolver,
    private readonly agentConnector: AgentConnector,
    private readonly sessionManager: BaileysSessionManager
  ) {
    this.debounceBuffer = new MessageDebounceBuffer(
      (context) => this.handleDispatch(context),
      (channelId, chatJid, isTyping) => this.handleTyping(channelId, chatJid, isTyping)
    );
  }

  public start(): void {
    if (this.isListening) return;
    this.isListening = true;

    DomainEventBus.getInstance().onMessageReceived((context) => {
      this.handleIncomingMessage(context).catch((err) => {
        console.error('[AgentOrchestrator] Error processing incoming message:', err);
      });
    });
  }

  private async handleIncomingMessage(context: TriggerContext): Promise<void> {
    // Ignore group chats by default to prevent spamming in groups
    if (context.chat.isGroup) return;

    const text = context.message.text?.trim();
    if (!text) return;

    // Check if the channel has an active AI agent binding (1:1 relation)
    const binding = await this.bindingRepo.getBindingByChannelId(context.channel.id);
    if (!binding || !binding.isActive) return;

    this.debounceBuffer.addMessage(
      {
        channelId: context.channel.id,
        chatJid: context.chat.jid,
        senderPhone: context.sender.phoneNumber || context.chat.jid.replace(/[^0-9]/g, ''),
        channelLine: context.channel.phoneNumber,
        text,
        messageId: context.message.id,
        timestamp: context.message.timestamp,
      },
      binding.debounceMs
    );
  }

  private async handleTyping(channelId: string, chatJid: string, isTyping: boolean): Promise<void> {
    try {
      const binding = await this.bindingRepo.getBindingByChannelId(channelId);
      if (binding && binding.isActive && binding.simulateTyping) {
        await this.sessionManager.setPresence(channelId, chatJid, isTyping ? 'composing' : 'paused');
      }
    } catch {
      // Non-critical
    }
  }

  private async handleDispatch(context: DebounceDispatchContext): Promise<void> {
    const binding = await this.bindingRepo.getBindingByChannelId(context.channelId);
    if (!binding || !binding.isActive) return;

    let resolvedChannel;
    let adapter;
    try {
      const resolved = await this.channelResolver.resolve(context.channelId);
      resolvedChannel = resolved.channel;
      adapter = resolved.adapter;
    } catch (err) {
      console.error(`[AgentOrchestrator] Could not resolve channel ${context.channelId}:`, err);
      return;
    }

    const payload: AgentPayload = {
      channel: 'whatsapp',
      channel_line: resolvedChannel.phoneNumber || context.channelLine || undefined,
      channel_user_id: context.senderPhone,
      user_id: context.senderPhone,
      message: context.consolidatedText,
      thread_id: binding.threadIdMode === 'phone' ? context.senderPhone : null,
    };

    try {
      const result = await this.agentConnector.callAgent(binding, payload);
      if (result.reply && result.reply.length > 0) {
        await adapter.sendText(
          {
            recipient: context.chatJid,
            text: result.reply,
          },
          resolvedChannel
        );
      }
    } catch (err) {
      console.error(`[AgentOrchestrator] AI Agent call failed for line ${context.channelId}:`, (err as Error).message);
      if (binding.fallbackMessage && binding.fallbackMessage.trim().length > 0) {
        try {
          await adapter.sendText(
            {
              recipient: context.chatJid,
              text: binding.fallbackMessage.trim(),
            },
            resolvedChannel
          );
        } catch (sendErr) {
          console.error(`[AgentOrchestrator] Failed to send contingency fallback message:`, sendErr);
        }
      }
    }
  }
}
