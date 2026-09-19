import type {
  AgentCommittedAttachment,
  AgentConversationMessagePage,
  AgentConversationMessagePageOptions,
  AgentConversationMessageWindowRequest,
  AgentConversationMessageWindowResult,
  AgentConversationUpdate,
  AgentDefinition,
  AgentDeviceRpcDeleteTurnRequest,
  AgentDeviceRpcDeleteTurnResponse,
  AgentDeviceRpcGetTurnDetailRequest,
  AgentDeviceRpcGetTurnDetailResponse,
  AgentDeviceRpcRetryTurnRequest,
  AgentDeviceRpcRetryTurnResponse,
  AgentDeviceRpcRunTurnRequest,
  AgentModelConfig,
  AgentRunError,
  AgentRuntimeView,
  ConversationTimelinePage,
  GetConversationTimelinePageOptions,
  MemeLoopRunHandle,
  MemeLoopRunStatus,
  ModelCatalog,
  ProviderAccountConfig,
  RemoteAgentExecuteRequest,
} from 'memeloop';

export interface WikiAgentDesktopHost {
  agentDefinition?: {
    getAgentDefs(): Promise<readonly AgentDefinition[]>;
    getAgentDef(definitionId: string): Promise<AgentDefinition | undefined>;
  };
  agentInstance?: {
    getAgents(page: number, pageSize: number, filters: { closed: false }): Promise<readonly Pick<AgentRuntimeView, 'id'>[]>;
    createAgent(definitionId: string, options?: { preview?: boolean }): Promise<{ id: string }>;
    getAgentMetadata(agentId: string): Promise<AgentRuntimeView | undefined>;
    updateAgent(agentId: string, data: Partial<AgentDefinition>): Promise<AgentRuntimeView>;
    cancelAgent(agentId: string): Promise<void>;
    deleteAgent(agentId: string): Promise<void>;
    getFrameworkConfigSchema(frameworkId: string): Promise<Record<string, unknown>>;
    getAgentMessagePage(conversationId: string, options: AgentConversationMessagePageOptions): Promise<AgentConversationMessagePage>;
    getAgentMessageWindowAround(request: AgentConversationMessageWindowRequest): Promise<AgentConversationMessageWindowResult>;
    getAgentConversationTimelinePage(conversationId: string, options: GetConversationTimelinePageOptions): Promise<ConversationTimelinePage>;
    getAgentTurnDetail(request: AgentDeviceRpcGetTurnDetailRequest): Promise<AgentDeviceRpcGetTurnDetailResponse>;
    prepareAgentDeviceRpcRunTurnForRenderer(request: RemoteAgentExecuteRequest): Promise<WikiAgentHostResult<AgentDeviceRpcRunTurnRequest>>;
    executeAgentRunForRenderer(request: AgentDeviceRpcRunTurnRequest): Promise<WikiAgentHostResult<MemeLoopRunHandle>>;
    getAgentRunStatus(runId: string): Promise<MemeLoopRunStatus | undefined>;
    cancelAgentRun(runId: string): Promise<boolean>;
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
    deleteConversationTurn(request: AgentDeviceRpcDeleteTurnRequest): Promise<AgentDeviceRpcDeleteTurnResponse>;
    retryConversationTurn(request: AgentDeviceRpcRetryTurnRequest): Promise<AgentDeviceRpcRetryTurnResponse>;
    resolveAskQuestion(conversationId: string, questionId: string, answer: string): Promise<void>;
  };
  externalAPI?: {
    getAIConfig(): Promise<{ default?: AgentModelConfig }>;
    getProviderAccounts(): Promise<readonly ProviderAccountConfig[]>;
    getProviderCatalog(): Promise<{ catalog: ModelCatalog }>;
  };
  context?: { get(key: 'isTest'): Promise<boolean | undefined> };
  deepLink?: { openDeepLink(url: string): Promise<void> };
  native?: { log(level: 'error' | 'warn', message: string, data: Record<string, unknown>): Promise<void> };
}

/** The Desktop renderer IPC result is the only plugin-owned host-bridge DTO. */
export type WikiAgentHostResult<T> =
  | { kind: 'success'; value: T }
  | { kind: 'agent-run-error'; error: AgentRunError };

interface WikiAgentObservable<T> {
  subscribe(listener: (value: T) => void): { unsubscribe(): void };
}

export interface WikiAgentDesktopObservables {
  agentInstance?: {
    subscribeToAgentUpdates(agentId: string): WikiAgentObservable<AgentRuntimeView | undefined>;
    subscribeToConversationUpdates(conversationId: string): WikiAgentObservable<AgentConversationUpdate>;
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
