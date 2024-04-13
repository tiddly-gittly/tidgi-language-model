/**
 * File copy from TidGi-Desktop's src/services/languageModel/interface.ts
 * And only import type here.
 * 
 * - delete LanguageModelServiceIPCDescriptor and some related imports
 */
import type { LLamaChatPromptOptions, LlamaChatSessionOptions, LlamaModelOptions, JinjaTemplateChatWrapperOptions } from 'node-llama-cpp';
import type { Observable } from 'rxjs';

export enum LanguageModelRunner {
  llamaCpp = 'llama.cpp',
  // rwkvCpp = 'rwkv.cpp',
}
export interface ILanguageModelPreferences {
  /**
   * Each runner can load different models. This is the default model file name for each runner.
   * @url https://github.com/Atome-FE/llama-node#supported-models
   */
  defaultModel: {
    [LanguageModelRunner.llamaCpp]: string;
  };
  /**
   * If a llm stop responding for this long, we will kill the conversation. This basically means it stopped responding.
   */
  timeoutDuration: number;
}

export interface ILLMResultBase {
  /**
   * Conversation id.
   * Can use this to stop a generation.
   * Also this worker is shared across all workspaces, so you can use this to identify which window is the result for.
   */
  id: string;
}
export type ILanguageModelWorkerResponse = INormalLanguageModelLogMessage | ILanguageModelWorkerResult | ILanguageModelLoadProgress;
export type ILanguageModelAPIResponse = ILanguageModelLoadProgress | ILLMResultPart;
export interface INormalLanguageModelLogMessage extends ILLMResultBase {
  /** for error, use `observer.error` instead */
  level: 'debug' | 'warn' | 'info';
  message: string;
  meta: unknown;
}
export interface ILanguageModelWorkerResult extends ILLMResultPart {
  type: 'result';
}
export interface ILanguageModelLoadProgress extends ILLMResultBase {
  percentage: number;
  type: 'progress';
}

/**
 * Part of generate result.
 */
export interface ILLMResultPart extends ILLMResultBase {
  token: string;
}

export interface IRunLLAmaOptions extends ILLMResultBase {
  completionOptions: Partial<LLamaChatPromptOptions> & { prompt: string };
  loadConfig: Partial<LlamaModelOptions>;
  /**
   * Load model to test if it's loadable, or preload model to speed up (when `autoDisposeSequence: false,`).
   * Without generating text.
   */
  loadModelOnly?: boolean;
  sessionOptions?: Pick<LlamaChatSessionOptions, 'systemPrompt'>;
  templates?: Partial<Pick<JinjaTemplateChatWrapperOptions, 'template' | 'systemRoleName'>>;
}

/**
 * Test language model on renderer by:
 * ```js
 * window.observables.languageModel.runLLama$({ prompt: 'A chat between a user and an assistant.\nUSER: You are a helpful assistant. Write a simple hello world in JS.\nASSISTANT:\n', id: '1' }).subscribe({ next: console.log, error: console.error, complete: () => console.warn('completed') })
 * ```
 */

/**
 * Run language model on a shared worker, and queue requests to the worker.
 */
export interface ILanguageModelService {
  /**
   * Abort a chat response generation.
   */
  abortLanguageModel(runner: LanguageModelRunner, id: string): Promise<void>;
  modelLoadProgress$: Observable<Record<LanguageModelRunner, number>>;
  /**
   * Null means started loading, but not finished yet.
   */
  modelLoaded$: Observable<Record<LanguageModelRunner, boolean | null>>;
  /**
   * Generate text based on options (including prompt).
   */
  runLanguageModel$(runner: LanguageModelRunner.llamaCpp, options: IRunLLAmaOptions): Observable<ILanguageModelAPIResponse>;
  /**
   * Unload model from memory. So it is possible to load another model, or to free up memory.
   */
  unloadLanguageModel(runner: LanguageModelRunner): Promise<void>;
}
