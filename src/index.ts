#!/usr/bin/env node
/**
 * MCP WhatsApp Gateway Server.
 * Supports unified HTTP server mode (MCP SSE, Admin REST API, Web Panel)
 * and legacy stdio mode for backward compatibility.
 */

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { loadGatewayConfig } from './config.js';
import { getDatabase } from './infrastructure/database/connection.js';
import { runMigrations } from './infrastructure/database/migrations.js';
import { SqliteProviderRepository } from './infrastructure/database/repositories/providerRepo.js';
import { SqliteChannelRepository } from './infrastructure/database/repositories/channelRepo.js';
import { SqliteMessageRepository } from './infrastructure/database/repositories/messageRepo.js';
import { SqliteTriggerRepository } from './infrastructure/database/repositories/triggerRepo.js';
import { TriggerDispatcher } from './application/services/triggerDispatcher.js';
import { ProviderFactory } from './application/services/providerFactory.js';
import { ChannelResolver } from './application/services/channelResolver.js';
import { AdminAuthService } from './application/services/adminAuth.js';
import { createUnifiedMcpServer } from './interfaces/mcp/server.js';
import { createMcpAuthMiddleware, setupMcpTransport } from './interfaces/mcp/transport.js';
import { createAdminRouter } from './interfaces/admin/router.js';
import { createMessagingRestRouter } from './interfaces/rest/messagingRouter.js';
import { BaileysSessionManager } from './infrastructure/providers/baileys/sessionManager.js';


const PKG_NAME = 'mcp-whatsapp';
const PKG_VERSION = '2.0.0';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServerMode(): Promise<void> {
  const config = loadGatewayConfig();

  // Warn if using default administrative credentials
  if (config.adminUsername === 'admin' && config.adminPassword === 'admin') {
    console.error(
      `[SECURITY WARNING] Using default administrative credentials (admin:admin). ` +
        `Set ADMIN_USERNAME and ADMIN_PASSWORD environment variables for production security.`
    );
  }

  // 1. Initialize SQLite Database & execute migrations
  const db = getDatabase(config.sqlitePath);
  runMigrations(db);

  // 2. Initialize Repositories and Domain Services
  const providerRepo = new SqliteProviderRepository(db, config.encryptionKey);
  const channelRepo = new SqliteChannelRepository(db);
  const messageRepo = new SqliteMessageRepository(db);
  const triggerRepo = new SqliteTriggerRepository(db, config.encryptionKey);
  const triggerDispatcher = new TriggerDispatcher(triggerRepo);
  triggerDispatcher.start();

  const sessionManager = BaileysSessionManager.getInstance(undefined, messageRepo);
  sessionManager.setMessageRepo(messageRepo);
  const providerFactory = new ProviderFactory(config.encryptionKey, sessionManager);
  const channelResolver = new ChannelResolver(channelRepo, providerRepo, providerFactory);
  const adminAuthService = new AdminAuthService(config);

  // 3. Hydrate existing Baileys WhatsApp Web sessions
  try {
    const providers = await providerRepo.findAll();
    const baileysProviderIds = new Set(
      providers.filter((p) => p.type === 'baileys' && p.isActive).map((p) => p.id)
    );
    if (baileysProviderIds.size > 0) {
      const allChannels = await channelRepo.findAll();
      const activeBaileysChannelIds = allChannels
        .filter((c) => c.isActive && baileysProviderIds.has(c.providerId))
        .map((c) => c.id);

      if (activeBaileysChannelIds.length > 0) {
        await sessionManager.hydrateExistingSessions(activeBaileysChannelIds);
      }
    }
  } catch (err) {
    console.error(`[${PKG_NAME}] Error hydrating Baileys sessions:`, (err as Error).message);
  }

  // 4. Initialize MCP Server & Transport
  const mcpTransport = setupMcpTransport(channelResolver);
  const mcpAuthMiddleware = createMcpAuthMiddleware(config.mcpApiToken);

  // 5. Initialize Express HTTP Application
  const app = express();

  // Security Headers
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    next();
  });

  app.use(express.json());

  // Static Admin Panel
  // When running compiled from dist/, panel files are in src/ or dist/
  const panelPath = path.resolve(__dirname, 'interfaces/web/panel');
  app.use('/panel', express.static(panelPath));

  // Interactive Swagger / OpenAPI Documentation
  const docsPath = path.resolve(__dirname, 'interfaces/docs');
  app.use('/docs', express.static(docsPath));
  app.get('/openapi.json', (_req, res) => {
    res.sendFile(path.join(docsPath, 'openapi.json'));
  });

  // Root redirect to panel
  app.get('/', (_req, res) => {
    res.redirect('/panel');
  });

  // Admin REST API
  app.use(
    '/api/admin',
    createAdminRouter({
      authService: adminAuthService,
      providerRepo,
      channelRepo,
      providerFactory,
      triggerRepo,
      triggerDispatcher,
      mcpApiToken: config.mcpApiToken,
    })
  );

  // Direct Messaging & Chats REST API
  app.use('/api', createMessagingRestRouter(channelResolver, config.mcpApiToken, adminAuthService));

  // MCP Protocol Endpoints (Streamable HTTP & SSE)
  app.all('/mcp', mcpAuthMiddleware, (req, res) => {
    mcpTransport.handleMcp(req, res);
  });
  app.get('/sse', mcpAuthMiddleware, (req, res) => {
    mcpTransport.handleSse(req, res);
  });
  app.post('/messages', mcpAuthMiddleware, (req, res) => {
    mcpTransport.handleMessages(req, res);
  });

  // Start HTTP Server
  app.listen(config.httpPort, config.httpHost, () => {
    console.error(`[${PKG_NAME} v${PKG_VERSION}] HTTP gateway active on http://${config.httpHost}:${config.httpPort}`);
    console.error(`  - MCP Endpoint:      http://${config.httpHost}:${config.httpPort}/mcp`);
    console.error(`  - SSE Endpoint:      http://${config.httpHost}:${config.httpPort}/sse`);
    console.error(`  - REST API:          http://${config.httpHost}:${config.httpPort}/api`);
    console.error(`  - API Docs (Swagger):http://${config.httpHost}:${config.httpPort}/docs`);
    console.error(`  - Admin Panel:       http://${config.httpHost}:${config.httpPort}/panel`);
    console.error(`  - Database:          ${config.sqlitePath} (WAL mode)`);
  });
}

