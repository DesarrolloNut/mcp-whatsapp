import { Trigger, TriggerDelivery } from '../models/trigger.js';

export interface ITriggerRepository {
  createTrigger(trigger: Omit<Trigger, 'createdAt' | 'updatedAt'>): Promise<Trigger>;
  updateTrigger(id: string, updates: Partial<Trigger>): Promise<Trigger>;
  deleteTrigger(id: string): Promise<void>;
  getTriggerById(id: string): Promise<Trigger | null>;
  getAllTriggers(): Promise<Trigger[]>;
  getActiveTriggersForChannel(channelId: string): Promise<Trigger[]>;

  // Cola Outbox y Auditoría
  createDelivery(delivery: Omit<TriggerDelivery, 'createdAt' | 'updatedAt'>): Promise<TriggerDelivery>;
  updateDelivery(id: string, updates: Partial<TriggerDelivery>): Promise<void>;
  getPendingDeliveries(limit: number): Promise<TriggerDelivery[]>;
  getDeliveriesByTrigger(triggerId: string, limit?: number): Promise<TriggerDelivery[]>;
  getDeliveryById(id: string): Promise<TriggerDelivery | null>;
  resetFailedDeliveries(triggerId: string): Promise<number>;
  resetDelivery(deliveryId: string): Promise<boolean>;
}
