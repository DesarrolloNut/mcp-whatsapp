import { Router } from 'express';
import { AdminAuthService } from '../../application/services/adminAuth.js';
import { IProviderRepository } from '../../domain/ports/IProviderRepository.js';
import { IChannelRepository } from '../../domain/ports/IChannelRepository.js';
import { ProviderFactory } from '../../application/services/providerFactory.js';
import { createAdminAuthMiddleware } from './middleware/auth.js';
import { createAuthRouter } from './routes/auth.js';
import { createProvidersRouter } from './routes/providers.js';
import { createChannelsRouter } from './routes/channels.js';
import { createSessionRouter } from './routes/session.js';
import { createDashboardRouter } from './routes/dashboard.js';
import { createTriggersRouter } from './routes/triggers.js';
import { BaileysSessionManager } from '../../infrastructure/providers/baileys/sessionManager.js';
import { ITriggerRepository } from '../../domain/ports/ITriggerRepository.js';
import { TriggerDispatcher } from '../../application/services/triggerDispatcher.js';

export interface AdminRouterDependencies {
  authService: AdminAuthService;
  providerRepo: IProviderRepository;
  channelRepo: IChannelRepository;
  providerFactory: ProviderFactory;
  triggerRepo: ITriggerRepository;
  triggerDispatcher: TriggerDispatcher;
  mcpApiToken?: string;
}

export function createAdminRouter(deps: AdminRouterDependencies): Router {
  const router = Router();
  const authMiddleware = createAdminAuthMiddleware(deps.authService);

  // Hook up automatic phone number detection upon successful Baileys pairing
  const sessionManager = BaileysSessionManager.getInstance();
  sessionManager.setOnConnected(async (channelId, phone) => {
    try {
      const channel = await deps.channelRepo.findById(channelId);
      if (channel) {
        const formattedPhone = phone.startsWith('+') ? phone : `+${phone}`;
        if (!channel.phoneNumber || channel.phoneNumber !== formattedPhone) {
          await deps.channelRepo.update(channelId, { phoneNumber: formattedPhone });
        }
      }
    } catch (err) {
      console.error(`[AdminRouter] Error auto-updating channel phone number for ${channelId}:`, err);
    }
  });

  // Public auth endpoint
  router.use('/auth', createAuthRouter(deps.authService));

  // Protected administration endpoints
  router.use('/providers', authMiddleware, createProvidersRouter(deps.providerRepo, deps.providerFactory));
  router.use('/channels', authMiddleware, createChannelsRouter(deps.channelRepo, deps.providerRepo));
  router.use('/channels', authMiddleware, createSessionRouter(deps.channelRepo, deps.providerRepo, sessionManager));
  router.use('/triggers', authMiddleware, createTriggersRouter(deps.triggerRepo, deps.triggerDispatcher));
  router.use('/dashboard', authMiddleware, createDashboardRouter(deps.providerRepo, deps.channelRepo, deps.mcpApiToken));

  return router;
}
