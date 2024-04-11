import { ILanguageModelService } from './languageModel';

declare global {
  interface Window {
    observables: {
      /**
       * Test language model on renderer by:
       * ```js
       * window.observables.languageModel.runLLama$({ prompt: 'A chat between a user and an assistant.\nUSER: You are a helpful assistant. Write a simple hello world in JS.\nASSISTANT:\n', id: '1' }).subscribe({ next: console.log, error: console.error, complete: () => console.warn('completed') })
       * ```
       */
      languageModel: ILanguageModelService;
    };
    service: {
      languageModel: ILanguageModelService;
    };
  }
}
