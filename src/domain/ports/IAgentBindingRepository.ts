import { AgentBinding } from '../models/agentBinding.js';

export interface IAgentBindingRepository {
  createBinding(binding: Omit<AgentBinding, 'createdAt' | 'updatedAt'>): Promise<AgentBinding>;
  updateBinding(id: string, updates: Partial<AgentBinding>): Promise<AgentBinding>;
  deleteBinding(id: string): Promise<void>;
  getBindingById(id: string): Promise<AgentBinding | null>;
  getBindingByChannelId(channelId: string): Promise<AgentBinding | null>;
  getAllBindings(): Promise<AgentBinding[]>;
}
