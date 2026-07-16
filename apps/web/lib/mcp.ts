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

/** The MCP connection URL for the grounded loop. Requests the native tool surface
 *  (`mode=full`); the tool ALLOWLIST is applied client-side in the loop (§S6.7),
 *  not via a query param. Undefined when unconfigured. */
export function mcpConnectionUrl(): string | undefined {
  if (!MCP_ENDPOINT) return undefined;
  try {
    const url = new URL(MCP_ENDPOINT);
    url.searchParams.set('mode', 'full');
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
  // Optional per-deployment steering (e.g. "prefer getAutomaticContext; avoid the
  // slow live-system dispatcher") — keeps server specifics out of the public repo.
  const guidance = process.env.ABLY_MCP_GUIDANCE?.trim();
  return [
    `You have a few specific read-only company tools, already connected (${list}) — calls take well under a second.`,
    'ACCURACY BEATS SPEED: this is a live quiz where a wrong answer scores nothing, while a slower correct answer still scores well — a few seconds spent verifying is ALWAYS a better trade than a wrong guess. Answer directly with NO tool call only when you are genuinely certain from your studies or general knowledge. If you are anything less than certain and a tool could settle it, look it up before answering — never present an unverified guess as an answer when a lookup could have confirmed it.',
    'If you need more than one lookup, request ALL the tool calls together in a single response (parallel tool calls) — they run concurrently. Only chain lookups when a call genuinely depends on a previous result.',
    'Only if the tools return nothing useful should you fall back to your best remaining guess — an educated guess still beats no answer.',
    'READ ONLY: never perform any create / update / delete / send / share operation, and only access clearly public or company-shared knowledge — if something looks private, personal, financial, or confidential, do not access it.',
    ...(guidance ? [guidance] : []),
  ].join('\n');
}
