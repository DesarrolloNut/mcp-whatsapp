import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  WASocket,
  fetchLatestBaileysVersion,
  Browsers,
  WAMessage,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import fs from 'node:fs';
import path from 'node:path';
import { Boom } from '@hapi/boom';
import { SqliteMessageRepository } from '../../database/repositories/messageRepo.js';
import { DomainEventBus } from '../../../application/services/domainEventBus.js';

export type SessionStatus = 'disconnected' | 'connecting' | 'qr_ready' | 'connected';

export interface SessionInstance {
  channelId: string;
  socket: WASocket | null;
  status: SessionStatus;
  qrRaw: string | null;
  qrDataUrl: string | null;
  userPhone: string | null;
  lastError?: string;
  reconnectAttempts: number;
}

export type OnConnectedHandler = (channelId: string, userPhone: string) => Promise<void>;

export function extractMessageText(msg: WAMessage): string | undefined {
  let m = msg.message;
  if (!m) return undefined;

  if (m.ephemeralMessage?.message) m = m.ephemeralMessage.message;
  if (m.viewOnceMessage?.message) m = m.viewOnceMessage.message;
  if (m.viewOnceMessageV2?.message) m = m.viewOnceMessageV2.message;
  if (m.documentWithCaptionMessage?.message) m = m.documentWithCaptionMessage.message;

  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    m.templateButtonReplyMessage?.selectedDisplayText ||
    m.buttonsResponseMessage?.selectedDisplayText ||
    m.listResponseMessage?.title ||
    m.reactionMessage?.text ||
    undefined
  );
}

export function extractMessageType(msg: WAMessage): string {
  let m = msg.message;
  if (!m) return 'unknown';

  if (m.ephemeralMessage?.message) m = m.ephemeralMessage.message;
  if (m.viewOnceMessage?.message) m = m.viewOnceMessage.message;
  if (m.viewOnceMessageV2?.message) m = m.viewOnceMessageV2.message;
  if (m.documentWithCaptionMessage?.message) m = m.documentWithCaptionMessage.message;

  if (m.conversation || m.extendedTextMessage) return 'text';
  if (m.imageMessage) return 'image';
  if (m.videoMessage) return 'video';
  if (m.audioMessage) return 'audio';
  if (m.documentMessage) return 'document';
  if (m.stickerMessage) return 'sticker';
  if (m.locationMessage) return 'location';
  if (m.contactMessage || m.contactsArrayMessage) return 'contact';
  if (m.reactionMessage) return 'reaction';
  return 'other';
}

export class BaileysSessionManager {
  private static instance: BaileysSessionManager;
  private readonly sessions = new Map<string, SessionInstance>();
  private readonly reconnectTimers = new Map<string, NodeJS.Timeout>();
  private readonly baseSessionPath: string;
  private readonly logger = pino({ level: 'warn' });
  private onConnectedCallback?: OnConnectedHandler;
  private messageRepo?: SqliteMessageRepository;

  constructor(baseSessionPath: string = './data/sessions', messageRepo?: SqliteMessageRepository) {
    this.baseSessionPath = path.resolve(baseSessionPath);
    this.messageRepo = messageRepo;
    if (!fs.existsSync(this.baseSessionPath)) {
      fs.mkdirSync(this.baseSessionPath, { recursive: true });
    }
  }

  public static getInstance(baseSessionPath?: string, messageRepo?: SqliteMessageRepository): BaileysSessionManager {
    if (!BaileysSessionManager.instance) {
      BaileysSessionManager.instance = new BaileysSessionManager(baseSessionPath, messageRepo);
    } else if (messageRepo && !BaileysSessionManager.instance.messageRepo) {
      BaileysSessionManager.instance.messageRepo = messageRepo;
    }
    return BaileysSessionManager.instance;
  }

  public setMessageRepo(repo: SqliteMessageRepository): void {
    this.messageRepo = repo;
  }

  public getMessageRepo(): SqliteMessageRepository | undefined {
    return this.messageRepo;
  }

  public setOnConnected(handler: OnConnectedHandler): void {
    this.onConnectedCallback = handler;
  }

  public getSession(channelId: string): SessionInstance | undefined {
    return this.sessions.get(channelId);
  }

  public getSocket(channelId: string): WASocket | null {
    return this.sessions.get(channelId)?.socket || null;
  }

