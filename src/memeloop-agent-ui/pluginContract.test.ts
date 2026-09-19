import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const directory = resolve(process.cwd(), 'src/memeloop-agent-ui');
const read = (name: string) => readFileSync(resolve(directory, name), 'utf8');

describe('MemeLoop TiddlyWiki plugin integration contract', () => {
  it('mounts the same shared widget in the full view and narrow sidebar tab', () => {
    expect(read('chat-view.tid')).toContain('<$memeloopAgentChat mode="full" />');
    expect(read('sidebar-tab.tid')).toContain('<$memeloopAgentChat mode="sidebar" />');
    const widget = read('components.tsx');
    const boundChat = read('boundChat.tsx');
    const selectors = read('selectors.tsx');
    expect(widget).toContain('AgentSessionProvider');
    expect(widget).toContain('ConversationTimelineWindowController');
    expect(widget).toContain('DEFAULT_RESIDENT_MESSAGE_LIMIT');
    expect(widget).toContain('DEFAULT_RESIDENT_CONTENT_BYTE_LIMIT');
    expect(widget).toContain('key={target.conversationId}');
    expect(widget).not.toContain('AgentChatShell');
    expect(boundChat).toContain('AgentChatShell');
    expect(boundChat).toContain('useAgentSessionChatAdapter');
    expect(boundChat).toContain('WikiAgentSelectors');
    expect(selectors).toContain('projectModelOptions');
  });

  it('does not regress to the former unbounded plugin-owned pager', () => {
    const source = `${read('components.tsx')}\n${read('boundChat.tsx')}`;
    for (
      const forbidden of [
        'INITIAL_PAGE_SIZE',
        'PAGE_SIZE = 100',
        'RESIDENT_LIMIT = 240',
        'limit: 99',
        'limit: 100',
        'getAgentMessagePage(',
        'boundedResidentMessages(',
      ]
    ) expect(source).not.toContain(forbidden);
  });

  it('declares container-query narrow layout and atomic TiddlyWiki drops', () => {
    const styles = read('styles.tid');
    expect(styles).toContain('container-type: inline-size');
    expect(styles).toContain('@container memeloop-chat');
    expect(styles).toMatch(/\.memeloop-tw-chat--sidebar\s*{[^}]*max-width:\s*30rem/s);
    expect(styles).toContain('@media (pointer: coarse)');
    expect(styles).toContain('[dir="rtl"]');
    expect(read('boundChat.tsx')).toContain('onAttachmentsSelect={selectAttachments}');
    expect(read('boundChat.tsx')).toContain('resolveDroppedWikiTiddlers={drop => resolveTiddlyWikiDrop');
    expect(read('dropPayload.ts')).toContain('rejects the whole');
  });

  it('composes shared major Agent features through a replaceable host boundary', () => {
    const widget = read('components.tsx');
    const boundChat = read('boundChat.tsx');
    expect(boundChat).toContain('createFileAttachmentSource');
    expect(widget).toContain('createWikiAgentConversationClient');
    expect(widget).toContain('createWikiAgentInstanceClient');
    expect(widget).toContain('hostAdapter: injectedHostAdapter');
    expect(boundChat).toContain('extractAgentRunError');
    expect(boundChat).toContain('onErrorAction');
    const host = read('hostAdapter.ts');
    expect(host).toContain('export interface WikiAgentHostAdapter');
    expect(host).toContain('definition: AgentDefinition');
    expect(host).toContain('selection: AgentModelConfig');
    expect(host).toContain('getModelConfig');
    expect(host).toContain('listProviderAccounts');
    expect(host).toContain('getProviderCatalog');
    expect(host).not.toContain('WikiAgentModelOption');
    expect(host).not.toContain('getModelSelection');
    expect(host).toContain('Promise<AgentSessionTarget>');
    expect(boundChat).toContain('mapFile: createFileAttachmentSource');
    expect(host).toContain('MAX_AGENT_DEFINITIONS = 128');
    expect(host).toContain('MAX_MODEL_OPTIONS = 512');
  });

  it('propagates Wiki language direction and palette mode into the shared UI theme', () => {
    const widget = read('components.tsx');
    expect(widget).toContain('ThemeProvider');
    expect(widget).toContain("getTiddlerText('$:/language'");
    expect(widget).toContain("getTiddlerText('$:/palette'");
    expect(widget).toContain("palette?.fields['color-scheme']");
    expect(widget).toContain('dir={direction}');
    expect(widget).toContain('refresh(changedTiddlers');
    expect(widget).toContain('this.refreshSelf()');
  });

  it('declares the external React singleton contract used by tw-react', () => {
    const manifest = JSON.parse(read('plugin.info')) as Record<string, unknown>;
    expect(manifest['Modern.TiddlyDev#ExternalModules']).toBe('react react-dom react/jsx-runtime react-dom/client');
  });
});
