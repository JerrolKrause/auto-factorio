import { ASTRA, object, string } from './protocol.js';
import type { RpcPort } from './protocol.js';
import type { ModelSelection } from '@autofactorio/contracts';
export const DEFAULT_MANAGED_SELECTION: ModelSelection = { provider: 'openai', modelId: ASTRA, reasoningEffort: 'low' };
export interface ManagedModel { id: string; displayName: string | null; efforts: string[] }
export interface ManagedCatalog { provider: 'openai'; models: ManagedModel[] }
export const disabledFeatures = ['shell_tool', 'view_image', 'apps', 'connectors', 'plugins', 'remote_plugin', 'tool_suggest',
  'remote_control', 'browser_use', 'computer_use', 'in_app_browser', 'multi_agent', 'multi_agent_v2', 'collab', 'image_generation',
  'js_repl', 'code_mode', 'code_mode_only', 'memory_tool', 'memories', 'goals', 'token_budget', 'hooks', 'codex_hooks', 'plugin_hooks',
  'request_permissions_tool', 'step_model_switching', 'skill_mcp_dependency_install', 'skill_search'];
export function profileOverrides(mcpNames: string[], logDir: string, selection: ModelSelection = DEFAULT_MANAGED_SELECTION): Record<string, unknown> {
  validateManagedSelectionShape(selection);
  return { forced_login_method: 'chatgpt', model_provider: selection.provider, model: selection.modelId, model_reasoning_effort: selection.reasoningEffort,
    approval_policy: 'never', sandbox_mode: 'read-only', web_search: 'disabled', project_doc_max_bytes: 0,
    log_dir: logDir, 'tools.update_plan.enabled': false, 'features.skip_host_skill_discovery': true,
    ...Object.fromEntries(disabledFeatures.map(key => [`features.${key}`, false])),
    ...Object.fromEntries(mcpNames.map(key => [`mcp_servers.${key}.enabled`, false])) };
}
export interface Preflight { model: string; effort: string; plan: unknown; ordinaryUsageAllowed: boolean | null; usage: unknown }
export class IncludedAllowanceUnavailable extends Error {}
function validateManagedSelectionShape(selection: ModelSelection): void {
  if (selection.provider !== 'openai') throw new Error(`Unsupported managed provider: ${selection.provider}`);
  if (!/^[a-z0-9][a-z0-9.-]{0,99}$/.test(selection.modelId) || !/^[a-z][a-z0-9-]{0,31}$/.test(selection.reasoningEffort)) throw new Error('Invalid managed model selection');
}
async function readCatalog(rpc: RpcPort): Promise<ManagedCatalog> {
  let cursor: string | null = null; const models: ManagedModel[] = []; const cursors = new Set<string>();
  do {
    const result = object(await rpc.call('model/list', { includeHidden: true, ...(cursor ? { cursor } : {}) }));
    if (!Array.isArray(result.data)) throw new Error('Missing model catalog');
    for (const raw of result.data) {
      const model = object(raw); const id = string(model.model);
      const efforts = Array.isArray(model.supportedReasoningEfforts)
        ? model.supportedReasoningEfforts.map(v => string(object(v).reasoningEffort)) : [];
      models.push({ id, displayName: typeof model.displayName === 'string' ? model.displayName : null, efforts: [...new Set(efforts)] });
    }
    cursor = result.nextCursor === null ? null : string(result.nextCursor);
    if (cursor && cursors.has(cursor)) throw new Error('Repeated model cursor');
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return { provider: 'openai', models };
}
export async function managedCatalog(rpc: RpcPort): Promise<ManagedCatalog> {
  await managedAuth(rpc); return readCatalog(rpc);
}
async function managedAuth(rpc: RpcPort): Promise<{ plan: unknown }> {
  const account = object(await rpc.call('account/read', { refreshToken: false }));
  if (!account.account || object(account.account).type !== 'chatgpt') throw new Error('Managed ChatGPT authentication required; API/provider fallback forbidden');
  const auth = object(await rpc.call('getAuthStatus', { includeToken: false, refreshToken: false }));
  if (auth.authMethod !== 'chatgpt') throw new Error('Externally supplied or API authentication rejected');
  return { plan: object(account.account).planType };
}
export function requireManagedSelection(catalog: ManagedCatalog, selection: ModelSelection): ManagedModel {
  validateManagedSelectionShape(selection);
  const model = catalog.models.find(value => value.id === selection.modelId);
  if (!model) throw new Error(`${selection.modelId === ASTRA ? 'Astra' : selection.modelId} unavailable; no model substitution`);
  if (!model.efforts.includes(selection.reasoningEffort)) throw new Error(`${selection.modelId} ${selection.reasoningEffort} effort unavailable`);
  return model;
}
export function checkAllowance(value: unknown): boolean | null {
  const data = object(value);
  const limits = object(data.rateLimits ?? {});
  const exhaustedWindow = ['primary', 'secondary'].some(key => {
    const window = limits[key]; return window && typeof object(window).usedPercent === 'number' && (object(window).usedPercent as number) >= 100;
  });
  if (data.ordinaryUsageAllowed === false || exhaustedWindow || limits.spendControlReached === true || limits.rateLimitReachedType) throw new IncludedAllowanceUnavailable('Included account allowance exhausted; paid usage/reset/fallback forbidden');
  return data.ordinaryUsageAllowed === true ? true : null;
}
export async function discover(rpc: RpcPort, selection: ModelSelection = DEFAULT_MANAGED_SELECTION): Promise<Preflight> {
  const account = await managedAuth(rpc);
  requireManagedSelection(await readCatalog(rpc), selection);
  const usage = await rpc.call('account/rateLimits/read');
  const ordinaryUsageAllowed = checkAllowance(usage);
  // Unknown allowance is reported, but cannot safely authorize an included-only live probe.
  if (ordinaryUsageAllowed !== true) throw new IncludedAllowanceUnavailable('Included account allowance unknown; inference withheld');
  const limits = object(object(usage).rateLimits);
  return { model: selection.modelId, effort: selection.reasoningEffort, plan: account.plan, ordinaryUsageAllowed,
    usage: { primary: limits.primary ?? null, secondary: limits.secondary ?? null, spendControlReached: limits.spendControlReached ?? null } };
}
