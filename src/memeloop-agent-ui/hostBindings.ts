import type { ConversationTimelinePageClient, ConversationTimelinePageRequest } from '@memeloop/react-ui/chat';
import { type AgentAttachmentInput, type AgentCommittedAttachment, type AgentConversationClient, type AgentInstanceClient, AgentRunFailure } from 'memeloop';
import { getWikiAgentHost, getWikiAgentObservables, type WikiAgentHostResult } from './hostEnvironment';

const TIMELINE_PAGE_LIMIT = 50;
const TIMELINE_PAGE_MAX_BYTES = 256 * 1024;
const DESKTOP_ATTACHMENT_CHUNK_BYTES = 256 * 1024;
const DESKTOP_ATTACHMENT_TOTAL_BYTES = 64 * 1024 * 1024;

export function createSecureBrowserUuid(): string {
  const cryptoProvider = Reflect.get(globalThis, 'crypto') as Crypto | undefined;
  if (cryptoProvider?.randomUUID) return cryptoProvider.randomUUID();
  const values = new Uint32Array(4);
  cryptoProvider?.getRandomValues(values);
  return Array.from(values, value => value.toString(16).padStart(8, '0')).join('-');
}

/** Keep File reads lazy so the host upload bridge controls the byte budget. */
export function createFileAttachmentSource(file: File): AgentAttachmentInput {
  return {
    kind: 'source',
    filename: file.name,
    mimeType: file.type || 'application/octet-stream',
    totalBytes: file.size,
    async readChunk(offset, maxBytes, options) {
      options?.signal?.throwIfAborted();
      if (offset >= file.size) return null;
      const data = new Uint8Array(await file.slice(offset, Math.min(file.size, offset + maxBytes)).arrayBuffer());
      options?.signal?.throwIfAborted();
      return data;
    },
  };
}

export function createWikiAgentInstanceClient(): AgentInstanceClient {
  return {
    async createAgent(definitionId, options) {
      options?.signal?.throwIfAborted();
      const instance = await requireAgentInstance().createAgent(definitionId, { preview: options?.preview });
      options?.signal?.throwIfAborted();
      return { id: instance.id };
    },
    async fetchAgent(agentId, options) {
      options?.signal?.throwIfAborted();
      const agent = await requireAgentInstance().getAgentMetadata(agentId);
      options?.signal?.throwIfAborted();
      if (!agent) throw new Error(`Agent not found: ${agentId}`);
      return agent;
    },
    async updateAgent(agentId, data, options) {
      options?.signal?.throwIfAborted();
      const agent = await requireAgentInstance().updateAgent(agentId, data);
      options?.signal?.throwIfAborted();
      return agent;
    },
    async cancelAgent(agentId, options) {
      options?.signal?.throwIfAborted();
      await requireAgentInstance().cancelAgent(agentId);
      options?.signal?.throwIfAborted();
    },
    async deleteAgent(agentId, options) {
      options?.signal?.throwIfAborted();
      await requireAgentInstance().deleteAgent(agentId);
      options?.signal?.throwIfAborted();
    },
    subscribeToUpdates(agentId, listener) {
      const observable = getWikiAgentObservables()?.agentInstance;
      if (!observable) throw new Error('wiki_agent_observables_unavailable');
      const subscription = observable.subscribeToAgentUpdates(agentId).subscribe(update => {
        if (update) listener(update);
      });
      return () => {
        subscription.unsubscribe();
      };
    },
    async getAgentFrameworkId(agentId, options) {
      const agent = await this.fetchAgent(agentId, options);
      return agent.agentDefId;
    },
    async getFrameworkConfigSchema(frameworkId, options) {
      options?.signal?.throwIfAborted();
      const schema = await requireAgentInstance().getFrameworkConfigSchema(frameworkId);
      options?.signal?.throwIfAborted();
      return schema;
    },
  };
}

