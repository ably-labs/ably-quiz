import { describe, expect, it } from 'vitest';
import {
  extractAnswer,
  extractAnswerLoose,
  extractToolCalls,
  mcpToolConfiguration,
} from './providers';

describe('extractAnswer (strict, incremental)', () => {
  it('parses the answer JSON that follows a think-aloud', () => {
    const t = 'Gold is Au.\n{"choice":"A","confidence":0.9,"quip":"Au natural"}';
    expect(extractAnswer(t)).toEqual({ choice: 'A', confidence: 0.9, quip: 'Au natural' });
  });

  it('returns null until the JSON object is complete', () => {
    expect(extractAnswer('thinking… {"choice":"A","confidence":0.5')).toBeNull();
  });

  it('uppercases the choice and clamps confidence to 0..1', () => {
    expect(extractAnswer('{"choice":"b","confidence":2,"quip":"x"}')).toEqual({
      choice: 'B',
      confidence: 1,
      quip: 'x',
    });
  });

  it('rejects a choice outside A–D', () => {
    expect(extractAnswer('{"choice":"E","confidence":0.5,"quip":"x"}')).toBeNull();
  });
});

describe('extractAnswerLoose (fallback for malformed JSON)', () => {
  it('recovers the choice when an unescaped quote in the quip breaks strict JSON (S0 failure mode)', () => {
    const t = `Presence tracks who's online.\n{"choice":"C","confidence":0.99,"quip":"the ultimate "who's online" detector!"}`;
    expect(extractAnswer(t)).toBeNull(); // strict can't parse it
    const loose = extractAnswerLoose(t);
    expect(loose?.choice).toBe('C');
    expect(loose?.confidence).toBe(0.99);
  });

  it('returns null when there is no choice to recover', () => {
    expect(extractAnswerLoose('I have no idea, sorry.')).toBeNull();
  });
});

describe('mcpToolConfiguration (grounding connector allowlist)', () => {
  // Regression: an EMPTY allowed_tools list makes the Anthropic MCP connector
  // 400 ("Cannot pass empty list for allowed_tools"), which silently killed
  // grounding for every Anthropic agent. With no allowlist we must OMIT it.
  it('omits tool_configuration entirely when the allowlist is empty', () => {
    expect(mcpToolConfiguration([])).toEqual({});
    expect('tool_configuration' in mcpToolConfiguration([])).toBe(false);
  });

  it('includes allowed_tools when an allowlist is configured', () => {
    expect(mcpToolConfiguration(['search_docs', 'get_page'])).toEqual({
      tool_configuration: { allowed_tools: ['search_docs', 'get_page'] },
    });
  });
});

describe('extractToolCalls (MCP tool-use blocks → transcript)', () => {
  it('pairs an mcp_tool_use with its mcp_tool_result by id', () => {
    const content = [
      { type: 'text', text: 'let me look that up' },
      {
        type: 'mcp_tool_use',
        id: 'mcptoolu_1',
        name: 'wikiSearchPages',
        server_name: 'knowledge',
        input: { query: 'AI Transport' },
      },
      {
        type: 'mcp_tool_result',
        tool_use_id: 'mcptoolu_1',
        is_error: false,
        content: [{ type: 'text', text: 'AI Transport is Ably’s agent product.' }],
      },
    ];
    expect(extractToolCalls(content)).toEqual([
      {
        name: 'wikiSearchPages',
        server: 'knowledge',
        input: '{"query":"AI Transport"}',
        result: 'AI Transport is Ably’s agent product.',
        isError: false,
      },
    ]);
  });

  it('records a tool_use with no result, and flags errors', () => {
    const content = [
      { type: 'mcp_tool_use', id: 'a', name: 'noResult', input: {} },
      { type: 'mcp_tool_use', id: 'b', name: 'boom', input: { x: 1 } },
      { type: 'mcp_tool_result', tool_use_id: 'b', is_error: true, content: 'nope' },
    ];
    const calls = extractToolCalls(content);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.name).toBe('noResult');
    expect(calls[0]?.result).toBeUndefined();
    expect(calls[1]).toMatchObject({ name: 'boom', result: 'nope', isError: true });
  });

  it('returns [] for non-array or tool-free content', () => {
    expect(extractToolCalls(undefined)).toEqual([]);
    expect(extractToolCalls([{ type: 'text', text: 'hi' }])).toEqual([]);
  });
});
