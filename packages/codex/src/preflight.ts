import { ASTRA, object, string } from './protocol.js';
import type { RpcPort } from './protocol.js';
export const disabledFeatures = ['shell_tool', 'view_image', 'apps', 'connectors', 'plugins', 'remote_plugin', 'tool_suggest',
  'remote_control', 'browser_use', 'computer_use', 'in_app_browser', 'multi_agent', 'multi_agent_v2', 'collab', 'image_generation',
  'js_repl', 'code_mode', 'code_mode_only', 'memory_tool', 'memories', 'goals', 'token_budget', 'hooks', 'codex_hooks', 'plugin_hooks',
  'request_permissions_tool', 'step_model_switching', 'skill_mcp_dependency_install', 'skill_search'];
export function profileOverrides(mcpNames: string[], logDir: string): Record<string, unknown> {
  return { forced_login_method: 'chatgpt', model_provider: 'openai', model: ASTRA, model_reasoning_effort: 'low',
    approval_policy: 'never', sandbox_mode: 'read-only', web_search: 'disabled', project_doc_max_bytes: 0,
    log_dir: logDir, 'tools.update_plan.enabled': false, 'features.skip_host_skill_discovery': true,
    ...Object.fromEntries(disabledFeatures.map(key => [`features.${key}`, false])),
    ...Object.fromEntries(mcpNames.map(key => [`mcp_servers.${key}.enabled`, false])) };
}
export interface Preflight { model: string; effort: string; plan: unknown; ordinaryUsageAllowed: boolean | null; usage: unknown }
export class IncludedAllowanceUnavailable extends Error {}
export function checkAllowance(value: unknown): boolean | null {
  const data = object(value);
  const limits = object(data.rateLimits ?? {});
  const exhaustedWindow = ['primary', 'secondary'].some(key => {
    const window = limits[key]; return window && typeof object(window).usedPercent === 'number' && (object(window).usedPercent as number) >= 100;
  });
  if (data.ordinaryUsageAllowed === false || exhaustedWindow || limits.spendControlReached === true || limits.rateLimitReachedType) throw new IncludedAllowanceUnavailable('Included account allowance exhausted; paid usage/reset/fallback forbidden');
  return data.ordinaryUsageAllowed === true ? true : null;
}
export async function discover(rpc: RpcPort): Promise<Preflight> {
  const account = object(await rpc.call('account/read', { refreshToken: false }));
  if (!account.account || object(account.account).type !== 'chatgpt') throw new Error('Managed ChatGPT authentication required; API/provider fallback forbidden');
  const auth = object(await rpc.call('getAuthStatus', { includeToken: false, refreshToken: false }));
  if (auth.authMethod !== 'chatgpt') throw new Error('Externally supplied or API authentication rejected');
  let cursor: string | null = null; let model: Record<string, unknown> | undefined;
  const cursors = new Set<string>();
  do {
    const result = object(await rpc.call('model/list', { includeHidden: true, ...(cursor ? { cursor } : {}) }));
    if (!Array.isArray(result.data)) throw new Error('Missing model catalog');
    model ??= result.data.map(object).find(m => m.model === ASTRA);
    cursor = result.nextCursor === null ? null : string(result.nextCursor);
    if (cursor && cursors.has(cursor)) throw new Error('Repeated model cursor');
    if (cursor) cursors.add(cursor);
  } while (cursor);
  if (!model) throw new Error('Astra unavailable; no model substitution');
  if (!Array.isArray(model.supportedReasoningEfforts) || !model.supportedReasoningEfforts.some(v => object(v).reasoningEffort === 'low')) throw new Error('Astra low effort unavailable');
  const usage = await rpc.call('account/rateLimits/read');
  const ordinaryUsageAllowed = checkAllowance(usage);
  // Unknown allowance is reported, but cannot safely authorize an included-only live probe.
  if (ordinaryUsageAllowed !== true) throw new IncludedAllowanceUnavailable('Included account allowance unknown; inference withheld');
  const limits = object(object(usage).rateLimits);
  return { model: ASTRA, effort: 'low', plan: object(account.account).planType, ordinaryUsageAllowed,
    usage: { primary: limits.primary ?? null, secondary: limits.secondary ?? null, spendControlReached: limits.spendControlReached ?? null } };
}
