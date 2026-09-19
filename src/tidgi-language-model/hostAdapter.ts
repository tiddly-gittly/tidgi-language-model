import type {
  AgentDefinition,
  AgentFrameworkConfig,
  AgentInstanceClient,
  AgentModelConfig,
  AgentRunErrorSettingTarget,
  AgentSessionTarget,
  ModelCatalog,
  ProviderAccountConfig,
} from 'memeloop';

import { resolveWikiAgentId } from './agentDiscovery';
import { getWikiAgentHost, getWikiAgentObservables, type WikiAgentDesktopHost } from './hostEnvironment';

const MAX_AGENT_DEFINITIONS = 128;
const MAX_MODEL_OPTIONS = 512;

/**
 * Narrow host boundary used by the example plugin. The React view does not
 * know about Electron IPC or settings storage. Tests and alternate Wiki hosts
 * can inject a compatible adapter without importing this Desktop bridge.
 */
export interface WikiAgentHostAdapter {
  isReady(): boolean;
  resolveAgentTarget(requestedAgentId: string | undefined, options: { signal: AbortSignal }): Promise<AgentSessionTarget>;
  listAgentDefinitions(options: { signal: AbortSignal }): Promise<readonly AgentDefinition[]>;
  createAgent(definition: AgentDefinition, options: { signal: AbortSignal }): ReturnType<AgentInstanceClient['createAgent']>;
  getAgentDefinition(definitionId: string, options: { signal: AbortSignal }): Promise<AgentDefinition | undefined>;
  getAgentFrameworkConfig(agentId: string, definitionId: string, options: { signal: AbortSignal }): Promise<AgentFrameworkConfig | undefined>;
  getModelConfig(agentId: string, definitionId: string, options: { signal: AbortSignal }): Promise<AgentModelConfig | undefined>;
  listProviderAccounts(options: { signal: AbortSignal }): Promise<readonly ProviderAccountConfig[]>;
  getProviderCatalog(options: { signal: AbortSignal }): Promise<ModelCatalog>;
  selectModel(agentId: string, selection: AgentModelConfig, options: { signal: AbortSignal }): Promise<void>;
  /** Exact Core target when available; hosts without field focus may degrade to its section. */
  openSettings(target?: AgentRunErrorSettingTarget): Promise<void>;
  logError(message: string, error: unknown): void;
}

export class WikiAgentHostUnavailableError extends Error {
  readonly code = 'wiki_agent_host_unavailable';

  constructor() {
    super('MemeLoop host services are unavailable');
    this.name = 'WikiAgentHostUnavailableError';
  }
}

function serviceWindow(): WikiAgentDesktopHost | undefined {
  return getWikiAgentHost();
}

function assertReady(): WikiAgentDesktopHost {
  const service = serviceWindow();
  if (
    !service?.agentDefinition || !service.agentInstance || !service.externalAPI ||
    !service.context || !service.deepLink
  ) throw new WikiAgentHostUnavailableError();
  return service;
}

function assertPluginHostReady(): void {
  assertReady();
  const observables = getWikiAgentObservables();
  if (!observables?.agentInstance) {
    throw new WikiAgentHostUnavailableError();
  }
}

function throwIfAborted(signal: AbortSignal): void {
  signal.throwIfAborted();
}

function boundedDefinitions(definitions: readonly AgentDefinition[]): AgentDefinition[] {
  const seen = new Set<string>();
  const result: AgentDefinition[] = [];
  for (const definition of definitions) {
    if (!definition.id || seen.has(definition.id)) continue;
    seen.add(definition.id);
    result.push(definition);
    if (result.length === MAX_AGENT_DEFINITIONS) break;
  }
  return result;
}

async function resolvedModelConfig(agentId: string, definitionId: string): Promise<AgentModelConfig | undefined> {
  const service = assertReady();
  const instance = await requireAgentInstance(service).getAgentMetadata(agentId);
  if (instance?.modelConfig) return instance.modelConfig;
  const definition = await requireAgentDefinition(service).getAgentDef(instance?.agentDefId || definitionId);
  if (definition?.modelConfig) return definition.modelConfig;
  const globalConfig = await requireExternalAPI(service).getAIConfig();
  return globalConfig.default
    ? globalConfig.default
    : undefined;
}

