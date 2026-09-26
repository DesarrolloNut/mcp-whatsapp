export type AgentReceptionMode = 'sync_json' | 'sse_stream';
export type ThreadIdMode = 'null' | 'phone';

export interface AgentBinding {
  id: string;
  channelId: string; // Restricción 1:1 estricta por línea telefónica
  name: string;
  agentUrl: string;
  receptionMode: AgentReceptionMode;
  headers: Record<string, string>;
  debounceMs: number; // Por defecto: 1500 ms
  replyField: string; // Por defecto: 'reply'
  threadIdMode: ThreadIdMode; // Por defecto: 'null'
  simulateTyping: boolean; // Por defecto: true
  fallbackMessage: string | null;
  timeoutMs: number; // Por defecto: 15000 ms
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgentPayload {
  channel: string;
  channel_line?: string;
  channel_user_id: string;
  user_id: string;
  message: string;
  thread_id: string | null;
}
