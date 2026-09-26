import Database from 'better-sqlite3';

interface Migration {
  name: string;
  up: (db: Database.Database) => void;
}

const migrations: Migration[] = [
  {
    name: '001_initial',
    up: (db: Database.Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS providers (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          type TEXT NOT NULL,
          base_url TEXT NOT NULL,
          api_key_encrypted TEXT NOT NULL,
          config_json TEXT NOT NULL DEFAULT '{}',
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS channels (
          id TEXT PRIMARY KEY,
          provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
          name TEXT NOT NULL UNIQUE,
          phone_number TEXT,
          instance_id TEXT,
          config_json TEXT NOT NULL DEFAULT '{}',
          is_default INTEGER NOT NULL DEFAULT 0,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS audit_log (
          id TEXT PRIMARY KEY,
          action TEXT NOT NULL,
          entity TEXT NOT NULL,
          details_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_channels_provider ON channels(provider_id);
        CREATE INDEX IF NOT EXISTS idx_channels_default ON channels(is_default);
        CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
      `);
    },
  },
  {
    name: '002_chats_and_messages',
    up: (db: Database.Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS chats (
          jid TEXT NOT NULL,
          channel_id TEXT NOT NULL,
          name TEXT,
          unread_count INTEGER NOT NULL DEFAULT 0,
          last_message_text TEXT,
          last_message_timestamp INTEGER NOT NULL DEFAULT 0,
          is_group INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (channel_id, jid)
        );

        CREATE TABLE IF NOT EXISTS messages (
          id TEXT NOT NULL,
          channel_id TEXT NOT NULL,
          chat_jid TEXT NOT NULL,
          sender_jid TEXT NOT NULL,
          from_me INTEGER NOT NULL DEFAULT 0,
          message_type TEXT NOT NULL,
          text_content TEXT,
          media_url TEXT,
          status TEXT NOT NULL DEFAULT 'sent',
          timestamp INTEGER NOT NULL,
          raw_json TEXT,
          PRIMARY KEY (channel_id, id)
        );

        CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(channel_id, chat_jid, timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_chats_updated ON chats(channel_id, last_message_timestamp DESC);
      `);
    },
  },
  {
    name: '003_jid_mappings_and_phone',
    up: (db: Database.Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS jid_mappings (
          channel_id TEXT NOT NULL,
          lid TEXT NOT NULL,
          pn_jid TEXT NOT NULL,
          phone_number TEXT,
          name TEXT,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (channel_id, lid)
        );

        CREATE INDEX IF NOT EXISTS idx_jid_map_pn ON jid_mappings(channel_id, pn_jid);
        CREATE INDEX IF NOT EXISTS idx_jid_map_phone ON jid_mappings(channel_id, phone_number);
      `);

      const tableInfo = db.prepare("PRAGMA table_info(chats)").all() as Array<{ name: string }>;
      const colNames = new Set(tableInfo.map((c) => c.name));
      if (!colNames.has('phone_number')) {
        db.exec(`ALTER TABLE chats ADD COLUMN phone_number TEXT;`);
      }
      if (!colNames.has('lid')) {
        db.exec(`ALTER TABLE chats ADD COLUMN lid TEXT;`);
      }
    },
  },
  {
    name: '004_triggers_and_outbox',
    up: (db: Database.Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS triggers (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          channel_id TEXT REFERENCES channels(id) ON DELETE CASCADE,
          is_active INTEGER NOT NULL DEFAULT 1,
          filter_message_type TEXT NOT NULL DEFAULT 'all',
          filter_ignore_groups INTEGER NOT NULL DEFAULT 1,
          filter_keyword TEXT,
          target_url TEXT NOT NULL,
          target_method TEXT NOT NULL DEFAULT 'POST',
          target_headers_json TEXT NOT NULL DEFAULT '{}',
          payload_mode TEXT NOT NULL DEFAULT 'standard',
          payload_template_json TEXT NOT NULL DEFAULT '{}',
          timeout_ms INTEGER NOT NULL DEFAULT 5000,
          max_retries INTEGER NOT NULL DEFAULT 3,
          retry_delay_ms INTEGER NOT NULL DEFAULT 10000,
          secret_token_encrypted TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS trigger_deliveries (
          id TEXT PRIMARY KEY,
          trigger_id TEXT NOT NULL REFERENCES triggers(id) ON DELETE CASCADE,
          message_id TEXT NOT NULL,
          channel_id TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          attempts INTEGER NOT NULL DEFAULT 0,
          max_retries INTEGER NOT NULL DEFAULT 3,
          next_retry_at INTEGER NOT NULL,
          last_status_code INTEGER,
          last_error TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_deliveries_pending ON trigger_deliveries(status, next_retry_at);
        CREATE INDEX IF NOT EXISTS idx_deliveries_trigger ON trigger_deliveries(trigger_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_triggers_channel ON triggers(channel_id);
      `);
    },
  },
  {
    name: '005_agent_bindings',
    up: (db: Database.Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS agent_bindings (
          id TEXT PRIMARY KEY,
          channel_id TEXT NOT NULL UNIQUE REFERENCES channels(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          agent_url TEXT NOT NULL,
          reception_mode TEXT NOT NULL DEFAULT 'sync_json',
          headers_json TEXT NOT NULL DEFAULT '{}',
          debounce_ms INTEGER NOT NULL DEFAULT 1500,
          reply_field TEXT NOT NULL DEFAULT 'reply',
          thread_id_mode TEXT NOT NULL DEFAULT 'null',
          simulate_typing INTEGER NOT NULL DEFAULT 1,
          fallback_message TEXT,
          timeout_ms INTEGER NOT NULL DEFAULT 15000,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_bindings_channel ON agent_bindings(channel_id);
      `);
    },
  },
];

export function runMigrations(db: Database.Database): void {
  // Ensure migration tracking table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    );
  `);

  const appliedRows = db.prepare('SELECT name FROM _migrations').all() as { name: string }[];
  const appliedSet = new Set(appliedRows.map((r) => r.name));

  const insertMigration = db.prepare(
    'INSERT INTO _migrations (name, applied_at) VALUES (?, ?)'
  );

  for (const m of migrations) {
    if (!appliedSet.has(m.name)) {
      db.transaction(() => {
        m.up(db);
        insertMigration.run(m.name, new Date().toISOString());
      })();
    }
  }
}
