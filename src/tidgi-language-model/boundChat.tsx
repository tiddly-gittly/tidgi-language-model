import { type AgentChatErrorPresentation, AgentChatShell, useAgentSession, useAgentSessionChatAdapter } from '@memeloop/react-ui/agent';
import {
  ConversationTimelineWindowController,
  DEFAULT_RESIDENT_CONTENT_BYTE_LIMIT,
  DEFAULT_RESIDENT_MESSAGE_LIMIT,
  type WebMemeLoopChatAdapter,
  type WebSelectedAttachmentBatch,
} from '@memeloop/react-ui/chat';
import { type ConversationMessageListProjection, extractAgentRunError } from 'memeloop';
import { useCallback, useMemo, useState } from 'react';
import { type AttachmentSelection, clearAttachmentSelectionAtRevision, EMPTY_ATTACHMENTS, nextAttachmentSelection } from './attachmentSelection';
import type { MemeLoopAgentChatProps } from './chatTypes';
import { resolveTiddlyWikiDrop } from './dropPayload';
import type { WikiAgentHostAdapter } from './hostAdapter';
import { createFileAttachmentSource, createSecureBrowserUuid, resolveAskQuestion } from './hostBindings';
import { formatTimelineMessage, getWikiAgentLabels, resolveWikiAgentLocale } from './labels';
import { wikiAgentI18n } from './localization';
import { localizeAgentRunError } from './localizeAgentRunError';
import { WikiAgentSelectors } from './selectors';

