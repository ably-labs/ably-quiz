// Optional MCP grounding (§S6). Point `ABLY_MCP_URL` at your MCP server's `/mcp`
// endpoint and agents can look up your company's knowledge to answer, over the
// model provider's native MCP connector — the host authorizes a short-lived,
// read-only session in-app (OAuth). Nothing here is provider- or product-
// specific: the tools your agents may call come from `ABLY_MCP_TOOLS` (a
// comma-separated allowlist). Unset `ABLY_MCP_URL` ⇒ grounding is off and agents
// answer on their own knowledge.

/** MCP server `/mcp` endpoint, from the env. No default — nothing internal ships. */
const MCP_ENDPOINT = process.env.ABLY_MCP_URL;

/** The MCP server's OAuth base origin (endpoints hang off it), or undefined when
 *  unconfigured / unparseable. */
export function mcpOrigin(): string | undefined {
  if (!MCP_ENDPOINT) return undefined;
  try {
    return new URL(MCP_ENDPOINT).origin;
  } catch {
    return undefined;
  }
}

/** True when an MCP server is configured, i.e. grounding is available. */
export function isMcpConfigured(): boolean {
  return Boolean(mcpOrigin());
}

/** The read-only tools an agent may call over MCP — from `ABLY_MCP_TOOLS`
 *  (comma-separated). Passed to the provider's connector as the `allowed_tools`
 *  list, so the model can only ever call what you allow. */
export function mcpAllowedTools(): string[] {
  return (process.env.ABLY_MCP_TOOLS ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

/** The MCP connection URL, with the allowlist applied as a query param when the
 *  server supports it (harmless otherwise). Undefined when unconfigured. */
export function mcpConnectionUrl(): string | undefined {
  if (!MCP_ENDPOINT) return undefined;
  try {
    const url = new URL(MCP_ENDPOINT);
    const tools = mcpAllowedTools();
    if (tools.length > 0) url.searchParams.set('allowedTools', tools.join(','));
    return url.toString();
  } catch {
    return undefined;
  }
}

/** Injected into a grounded agent's system prompt: names the allowed tools and
 *  the read-only rules. Generic — the specifics live in your MCP + `ABLY_MCP_TOOLS`. */
export function groundingInstructions(): string {
  const tools = mcpAllowedTools();
  const list = tools.length > 0 ? tools.join(', ') : 'the available MCP tools';
  return [
    `You may make AT MOST ONE read-only lookup to help answer this question, by calling one of the tools available to you (${list}). Only do so when it genuinely helps — you are on a tight timer, so keep it to a single quick call.`,
    'READ ONLY: never perform any create / update / delete / send / share operation, and only access clearly public or company-shared knowledge — if something looks private, personal, financial, or confidential, do not access it.',
  ].join('\n');
}
