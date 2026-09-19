import type { AgentDefinition, AgentModelConfig, ModelCatalog, ProviderAccountConfig } from 'memeloop';
import { useCallback, useEffect, useRef, useState } from 'react';
import { WIKI_AGENT_HOST_LIMITS, type WikiAgentHostAdapter } from './hostAdapter';
import type { WikiAgentLabels } from './labels';

interface WikiAgentModelOption {
  selection: AgentModelConfig;
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
        label: `${provider?.name ?? account.providerId} · ${catalogModel?.name ?? route.modelId}`,
      });
      if (options.length === WIKI_AGENT_HOST_LIMITS.modelOptions) return options;
    }
  }
  return options;
}

export function WikiAgentSelectors({
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
  labels: WikiAgentLabels;
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