export function BoundMemeLoopWikiChat({
  conversationId,
  hostAdapter,
  language,
  mode,
  onAgentChange,
  parentWidget,
  timelineController,
}: Required<Pick<MemeLoopAgentChatProps, 'language' | 'mode'>> & Pick<MemeLoopAgentChatProps, 'parentWidget'> & {
  conversationId: string;
  hostAdapter: WikiAgentHostAdapter;
  onAgentChange: (agentId: string) => void;
  timelineController: ConversationTimelineWindowController;
}) {
  const { snapshot } = useAgentSession();
  const [attachments, setAttachments] = useState<AttachmentSelection>(EMPTY_ATTACHMENTS);
  const workspaceName = $tw.wiki.getTiddlerText('$:/info/tidgi/workspaceName', '') || $tw.wiki.getTiddlerText('$:/SiteTitle', 'Wiki');
  const locale = resolveWikiAgentLocale(language);
  const labels = getWikiAgentLabels(language);
  const translator = useMemo(() => wikiAgentI18n.getFixedT(locale, 'agent'), [locale]);
  const adapterOptions = useMemo(() => ({
    conversationId,
    timelineController,
    createId: createSecureBrowserUuid,
    mapFile: createFileAttachmentSource,
    onError: (error: Error, operation: string) => {
      hostAdapter.logError(`MemeLoop Wiki chat operation failed: ${operation}`, error);
    },
  }), [conversationId, hostAdapter, timelineController]);
  const baseAdapter = useAgentSessionChatAdapter(adapterOptions);
  const adapter = useMemo((): WebMemeLoopChatAdapter => ({
    ...baseAdapter,
    resolveAskQuestion: (questionId, answer) => resolveAskQuestion(conversationId, questionId, answer),
    residentContentByteLimit: DEFAULT_RESIDENT_CONTENT_BYTE_LIMIT,
    residentMessageLimit: DEFAULT_RESIDENT_MESSAGE_LIMIT,
  }), [baseAdapter, conversationId]);
  const selectAttachments = useCallback((batch: WebSelectedAttachmentBatch) => {
    setAttachments(current => nextAttachmentSelection(current, batch));
  }, []);
  const clearAttachmentsForRevision = useMemo(() => {
    const sentRevision = attachments.revision;
    return () => {
      setAttachments(current => clearAttachmentSelectionAtRevision(current, sentRevision));
    };
  }, [attachments.revision]);
  const timestampFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }),
    [locale],
  );
  const formatTimestamp = useCallback((timestamp: number) => timestampFormatter.format(new Date(timestamp)), [timestampFormatter]);
  const resolveErrorPresentation = useCallback((value: Error | ConversationMessageListProjection): AgentChatErrorPresentation | null => {
    const runError = value instanceof Error ? extractAgentRunError(value) : extractAgentRunError(value.metadata?.agentRunError);
    if (!runError) return null;
    return {
      title: labels.configErrorTitle,
      message: localizeAgentRunError(runError, translator),
      diagnosticId: runError.diagnosticId,
      settingTarget: runError.settingTarget,
      ...(runError.settingTarget === undefined ? {} : { actionLabel: labels.configure, actionId: 'open-external-api-settings' }),
    };
  }, [labels.configErrorTitle, labels.configure, translator]);
  const currentDefinitionId = snapshot.agent?.agentDefId || 'memeloop:general-assistant';

  return (
    <div className={`memeloop-tw-chat memeloop-tw-chat--${mode}`}>
      <AgentChatShell
        adapter={adapter}
        header={{ title: snapshot.agent?.name || labels.agent }}
        toolbar={{
          primary: (
            <WikiAgentSelectors
              agentId={conversationId}
              currentDefinitionId={currentDefinitionId}
              disabled={adapter.isRunning}
              hostAdapter={hostAdapter}
              labels={labels}
              onAgentChange={onAgentChange}
            />
          ),
          loading: adapter.isLoading,
          status: snapshot.agent?.status.progress ? <span className='memeloop-tw-chat__status'>{snapshot.agent.status.progress}</span> : undefined,
        }}
        resolveErrorPresentation={resolveErrorPresentation}
        genericErrorPresentation={{ title: labels.configErrorTitle, message: labels.genericError }}
        onErrorAction={async presentation => {
          if (presentation.settingTarget) await hostAdapter.openSettings(presentation.settingTarget);
        }}
        onShellError={(error, operation) => {
          hostAdapter.logError(`MemeLoop Wiki shell operation failed: ${operation}`, error);
        }}
        selectedFile={attachments.file}
        selectedWikiTiddlers={attachments.wikiTiddlers}
        onAttachmentsSelect={selectAttachments}
        onClearFile={() => {
          setAttachments(current => nextAttachmentSelection(current, { wikiTiddlers: current.wikiTiddlers }));
        }}
        onClearAttachments={clearAttachmentsForRevision}
        onRemoveWikiTiddler={index => {
          setAttachments(current =>
            nextAttachmentSelection(current, {
              ...(current.file === undefined ? {} : { file: current.file }),
              wikiTiddlers: current.wikiTiddlers.filter((_, itemIndex) => itemIndex !== index),
            })
          );
        }}
        resolveDroppedWikiTiddlers={drop => resolveTiddlyWikiDrop(drop, workspaceName)}
        onWikiTiddlerClick={tiddler => {
          parentWidget?.dispatchEvent({ type: 'tm-navigate', navigateTo: tiddler.tiddlerTitle });
        }}
        disabled={!snapshot.agent || adapter.isRunning}
        placeholder={labels.placeholder}
        loadingMessage={labels.loading}
        emptyMessage={labels.empty}
        operationErrorMessage={labels.operationError}
        composerLabels={{
          input: labels.composerInput,
          send: labels.send,
          cancel: labels.cancel,
          addFile: labels.addFile,
          removeFile: labels.removeFile,
          removeTiddler: labels.removeTiddler,
        }}
        timelineLabels={{
          navigation: labels.timelineNavigation,
          message: (index, total, role) => formatTimelineMessage(index, total, role, locale),
          compacted: labels.compacted,
          loadEarlier: labels.loadEarlier,
          loadLater: labels.loadLater,
          seek: labels.seek,
          close: labels.close,
          newMessages: labels.newMessages,
        }}
        formatTimelineTimestamp={formatTimestamp}
        actionLabels={{ retry: labels.retry, deleteTurn: labels.deleteTurn, copy: labels.copy, copyAll: labels.copyAll, user: labels.user, agent: labels.agent }}
        messageLabels={{
          attachmentAlt: labels.attachment,
          attachmentLoadFailed: labels.attachmentLoadFailed,
          noDetails: labels.noDetails,
          loadDetails: labels.loadDetails,
          reloadDetails: labels.reloadDetails,
          hideDetails: labels.hideDetails,
          showDetails: labels.showDetails,
          detailTruncated: labels.detailTruncated,
          detailLoadFailed: labels.detailLoadFailed,
          exportFullMessage: labels.exportFullMessage,
          reasoning: labels.reasoning,
          thinking: labels.thinking,
          showReasoning: labels.showReasoning,
          hideReasoning: labels.hideReasoning,
          loadMoreReasoning: labels.loadMoreReasoning,
          reasoningLoadFailed: labels.reasoningLoadFailed,
          error: labels.error,
          toolResult: labels.toolResult,
          toolCall: labels.toolCall,
          truncated: labels.truncated,
          askQuestion: { answerPlaceholder: labels.answerPlaceholder, submit: labels.submit, confirmSelection: labels.confirmSelection, answered: labels.answered },
        }}
      />
    </div>
  );
}
