import { Router, Request, Response } from 'express';
import crypto from 'node:crypto';
import { IAgentBindingRepository } from '../../../domain/ports/IAgentBindingRepository.js';
import { IChannelRepository } from '../../../domain/ports/IChannelRepository.js';
import { AgentConnector } from '../../../application/services/agentConnector.js';
import { AgentReceptionMode, ThreadIdMode } from '../../../domain/models/agentBinding.js';

export function createAgentsRouter(
  agentBindingRepo: IAgentBindingRepository,
  channelRepo: IChannelRepository,
  agentConnector: AgentConnector
): Router {
  const router = Router();

  // 1. List all agent bindings enriched with channel details
  router.get('/', async (_req: Request, res: Response) => {
    try {
      const [bindings, channels] = await Promise.all([
        agentBindingRepo.getAllBindings(),
        channelRepo.findAll(),
      ]);

      const channelMap = new Map(channels.map((c) => [c.id, c]));

      const enriched = bindings.map((b) => {
        const channel = channelMap.get(b.channelId);
        return {
          ...b,
          channelName: channel?.name || 'Canal Desconocido',
          channelPhoneNumber: channel?.phoneNumber || null,
        };
      });

      res.json(enriched);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // 2. Get available channels that do NOT have any agent bound yet (Strict 1:1)
  router.get('/available-channels', async (req: Request, res: Response) => {
    try {
      const excludeBindingId = req.query.excludeBindingId ? String(req.query.excludeBindingId) : null;
      const [channels, bindings] = await Promise.all([
        channelRepo.findAll({ activeOnly: true }),
        agentBindingRepo.getAllBindings(),
      ]);

      const boundChannelIds = new Set(
        bindings
          .filter((b) => !excludeBindingId || b.id !== excludeBindingId)
          .map((b) => b.channelId)
      );

      const available = channels.filter((c) => !boundChannelIds.has(c.id));
      res.json(available);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // 3. Get single binding by ID
  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const binding = await agentBindingRepo.getBindingById(id);
      if (!binding) {
        res.status(404).json({ error: 'Vinculación de agente no encontrada.' });
        return;
      }

      const channel = await channelRepo.findById(binding.channelId);
      res.json({
        ...binding,
        channelName: channel?.name || 'Canal Desconocido',
        channelPhoneNumber: channel?.phoneNumber || null,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // 4. Create new agent binding (Strict 1:1 Line validation)
  router.post('/', async (req: Request, res: Response) => {
    try {
      const {
        channelId,
        name,
        agentUrl,
        receptionMode,
        headers,
        debounceMs,
        replyField,
        threadIdMode,
        simulateTyping,
        fallbackMessage,
        timeoutMs,
        isActive,
      } = req.body || {};

      if (!channelId || !name || !agentUrl) {
        res.status(400).json({ error: 'Campos obligatorios requeridos: channelId, name, agentUrl' });
        return;
      }

      // Validate URL format
      try {
        new URL(agentUrl);
      } catch {
        res.status(400).json({ error: 'agentUrl debe ser una URL válida (http:// o https://)' });
        return;
      }

      // Verify channel exists
      const channel = await channelRepo.findById(channelId);
      if (!channel) {
        res.status(404).json({ error: `La línea/canal especificado (${channelId}) no existe.` });
        return;
      }

      // Strict 1:1 check: ensure channel does not have an existing agent
      const existing = await agentBindingRepo.getBindingByChannelId(channelId);
      if (existing) {
        res.status(400).json({
          error: `La línea "${channel.name}" ya está vinculada al agente "${existing.name}". Cada línea telefónica solo puede tener un único agente vinculado.`,
        });
        return;
      }

      const validMode: AgentReceptionMode = receptionMode === 'sse_stream' ? 'sse_stream' : 'sync_json';
      const validThreadId: ThreadIdMode = threadIdMode === 'phone' ? 'phone' : 'null';

      const id = `agent_${crypto.randomBytes(6).toString('hex')}`;
      const created = await agentBindingRepo.createBinding({
        id,
        channelId: String(channelId).trim(),
        name: String(name).trim(),
        agentUrl: String(agentUrl).trim(),
        receptionMode: validMode,
        headers: typeof headers === 'object' && headers !== null ? headers : { 'Content-Type': 'application/json' },
        debounceMs: typeof debounceMs === 'number' && debounceMs >= 200 ? debounceMs : 1500,
        replyField: replyField ? String(replyField).trim() : 'reply',
        threadIdMode: validThreadId,
        simulateTyping: simulateTyping !== false,
        fallbackMessage: fallbackMessage ? String(fallbackMessage).trim() : null,
        timeoutMs: typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : 15000,
        isActive: isActive !== false,
      });

      res.status(201).json(created);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // 5. Update agent binding
  router.put('/:id', async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const binding = await agentBindingRepo.getBindingById(id);
      if (!binding) {
        res.status(404).json({ error: 'Vinculación de agente no encontrada.' });
        return;
      }

      const {
        channelId,
        name,
        agentUrl,
        receptionMode,
        headers,
        debounceMs,
        replyField,
        threadIdMode,
        simulateTyping,
        fallbackMessage,
        timeoutMs,
        isActive,
      } = req.body || {};

      if (agentUrl) {
        try {
          new URL(agentUrl);
        } catch {
          res.status(400).json({ error: 'agentUrl debe ser una URL válida (http:// o https://)' });
          return;
        }
      }

      if (channelId && channelId !== binding.channelId) {
        const existing = await agentBindingRepo.getBindingByChannelId(channelId);
        if (existing && existing.id !== binding.id) {
          res.status(400).json({
            error: `La línea seleccionada ya tiene un agente vinculado ("${existing.name}").`,
          });
          return;
        }
      }

      const updates: any = {};
      if (channelId !== undefined) updates.channelId = String(channelId).trim();
      if (name !== undefined) updates.name = String(name).trim();
      if (agentUrl !== undefined) updates.agentUrl = String(agentUrl).trim();
      if (receptionMode !== undefined) {
        updates.receptionMode = receptionMode === 'sse_stream' ? 'sse_stream' : 'sync_json';
      }
      if (headers !== undefined) updates.headers = headers;
      if (debounceMs !== undefined) updates.debounceMs = Number(debounceMs);
      if (replyField !== undefined) updates.replyField = String(replyField).trim();
      if (threadIdMode !== undefined) updates.threadIdMode = threadIdMode === 'phone' ? 'phone' : 'null';
      if (simulateTyping !== undefined) updates.simulateTyping = !!simulateTyping;
      if (fallbackMessage !== undefined) updates.fallbackMessage = fallbackMessage ? String(fallbackMessage).trim() : null;
      if (timeoutMs !== undefined) updates.timeoutMs = Number(timeoutMs);
      if (isActive !== undefined) updates.isActive = !!isActive;

      const updated = await agentBindingRepo.updateBinding(id, updates);
      res.json(updated);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // 6. Delete agent binding
  router.delete('/:id', async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const binding = await agentBindingRepo.getBindingById(id);
      if (!binding) {
        res.status(404).json({ error: 'Vinculación de agente no encontrada.' });
        return;
      }

      await agentBindingRepo.deleteBinding(id);
      res.json({ success: true, message: 'Vinculación de agente eliminada correctamente.' });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // 7. Test connection with an existing registered binding
  router.post('/:id/test', async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const binding = await agentBindingRepo.getBindingById(id);
      if (!binding) {
        res.status(404).json({ error: 'Vinculación de agente no encontrada.' });
        return;
      }

      const result = await agentConnector.testConnection(binding);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // 8. Test connection ad-hoc before saving
  router.post('/test-endpoint', async (req: Request, res: Response) => {
    try {
      const { agentUrl, receptionMode, headers, replyField, threadIdMode, timeoutMs } = req.body || {};
      if (!agentUrl) {
        res.status(400).json({ error: 'agentUrl es requerido para probar la conexión.' });
        return;
      }

      try {
        new URL(agentUrl);
      } catch {
        res.status(400).json({ error: 'agentUrl debe ser una URL válida.' });
        return;
      }

      const dummyBinding: any = {
        id: 'test',
        channelId: 'test',
        name: 'Test Agent',
        agentUrl,
        receptionMode: receptionMode === 'sse_stream' ? 'sse_stream' : 'sync_json',
        headers: typeof headers === 'object' && headers !== null ? headers : {},
        debounceMs: 1500,
        replyField: replyField || 'reply',
        threadIdMode: threadIdMode || 'null',
        simulateTyping: true,
        fallbackMessage: null,
        timeoutMs: typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : 15000,
        isActive: true,
      };

      const result = await agentConnector.testConnection(dummyBinding);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
