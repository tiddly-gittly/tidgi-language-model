import type { AgentRunError } from 'memeloop';

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Render Core localization keys and never expose host exception text. */
export function localizeAgentRunError(error: AgentRunError, translate: Translate): string {
  if (
    error.code === 'PROVIDER_CONFIGURATION_MISSING' &&
    error.settingTarget?.kind === 'runtime' &&
    error.settingTarget.section === 'agent'
  ) return translate('Chat.ConfigError.NoDefaultModel');

  const parameters = error.localizedParams;
  const interpolation: Record<string, unknown> = { ...(parameters ?? {}) };
  const message = translate(error.messageKey, { defaultValue: error.code, ...interpolation });
  if (
    error.code === 'USER_MESSAGE_TOO_LARGE' &&
    Number.isSafeInteger(parameters?.requested) &&
    Number.isSafeInteger(parameters?.limit)
  ) return `${message} ${translate('agent.run.error.userMessageTooLargeDetail', interpolation)}`;
  if (error.code !== 'CONTEXT_COMPACTION_PENDING' || !Number.isSafeInteger(parameters?.processedMessages)) return message;
  const detailKey = Number.isSafeInteger(parameters?.remainingEstimate)
    ? 'agent.run.error.contextCompactionPendingProgressEstimate'
    : 'agent.run.error.contextCompactionPendingProgress';
  return `${message} ${translate(detailKey, interpolation)}`;
}
