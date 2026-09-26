import { Router, Request, Response } from 'express';
import crypto from 'node:crypto';
import { ITriggerRepository } from '../../../domain/ports/ITriggerRepository.js';
import { TriggerDispatcher } from '../../../application/services/triggerDispatcher.js';

export function createTriggersRouter(
  triggerRepo: ITriggerRepository,
  dispatcher: TriggerDispatcher
): Router {
  const router = Router();

  // 1. List all triggers with summary delivery counts
  router.get('/', async (_req: Request, res: Response) => {
    try {
      const triggers = await triggerRepo.getAllTriggers();
      const triggersWithStats = await Promise.all(
        triggers.map(async (t) => {
          const deliveries = await triggerRepo.getDeliveriesByTrigger(t.id, 100);
          const pending = deliveries.filter((d) => d.status === 'pending').length;
          const delivered = deliveries.filter((d) => d.status === 'delivered').length;
          const failed = deliveries.filter((d) => d.status === 'failed').length;
          return {
            ...t,
            stats: { pending, delivered, failed, total: deliveries.length },
          };
        })
      );
      res.json(triggersWithStats);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // 2. Create trigger with configurable parameters & sensible defaults
  router.post('/', async (req: Request, res: Response) => {
    try {
      const {
        name,
        channelId,
        isActive,
        filterMessageType,
        filterIgnoreGroups,
        filterKeyword,
        targetUrl,
        targetMethod,
        targetHeaders,
        payloadMode,
        payloadTemplate,
        timeoutMs,
        maxRetries,
        retryDelayMs,
        secretToken,
      } = req.body || {};

      if (!name || !targetUrl) {
        res.status(400).json({ error: 'Missing required fields: name, targetUrl' });
        return;
      }

      // Basic URL format validation
      try {
        new URL(targetUrl);
      } catch {
        res.status(400).json({ error: 'targetUrl must be a valid HTTP or HTTPS URL' });
        return;
      }

      const id = `trig_${crypto.randomBytes(6).toString('hex')}`;
      const trigger = await triggerRepo.createTrigger({
        id,
        name: String(name).trim(),
        channelId: channelId ? String(channelId).trim() : null,
        isActive: isActive !== false,
        filterMessageType: filterMessageType ? String(filterMessageType).trim() : 'all',
        filterIgnoreGroups: filterIgnoreGroups !== false,
        filterKeyword: filterKeyword ? String(filterKeyword).trim() : null,
        targetUrl: String(targetUrl).trim(),
        targetMethod: (['POST', 'PUT', 'GET'].includes(targetMethod) ? targetMethod : 'POST') as any,
        targetHeaders: typeof targetHeaders === 'object' && targetHeaders !== null ? targetHeaders : { 'Content-Type': 'application/json' },
        payloadMode: (['standard', 'custom'].includes(payloadMode) ? payloadMode : 'standard') as any,
        payloadTemplate: typeof payloadTemplate === 'object' && payloadTemplate !== null ? payloadTemplate : {},
        timeoutMs: Number(timeoutMs) > 0 ? Number(timeoutMs) : 5000,
        maxRetries: Number(maxRetries) >= 0 ? Number(maxRetries) : 3,
        retryDelayMs: Number(retryDelayMs) > 0 ? Number(retryDelayMs) : 10000,
        secretToken: secretToken ? String(secretToken).trim() : null,
      });

      res.status(201).json(trigger);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // 3. Get trigger by ID
  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const trigger = await triggerRepo.getTriggerById(id);
      if (!trigger) {
        res.status(404).json({ error: `Trigger not found with id: ${id}` });
        return;
      }
      res.json(trigger);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // 4. Update trigger
  router.put('/:id', async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const updates = req.body || {};
      const updated = await triggerRepo.updateTrigger(id, updates);
      res.json(updated);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // 5. Delete trigger
  router.delete('/:id', async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      await triggerRepo.deleteTrigger(id);
      res.json({ success: true, message: `Trigger ${id} deleted` });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // 6. Test trigger in real-time with mock data
  router.post('/:id/test', async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const trigger = await triggerRepo.getTriggerById(id);
      if (!trigger) {
        res.status(404).json({ error: `Trigger not found with id: ${id}` });
        return;
      }

      const mockContext = req.body?.mockContext;
      const testResult = await dispatcher.testTrigger(trigger, mockContext);
      res.json(testResult);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // 7. Get deliveries for trigger (paginated)
  router.get('/:id/deliveries', async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const limit = Number(req.query.limit) > 0 ? Number(req.query.limit) : 50;
      const deliveries = await triggerRepo.getDeliveriesByTrigger(id, limit);
      res.json(deliveries);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // 8. Replay all failed deliveries for a trigger
  router.post('/:id/retry-failed', async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const count = await triggerRepo.resetFailedDeliveries(id);
      // Run background processing immediately
      setImmediate(() => {
        dispatcher.processQueue().catch(() => {});
      });
      res.json({ success: true, count, message: `Requeued ${count} failed deliveries for retry` });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // 9. Replay a single delivery
  router.post('/deliveries/:deliveryId/retry', async (req: Request, res: Response) => {
    try {
      const deliveryId = String(req.params.deliveryId);
      const ok = await triggerRepo.resetDelivery(deliveryId);
      if (!ok) {
        res.status(404).json({ error: `Delivery ${deliveryId} not found` });
        return;
      }
      setImmediate(() => {
        dispatcher.processQueue().catch(() => {});
      });
      res.json({ success: true, message: `Requeued delivery ${deliveryId}` });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
