import Database from 'better-sqlite3';
import { ITriggerRepository } from '../../../domain/ports/ITriggerRepository.js';
import { Trigger, TriggerDelivery, TriggerMethod, TriggerPayloadMode, DeliveryStatus } from '../../../domain/models/trigger.js';
import { encrypt, decrypt } from '../../../application/security/encryption.js';

interface TriggerRow {
  id: string;
  name: string;
  channel_id: string | null;
  is_active: number;
  filter_message_type: string;
  filter_ignore_groups: number;
  filter_keyword: string | null;
  target_url: string;
  target_method: string;
  target_headers_json: string;
  payload_mode: string;
  payload_template_json: string;
  timeout_ms: number;
  max_retries: number;
  retry_delay_ms: number;
  secret_token_encrypted: string | null;
  created_at: string;
  updated_at: string;
}

interface DeliveryRow {
  id: string;
  trigger_id: string;
  message_id: string;
  channel_id: string;
  payload_json: string;
  status: string;
  attempts: number;
  max_retries: number;
  next_retry_at: number;
  last_status_code: number | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export class SqliteTriggerRepository implements ITriggerRepository {
  constructor(
    private readonly db: Database.Database,
    private readonly encryptionKey: string
  ) {}

  private mapTriggerRow(row: TriggerRow): Trigger {
    let secretToken: string | null = null;
    if (row.secret_token_encrypted) {
      try {
        secretToken = decrypt(row.secret_token_encrypted, this.encryptionKey);
      } catch {
        secretToken = null;
      }
    }

    return {
      id: row.id,
      name: row.name,
      channelId: row.channel_id,
      isActive: row.is_active === 1,
      filterMessageType: row.filter_message_type,
      filterIgnoreGroups: row.filter_ignore_groups === 1,
      filterKeyword: row.filter_keyword,
      targetUrl: row.target_url,
      targetMethod: row.target_method as TriggerMethod,
      targetHeaders: JSON.parse(row.target_headers_json || '{}'),
      payloadMode: row.payload_mode as TriggerPayloadMode,
      payloadTemplate: JSON.parse(row.payload_template_json || '{}'),
      timeoutMs: row.timeout_ms,
      maxRetries: row.max_retries,
      retryDelayMs: row.retry_delay_ms,
      secretToken,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapDeliveryRow(row: DeliveryRow): TriggerDelivery {
    return {
      id: row.id,
      triggerId: row.trigger_id,
      messageId: row.message_id,
      channelId: row.channel_id,
      payloadJson: row.payload_json,
      status: row.status as DeliveryStatus,
      attempts: row.attempts,
      maxRetries: row.max_retries,
      nextRetryAt: row.next_retry_at,
      lastStatusCode: row.last_status_code,
      lastError: row.last_error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async createTrigger(trigger: Omit<Trigger, 'createdAt' | 'updatedAt'>): Promise<Trigger> {
    const now = new Date().toISOString();
    const encryptedSecret = trigger.secretToken ? encrypt(trigger.secretToken, this.encryptionKey) : null;

    const stmt = this.db.prepare(`
      INSERT INTO triggers (
        id, name, channel_id, is_active, filter_message_type, filter_ignore_groups,
        filter_keyword, target_url, target_method, target_headers_json, payload_mode,
        payload_template_json, timeout_ms, max_retries, retry_delay_ms, secret_token_encrypted,
        created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?
      )
    `);

    stmt.run(
      trigger.id,
      trigger.name,
      trigger.channelId,
      trigger.isActive ? 1 : 0,
      trigger.filterMessageType || 'all',
      trigger.filterIgnoreGroups ? 1 : 0,
      trigger.filterKeyword || null,
      trigger.targetUrl,
      trigger.targetMethod || 'POST',
      JSON.stringify(trigger.targetHeaders || {}),
      trigger.payloadMode || 'standard',
      JSON.stringify(trigger.payloadTemplate || {}),
      trigger.timeoutMs ?? 5000,
      trigger.maxRetries ?? 3,
      trigger.retryDelayMs ?? 10000,
      encryptedSecret,
      now,
      now
    );

    return (await this.getTriggerById(trigger.id))!;
  }

  async updateTrigger(id: string, updates: Partial<Trigger>): Promise<Trigger> {
    const existing = await this.getTriggerById(id);
    if (!existing) {
      throw new Error(`Trigger not found with id: ${id}`);
    }

    const now = new Date().toISOString();
    const encryptedSecret = updates.secretToken !== undefined
      ? (updates.secretToken ? encrypt(updates.secretToken, this.encryptionKey) : null)
      : (existing.secretToken ? encrypt(existing.secretToken, this.encryptionKey) : null);

    const merged = {
      name: updates.name ?? existing.name,
      channelId: updates.channelId !== undefined ? updates.channelId : existing.channelId,
      isActive: updates.isActive !== undefined ? updates.isActive : existing.isActive,
      filterMessageType: updates.filterMessageType ?? existing.filterMessageType,
      filterIgnoreGroups: updates.filterIgnoreGroups !== undefined ? updates.filterIgnoreGroups : existing.filterIgnoreGroups,
      filterKeyword: updates.filterKeyword !== undefined ? updates.filterKeyword : existing.filterKeyword,
      targetUrl: updates.targetUrl ?? existing.targetUrl,
      targetMethod: updates.targetMethod ?? existing.targetMethod,
      targetHeaders: updates.targetHeaders ?? existing.targetHeaders,
      payloadMode: updates.payloadMode ?? existing.payloadMode,
      payloadTemplate: updates.payloadTemplate ?? existing.payloadTemplate,
      timeoutMs: updates.timeoutMs ?? existing.timeoutMs,
      maxRetries: updates.maxRetries ?? existing.maxRetries,
      retryDelayMs: updates.retryDelayMs ?? existing.retryDelayMs,
    };

    const stmt = this.db.prepare(`
      UPDATE triggers SET
        name = ?, channel_id = ?, is_active = ?, filter_message_type = ?, filter_ignore_groups = ?,
        filter_keyword = ?, target_url = ?, target_method = ?, target_headers_json = ?, payload_mode = ?,
        payload_template_json = ?, timeout_ms = ?, max_retries = ?, retry_delay_ms = ?,
        secret_token_encrypted = ?, updated_at = ?
      WHERE id = ?
    `);

    stmt.run(
      merged.name,
      merged.channelId,
      merged.isActive ? 1 : 0,
      merged.filterMessageType,
      merged.filterIgnoreGroups ? 1 : 0,
      merged.filterKeyword,
      merged.targetUrl,
      merged.targetMethod,
      JSON.stringify(merged.targetHeaders),
      merged.payloadMode,
      JSON.stringify(merged.payloadTemplate),
      merged.timeoutMs,
      merged.maxRetries,
      merged.retryDelayMs,
      encryptedSecret,
      now,
      id
    );

    return (await this.getTriggerById(id))!;
  }

  async deleteTrigger(id: string): Promise<void> {
    this.db.prepare('DELETE FROM triggers WHERE id = ?').run(id);
  }

  async getTriggerById(id: string): Promise<Trigger | null> {
    const row = this.db.prepare('SELECT * FROM triggers WHERE id = ?').get(id) as TriggerRow | undefined;
    return row ? this.mapTriggerRow(row) : null;
  }

  async getAllTriggers(): Promise<Trigger[]> {
    const rows = this.db.prepare('SELECT * FROM triggers ORDER BY created_at DESC').all() as TriggerRow[];
    return rows.map((r) => this.mapTriggerRow(r));
  }

  async getActiveTriggersForChannel(channelId: string): Promise<Trigger[]> {
    const rows = this.db.prepare(`
      SELECT * FROM triggers
      WHERE is_active = 1 AND (channel_id IS NULL OR channel_id = ?)
      ORDER BY created_at ASC
    `).all(channelId) as TriggerRow[];
    return rows.map((r) => this.mapTriggerRow(r));
  }

  // --- OUTBOX / DELIVERIES ---

  async createDelivery(delivery: Omit<TriggerDelivery, 'createdAt' | 'updatedAt'>): Promise<TriggerDelivery> {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO trigger_deliveries (
        id, trigger_id, message_id, channel_id, payload_json, status,
        attempts, max_retries, next_retry_at, last_status_code, last_error,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      delivery.id,
      delivery.triggerId,
      delivery.messageId,
      delivery.channelId,
      delivery.payloadJson,
      delivery.status || 'pending',
      delivery.attempts || 0,
      delivery.maxRetries ?? 3,
      delivery.nextRetryAt || Date.now(),
      delivery.lastStatusCode ?? null,
      delivery.lastError ?? null,
      now,
      now
    );

    return (await this.getDeliveryById(delivery.id))!;
  }

  async updateDelivery(id: string, updates: Partial<TriggerDelivery>): Promise<void> {
    const now = new Date().toISOString();
    const existing = await this.getDeliveryById(id);
    if (!existing) return;

    const merged = {
      status: updates.status ?? existing.status,
      attempts: updates.attempts ?? existing.attempts,
      nextRetryAt: updates.nextRetryAt ?? existing.nextRetryAt,
      lastStatusCode: updates.lastStatusCode !== undefined ? updates.lastStatusCode : existing.lastStatusCode,
      lastError: updates.lastError !== undefined ? updates.lastError : existing.lastError,
    };

    this.db.prepare(`
      UPDATE trigger_deliveries SET
        status = ?, attempts = ?, next_retry_at = ?, last_status_code = ?, last_error = ?, updated_at = ?
      WHERE id = ?
    `).run(
      merged.status,
      merged.attempts,
      merged.nextRetryAt,
      merged.lastStatusCode,
      merged.lastError,
      now,
      id
    );
  }

  async getPendingDeliveries(limit: number = 20): Promise<TriggerDelivery[]> {
    const now = Date.now();
    const rows = this.db.prepare(`
      SELECT * FROM trigger_deliveries
      WHERE status = 'pending' AND next_retry_at <= ?
      ORDER BY next_retry_at ASC
      LIMIT ?
    `).all(now, limit) as DeliveryRow[];
    return rows.map((r) => this.mapDeliveryRow(r));
  }

  async getDeliveriesByTrigger(triggerId: string, limit: number = 50): Promise<TriggerDelivery[]> {
    const rows = this.db.prepare(`
      SELECT * FROM trigger_deliveries
      WHERE trigger_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(triggerId, limit) as DeliveryRow[];
    return rows.map((r) => this.mapDeliveryRow(r));
  }

  async getDeliveryById(id: string): Promise<TriggerDelivery | null> {
    const row = this.db.prepare('SELECT * FROM trigger_deliveries WHERE id = ?').get(id) as DeliveryRow | undefined;
    return row ? this.mapDeliveryRow(row) : null;
  }

  async resetFailedDeliveries(triggerId: string): Promise<number> {
    const now = Date.now();
    const updatedAt = new Date().toISOString();
    const result = this.db.prepare(`
      UPDATE trigger_deliveries
      SET status = 'pending', attempts = 0, next_retry_at = ?, last_error = NULL, updated_at = ?
      WHERE trigger_id = ? AND status = 'failed'
    `).run(now, updatedAt, triggerId);
    return result.changes;
  }

  async resetDelivery(deliveryId: string): Promise<boolean> {
    const now = Date.now();
    const updatedAt = new Date().toISOString();
    const result = this.db.prepare(`
      UPDATE trigger_deliveries
      SET status = 'pending', attempts = 0, next_retry_at = ?, last_error = NULL, updated_at = ?
      WHERE id = ?
    `).run(now, updatedAt, deliveryId);
    return result.changes > 0;
  }
}