async function startStdioMode(): Promise<void> {
  const config = loadGatewayConfig();

  // 1. Initialize SQLite Database & execute migrations
  const db = getDatabase(config.sqlitePath);
  runMigrations(db);

  // 2. Initialize Repositories and Domain Services
  const providerRepo = new SqliteProviderRepository(db, config.encryptionKey);
  const channelRepo = new SqliteChannelRepository(db);
  const messageRepo = new SqliteMessageRepository(db);
  const sessionManager = BaileysSessionManager.getInstance(undefined, messageRepo);
  sessionManager.setMessageRepo(messageRepo);
  const providerFactory = new ProviderFactory(config.encryptionKey, sessionManager);
  const channelResolver = new ChannelResolver(channelRepo, providerRepo, providerFactory);

  // 3. Hydrate active Baileys WhatsApp Web sessions if any
  try {
    const providers = await providerRepo.findAll();
    const baileysProviderIds = new Set(
      providers.filter((p) => p.type === 'baileys' && p.isActive).map((p) => p.id)
    );
    if (baileysProviderIds.size > 0) {
      const allChannels = await channelRepo.findAll();
      const activeBaileysChannelIds = allChannels
        .filter((c) => c.isActive && baileysProviderIds.has(c.providerId))
        .map((c) => c.id);

      if (activeBaileysChannelIds.length > 0) {
        const sessionManager = BaileysSessionManager.getInstance();
        await sessionManager.hydrateExistingSessions(activeBaileysChannelIds);
      }
    }
  } catch (err) {
    console.error(`[${PKG_NAME}] Error hydrating Baileys sessions:`, (err as Error).message);
  }

  // 4. Create Unified MCP Server & Connect to Stdio Transport
  const server = createUnifiedMcpServer(channelResolver);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[${PKG_NAME} v${PKG_VERSION}] ready (stdio mode, dynamic multi-channel)`);
}

async function main(): Promise<void> {
  const mode = process.env.WHATSAPP_MODE?.trim().toLowerCase();
  if (mode === 'stdio') {
    await startStdioMode();
  } else {
    await startServerMode();
  }
}


main().catch((err) => {
  console.error(`[${PKG_NAME}] fatal:`, err instanceof Error ? err.message : err);
  process.exit(1);
});