export function createWikiAgentConversationClient(): AgentConversationClient {
  return {
    async getMessagePage(conversationId, options, callOptions) {
      callOptions?.signal?.throwIfAborted();
      const page = await requireAgentInstance().getAgentMessagePage(conversationId, options);
      callOptions?.signal?.throwIfAborted();
      return page;
    },
    async getMessageWindowAround(request, options) {
      options?.signal?.throwIfAborted();
      const page = await requireAgentInstance().getAgentMessageWindowAround(request);
      options?.signal?.throwIfAborted();
      return page;
    },
    async getTurnDetail(request, options) {
      options?.signal?.throwIfAborted();
      const detail = await requireAgentInstance().getAgentTurnDetail(request);
      options?.signal?.throwIfAborted();
      return detail;
    },
    async sendMessage(conversationId, content, attachment, wikiTiddlers, options) {
      options?.signal?.throwIfAborted();
      const instance = requireAgentInstance();
      const agent = await instance.getAgentMetadata(conversationId);
      if (!agent || agent.id !== conversationId) throw new Error('agent_conversation_not_found');
      const stagedAttachment = await stageAttachment(attachment, conversationId, options?.signal);
      const requestId = `wiki-agent:request:${createSecureBrowserUuid()}`;
      const turnId = `wiki-agent:turn:${createSecureBrowserUuid()}`;
      const request = unwrap(
        await instance.prepareAgentDeviceRpcRunTurnForRenderer({
          target: { kind: 'local' },
          provenance: { conversationId, definitionId: agent.agentDefId, requestId, turnId },
          message: content,
          ...(stagedAttachment === undefined ? {} : { attachment: stagedAttachment }),
          ...(wikiTiddlers === undefined ? {} : { wikiTiddlers }),
        }),
      );
      const handle = unwrap(await instance.executeAgentRunForRenderer(request));
      if (handle.conversationId !== conversationId || handle.requestId !== requestId || handle.turnId !== turnId) {
        await instance.cancelAgentRun(handle.runId);
        throw new Error('durable_agent_run_identity_mismatch');
      }
      await waitForRun(handle.runId, options?.signal);
    },
    subscribeToMessages(conversationId, listener) {
      const observable = getWikiAgentObservables()?.agentInstance;
      if (!observable) throw new Error('wiki_agent_observables_unavailable');
      const subscription = observable.subscribeToConversationUpdates(conversationId).subscribe(update => {
        listener(update as never);
      });
      return () => {
        subscription.unsubscribe();
      };
    },
    async deleteTurn(request, options) {
      options?.signal?.throwIfAborted();
      const response = await requireAgentInstance().deleteConversationTurn(request);
      options?.signal?.throwIfAborted();
      return response as never;
    },
    async retryTurn(request, options) {
      options?.signal?.throwIfAborted();
      const response = await requireAgentInstance().retryConversationTurn(request);
      options?.signal?.throwIfAborted();
      return response as never;
    },
  };
}

/**
 * Move a browser `File` into the Desktop-owned attachment store before a run
 * is prepared. The renderer reads lazy, bounded chunks only; it never exposes
 * a whole file to the plugin or to a device transport.
 */
