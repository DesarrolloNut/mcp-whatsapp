export type TriggerPayloadMode = 'standard' | 'custom';
export type TriggerMethod = 'POST' | 'PUT' | 'GET';
export type DeliveryStatus = 'pending' | 'delivered' | 'failed';

export interface Trigger {
  id: string;
  name: string;
  channelId: string | null;
  isActive: boolean;
  filterMessageType: string;
  filterIgnoreGroups: boolean;
  filterKeyword: string | null;
  targetUrl: string;
  targetMethod: TriggerMethod;
  targetHeaders: Record<string, string>;
  payloadMode: TriggerPayloadMode;
  payloadTemplate: Record<string, any>;
  timeoutMs: number;
  maxRetries: number;
  retryDelayMs: number;
  secretToken: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TriggerDelivery {
  id: string;
  triggerId: string;
  messageId: string;
  channelId: string;
  payloadJson: string;
  status: DeliveryStatus;
  attempts: number;
  maxRetries: number;
  nextRetryAt: number;
  lastStatusCode: number | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TriggerContext {
  channel: {
    id: string;
    name: string;
    phoneNumber?: string;
  };
  sender: {
    jid: string;
    phoneNumber: string;
    name?: string;
  };
  chat: {
    jid: string;
    isGroup: boolean;
    name?: string;
  };
  message: {
    id: string;
    text?: string;
    type: string;
    timestamp: number;
    timestampISO: string;
    mediaUrl?: string;
    mentions?: string[];
  };
  receivedAt: string;
}