  public getStatus(channelId: string): {
    status: SessionStatus;
    qrDataUrl: string | null;
    userPhone: string | null;
    isConnected: boolean;
  } {
    const session = this.sessions.get(channelId);
    if (!session) {
      return {
        status: 'disconnected',
        qrDataUrl: null,
        userPhone: null,
        isConnected: false,
      };
    }
    return {
      status: session.status,
      qrDataUrl: session.qrDataUrl,
      userPhone: session.userPhone,
      isConnected: session.status === 'connected',
    };
  }

  public async startSession(channelId: string, options: { forceNew?: boolean } = {}): Promise<SessionInstance> {
    // Clear any pending reconnection timer for this channel
    const timer = this.reconnectTimers.get(channelId);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(channelId);
    }

    if (options.forceNew) {
      await this.cleanupSession(channelId, true);
    } else {
      const existing = this.sessions.get(channelId);
      if (existing && existing.status === 'connected' && existing.socket) {
        return existing;
      }
      if (existing && existing.status === 'qr_ready' && existing.qrDataUrl) {
        return existing;
      }
      // If there's an existing stale socket, close it cleanly
      if (existing?.socket) {
        try {
          existing.socket.ev.removeAllListeners('connection.update');
          existing.socket.ev.removeAllListeners('creds.update');
          existing.socket.ws?.close();
        } catch {}
        existing.socket = null;
      }
    }

