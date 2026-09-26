export interface BufferedMessageItem {
  channelId: string;
  chatJid: string;
  senderPhone: string;
  channelLine?: string;
  text: string;
  messageId: string;
  timestamp: number;
}

export interface DebounceDispatchContext {
  channelId: string;
  chatJid: string;
  senderPhone: string;
  channelLine?: string;
  consolidatedText: string;
  messageIds: string[];
}

interface ChatBufferState {
  timer: NodeJS.Timeout | null;
  items: BufferedMessageItem[];
  queuedItems: BufferedMessageItem[];
  isBusy: boolean;
  debounceMs: number;
}

export class MessageDebounceBuffer {
  private readonly buffers = new Map<string, ChatBufferState>();

  constructor(
    private readonly onDispatch: (context: DebounceDispatchContext) => Promise<void>,
    private readonly onTypingState?: (channelId: string, chatJid: string, isTyping: boolean) => Promise<void>
  ) {}

  private getKey(channelId: string, chatJid: string): string {
    return `${channelId}:${chatJid}`;
  }

  /**
   * Adds an incoming message to the buffer and resets the trailing debounce timer.
   */
  public addMessage(item: BufferedMessageItem, debounceMs: number = 1500): void {
    const key = this.getKey(item.channelId, item.chatJid);
    let state = this.buffers.get(key);

    if (!state) {
      state = {
        timer: null,
        items: [],
        queuedItems: [],
        isBusy: false,
        debounceMs,
      };
      this.buffers.set(key, state);
    }

    state.debounceMs = debounceMs;

    // If the agent is currently processing the previous request, hold new messages in queuedItems
    if (state.isBusy) {
      state.queuedItems.push(item);
      return;
    }

    state.items.push(item);

    // Notify typing indicator when user starts/continues writing
    if (this.onTypingState) {
      this.onTypingState(item.channelId, item.chatJid, true).catch(() => {});
    }

    // Reset trailing timer with the configured debounce duration
    if (state.timer) {
      clearTimeout(state.timer);
    }

    state.timer = setTimeout(() => {
      this.triggerDispatch(item.channelId, item.chatJid);
    }, Math.max(200, debounceMs));
  }

  private async triggerDispatch(channelId: string, chatJid: string): Promise<void> {
    const key = this.getKey(channelId, chatJid);
    const state = this.buffers.get(key);
    if (!state || state.items.length === 0) return;

    // Mark as busy so incoming messages during agent response generation go to queuedItems
    state.isBusy = true;
    const messagesToProcess = [...state.items];
    state.items = [];
    state.timer = null;

    // Concatenate sequential message texts with linebreaks
    const consolidatedText = messagesToProcess
      .map((m) => m.text.trim())
      .filter((t) => t.length > 0)
      .join('\n');

    const firstMsg = messagesToProcess[0];
    const messageIds = messagesToProcess.map((m) => m.messageId);

    try {
      if (consolidatedText.length > 0) {
        await this.onDispatch({
          channelId,
          chatJid,
          senderPhone: firstMsg.senderPhone,
          channelLine: firstMsg.channelLine,
          consolidatedText,
          messageIds,
        });
      }
    } catch (err) {
      console.error(`[MessageDebounceBuffer] Error dispatching to agent for ${key}:`, err);
    } finally {
      state.isBusy = false;

      // Stop typing simulation once agent interaction concludes
      if (this.onTypingState) {
        this.onTypingState(channelId, chatJid, false).catch(() => {});
      }

      // If new messages arrived while the agent was generating, schedule them now
      if (state.queuedItems.length > 0) {
        state.items = [...state.queuedItems];
        state.queuedItems = [];
        state.timer = setTimeout(() => {
          this.triggerDispatch(channelId, chatJid);
        }, Math.max(200, state.debounceMs));
      } else {
        // Clean up empty buffer state
        this.buffers.delete(key);
      }
    }
  }

  /**
   * Clears any active buffer for a given chat.
   */
  public clear(channelId: string, chatJid: string): void {
    const key = this.getKey(channelId, chatJid);
    const state = this.buffers.get(key);
    if (state?.timer) {
      clearTimeout(state.timer);
    }
    this.buffers.delete(key);
  }
}
