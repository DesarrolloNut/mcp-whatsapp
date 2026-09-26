import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import { IAgentBindingRepository } from '../../../domain/ports/IAgentBindingRepository.js';
import { AgentBinding, AgentReceptionMode, ThreadIdMode } from '../../../domain/models/agentBinding.js';

interface AgentBindingRow {
  id: string;
  channel_id: string;
  name: string;
  agent_url: string;
  reception_mode: string;
  headers_json: string;
  debounce_ms: number;
  reply_field: string;
  thread_id_mode: string;
  simulate_typing: number;
  fallback_message: string | null;
  timeout_ms: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

function mapRowToEntity(row: AgentBindingRow): AgentBinding {
  let headers: Record<string, string> = {};
  try {
    headers = JSON.parse(row.headers_json || '{}');
  } catch {
    headers = {};
  }

  return {
    id: row.id,
    channelId: row.channel_id,
    name: row.name,
    agentUrl: row.agent_url,
    receptionMode: (row.reception_mode as AgentReceptionMode) || 'sync_json',
    headers,
    debounceMs: row.debounce_ms ?? 1500,
    replyField: row.reply_field || 'reply',
    threadIdMode: (row.thread_id_mode as ThreadIdMode) || 'null',
    simulateTyping: row.simulate_typing === 1,
    fallbackMessage: row.fallback_message || null,
    timeoutMs: row.timeout_ms ?? 15000,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteAgentBindingRepository implements IAgentBindingRepository {
  constructor(private readonly db: Database.Database) {}

  async createBinding(binding: Omit<AgentBinding, 'createdAt' | 'updatedAt'>): Promise<AgentBinding> {
    // 1:1 business check: verify if the channel already has an assigned agent
    const existing = await this.getBindingByChannelId(binding.channelId);
    if (existing) {
      throw new Error(`La línea telefónica seleccionada ya tiene un Agente de IA vinculado ("${existing.name}"). Cada línea solo puede vincularse a un único agente.`);
    }

    const id = binding.id || crypto.randomUUID();
    const now = new Date().toISOString();
    const headersJson = JSON.stringify(binding.headers || {});

    const stmt = this.db.prepare(`
      INSERT INTO agent_bindings (
        id, channel_id, name, agent_url, reception_mode,
        headers_json, debounce_ms, reply_field, thread_id_mode,
        simulate_typing, fallback_message, timeout_ms, is_active,
        created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?
      )
    `);

    stmt.run(
      id,
      binding.channelId,
      binding.name,
      binding.agentUrl,
      binding.receptionMode || 'sync_json',
      headersJson,
      binding.debounceMs ?? 1500,
      binding.replyField || 'reply',
      binding.threadIdMode || 'null',
      binding.simulateTyping !== false ? 1 : 0,
      binding.fallbackMessage || null,
      binding.timeoutMs ?? 15000,
      binding.isActive !== false ? 1 : 0,
      now,
      now
    );

    const created = await this.getBindingById(id);
    if (!created) {
      throw new Error('No se pudo recuperar la vinculación de agente recién creada.');
    }
    return created;
  }

  async updateBinding(id: string, updates: Partial<AgentBinding>): Promise<AgentBinding> {
    const current = await this.getBindingById(id);
    if (!current) {
      throw new Error(`Vinculación de agente no encontrada con ID: ${id}`);
    }

    if (updates.channelId && updates.channelId !== current.channelId) {
      const existing = await this.getBindingByChannelId(updates.channelId);
      if (existing && existing.id !== id) {
        throw new Error(`La línea telefónica ya tiene un Agente de IA vinculado ("${existing.name}").`);
      }
    }

    const fields: string[] = [];
    const values: (string | number | null)[] = [];

    if (updates.channelId !== undefined) {
      fields.push('channel_id = ?');
      values.push(updates.channelId);
    }
    if (updates.name !== undefined) {
      fields.push('name = ?');
      values.push(updates.name);
    }
    if (updates.agentUrl !== undefined) {
      fields.push('agent_url = ?');
      values.push(updates.agentUrl);
    }
    if (updates.receptionMode !== undefined) {
      fields.push('reception_mode = ?');
      values.push(updates.receptionMode);
    }
    if (updates.headers !== undefined) {
      fields.push('headers_json = ?');
      values.push(JSON.stringify(updates.headers));
    }
    if (updates.debounceMs !== undefined) {
      fields.push('debounce_ms = ?');
      values.push(updates.debounceMs);
    }
    if (updates.replyField !== undefined) {
      fields.push('reply_field = ?');
      values.push(updates.replyField);
    }
    if (updates.threadIdMode !== undefined) {
      fields.push('thread_id_mode = ?');
      values.push(updates.threadIdMode);
    }
    if (updates.simulateTyping !== undefined) {
      fields.push('simulate_typing = ?');
      values.push(updates.simulateTyping ? 1 : 0);
    }
    if (updates.fallbackMessage !== undefined) {
      fields.push('fallback_message = ?');
      values.push(updates.fallbackMessage);
    }
    if (updates.timeoutMs !== undefined) {
      fields.push('timeout_ms = ?');
      values.push(updates.timeoutMs);
    }
    if (updates.isActive !== undefined) {
      fields.push('is_active = ?');
      values.push(updates.isActive ? 1 : 0);
    }

    const now = new Date().toISOString();
    fields.push('updated_at = ?');
    values.push(now);

    values.push(id);

    const query = `UPDATE agent_bindings SET ${fields.join(', ')} WHERE id = ?`;
    this.db.prepare(query).run(...values);

    const updated = await this.getBindingById(id);
    if (!updated) {
      throw new Error(`Error al recuperar la vinculación de agente tras la actualización: ${id}`);
    }
    return updated;
  }

  async deleteBinding(id: string): Promise<void> {
    this.db.prepare('DELETE FROM agent_bindings WHERE id = ?').run(id);
  }

  async getBindingById(id: string): Promise<AgentBinding | null> {
    const row = this.db.prepare('SELECT * FROM agent_bindings WHERE id = ?').get(id) as AgentBindingRow | undefined;
    return row ? mapRowToEntity(row) : null;
  }

  async getBindingByChannelId(channelId: string): Promise<AgentBinding | null> {
    const row = this.db.prepare('SELECT * FROM agent_bindings WHERE channel_id = ?').get(channelId) as AgentBindingRow | undefined;
    return row ? mapRowToEntity(row) : null;
  }

  async getAllBindings(): Promise<AgentBinding[]> {
    const rows = this.db.prepare('SELECT * FROM agent_bindings ORDER BY created_at DESC').all() as AgentBindingRow[];
    return rows.map(mapRowToEntity);
  }
}
