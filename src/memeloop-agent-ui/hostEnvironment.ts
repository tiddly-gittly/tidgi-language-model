import type {
  AgentCommittedAttachment,
  AgentConversationMessagePage,
  AgentConversationMessageWindowResult,
  AgentConversationTurnDetailResponse,
  AgentDefinition,
  AgentFrameworkConfig,
  AgentModelConfig,
  AgentRunError,
  AgentRuntimeView,
  ConversationTimelinePage,
  ModelCatalog,
  ProviderAccountConfig,
} from 'memeloop';

export interface WikiAgentDesktopHost {
  agentDefinition?: {
    getAgentDefs(): Promise<readonly AgentDefinition[]>;
    getAgentDef(definitionId: string): Promise<AgentDefinition | undefined>;
  };
  agentInstance?: {
    getAgents(page: number, pageSize: number, filters: { closed: false }): Promise<readonly { id: string }[]>;
    createAgent(definitionId: string, options?: { preview?: boolean }): Promise<{ id: string }>;
    getAgentMetadata(agentId: string): Promise<AgentRuntimeView | undefined>;
    updateAgent(agentId: string, data: Partial<AgentDefinition>): Promise<AgentRuntimeView>;
    cancelAgent(agentId: string): Promise<void>;
    deleteAgent(agentId: string): Promise<void>;
    getFrameworkConfigSchema(frameworkId: string): Promise<Record<string, unknown>>;
    getAgentMessagePage(conversationId: string, options: unknown): Promise<AgentConversationMessagePage>;
    getAgentMessageWindowAround(request: unknown): Promise<AgentConversationMessageWindowResult>;
    getAgentConversationTimelinePage(conversationId: string, options: unknown): Promise<ConversationTimelinePage>;
    getAgentTurnDetail(request: unknown): Promise<AgentConversationTurnDetailResponse>;
    prepareAgentDeviceRpcRunTurnForRenderer(request: unknown): Promise<WikiAgentHostResult<unknown>>;
    executeAgentRunForRenderer(request: unknown): Promise<WikiAgentHostResult<WikiAgentRunHandle>>;
    getAgentRunStatus(runId: string): Promise<WikiAgentRunStatus | undefined>;
    cancelAgentRun(runId: string): Promise<void>;
    beginAgentAttachmentUpload(input: {
      conversationId: string;
      filename: string;
      mimeType: string;
      totalBytes: number;
      sha256?: string;
    }): Promise<{ uploadId: string }>;
    writeAgentAttachmentChunk(input: {
      conversationId: string;
      uploadId: string;
      offset: number;
      data: Uint8Array;
    }): Promise<{ nextOffset: number }>;
    commitAgentAttachmentUpload(input: { conversationId: string; uploadId: string }): Promise<AgentCommittedAttachment>;
    abortAgentAttachmentUpload(input: { conversationId: string; uploadId: string }): Promise<void>;
    deleteConversationTurn(request: unknown): Promise<unknown>;
    retryConversationTurn(request: unknown): Promise<unknown>;
    resolveAskQuestion(conversationId: string, questionId: string, answer: string): Promise<void>;
    getAgentFrameworkConfig?(agentId: string): Promise<AgentFrameworkConfig | undefined>;
  };
  externalAPI?: {
    getAIConfig(): Promise<{ default?: AgentModelConfig }>;
    getProviderAccounts(): Promise<readonly ProviderAccountConfig[]>;
    getProviderCatalog(): Promise<{ catalog: ModelCatalog }>;
  };
  context?: { get(key: string): Promise<unknown> };
  deepLink?: { openDeepLink(url: string): Promise<void> };
  native?: { log(level: 'error' | 'warn', message: string, data: Record<string, unknown>): Promise<void> };
}

export interface WikiAgentHostResult<T> {
  kind: 'success' | 'failure';
  value?: T;
  error?: AgentRunError;
}

export interface WikiAgentRunHandle {
  runId: string;
  conversationId: string;
  requestId: string;
  turnId: string;
}

export interface WikiAgentRunStatus {
  state: 'completed' | 'failed' | 'cancelled' | 'queued' | 'running';
  error?: AgentRunError;
}

interface WikiAgentObservable<T> {
  subscribe(listener: (value: T) => void): { unsubscribe(): void };
}

export interface WikiAgentDesktopObservables {
  agentInstance?: {
    subscribeToAgentUpdates(agentId: string): WikiAgentObservable<AgentRuntimeView | undefined>;
    subscribeToConversationUpdates(conversationId: string): WikiAgentObservable<unknown>;
  };
}

declare global {
  interface Window {
    service: WikiAgentDesktopHost;
    observables: WikiAgentDesktopObservables;
  }
}

export function getWikiAgentHost(): WikiAgentDesktopHost | undefined {
  return typeof window === 'undefined' ? undefined : window.service;
}

export function getWikiAgentObservables(): WikiAgentDesktopObservables | undefined {
  return typeof window === 'undefined' ? undefined : window.observables;
}
