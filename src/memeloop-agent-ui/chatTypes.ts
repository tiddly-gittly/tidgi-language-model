import type { Widget as TiddlyWikiWidget } from 'tiddlywiki';
import type { WikiAgentHostAdapter } from './hostAdapter';
import type { WikiAgentColorScheme } from './presentation';

export interface MemeLoopAgentChatProps {
  agentId?: string;
  colorScheme?: WikiAgentColorScheme;
  hostAdapter?: WikiAgentHostAdapter;
  language?: string;
  mode?: 'full' | 'sidebar';
  parentWidget?: TiddlyWikiWidget;
}
