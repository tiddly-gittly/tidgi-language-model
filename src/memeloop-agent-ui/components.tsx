import { widget as Widget } from '$:/plugins/linonetwo/tw-react/widget.js';
import { AgentChatConfigError, type AgentChatErrorPresentation, AgentChatShell, AgentSessionProvider, useAgentSession, useAgentSessionChatAdapter } from '@memeloop/react-ui/agent';
import {
  ConversationTimelineWindowController,
  DEFAULT_RESIDENT_CONTENT_BYTE_LIMIT,
  DEFAULT_RESIDENT_MESSAGE_LIMIT,
  type WebMemeLoopChatAdapter,
  type WebSelectedAttachmentBatch,
} from '@memeloop/react-ui/chat';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import {
  type AgentDefinition,
  type AgentModelConfig,
  AgentSessionController,
  type AgentSessionTarget,
  type ConversationMessageListProjection,
  extractAgentRunError,
  type ModelCatalog,
  type ModelCatalogModel,
  type ModelCatalogProvider,
  type ProviderAccountConfig,
  type ProviderModelRoute,
} from 'memeloop';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Widget as TiddlyWikiWidget } from 'tiddlywiki';
import { type AttachmentSelection, clearAttachmentSelectionAtRevision, EMPTY_ATTACHMENTS, nextAttachmentSelection } from './attachmentSelection';
import { resolveTiddlyWikiDrop } from './dropPayload';
import { createDesktopWikiAgentHostAdapter, WIKI_AGENT_HOST_LIMITS, type WikiAgentHostAdapter } from './hostAdapter';
import {
  createFileAttachmentSource,
  createSecureBrowserUuid,
  createWikiAgentConversationClient,
  createWikiAgentInstanceClient,
  createWikiConversationTimelineClient,
  resolveAskQuestion,
} from './hostBindings';
import { formatTimelineMessage, getWikiAgentLabels, resolveWikiAgentLocale } from './labels';
import { wikiAgentI18n } from './localization';
import { localizeAgentRunError } from './localizeAgentRunError';
import { resolveWikiAgentColorScheme, resolveWikiAgentDirection, type WikiAgentColorScheme } from './presentation';

interface MemeLoopAgentChatProps {
  agentId?: string;
  colorScheme?: WikiAgentColorScheme;
  hostAdapter?: WikiAgentHostAdapter;
  language?: string;
  mode?: 'full' | 'sidebar';
  parentWidget?: TiddlyWikiWidget;
}

interface WikiAgentModelOption {
  selection: AgentModelConfig;
  account: ProviderAccountConfig;
  route: ProviderModelRoute;
  provider?: ModelCatalogProvider;
  catalogModel?: ModelCatalogModel;
  label: string;
}

function projectModelOptions(
  accounts: readonly ProviderAccountConfig[],
  catalog: ModelCatalog,
  selected: AgentModelConfig | undefined,
): WikiAgentModelOption[] {
  const seen = new Set<string>();
  const options: WikiAgentModelOption[] = [];
  for (const account of accounts) {
    if (account.enabled === false) continue;
    for (const route of account.models) {
      const key = JSON.stringify([account.providerId, route.modelId]);
      if (seen.has(key)) continue;
      seen.add(key);
      const provider = account.catalogProvider ?? catalog.providers.find(value => value.id === account.providerId);
      const catalogModel = provider?.models.find(value => value.id === route.modelId);
      const selection = selected?.providerId === account.providerId && selected.modelId === route.modelId
        ? selected
        : {
          providerId: account.providerId,
          modelId: route.modelId,
          ...(selected?.parameters === undefined ? {} : { parameters: selected.parameters }),
        };
      options.push({
        selection,
        account,
        route,
        ...(provider === undefined ? {} : { provider }),
        ...(catalogModel === undefined ? {} : { catalogModel }),
        label: `${provider?.name ?? account.providerId} · ${catalogModel?.name ?? route.modelId}`,
      });
      if (options.length === WIKI_AGENT_HOST_LIMITS.modelOptions) return options;
    }
  }
  return options;
}

