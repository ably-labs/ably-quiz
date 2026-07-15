import { describe, expect, it } from 'vitest';
import { mcpResultText, parseJsonRpc } from './mcp-client';

describe('parseJsonRpc', () => {
  it('parses a plain JSON response', () => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tools: [] } });
    expect(parseJsonRpc(body, 'application/json', 1).result).toEqual({ tools: [] });
  });

  it('extracts the matching id from an SSE stream', () => {
    const sse = ['event: message', 'data: {"jsonrpc":"2.0","id":7,"result":{"ok":true}}', ''].join(
      '\n',
    );
    expect(parseJsonRpc(sse, 'text/event-stream', 7).result).toEqual({ ok: true });
  });

  it('surfaces a JSON-RPC error', () => {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      error: { code: -32601, message: 'nope' },
    });
    expect(parseJsonRpc(body, 'application/json', 2).error).toMatchObject({ message: 'nope' });
  });

  it('returns {} for unparseable bodies', () => {
    expect(parseJsonRpc('<html>500</html>', 'text/html', 1)).toEqual({});
  });
});

describe('mcpResultText', () => {
  it('joins the text of an MCP result content array', () => {
    const result = {
      content: [
        { type: 'text', text: 'AI ' },
        { type: 'text', text: 'Transport' },
      ],
    };
    expect(mcpResultText(result)).toBe('AI Transport');
  });

  it('handles a string content and missing content', () => {
    expect(mcpResultText({ content: 'plain' })).toBe('plain');
    expect(mcpResultText({})).toBe('');
    expect(mcpResultText(null)).toBe('');
  });
});
