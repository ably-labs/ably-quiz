// MCP MCP grounding config (§S6). Single source of truth for the read-only
// allowlist, the connector wiring, and the pre-built tool "registry" injected
// into agent prompts so they skip the searchAblyTools discovery round-trip
// (Matt's latency optimization, 2026-07-14) and go straight to callTool.
//
// Auth is Option A: the model provider's native MCP connector holds the remote
// connection; the host's short-lived, read-only Okta token is passed per turn.

/** MCP grounding endpoint — the operator's own MCP server `/mcp` URL, from the
 *  `ABLY_MCP_URL` env var. There is NO default: never ship an internal endpoint.
 *  Unset ⇒ grounding is off and agents answer on their own knowledge. */
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

/** Read-only allowlist — the 61 tools finalized with Matt (PROGRESS.md). Passed on
 *  the connection URL so the Worker enforces it server-side (slim mode). */
export const ABLY_OS_READ_TOOLS: readonly string[] = [
  // plumbing
  'callTool',
  'getContext',
  'getContextDetail',
  'getToolCategories',
  'searchAblyTools',
  'listAllContexts',
  'getCurrentDate',
  // skills
  'skillList',
  'skillSearch',
  'skillGet',
  // wiki
  'wikiSearchPages',
  'wikiSearchUsingCql',
  'wikiGetPage',
  'wikiGetPagesInSpace',
  'wikiGetSpaces',
  'wikiGetBlogPost',
  'wikiGetPageAncestors',
  'wikiGetLabels',
  'wikiContentInsights',
  // github
  'githubGetFileContents',
  'githubGetRepository',
  'githubGetIssue',
  'githubGetCommit',
  'githubListAblyRepositories',
  'githubSearchAblyRepositories',
  'githubSmartSearch',
  'githubListBranches',
  'githubListTags',
  'githubListWorkflowRuns',
  'githubGetWorkflowRun',
  'githubAnalyze',
  // helpdesk
  'helpdeskGetConversation',
  'helpdeskGetConversations',
  // web fetch
  'webFetchAI',
  'webFetchBrowser',
  'webFetchScrape',
  // chat
  'chatListChannels',
  'chatFindAndAnalyze',
  'chatDiscoverThemes',
  'chatChannelActivity',
  'chatAnalyzeThread',
  // tracker
  'trackerGetIssue',
  'trackerSearchIssues',
  'trackerListProjects',
  'trackerListBoards',
  'trackerListStatuses',
  'trackerCommonQueries',
  // google workspace (reads only)
  'googleDocsRead',
  'googleDocsAnalyze',
  'googleDocsActivity',
  'googleDriveRead',
  'googleDriveAnalyze',
  'googleDriveExcelAnalyze',
  'googleDriveJSONAnalyze',
  'googleDrivePDFAnalyze',
  'googleSheetsRead',
  'googleSheetsAnalyze',
  'googleSlidesRead',
  'googleSlidesAnalyze',
  'googleSlidesSummary',
  'googleSlidesActivity',
];

/** MCP tools EXPOSED to the model (Anthropic `tool_configuration.allowed_tools`).
 *  Deliberately NOT searchAblyTools — the catalog below is pre-injected, so the
 *  agent dispatches straight through callTool. getContext is a
 *  zero-arg Ably primer that needs no discovery. */
export const ABLY_OS_CONNECTOR_TOOLS: readonly string[] = ['callTool', 'getContext'];

/** The MCP connection URL with the server-side read-only allowlist applied, or
 *  undefined when no MCP server is configured. */
export function ablyOsMcpUrl(): string | undefined {
  if (!MCP_ENDPOINT) return undefined;
  try {
    const url = new URL(MCP_ENDPOINT);
    url.searchParams.set('allowedTools', ABLY_OS_READ_TOOLS.join(','));
    return url.toString();
  } catch {
    return undefined;
  }
}

/** The pre-built tool "registry" injected into agent prompts (grouped, terse) so
 *  the model knows the menu without a searchAblyTools round-trip. */
const CATALOG_GROUPS: ReadonlyArray<{ label: string; tools: string; note: string }> = [
  {
    label: 'Wiki (docs)',
    tools:
      'wikiSearchPages, wikiSearchUsingCql, wikiGetPage, wikiGetPagesInSpace, wikiGetSpaces, wikiGetBlogPost',
    note: 'search & read Ably documentation and internal pages',
  },
  {
    label: 'GitHub',
    tools:
      'githubSearchAblyRepositories, githubGetFileContents, githubGetRepository, githubGetIssue, githubGetCommit, githubSmartSearch',
    note: 'search & read Ably code, repos, issues',
  },
  {
    label: 'Helpdesk',
    tools: 'helpdeskGetConversations, helpdeskGetConversation',
    note: 'read questions users asked the Ably docs AI',
  },
  {
    label: 'Chat',
    tools:
      'chatListChannels, chatFindAndAnalyze, chatDiscoverThemes, chatChannelActivity, chatAnalyzeThread',
    note: 'search & summarize internal Chat discussion',
  },
  {
    label: 'Tracker',
    tools: 'trackerSearchIssues, trackerGetIssue, trackerListProjects, trackerListBoards',
    note: 'read engineering work items',
  },
  {
    label: 'Web',
    tools: 'webFetchAI, webFetchScrape, webFetchBrowser',
    note: 'fetch & read a public web page',
  },
  {
    label: 'Google Workspace (read)',
    tools: 'googleDocsRead, googleDriveRead, googleSheetsRead, googleSlidesRead (+ *Analyze)',
    note: 'read Docs/Drive/Sheets/Slides content',
  },
];

/** Injected into a grounded agent's system prompt. Names the menu + the rules. */
export function groundingInstructions(): string {
  const menu = CATALOG_GROUPS.map((g) => `- ${g.label} — ${g.note}: ${g.tools}`).join('\n');
  return [
    'You may look up your company knowledge to answer, by calling `callTool` with a tool name and args (e.g. callTool("wikiSearchPages", {"query":"…"})). You already know the menu — do NOT call searchAblyTools.',
    'Only do this when it genuinely helps; you are on a tight timer, so at most one quick lookup.',
    'READ ONLY: never perform any create/update/delete/send/share operation. Only access clearly public or company-shared knowledge — if something looks private, personal, financial, or customer-confidential, do not access it.',
    '',
    'Available read tools (via callTool):',
    menu,
  ].join('\n');
}
