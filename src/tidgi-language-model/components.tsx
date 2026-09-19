import { widget as Widget } from '$:/plugins/linonetwo/tw-react/widget.js';
import { AgentChatConfigError, AgentSessionProvider } from '@memeloop/react-ui/agent';
import { ConversationTimelineWindowController, DEFAULT_RESIDENT_CONTENT_BYTE_LIMIT, DEFAULT_RESIDENT_MESSAGE_LIMIT } from '@memeloop/react-ui/chat';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import { AgentSessionController, type AgentSessionTarget } from 'memeloop';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BoundMemeLoopWikiChat } from './boundChat';
import type { MemeLoopAgentChatProps } from './chatTypes';
import { createDesktopWikiAgentHostAdapter, type WikiAgentHostAdapter } from './hostAdapter';
import { createWikiAgentConversationClient, createWikiAgentInstanceClient, createWikiConversationTimelineClient } from './hostBindings';
import { getWikiAgentLabels } from './labels';
import { resolveWikiAgentColorScheme, resolveWikiAgentDirection } from './presentation';

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
