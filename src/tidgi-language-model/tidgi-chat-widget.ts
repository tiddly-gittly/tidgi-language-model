/* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import { widget as Widget } from '$:/core/modules/widgets/widget.js';
import { IChangedTiddlers, IParseTreeNode, IWidgetEvent, IWidgetInitialiseOptions } from 'tiddlywiki';
import { historyManager, isChinese, renderChattingConversation, renderConversation } from './utils';
import './style.less';
import type { Observable } from 'rxjs';
import { ILanguageModelAPIResponse, type IRunLLAmaOptions, LanguageModelRunner } from './languageModel';

class ChatGPTWidget extends Widget {
  private containerNodeTag: keyof HTMLElementTagNameMap = 'div';

  private containerNodeClass = '';

  private readonly tmpHistoryTiddler = `$:/temp/linonetwo/tidgi-language-model/history-${Date.now()}`;

  private historyTiddler: string = this.tmpHistoryTiddler;

  private readonly chatButtonText: string = $tw.wiki.renderText(
    'text/html',
    'text/vnd.tiddlywiki',
    $tw.wiki.getTiddlerText(
      '$:/core/images/add-comment',
    )!,
  );

  private readonly attachmentButtonText: string = $tw.wiki.renderText(
    'text/html',
    'text/vnd.tiddlywiki',
    $tw.wiki.getTiddlerText(
      '$:/core/images/import-button',
    )!,
  );

  private readonly editButtonText: string = $tw.wiki.renderText(
    'text/html',
    'text/vnd.tiddlywiki',
    $tw.wiki.getTiddlerText(
      '$:/core/images/edit-button',
    )!,
  );

  private readonly deleteButtonText: string = $tw.wiki.renderText(
    'text/html',
    'text/vnd.tiddlywiki',
    $tw.wiki.getTiddlerText(
      '$:/core/images/delete-button',
    )!,
  );

  private readonly cancelButtonText: string = $tw.wiki.renderText(
    'text/html',
    'text/vnd.tiddlywiki',
    $tw.wiki.getTiddlerText(
      '$:/core/images/cancel-button',
    )!,
  );

  private readonly copyButtonText: string = $tw.wiki.renderText(
    'text/html',
    'text/vnd.tiddlywiki',
    $tw.wiki.getTiddlerText(
      '$:/core/images/copy-clipboard',
    )!,
  );

  private scroll = false;

  private readonly = false;

  private readonly runLanguageModelOptions: IRunLLAmaOptions = {
    completionOptions: {
      prompt: 'Say Hello to me.',
    },
    loadConfig: {},
    // overwrite this id later
    id: 'tidgi-chat-widget',
  };

  private runner = LanguageModelRunner.llamaCpp;

  private systemPrompt = '';
  private promptTemplate = '';
  private systemTemplate: string | undefined;

  initialise(parseTreeNode: IParseTreeNode, options: IWidgetInitialiseOptions) {
    super.initialise(parseTreeNode, options);
    this.computeAttributes();
  }

  execute() {
    this.containerNodeTag = this.getAttribute('component', 'div') as keyof HTMLElementTagNameMap;
    this.containerNodeClass = this.getAttribute('className', '');
    this.historyTiddler = this.getAttribute('history', '') || this.tmpHistoryTiddler;
    this.scroll = this.getAttribute('scroll')?.toLowerCase?.() === 'yes';
    this.readonly = this.getAttribute('readonly')?.toLowerCase?.() === 'yes';

    const DefaultModelRunner = $tw.wiki.getTiddlerText('$:/plugins/linonetwo/tidgi-language-model/configs/DefaultModelRunner') as LanguageModelRunner | undefined;
    this.runner = this.getAttribute('runner', DefaultModelRunner || LanguageModelRunner.llamaCpp) as LanguageModelRunner;

    const temperature = Number(this.getAttribute('temperature'));
    const topP = Number(this.getAttribute('topP'));
    const maxTokens = Number.parseInt(this.getAttribute('maxTokens')!, 10);
    if (Number.isSafeInteger(maxTokens) && maxTokens > 0) {
      this.runLanguageModelOptions.completionOptions.maxTokens = maxTokens;
    }
    if (temperature >= 0 && temperature <= 2) {
      this.runLanguageModelOptions.completionOptions.temperature = temperature;
    }
    if (topP >= 0 && topP <= 1) {
      this.runLanguageModelOptions.completionOptions.topP = topP;
    }
    const presencePenalty = Number(this.getAttribute('presencePenalty'));
    const frequencyPenalty = Number(this.getAttribute('frequencyPenalty'));
    if (frequencyPenalty >= -2 && frequencyPenalty <= 2) {
      // eslint-disable-next-line unicorn/no-useless-fallback-in-spread
      this.runLanguageModelOptions.completionOptions.repeatPenalty = { ...(this.runLanguageModelOptions.completionOptions.repeatPenalty || {}), frequencyPenalty };
    }
    // eslint-disable-next-line unicorn/no-useless-fallback-in-spread
    this.runLanguageModelOptions.completionOptions.repeatPenalty = { ...(this.runLanguageModelOptions.completionOptions.repeatPenalty || {}), presencePenalty };
    const [currentLanguage] = $tw.wiki.filterTiddlers('[[$:/language]get[text]get[name]else[en-GB]]');
    const DefaultSystemPrompt = $tw.wiki.getTiddlerText(
      `$:/plugins/linonetwo/tidgi-language-model/language/${currentLanguage}/DefaultSystemPrompt`,
      $tw.wiki.getTiddlerText('$:/plugins/linonetwo/tidgi-language-model/language/en-GB/DefaultSystemPrompt'),
    );
    this.systemPrompt = this.getAttribute('systemPrompt', DefaultSystemPrompt || 'A chat between a user and an assistant. You are a helpful assistant.\n');
    const DefaultPromptTemplate = $tw.wiki.getTiddlerText(
      `$:/plugins/linonetwo/tidgi-language-model/language/${currentLanguage}/DefaultPromptTemplate`,
      $tw.wiki.getTiddlerText('$:/plugins/linonetwo/tidgi-language-model/language/en-GB/DefaultPromptTemplate'),
    );
    this.promptTemplate = this.getAttribute('promptTemplate', DefaultPromptTemplate || '<<systemPrompt>> USER: <<userInputText>> ASSISTANT:');
    const DefaultSystemTemplateTitle = $tw.wiki.getTiddlerText(`$:/plugins/linonetwo/tidgi-language-model/configs/DefaultSystemTemplate`);
    const DefaultSystemTemplate = DefaultSystemTemplateTitle ? $tw.wiki.getTiddlerText(DefaultSystemTemplateTitle) : undefined;
    this.systemTemplate = this.getAttribute('systemTemplate') || DefaultSystemTemplate;
    this.makeChildWidgets();
  }

  render(parent: Element, nextSibling: Element | null) {
    if ($tw.browser === undefined) {
      return;
    }
    this.execute();
    const conversations = $tw.utils.domMaker('div', {
      class: 'conversations',
    });
    const containerElement = $tw.utils.domMaker(this.containerNodeTag, {
      class: `tidgi-language-model-container ${this.containerNodeClass}`,
      children: [conversations],
    }) as HTMLDivElement;
    parent.insertBefore(containerElement, nextSibling);
    this.domNodes.push(containerElement);
    this.chat(containerElement, conversations);
  }

  refresh(changedTiddlers: IChangedTiddlers) {
    const changedAttributes = this.computeAttributes();
    if ($tw.utils.count(changedAttributes) > 0) {
      this.refreshSelf();
      return true;
    } else if (changedTiddlers[this.historyTiddler]?.deleted) {
      this.refreshSelf();
      return true;
    }
    return this.refreshChildren(changedTiddlers);
  }

  chat(container: HTMLDivElement, conversations: HTMLDivElement) {
    try {
      const zh = isChinese();
      const { getHistory, setHistory } = historyManager(this.historyTiddler);
      // 聊天机制
      let fillChatInput: ((user: string, attachment?: string) => void) | undefined;
      if (!this.readonly) {
        const chatInput = $tw.utils.domMaker('textarea', {
          class: 'chat-input',
          attributes: {
            type: 'text',
            placeholder: zh ? '输入一个问题...' : 'Ask a question...',
            autofocus: true,
            rows: 1,
          },
        });
        fillChatInput = (user: string, attachment?: string) => {
          chatInput.value = user;
          attachmentInput.value = attachment ?? '';
        };
        const chatButton = $tw.utils.domMaker('button', {
          class: 'chat-button',
          innerHTML: this.chatButtonText,
          attributes: {
            title: zh ? '进行对话' : 'Chat',
          },
        });
        const attachmentButton = $tw.utils.domMaker('button', {
          class: 'attachment-button',
          innerHTML: this.attachmentButtonText,
          attributes: {
            title: zh ? '附加条目' : 'Attach Tiddler',
          },
        });
        const attachmentInput = $tw.utils.domMaker('input', {
          class: 'attachment-input',
          attributes: {
            type: 'text',
            placeholder: zh ? '填入条目标题或筛选器表达式' : 'Fill in Tiddler title or filter expression',
            autofocus: false,
            hidden: true,
          },
        });
        container.prepend(
          $tw.utils.domMaker('div', {
            class: 'chat-box',
            children: [attachmentButton, chatInput, chatButton],
          }),
        );

        const toggleAttachmentInput = () => {
          attachmentInput.hidden = !attachmentInput.hidden;
        };
        container.prepend(attachmentInput);
        // 会话接口
        let apiLock = false;
        const createChat = (event: UIEvent) => {
          // 锁与参数解析
          if (apiLock) {
            return;
          }
          const userInputText = chatInput.value.trim();
          if (!userInputText) {
            return;
          }
          // eslint-disable-next-line unicorn/prefer-string-replace-all
          const attachment = attachmentInput.hidden ? '' : $tw.wiki.filterTiddlers(attachmentInput.value).map(title => $tw.wiki.getTiddlerText(title)).join('\n\n');
          chatInput.value = '';
          apiLock = true;
          chatButton.disabled = true;
          // get config from tiddlers
          const runner = this.runner || 'llama.cpp' as LanguageModelRunner;
          const id = String(Date.now());
          /**
           * We add stream result to this answer string.
           */
          let accumulatedAnswer = '';
          let created = 0;

          const onComplete = (conversation: HTMLDivElement) => {
            const newHistory = {
              id,
              created,
              assistant: accumulatedAnswer,
              user: userInputText,
              // only record the filter string, instead of final result, to reduce history size
              attachment: attachmentInput.hidden ? '' : attachmentInput.value,
            };
            setHistory([...getHistory(), newHistory]);
            conversation.remove();
            const resultConversation = renderConversation(
              newHistory,
              zh,
              this.editButtonText,
              this.deleteButtonText,
              this.copyButtonText,
              fillChatInput,
              () => {
                resultConversation.remove();
                setHistory(
                  getHistory().filter(({ id }) => id !== newHistory.id),
                );
              },
            );
            conversations.prepend(resultConversation);

            // 发送相关事件
            this.setVariable('output-text', accumulatedAnswer);
            const theEvent: IWidgetEvent = {
              event,
              type: 'tidgi-chat',
              name: 'completion-finish',
              paramObject: {
                ...newHistory,
                created: new Date(newHistory.created * 1000),
              },
              widget: this,
              historyTiddler: this.historyTiddler,
            };
            this.invokeAction?.(this, theEvent);
            this.dispatchEvent(theEvent);
            $tw.hooks.invokeHook('tidgi-chat', theEvent);
            apiLock = false;
            chatButton.disabled = false;
          };
          // 创建 DOM
          const onCancel = async (conversation: HTMLDivElement) => {
            await window.service.languageModel.abortLanguageModel(runner, id);
            apiLock = false;
            chatButton.disabled = false;
            conversation.remove();
          };
          const { conversation, answerBox, printError, updateProgress } = renderChattingConversation({
            zh,
            user: userInputText,
            attachment,
            onCancel,
            onEdit: fillChatInput,
            conversations,
            editButtonText: this.editButtonText,
            deleteButtonText: this.deleteButtonText,
            copyButtonText: this.copyButtonText,
            cancelButtonText: this.cancelButtonText,
          });
          conversations.prepend(conversation);
          /**
           * test this with
           *
           * ```js
           * $tw.wiki.renderText('text/plain-formatted', 'text/vnd.tiddlywiki', $tw.wiki.getTiddlerText('$:/plugins/linonetwo/tidgi-language-model/language/zh-Hans/DefaultPromptTemplate'), { variables: { systemPrompt: $tw.wiki.getTiddlerText('$:/plugins/linonetwo/tidgi-language-model/language/zh-Hans/DefaultSystemPrompt'), userInputText: 'Hi', attachment: '' } })
           * ```
           */
          const prompt = $tw.wiki.renderText('text/plain-formatted', 'text/vnd.tiddlywiki', this.promptTemplate, {
            variables: {
              userInputText,
              attachment,
            },
          });

          // if no tidgi service, not actually calling api
          if (window?.observables?.languageModel?.runLanguageModel$ === undefined) return;

          // 流式调用
          try {
            const onerror = (error: Error) => {
              console.error(error);
              printError(String(error));
              apiLock = false;
              chatButton.disabled = false;
            };

            let runnerResultObserver: Observable<ILanguageModelAPIResponse>;
            switch (runner) {
              case LanguageModelRunner.llamaCpp: {
                runnerResultObserver = window.observables.languageModel.runLanguageModel$(runner, {
                  completionOptions: {
                    ...this.runLanguageModelOptions?.completionOptions,
                    prompt,
                  },
                  sessionOptions: {
                    systemPrompt: this.systemPrompt,
                  },
                  templates: {
                    template: this.systemTemplate,
                  },
                  loadConfig: this.runLanguageModelOptions?.loadConfig,
                  id,
                });
                break;
              }
            }
            runnerResultObserver.subscribe({
              next: (data) => {
                try {
                  if (data.id !== id) return;
                  if ('type' in data && data.type === 'progress') {
                    updateProgress(data.percentage);
                  } else if ('token' in data) {
                    accumulatedAnswer = `${accumulatedAnswer}${data.token ?? ''}`;
                    answerBox.textContent = `${accumulatedAnswer}█`;
                    created = Date.now();
                  }
                } catch (error) {
                  onerror(error as Error);
                }
                conversations.scrollTop = conversations.scrollHeight;
              },
              error: onerror,
              complete: () => {
                onComplete(conversation);
              },
            });
          } catch (error) {
            console.error(error);
            printError(String(error));
          }
        };

        chatButton.addEventListener('click', createChat);
        attachmentButton.addEventListener('click', toggleAttachmentInput);
        chatInput.addEventListener('keydown', (event) => {
          if (event.isComposing) return;
          if (event.code === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            createChat(event);
          }
        });
      }

      // 历史对话
      for (const conversation of getHistory()) {
        const resultConversation = renderConversation(
          conversation,
          zh,
          this.editButtonText,
          this.deleteButtonText,
          this.copyButtonText,
          fillChatInput,
          this.readonly
            ? undefined
            : () => {
              resultConversation.remove();
              setHistory(
                getHistory().filter(({ id }) => id !== conversation.id),
              );
            },
        );
        conversations.append(resultConversation);
      }
    } catch (error) {
      console.error(error);
      container.textContent = String(error);
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
exports['tidgi-chat'] = ChatGPTWidget;