export function createDesktopWikiAgentHostAdapter(): WikiAgentHostAdapter {
  return {
    isReady: () => {
      try {
        assertPluginHostReady();
        return true;
      } catch {
        return false;
      }
    },

    async resolveAgentTarget(requestedAgentId, { signal }) {
      throwIfAborted(signal);
      const agentId = await resolveWikiAgentId(requestedAgentId, requireAgentInstance(assertReady()));
      throwIfAborted(signal);
      return { agentId, conversationId: agentId };
    },

    async listAgentDefinitions({ signal }) {
      throwIfAborted(signal);
      const definitions = await requireAgentDefinition(assertReady()).getAgentDefs();
      throwIfAborted(signal);
      return boundedDefinitions(definitions);
    },

    async createAgent(definition, { signal }) {
      throwIfAborted(signal);
      const instance = await requireAgentInstance(assertReady()).createAgent(definition.id);
      throwIfAborted(signal);
      return { id: instance.id };
    },

    async getAgentDefinition(definitionId, { signal }) {
      throwIfAborted(signal);
      const definition = await requireAgentDefinition(assertReady()).getAgentDef(definitionId);
      throwIfAborted(signal);
      return definition;
    },

    async getAgentFrameworkConfig(agentId, definitionId, { signal }) {
      throwIfAborted(signal);
      const service = assertReady();
      const instance = await requireAgentInstance(service).getAgentMetadata(agentId);
      throwIfAborted(signal);
      if (instance?.agentFrameworkConfig !== undefined) {
        return instance.agentFrameworkConfig;
      }
      const definition = await requireAgentDefinition(service).getAgentDef(instance?.agentDefId || definitionId);
      throwIfAborted(signal);
      return definition?.agentFrameworkConfig;
    },

    async getModelConfig(agentId, definitionId, { signal }) {
      throwIfAborted(signal);
      const selection = await resolvedModelConfig(agentId, definitionId);
      throwIfAborted(signal);
      return selection;
    },

    async listProviderAccounts({ signal }) {
      throwIfAborted(signal);
      const accounts = await requireExternalAPI(assertReady()).getProviderAccounts();
      throwIfAborted(signal);
      return accounts;
    },

    async getProviderCatalog({ signal }) {
      throwIfAborted(signal);
      const resolution = await requireExternalAPI(assertReady()).getProviderCatalog();
      throwIfAborted(signal);
      return resolution.catalog;
    },

    async selectModel(agentId, selection, { signal }) {
      throwIfAborted(signal);
      const service = assertReady();
      const instance = await requireAgentInstance(service).getAgentMetadata(agentId);
      throwIfAborted(signal);
      if (!instance) throw new WikiAgentHostUnavailableError();
      await requireAgentInstance(service).updateAgent(agentId, {
        modelConfig: selection,
      });
      throwIfAborted(signal);
    },

    async openSettings(target) {
      const service = assertReady();
      const isTestMode = await requireContext(service).get('isTest');
      await requireDeepLink(service).openDeepLink(buildSettingsDeepLink(isTestMode === true ? 'tidgi-test' : 'tidgi', target));
    },

    logError(message, error) {
      const native = serviceWindow()?.native;
      if (!native) return;
      void native.log('error', message, { error }).catch(() => undefined);
    },
  };
}

export const WIKI_AGENT_HOST_LIMITS = Object.freeze({
  agentDefinitions: MAX_AGENT_DEFINITIONS,
  modelOptions: MAX_MODEL_OPTIONS,
});

function requireAgentDefinition(service: WikiAgentDesktopHost) {
  if (!service.agentDefinition) throw new WikiAgentHostUnavailableError();
  return service.agentDefinition;
}

function requireAgentInstance(service: WikiAgentDesktopHost) {
  if (!service.agentInstance) throw new WikiAgentHostUnavailableError();
  return service.agentInstance;
}

function requireExternalAPI(service: WikiAgentDesktopHost) {
  if (!service.externalAPI) throw new WikiAgentHostUnavailableError();
  return service.externalAPI;
}

function requireContext(service: WikiAgentDesktopHost) {
  if (!service.context) throw new WikiAgentHostUnavailableError();
  return service.context;
}

function requireDeepLink(service: WikiAgentDesktopHost) {
  if (!service.deepLink) throw new WikiAgentHostUnavailableError();
  return service.deepLink;
}

function buildSettingsDeepLink(scheme: 'tidgi' | 'tidgi-test', target?: AgentRunErrorSettingTarget): string {
  const section = target?.kind === 'runtime' ? target.section === 'network' ? 'network' : 'aiAgent' : 'externalAPI';
  const url = new URL(`${scheme}://preferences/${section}`);
  if (target?.kind === 'provider') {
    url.searchParams.set('provider', target.providerId);
    url.searchParams.set('field', target.field);
  } else if (target?.kind === 'model') {
    url.searchParams.set('provider', target.providerId);
    url.searchParams.set('model', target.modelId);
    url.searchParams.set('field', 'model');
  }
  return url.toString();
}
