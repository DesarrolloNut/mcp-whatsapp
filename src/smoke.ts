/**
 * Smoke test for mcp-whatsapp.
 * Supports both HTTP Gateway mode (SQLite, channels, provider resolution)
 * and legacy stdio Evolution API checks.
 */

import { loadGatewayConfig } from './config.js';
import { getDatabase, closeDatabase } from './infrastructure/database/connection.js';
import { runMigrations } from './infrastructure/database/migrations.js';
import { SqliteProviderRepository } from './infrastructure/database/repositories/providerRepo.js';
import { SqliteChannelRepository } from './infrastructure/database/repositories/channelRepo.js';
import { ProviderFactory } from './application/services/providerFactory.js';
import { ChannelResolver } from './application/services/channelResolver.js';
import { buildUnifiedRegistry } from './interfaces/mcp/registry.js';

async function runGatewaySmoke(): Promise<void> {
  console.log('--- Testing MCP WhatsApp Gateway Mode ---');
  const config = loadGatewayConfig();

  // 1. Verify Database & Migrations
  const db = getDatabase(config.sqlitePath);
  runMigrations(db);
  console.log('✅ SQLite database initialized with WAL mode and migrations applied.');

  // 2. Verify Repositories & Resolver
  const providerRepo = new SqliteProviderRepository(db, config.encryptionKey);
  const channelRepo = new SqliteChannelRepository(db);
  const { SqliteMessageRepository } = await import('./infrastructure/database/repositories/messageRepo.js');
  const messageRepo = new SqliteMessageRepository(db);
  const { BaileysSessionManager } = await import('./infrastructure/providers/baileys/sessionManager.js');
  const sessionManager = BaileysSessionManager.getInstance(undefined, messageRepo);
  sessionManager.setMessageRepo(messageRepo);

  const providerFactory = new ProviderFactory(config.encryptionKey, sessionManager);
  const resolver = new ChannelResolver(channelRepo, providerRepo, providerFactory);

  const providers = await providerRepo.findAll();
  const channels = await channelRepo.findAll();
  console.log(`✅ Database accessible: ${providers.length} provider(s), ${channels.length} channel(s) registered.`);
  if (channels.length > 0) {
    const resolved = await resolver.resolve();
    console.log(`✅ Default channel resolved: ${resolved.channel.name} (${resolved.provider.name})`);
  }

  // 3. Verify MCP Tool Registry
  const registry = buildUnifiedRegistry();
  console.log(`✅ Unified MCP Tool Registry loaded: ${registry.tools.length} tools registered.`);

  // 4. Verify OpenAPI 3.1 Specification
  const fs = await import('node:fs');
  const path = await import('node:path');
  const openapiPath = path.resolve('src/interfaces/docs/openapi.json');
  if (fs.existsSync(openapiPath)) {
    const raw = fs.readFileSync(openapiPath, 'utf8');
    const parsed = JSON.parse(raw);
    const pathCount = Object.keys(parsed.paths || {}).length;
    console.log(`✅ OpenAPI 3.1 Spec verified (${pathCount} paths documented).`);
  }

  // 5. Verify Baileys Direct Provider, SessionManager & Message Persistence
  const mockBaileysStatus = sessionManager.getStatus('smoke-test-channel');
  console.log(`✅ Baileys Session Manager active (Initial status: ${mockBaileysStatus.status}, connected: ${mockBaileysStatus.isConnected})`);

  const mockBaileysProvider = {
    id: 'smoke-baileys',
    name: 'Embedded Baileys Smoke',
    type: 'baileys' as const,
    baseUrl: 'embedded://whatsapp-web',
    apiKeyEncrypted: 'mock-encrypted-key',
    config: {},
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const baileysAdapter = providerFactory.create(mockBaileysProvider);
  const connTest = await baileysAdapter.testConnection();
  console.log(`✅ Baileys Adapter testConnection: success=${connTest.success}, message="${connTest.message}"`);

  // Verify chat & message persistence roundtrip
  const testChannel = {
    id: 'smoke-channel-1',
    providerId: 'smoke-baileys',
    name: 'Smoke Channel',
    config: {},
    isDefault: true,
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  messageRepo.upsertMessage(testChannel.id, {
    id: 'msg-smoke-123',
    chatJid: '18292571290@s.whatsapp.net',
    senderJid: '18292571290@s.whatsapp.net',
    fromMe: false,
    messageType: 'text',
    textContent: 'Hola, este es un mensaje de prueba',
    timestamp: Date.now(),
  });
  const foundChats = await baileysAdapter.findChats(testChannel);
  const foundMessages = await baileysAdapter.findMessages({ chatId: '18292571290@s.whatsapp.net' }, testChannel);
  if (foundChats.length === 0 || foundMessages.length === 0) {
    throw new Error(`Expected at least 1 chat and 1 message in persistence test`);
  }
  console.log(`✅ Baileys Message & Chat persistence verified: found ${foundChats.length} chat(s) and ${foundMessages.length} message(s).`);

  // 6. Verify MCP HTTP Transport (Initialize, tools/list discovery, direct probes)
  const express = (await import('express')).default;
  const { setupMcpTransport } = await import('./interfaces/mcp/transport.js');
  const mcpApp = express();
  mcpApp.use(express.json());
  const transportManager = setupMcpTransport(resolver);
  mcpApp.all('/mcp', (req, res) => {
    transportManager.handleMcp(req, res);
  });

  const testServer = await new Promise<import('node:http').Server>((resolve) => {
    const s = mcpApp.listen(0, '127.0.0.1', () => resolve(s));
  });
  const address = testServer.address() as import('node:net').AddressInfo;
  const mcpUrl = `http://127.0.0.1:${address.port}/mcp`;

  try {
    // Check 6a: Direct tools/list probe (Testing tool scenario)
    const directListRes = await fetch(mcpUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    const directListData = (await directListRes.json()) as Record<string, unknown>;
    console.log('directListRes status:', directListRes.status, 'body:', JSON.stringify(directListData));
    const directResult = directListData.result as { tools?: unknown[] } | undefined;
    const toolCount = directResult?.tools?.length ?? 0;
    if (toolCount !== 24) {
      throw new Error(`Expected 24 tools in tools/list direct probe, got ${toolCount}. Body: ${JSON.stringify(directListData)}`);
    }
    console.log(`✅ MCP HTTP Direct probe: tools/list returned ${toolCount} tools successfully.`);

    // Check 6b: Standard Initialize -> tools/list sequence
    const initRes = await fetch(mcpUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'smoke-client', version: '1.0.0' },
        },
      }),
    });
    const sessionId = initRes.headers.get('mcp-session-id');
    console.log(`✅ MCP HTTP Initialize handshake: status ${initRes.status}, session=${sessionId || 'stateless'}`);

    const sessionListRes = await fetch(mcpUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} }),
    });
    const sessionListData = (await sessionListRes.json()) as { result?: { tools?: unknown[] } };
    const sessionToolCount = sessionListData.result?.tools?.length ?? 0;
    if (sessionToolCount !== 24) {
      throw new Error(`Expected 24 tools in tools/list session probe, got ${sessionToolCount}`);
    }
    // Check 6c: Direct tools/call validation check
    const callRes = await fetch(mcpUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'whatsapp_send_text',
          arguments: { recipient: '', text: '' },
        },
      }),
    });
    const callData = (await callRes.json()) as { result?: { isError?: boolean; content?: Array<{ text: string }> } };
    if (!callData.result?.isError || !callData.result?.content?.[0]?.text) {
      throw new Error(`Expected tool validation error response, got ${JSON.stringify(callData)}`);
    }
    console.log(`✅ MCP HTTP tools/call validated: gracefully handled argument validation error.`);

    // 7. Verify AI Agent 1:1 Binding, Debounce Buffer & Connector
    console.log('--- Testing AI Agent 1:1 Binding & Debounce Buffer ---');
    const { SqliteAgentBindingRepository } = await import('./infrastructure/database/repositories/agentBindingRepo.js');
    const { MessageDebounceBuffer } = await import('./application/services/messageDebounceBuffer.js');

    const agentRepo = new SqliteAgentBindingRepository(db);

    // Clean any previous test binding
    const existingBindings = await agentRepo.getAllBindings();
    for (const b of existingBindings) {
      if (b.id.startsWith('smoke-')) await agentRepo.deleteBinding(b.id);
    }

    // Ensure valid channel for agent test
    let smokeChannel = channels[0];
    if (!smokeChannel) {
      let prov = providers[0];
      if (!prov) {
        prov = await providerRepo.create({
          name: 'Smoke Provider for Agent',
          type: 'baileys',
          baseUrl: 'embedded://whatsapp-web',
          apiKey: 'mock-key',
        });
      }
      smokeChannel = await channelRepo.create({
        name: 'Smoke Agent Channel',
        providerId: prov.id,
        phoneNumber: '+18095551234',
      });
    }

    // Test 7a: Create 1st binding for channel -> Success
    const binding1 = await agentRepo.createBinding({
      id: 'smoke-agent-1',
      channelId: smokeChannel.id,
      name: 'Asesor Comercial IA',
      agentUrl: 'http://localhost:9999/chat',
      receptionMode: 'sync_json',
      headers: { 'Authorization': 'Bearer test-token' },
      debounceMs: 500,
      replyField: 'reply',
      threadIdMode: 'null',
      simulateTyping: true,
      fallbackMessage: 'Fallback smoke test',
      timeoutMs: 5000,
      isActive: true,
    });
    console.log(`✅ 1:1 Agent Binding created successfully: ${binding1.name} on channel ${binding1.channelId}`);

    // Test 7b: Attempt to bind 2nd agent to same channel -> Must throw error (Strict 1:1)
    let rule1to1Enforced = false;
    try {
      await agentRepo.createBinding({
        id: 'smoke-agent-2',
        channelId: smokeChannel.id,
        name: 'Segundo Agente Prohibido',
        agentUrl: 'http://localhost:9999/chat2',
        receptionMode: 'sync_json',
        headers: {},
        debounceMs: 1500,
        replyField: 'reply',
        threadIdMode: 'null',
        simulateTyping: true,
        fallbackMessage: null,
        timeoutMs: 5000,
        isActive: true,
      });
    } catch (err) {
      rule1to1Enforced = true;
      console.log(`✅ Strict 1:1 Line Binding rule enforced: second binding was correctly rejected ("${(err as Error).message}")`);
    }
    if (!rule1to1Enforced) {
      throw new Error('Strict 1:1 Line Binding rule failed: allowed 2 agents on the same line!');
    }

    // Test 7c: Message Debounce Buffer rapid sequential burst concatenation
    let dispatchedContext: any = null;
    const buffer = new MessageDebounceBuffer(async (context) => {
      dispatchedContext = context;
    });

    buffer.addMessage({
      channelId: 'ch1',
      chatJid: 'user1@s.whatsapp.net',
      senderPhone: '18095550001',
      text: 'Hola',
      messageId: 'm1',
      timestamp: Date.now(),
    }, 300);

    // Send message 2 after 100ms (resets trailing timer)
    await new Promise((r) => setTimeout(r, 100));
    buffer.addMessage({
      channelId: 'ch1',
      chatJid: 'user1@s.whatsapp.net',
      senderPhone: '18095550001',
      text: '¿Tienen disponibilidad del producto X?',
      messageId: 'm2',
      timestamp: Date.now(),
    }, 300);

    // Send message 3 after another 100ms
    await new Promise((r) => setTimeout(r, 100));
    buffer.addMessage({
      channelId: 'ch1',
      chatJid: 'user1@s.whatsapp.net',
      senderPhone: '18095550001',
      text: 'Y cuál es el precio por mayor',
      messageId: 'm3',
      timestamp: Date.now(),
    }, 300);

    // Wait for 400ms of silence (> 300ms debounce threshold)
    await new Promise((r) => setTimeout(r, 450));

    if (!dispatchedContext) {
      throw new Error('MessageDebounceBuffer failed: did not trigger dispatch after debounce window');
    }
    if (dispatchedContext.consolidatedText !== 'Hola\n¿Tienen disponibilidad del producto X?\nY cuál es el precio por mayor') {
      throw new Error(`MessageDebounceBuffer failed: unexpected consolidated text "${dispatchedContext.consolidatedText}"`);
    }
    console.log(`✅ MessageDebounceBuffer validated: 3 rapid burst messages consolidated into 1 prompt after silence window.`);

    // Cleanup test binding
    await agentRepo.deleteBinding('smoke-agent-1');
    console.log(`✅ Agent binding cleanup completed.`);
  } finally {
    testServer.close();
  }

  closeDatabase();
  console.log('\nAll gateway smoke checks passed successfully.');
}

async function main(): Promise<void> {
  await runGatewaySmoke();
}

main().catch((err) => {
  console.error('Smoke test fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});

