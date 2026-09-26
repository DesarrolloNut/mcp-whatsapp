import { AgentBinding, AgentPayload } from '../../domain/models/agentBinding.js';

export interface AgentCallResult {
  reply: string;
  latencyMs: number;
}

export class AgentConnector {
  /**
   * Calls the external AI agent according to its reception mode (sync JSON or SSE stream)
   * and returns the final consolidated text response.
   */
  public async callAgent(binding: AgentBinding, payload: AgentPayload): Promise<AgentCallResult> {
    const startTime = Date.now();
    const timeoutMs = binding.timeoutMs && binding.timeoutMs > 0 ? binding.timeoutMs : 15000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(binding.headers || {}),
    };

    if (binding.receptionMode === 'sse_stream') {
      headers['Accept'] = 'text/event-stream';
    }

    try {
      const response = await fetch(binding.agentUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status} ${response.statusText}${errorBody ? `: ${errorBody.slice(0, 300)}` : ''}`);
      }

      let reply = '';

      if (binding.receptionMode === 'sse_stream') {
        reply = await this.consumeSseStream(response);
      } else {
        reply = await this.consumeSyncJson(response, binding.replyField);
      }

      const latencyMs = Date.now() - startTime;
      return {
        reply: reply.trim(),
        latencyMs,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Parses synchronous JSON response and extracts the reply text.
   */
  private async consumeSyncJson(response: Response, replyField: string = 'reply'): Promise<string> {
    const data = await response.json();
    if (!data || typeof data !== 'object') {
      return String(data ?? '');
    }

    // Attempt lookup using configured replyField (supports dot notation e.g. "output.text")
    let extracted = this.extractNestedProperty(data, replyField);

    // Fallbacks if not found on the specified field
    if (extracted === undefined || extracted === null) {
      const record = data as Record<string, any>;
      const commonFields = ['reply', 'response', 'message', 'text', 'output', 'result'];
      for (const field of commonFields) {
        if (record[field] !== undefined && record[field] !== null) {
          extracted = record[field];
          break;
        }
      }
    }

    if (typeof extracted === 'string') return extracted;
    if (typeof extracted === 'number' || typeof extracted === 'boolean') return String(extracted);
    if (typeof extracted === 'object') return JSON.stringify(extracted, null, 2);

    return JSON.stringify(data);
  }

  /**
   * Reads an SSE (Server-Sent Events) stream chunk-by-chunk and consolidates all tokens.
   */
  private async consumeSseStream(response: Response): Promise<string> {
    if (!response.body) {
      throw new Error('La respuesta SSE no contiene cuerpo streamable.');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let accumulatedText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      // Keep incomplete trailing line in the buffer
      buffer = lines.pop() || '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith(':')) continue; // Ignore SSE comments or empty lines

        if (line.startsWith('data:')) {
          const dataContent = line.slice(5).trim();
          if (dataContent === '[DONE]') {
            return accumulatedText;
          }

          try {
            const parsed = JSON.parse(dataContent);
            if (typeof parsed === 'string') {
              accumulatedText += parsed;
            } else if (typeof parsed === 'object' && parsed !== null) {
              const chunk =
                parsed.chunk ||
                parsed.content ||
                parsed.text ||
                parsed.message ||
                parsed.delta?.content ||
                parsed.delta?.text ||
                '';
              accumulatedText += String(chunk);
            }
          } catch {
            // Raw text chunk in data field
            accumulatedText += dataContent;
          }
        }
      }
    }

    // Flush any leftover buffer if ending with data
    if (buffer.trim().startsWith('data:')) {
      const remaining = buffer.trim().slice(5).trim();
      if (remaining && remaining !== '[DONE]') {
        try {
          const parsed = JSON.parse(remaining);
          const chunk = parsed.chunk || parsed.content || parsed.text || remaining;
          accumulatedText += String(chunk);
        } catch {
          accumulatedText += remaining;
        }
      }
    }

    return accumulatedText;
  }

  private extractNestedProperty(obj: any, path: string): any {
    if (!path) return undefined;
    const parts = path.split('.');
    let current = obj;
    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== 'object') {
        return undefined;
      }
      current = current[part];
    }
    return current;
  }

  /**
   * Tests the connection with the given binding using a simulated message.
   */
  public async testConnection(binding: AgentBinding): Promise<{
    success: boolean;
    latencyMs: number;
    reply?: string;
    error?: string;
  }> {
    const testPayload: AgentPayload = {
      channel: 'whatsapp',
      channel_line: 'test-line',
      channel_user_id: 'test-user-001',
      user_id: 'test-user-001',
      message: 'Hola, este es un mensaje de prueba desde MCP WhatsApp Gateway.',
      thread_id: binding.threadIdMode === 'phone' ? 'test-user-001' : null,
    };

    try {
      const result = await this.callAgent(binding, testPayload);
      return {
        success: true,
        latencyMs: result.latencyMs,
        reply: result.reply,
      };
    } catch (err) {
      return {
        success: false,
        latencyMs: 0,
        error: (err as Error).message,
      };
    }
  }
}