    return this.initSocket(channelId);
  }

  private async initSocket(channelId: string): Promise<SessionInstance> {
    const sessionDir = path.join(this.baseSessionPath, channelId);
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }

    let sessionState = this.sessions.get(channelId);
    if (!sessionState) {
      sessionState = {
        channelId,
        socket: null,
        status: 'connecting',
        qrRaw: null,
        qrDataUrl: null,
        userPhone: null,
        reconnectAttempts: 0,
      };
      this.sessions.set(channelId, sessionState);
    } else {
      sessionState.status = 'connecting';
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    let version: [number, number, number] | undefined;
    try {
      const v = await fetchLatestBaileysVersion();
      version = v.version;
    } catch {
      // Fallback version if offline
    }

    const socket = makeWASocket({
      version,
      auth: state,
      logger: this.logger,
      printQRInTerminal: false,
      browser: Browsers.ubuntu('Chrome'),
      syncFullHistory: true,
      generateHighQualityLinkPreview: true,
    });

    sessionState.socket = socket;

    socket.ev.on('creds.update', saveCreds);

    // Capture initial sync history from phone
    socket.ev.on('messaging-history.set', (payload) => {
      if (!this.messageRepo) return;
      const { chats, messages, contacts } = payload;
      if (contacts) {
        for (const ct of contacts) {
          if (!ct.id) continue;
          const name = ct.name || ct.notify || undefined;
          const lid = (ct as any).lid;
          if (lid && ct.id.includes('@s.whatsapp.net')) {
            this.messageRepo.recordJidMapping(channelId, {
              lid,
              pnJid: ct.id,
              name,
              phoneNumber: ct.id.replace(/[^0-9]/g, ''),
            });
          }
          if (name) {
            this.messageRepo.upsertChat(channelId, {
              jid: ct.id,
              name,
              isGroup: ct.id.endsWith('@g.us'),
            });
          }
        }
      }
      if (chats) {
        for (const c of chats) {
          if (!c.id) continue;
          this.messageRepo.upsertChat(channelId, {
            jid: c.id,
            name: c.name || undefined,
            unreadCount: c.unreadCount || 0,
            timestamp: (c.conversationTimestamp as number) ? Number(c.conversationTimestamp) * 1000 : Date.now(),
            isGroup: c.id.endsWith('@g.us'),
          });
        }
      }
      if (messages) {
        for (const m of messages) {
          const chatJid = m.key.remoteJid;
          const msgId = m.key.id;
          if (!chatJid || !msgId) continue;
          const text = extractMessageText(m);
          const type = extractMessageType(m);
          const ts = m.messageTimestamp ? Number(m.messageTimestamp) * 1000 : Date.now();
          if (!m.key.fromMe && m.pushName) {
            this.messageRepo.upsertChat(channelId, {
              jid: chatJid,
              name: m.pushName,
              isGroup: chatJid.endsWith('@g.us'),
            });
          }
          this.messageRepo.upsertMessage(channelId, {
            id: msgId,
            chatJid,
            senderJid: m.key.participant || (m.key.fromMe ? (sessionState.userPhone ? `${sessionState.userPhone}@s.whatsapp.net` : 'me') : chatJid),
            fromMe: !!m.key.fromMe,
            messageType: type,
            textContent: text,
            timestamp: ts,
            raw: m,
          });
        }
      }
    });

    // Capture dynamic contacts updates
    socket.ev.on('contacts.upsert', (contacts) => {
      if (!this.messageRepo) return;
      for (const ct of contacts) {
        if (!ct.id) continue;
        const name = ct.name || ct.notify || undefined;
        const lid = (ct as any).lid;
        if (lid && ct.id.includes('@s.whatsapp.net')) {
          this.messageRepo.recordJidMapping(channelId, {
            lid,
            pnJid: ct.id,
            name,
            phoneNumber: ct.id.replace(/[^0-9]/g, ''),
          });
        }
        if (name) {
          this.messageRepo.upsertChat(channelId, {
            jid: ct.id,
            name,
            isGroup: ct.id.endsWith('@g.us'),
          });
        }
      }
    });

    // Capture dynamic chat updates
    socket.ev.on('chats.upsert', (chats) => {
      if (!this.messageRepo) return;
      for (const c of chats) {
        if (!c.id) continue;
        this.messageRepo.upsertChat(channelId, {
          jid: c.id,
          name: c.name || undefined,
          unreadCount: c.unreadCount || 0,
          timestamp: (c.conversationTimestamp as number) ? Number(c.conversationTimestamp) * 1000 : Date.now(),
          isGroup: c.id.endsWith('@g.us'),
        });
      }
    });

    // Capture dynamic incoming/outgoing messages
    socket.ev.on('messages.upsert', (payload) => {
      if (!this.messageRepo) return;
      for (const m of payload.messages) {
        const chatJid = m.key.remoteJid;
        const msgId = m.key.id;
        if (!chatJid || !msgId) continue;
        const text = extractMessageText(m);
        const type = extractMessageType(m);
        const ts = m.messageTimestamp ? Number(m.messageTimestamp) * 1000 : Date.now();
        if (!m.key.fromMe && m.pushName) {
          this.messageRepo.upsertChat(channelId, {
            jid: chatJid,
            name: m.pushName,
            isGroup: chatJid.endsWith('@g.us'),
          });
        }
        this.messageRepo.upsertMessage(channelId, {
          id: msgId,
          chatJid,
          senderJid: m.key.participant || (m.key.fromMe ? (sessionState.userPhone ? `${sessionState.userPhone}@s.whatsapp.net` : 'me') : chatJid),
          fromMe: !!m.key.fromMe,
          messageType: type,
          textContent: text,
          timestamp: ts,
          raw: m,
        });

        // Emit inbound message event to DomainEventBus for Triggers & Webhooks
        if (!m.key.fromMe) {
          const senderJid = m.key.participant || chatJid;
          const senderPhone = senderJid.replace(/[^0-9]/g, '');
          DomainEventBus.getInstance().emitMessageReceived({
            channel: {
              id: channelId,
              name: channelId,
              phoneNumber: sessionState.userPhone || undefined,
            },
            sender: {
              jid: senderJid,
              phoneNumber: senderPhone,
              name: m.pushName || undefined,
            },
            chat: {
              jid: chatJid,
              isGroup: chatJid.endsWith('@g.us'),
              name: m.pushName || undefined,
            },
            message: {
              id: msgId,
              text,
              type,
              timestamp: ts,
              timestampISO: new Date(ts).toISOString(),
            },
            receivedAt: new Date().toISOString(),
          });
        }
      }
    });

    socket.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        sessionState.qrRaw = qr;
        try {
          sessionState.qrDataUrl = await QRCode.toDataURL(qr, { margin: 2, scale: 6 });
          sessionState.status = 'qr_ready';
        } catch (err) {
          this.logger.error({ err }, 'Error generating QR Code data URL');
        }
      }

      if (connection === 'open') {
        sessionState.status = 'connected';
        sessionState.qrRaw = null;
        sessionState.qrDataUrl = null;
        sessionState.reconnectAttempts = 0;

        const userJid = socket.user?.id || '';
        const phone = userJid.split(':')[0] || userJid.split('@')[0];
        sessionState.userPhone = phone;
        this.logger.info(`[Baileys] Channel ${channelId} connected successfully as ${phone}`);

        if (this.onConnectedCallback) {
          this.onConnectedCallback(channelId, phone).catch((err) => {
            this.logger.error({ err }, `Error executing onConnected callback for ${channelId}`);
          });
        }
      }

      if (connection === 'close') {
        const boomError = lastDisconnect?.error as Boom | undefined;
        const statusCode = boomError?.output?.statusCode;
        const isLoggedOut = statusCode === DisconnectReason.loggedOut;
        const shouldReconnect = !isLoggedOut;

        sessionState.lastError = boomError?.message;

        if (isLoggedOut) {
          sessionState.status = 'disconnected';
          sessionState.socket = null;
          sessionState.userPhone = null;
          sessionState.qrDataUrl = null;
          sessionState.qrRaw = null;
          try {
            fs.rmSync(sessionDir, { recursive: true, force: true });
          } catch (e) {
            this.logger.error({ err: e }, 'Failed to remove session directory on logout');
          }
          this.logger.warn(`[Baileys] Channel ${channelId} logged out from phone.`);
        } else if (shouldReconnect) {
          sessionState.status = 'connecting';
          const isRestart = statusCode === DisconnectReason.restartRequired;
          const delay = isRestart ? 150 : Math.min(1000 * Math.pow(2, sessionState.reconnectAttempts), 10000);
          if (!isRestart) {
            sessionState.reconnectAttempts++;
          }
          this.logger.info(
            `[Baileys] Channel ${channelId} socket closed (code: ${statusCode}). Re-initializing socket in ${delay}ms...`
          );

          if (this.reconnectTimers.has(channelId)) {
            clearTimeout(this.reconnectTimers.get(channelId));
          }

          const reconnectTimer = setTimeout(() => {
            this.reconnectTimers.delete(channelId);
            this.initSocket(channelId).catch((err) => {
              this.logger.error({ err }, `Failed to reconnect socket for channel ${channelId}`);
            });
          }, delay);

          this.reconnectTimers.set(channelId, reconnectTimer);
        } else {
          sessionState.status = 'disconnected';
          sessionState.socket = null;
        }
      }
    });

    return sessionState;
  }

  public async cleanupSession(channelId: string, wipeCredentials = false): Promise<void> {
    if (this.reconnectTimers.has(channelId)) {
      clearTimeout(this.reconnectTimers.get(channelId));
      this.reconnectTimers.delete(channelId);
    }

    const session = this.sessions.get(channelId);
    if (session?.socket) {
      try {
        session.socket.ev.removeAllListeners('connection.update');
        session.socket.ev.removeAllListeners('creds.update');
        session.socket.ws?.close();
      } catch {}
      session.socket = null;
    }

    if (wipeCredentials) {
      const sessionDir = path.join(this.baseSessionPath, channelId);
      try {
        if (fs.existsSync(sessionDir)) {
          fs.rmSync(sessionDir, { recursive: true, force: true });
        }
      } catch {}
    }

    if (session) {
      session.status = 'disconnected';
      session.qrDataUrl = null;
      session.qrRaw = null;
      session.reconnectAttempts = 0;
    }
  }

  public async logoutSession(channelId: string): Promise<void> {
    const session = this.sessions.get(channelId);
    if (session?.socket) {
      try {
        await session.socket.logout();
      } catch {
        // Socket might already be closed
      }
    }

    await this.cleanupSession(channelId, true);
    this.sessions.delete(channelId);
  }

  /**
   * Rehydrates all active sessions found in storage on server startup.
   */
  public async hydrateExistingSessions(activeChannelIds: string[]): Promise<void> {
    if (!fs.existsSync(this.baseSessionPath)) return;

    const dirs = fs.readdirSync(this.baseSessionPath, { withFileTypes: true });
    for (const dir of dirs) {
      if (dir.isDirectory() && activeChannelIds.includes(dir.name)) {
        const credsFile = path.join(this.baseSessionPath, dir.name, 'creds.json');
        if (fs.existsSync(credsFile)) {
          this.logger.info(`[Baileys] Restoring session for channel: ${dir.name}`);
          this.startSession(dir.name).catch((err) => {
            this.logger.error({ err }, `Failed to restore session for ${dir.name}`);
          });
        }
      }
    }
  }
}

