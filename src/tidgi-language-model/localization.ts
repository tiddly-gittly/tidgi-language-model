import { createInstance, type i18n } from 'i18next';

type AgentResource = {
  Chat: { ConfigError: { MissingAPIKeyError: string; NoDefaultModel: string } };
  agent: { run: { error: Record<string, string> } };
};

function resource(apiKey: string, noDefaultModel: string, errors: Record<string, string>): AgentResource {
  return {
    Chat: { ConfigError: { MissingAPIKeyError: apiKey, NoDefaultModel: noDefaultModel } },
    agent: { run: { error: errors } },
  };
}

const englishErrors = {
  cancelled: 'The run was cancelled.',
  interrupted: 'The run was interrupted.',
  invalidRequest: 'The Agent request is invalid.',
  modelNotFound: 'Model {{modelId}} is unavailable for {{providerId}}.',
  providerAuthMissing: 'Authentication for {{providerId}} is missing or invalid.',
  providerConfigurationMissing: '{{providerId}} is missing the required {{settingField}} setting.',
  providerUnavailable: '{{providerId}} is temporarily unavailable.',
  rateLimited: '{{providerId}} is rate limiting requests. Try again later.',
  runnerUnavailable: 'No Agent runner is available.',
  storageUnavailable: 'Agent storage is unavailable.',
  deviceAuthRequired: 'This device must be authorized before running the Agent.',
  devicePermissionDenied: 'This device is not permitted to run this Agent.',
  networkUnavailable: 'The Agent network is unavailable.',
  userMessageTooLarge: 'The user message is too large for this run.',
  userMessageTooLargeDetail: 'Requested {{requested}} bytes; the limit is {{limit}} bytes.',
  contextCompactionPending: 'The long conversation is still being compacted.',
  contextCompactionPendingProgress: '{{processedMessages}} messages have been processed.',
  contextCompactionPendingProgressEstimate: '{{processedMessages}} messages have been processed; about {{remainingEstimate}} remain.',
  contextCompactionFailed: 'The long conversation could not be compacted safely.',
  contextBudgetExceeded: 'The conversation exceeds the model context budget.',
  internal: 'The Agent encountered an internal error.',
};

/**
 * A Wiki tab has its own WebContents. Keep this resource-only i18n instance
 * synchronous and local to the plugin instead of inheriting Desktop state.
 */
export const wikiAgentI18n: i18n = createInstance();

void wikiAgentI18n.init({
  defaultNS: 'agent',
  fallbackLng: 'en',
  initAsync: false,
  interpolation: { escapeValue: false },
  resources: {
    en: {
      agent: resource(
        'API key for {{provider}} not found. Please add it in Settings.',
        'No default model configured. Please configure a default model in settings.',
        englishErrors,
      ),
    },
    fr: { agent: resource('Clé API pour {{provider}} introuvable. Ajoutez-la dans les paramètres.', 'Aucun modèle par défaut configuré.', englishErrors) },
    ja: { agent: resource('{{provider}} の APIキーが見つかりません。設定に追加してください。', '既定のモデルが設定されていません。', englishErrors) },
    ru: { agent: resource('API-ключ для {{provider}} не найден. Добавьте его в настройках.', 'Модель по умолчанию не настроена.', englishErrors) },
    'zh-Hans': { agent: resource('未找到 {{provider}} 的 API 密钥，请在设置中添加。', '尚未配置默认模型。', englishErrors) },
    'zh-Hant': { agent: resource('找不到 {{provider}} 的 API 密鑰，請在設定中新增。', '尚未設定預設模型。', englishErrors) },
  },
});