function useWikiAgentTarget(
  requestedAgentId: string | undefined,
  controller: AgentSessionController,
  hostAdapter: WikiAgentHostAdapter,
) {
  const [target, setTarget] = useState<AgentSessionTarget>();
  const [discoveryFailed, setDiscoveryFailed] = useState(false);
  const generationReference = useRef(0);

  useEffect(() => {
    const generation = generationReference.current + 1;
    generationReference.current = generation;
    const abortController = new AbortController();
    setTarget(undefined);
    setDiscoveryFailed(false);
    controller.stop();
    void hostAdapter.resolveAgentTarget(requestedAgentId, { signal: abortController.signal }).then(async nextTarget => {
      if (generation !== generationReference.current || abortController.signal.aborted) return;
      await controller.start(nextTarget);
      if (generation === generationReference.current) setTarget(nextTarget);
    }).catch((error: unknown) => {
      if (generation !== generationReference.current || abortController.signal.aborted) return;
      controller.stop();
      setDiscoveryFailed(true);
      hostAdapter.logError('MemeLoop Wiki agent discovery failed', error);
    });
    return () => {
      generationReference.current += 1;
      abortController.abort();
      controller.stop();
    };
  }, [controller, hostAdapter, requestedAgentId]);

  return { target, discoveryFailed };
}