async function stageAttachment(
  attachment: AgentAttachmentInput | undefined,
  conversationId: string,
  signal: AbortSignal | undefined,
): Promise<AgentCommittedAttachment | undefined> {
  if (attachment === undefined || attachment.kind === 'committed') return attachment;
  signal?.throwIfAborted();
  if (attachment.totalBytes > DESKTOP_ATTACHMENT_TOTAL_BYTES) {
    throw new RangeError('attachment exceeds Desktop upload limit');
  }
  const instance = requireAgentInstance();
  const upload = await instance.beginAgentAttachmentUpload({
    conversationId,
    filename: attachment.filename,
    mimeType: attachment.mimeType,
    totalBytes: attachment.totalBytes,
    ...(attachment.sha256 === undefined ? {} : { sha256: attachment.sha256 }),
  });
  const scope = { conversationId, uploadId: upload.uploadId };
  try {
    let offset = 0;
    while (offset < attachment.totalBytes) {
      signal?.throwIfAborted();
      const maximum = Math.min(DESKTOP_ATTACHMENT_CHUNK_BYTES, attachment.totalBytes - offset);
      const data = await attachment.readChunk(offset, maximum, { signal });
      signal?.throwIfAborted();
      if (!data || data.byteLength === 0 || data.byteLength > maximum) {
        throw new Error('attachment source returned an invalid chunk');
      }
      const written = await instance.writeAgentAttachmentChunk({ ...scope, offset, data });
      if (written.nextOffset !== offset + data.byteLength) throw new Error('attachment upload offset diverged');
      offset = written.nextOffset;
    }
    const committed = await instance.commitAgentAttachmentUpload(scope);
    if (committed.reference.size !== attachment.totalBytes) throw new Error('attachment committed size diverged');
    return committed;
  } catch (error) {
    await instance.abortAgentAttachmentUpload(scope).catch(() => undefined);
    throw error;
  }
}

export function createWikiConversationTimelineClient(): ConversationTimelinePageClient {
  return {
    async getPage(request: ConversationTimelinePageRequest, options) {
      options.signal.throwIfAborted();
      if (!Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > TIMELINE_PAGE_LIMIT) {
        throw new RangeError(`Timeline pages are limited to ${TIMELINE_PAGE_LIMIT} entries`);
      }
      if (!Number.isSafeInteger(request.maxBytes) || request.maxBytes < 1 || request.maxBytes > TIMELINE_PAGE_MAX_BYTES) {
        throw new RangeError(`Timeline pages are limited to ${TIMELINE_PAGE_MAX_BYTES} bytes`);
      }
      const page = await requireAgentInstance().getAgentConversationTimelinePage(request.conversationId, {
        limit: request.limit,
        maxBytes: request.maxBytes,
        expectedRevision: request.expectedRevision,
        beforeCursor: request.beforeCursor,
        afterCursor: request.afterCursor,
        aroundEntryIndex: request.aroundEntryIndex,
      });
      options.signal.throwIfAborted();
      return page;
    },
  };
}

export async function resolveAskQuestion(conversationId: string, questionId: string, answer: string): Promise<void> {
  await requireAgentInstance().resolveAskQuestion(conversationId, questionId, answer);
}

function requireAgentInstance() {
  const instance = getWikiAgentHost()?.agentInstance;
  if (!instance) throw new Error('wiki_agent_host_unavailable');
  return instance;
}

function unwrap<T>(result: WikiAgentHostResult<T>): T {
  if (result.kind === 'success' && result.value !== undefined) return result.value;
  if (result.error) throw new AgentRunFailure(result.error);
  throw new Error('wiki_agent_host_operation_failed');
}

async function waitForRun(runId: string, signal?: AbortSignal): Promise<void> {
  let cancelRequested = false;
  const cancel = () => {
    if (cancelRequested) return;
    cancelRequested = true;
    void requireAgentInstance().cancelAgentRun(runId);
  };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    for (;;) {
      signal?.throwIfAborted();
      const status = await requireAgentInstance().getAgentRunStatus(runId);
      signal?.throwIfAborted();
      if (!status) throw new Error('durable_agent_run_disappeared');
      if (status.state === 'completed') return;
      if (status.state === 'failed') {
        const error = new Error(status.error?.code ?? 'agent_run_failed');
        if (status.error) Object.defineProperty(error, 'agentRunError', { value: status.error, enumerable: false });
        throw error;
      }
      if (status.state === 'cancelled') throw new Error('agent_run_cancelled');
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 100);
        const onAbort = () => {
          clearTimeout(timer);
          reject(signal?.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
      });
    }
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
}
