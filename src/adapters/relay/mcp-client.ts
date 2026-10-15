// A minimal MCP client over Streamable HTTP: initialize, then call tools.
// Enough for Relay Cloud's read-only tools, with no SDK dependency.
// Spec: https://modelcontextprotocol.io/specification/2025-03-26/basic/transports

interface JsonRpcResponse { jsonrpc: '2.0'; id?: number; result?: any; error?: { code: number; message: string } }

export class McpHttpClient {
  private readonly url: string;
  private readonly token: string;
  private session: string | null = null;
  private nextId = 1;

  constructor(url: string, token: string) {
    this.url = url;
    this.token = token;
  }

  async connect(): Promise<void> {
    await this.request('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'threadline', version: '0.1' },
    });
    await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' });
  }

  /** Call a tool and return its parsed JSON result. Throws on tool or transport errors. */
  async callTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const result = await this.request('tools/call', { name, arguments: args });
    const text = (result?.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
    if (result?.isError) throw new Error(`${name}: ${text.slice(0, 200)}`);
    if (result?.structuredContent) return result.structuredContent as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`${name} returned text that is not JSON: ${text.slice(0, 120)}`);
    }
  }

  private async request(method: string, params: unknown): Promise<any> {
    const id = this.nextId++;
    const res = await this.post({ jsonrpc: '2.0', id, method, params });
    const message = res.find(m => m.id === id);
    if (!message) throw new Error(`MCP ${method}: no response`);
    if (message.error) throw new Error(`MCP ${method}: ${message.error.message}`);
    return message.result;
  }

  private async post(body: unknown): Promise<JsonRpcResponse[]> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(this.session ? { 'Mcp-Session-Id': this.session } : {}),
      },
      body: JSON.stringify(body),
    });
    this.session = res.headers.get('mcp-session-id') ?? this.session;
    if (res.status === 401) throw new Error('Relay rejected the API key (401). Check RELAY_API_KEY in .env.');
    if (res.status === 202) return []; // a notification was accepted
    if (!res.ok) throw new Error(`MCP HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);

    const text = await res.text();
    if ((res.headers.get('content-type') ?? '').includes('text/event-stream')) {
      // Server-Sent Events: each "data:" line carries one JSON-RPC message.
      return text.split('\n').filter(l => l.startsWith('data:')).map(l => JSON.parse(l.slice(5).trim()));
    }
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [parsed];
  }
}