function WikiAgentSelectors({
  agentId,
  currentDefinitionId,
  disabled,
  hostAdapter,
  labels,
  onAgentChange,
}: {
  agentId: string;
  currentDefinitionId: string;
  disabled: boolean;
  hostAdapter: WikiAgentHostAdapter;
  labels: ReturnType<typeof getWikiAgentLabels>;
  onAgentChange: (agentId: string) => void;
}) {
  const [definitions, setDefinitions] = useState<readonly AgentDefinition[]>([]);
  const [models, setModels] = useState<readonly WikiAgentModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState<AgentModelConfig>();
  const [loading, setLoading] = useState(true);
  const [operationError, setOperationError] = useState<string>();
  const operationReference = useRef<AbortController | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setOperationError(undefined);
    void Promise.all([
      hostAdapter.listAgentDefinitions({ signal: controller.signal }),
      hostAdapter.getModelConfig(agentId, currentDefinitionId, { signal: controller.signal }),
      hostAdapter.listProviderAccounts({ signal: controller.signal }),
      hostAdapter.getProviderCatalog({ signal: controller.signal }),
    ]).then(([nextDefinitions, model, accounts, catalog]) => {
      if (controller.signal.aborted) return;
      setDefinitions(nextDefinitions);
      setSelectedModel(model);
      setModels(projectModelOptions(accounts, catalog, model));
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setDefinitions([]);
      setModels([]);
      setSelectedModel(undefined);
      setOperationError(labels.controlsUnavailable);
      hostAdapter.logError('MemeLoop Wiki controls failed to load', error);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => {
      controller.abort();
    };
  }, [agentId, currentDefinitionId, hostAdapter, labels.controlsUnavailable]);

  useEffect(() => () => {
    operationReference.current?.abort();
  }, []);

  const switchAgent = useCallback((definition: AgentDefinition) => {
    operationReference.current?.abort();
    const controller = new AbortController();
    operationReference.current = controller;
    setLoading(true);
    setOperationError(undefined);
    void hostAdapter.createAgent(definition, { signal: controller.signal }).then(agent => {
      if (!controller.signal.aborted) onAgentChange(agent.id);
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setOperationError(labels.agentSwitchFailed);
      hostAdapter.logError('MemeLoop Wiki agent switch failed', error);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
  }, [hostAdapter, labels.agentSwitchFailed, onAgentChange]);

  const selectModel = useCallback((optionKey: string) => {
    const option = models.find(value => modelOptionKey(value) === optionKey);
    if (!option) return;
    operationReference.current?.abort();
    const controller = new AbortController();
    operationReference.current = controller;
    setLoading(true);
    setOperationError(undefined);
    void hostAdapter.selectModel(agentId, option.selection, { signal: controller.signal }).then(() => {
      if (!controller.signal.aborted) setSelectedModel(option.selection);
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setOperationError(labels.modelUpdateFailed);
      hostAdapter.logError('MemeLoop Wiki model selection failed', error);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
  }, [agentId, hostAdapter, labels.modelUpdateFailed, models]);

  return (
    <div className='memeloop-tw-chat__selectors' aria-label={labels.agentControls}>
      <label className='memeloop-tw-chat__selector'>
        <span>{labels.selectAgent}</span>
        <select
          aria-label={labels.selectAgent}
          disabled={disabled || loading || definitions.length === 0}
          value={definitions.some(definition => definition.id === currentDefinitionId) ? currentDefinitionId : ''}
          onChange={event => {
            const definition = definitions.find(value => value.id === event.target.value);
            if (definition) switchAgent(definition);
          }}
        >
          <option value='' disabled>{labels.noOptions}</option>
          {definitions.map(definition => <option key={definition.id} value={definition.id}>{definition.name || definition.id}</option>)}
        </select>
      </label>
      <label className='memeloop-tw-chat__selector'>
        <span>{labels.selectModel}</span>
        <select
          aria-label={labels.selectModel}
          disabled={disabled || loading || models.length === 0}
          value={modelSelectionKey(selectedModel)}
          onChange={event => {
            selectModel(event.target.value);
          }}
        >
          <option value='' disabled>{labels.noOptions}</option>
          {models.map(option => <option key={modelOptionKey(option)} value={modelOptionKey(option)}>{option.label}</option>)}
        </select>
      </label>
      {loading && <span className='memeloop-tw-chat__control-status' role='status'>{labels.loadingOptions}</span>}
      {operationError && <span className='memeloop-tw-chat__control-error' role='alert'>{operationError}</span>}
    </div>
  );
}

function modelSelectionKey(selection: AgentModelConfig | undefined): string {
  return selection === undefined ? '' : JSON.stringify([selection.providerId, selection.modelId]);
}

function modelOptionKey(option: WikiAgentModelOption): string {
  return modelSelectionKey(option.selection);
}

function BoundMemeLoopWikiChat({
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

function HostUnavailable({ hostAdapter, labels, mode }: { hostAdapter: WikiAgentHostAdapter; labels: ReturnType<typeof getWikiAgentLabels>; mode: 'full' | 'sidebar' }) {
  const [actionFailed, setActionFailed] = useState(false);
  return (
    <div className={`memeloop-tw-chat memeloop-tw-chat--${mode} memeloop-tw-chat--loading`}>
      <AgentChatConfigError
        title={labels.configErrorTitle}
        message={actionFailed ? labels.settingsUnavailable : labels.hostUnavailable}
        actionLabel={labels.configure}
        actionId='open-external-api-settings'
        onAction={async () => {
          setActionFailed(false);
          try {
            await hostAdapter.openSettings();
          } catch (error) {
            setActionFailed(true);
            hostAdapter.logError('MemeLoop Wiki settings action failed', error);
          }
        }}
      />
    </div>
  );
}

function MemeLoopWikiChat({
  agentId,
  colorScheme = 'light',
  hostAdapter: injectedHostAdapter,
  language = navigator.language,
  mode = 'full',
  parentWidget,
}: MemeLoopAgentChatProps) {
  const hostAdapter = useMemo(() => injectedHostAdapter ?? createDesktopWikiAgentHostAdapter(), [injectedHostAdapter]);
  const direction = resolveWikiAgentDirection(language);
  const theme = useMemo(
    () => createTheme({ palette: { mode: colorScheme }, direction, typography: { fontFamily: 'inherit' } }),
    [colorScheme, direction],
  );
  const labels = getWikiAgentLabels(language);
  const [selectedAgentId, setSelectedAgentId] = useState(agentId);
  useEffect(() => {
    setSelectedAgentId(agentId);
  }, [agentId]);
  const controller = useMemo(() =>
    new AgentSessionController({
      agentInstanceClient: createWikiAgentInstanceClient(),
      conversationClient: createWikiAgentConversationClient(),
      maxResidentMessages: DEFAULT_RESIDENT_MESSAGE_LIMIT,
      maxResidentBytes: DEFAULT_RESIDENT_CONTENT_BYTE_LIMIT,
    }), []);
  const timelineController = useMemo(() => new ConversationTimelineWindowController(createWikiConversationTimelineClient()), []);
  const { target, discoveryFailed } = useWikiAgentTarget(selectedAgentId, controller, hostAdapter);
  useEffect(() => () => {
    timelineController.dispose();
  }, [timelineController]);

  const content = !hostAdapter.isReady()
    ? <HostUnavailable hostAdapter={hostAdapter} labels={labels} mode={mode} />
    : !target
    ? (
      <div className={`memeloop-tw-chat memeloop-tw-chat--${mode} memeloop-tw-chat--loading`}>
        {discoveryFailed
          ? <AgentChatConfigError title={labels.configErrorTitle} message={labels.genericError} actionLabel={labels.configure} onAction={() => hostAdapter.openSettings()} />
          : labels.loading}
      </div>
    )
    : (
      <AgentSessionProvider controller={controller}>
        <BoundMemeLoopWikiChat
          key={target.conversationId}
          conversationId={target.conversationId}
          hostAdapter={hostAdapter}
          language={language}
          mode={mode}
          onAgentChange={setSelectedAgentId}
          parentWidget={parentWidget}
          timelineController={timelineController}
        />
      </AgentSessionProvider>
    );

  return (
    <ThemeProvider theme={theme}>
      <div className='memeloop-tw-host' data-color-scheme={colorScheme} data-testid={`memeloop-wiki-agent-${mode}`} dir={direction} lang={localeLanguageTag(language)}>
        {content}
      </div>
    </ThemeProvider>
  );
}

function localeLanguageTag(language: string): string {
  return language.replace(/^\$:\/languages\//u, '') || 'en';
}

function wikiPresentationProps(): Pick<MemeLoopAgentChatProps, 'colorScheme' | 'language'> {
  const language = $tw.wiki.getTiddlerText('$:/language', '') || navigator.language;
  const paletteTitle = $tw.wiki.getTiddlerText('$:/palette', '$:/palettes/Vanilla');
  const palette = $tw.wiki.getTiddler(paletteTitle);
  return { language, colorScheme: resolveWikiAgentColorScheme(palette?.fields['color-scheme']) };
}

class MemeLoopAgentChatWidget extends Widget<MemeLoopAgentChatProps> {
  reactComponent = MemeLoopWikiChat;
  getProps = (): MemeLoopAgentChatProps => ({
    agentId: this.getAttribute('agentId'),
    mode: this.getAttribute('mode', 'full') === 'sidebar' ? 'sidebar' : 'full',
    parentWidget: this,
    ...wikiPresentationProps(),
  });

  refresh(changedTiddlers: Record<string, unknown>): boolean {
    const paletteTitle = $tw.wiki.getTiddlerText('$:/palette', '$:/palettes/Vanilla');
    const presentationChanged = ['$:/language', '$:/palette', '$:/info/tidgi/workspaceName', '$:/SiteTitle', paletteTitle]
      .some(title => Object.hasOwn(changedTiddlers, title));
    if (!presentationChanged) return false;
    this.refreshSelf();
    return true;
  }
}

const pluginExports = module.exports as Record<string, unknown>;
pluginExports.MemeLoopAgentChatWidget = MemeLoopAgentChatWidget;
