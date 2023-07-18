/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import { widget as Widget } from '$:/core/modules/widgets/widget.js';
import { HTMLTags, IChangedTiddlers, IParseTreeNode, IWidgetEvent, IWidgetInitialiseOptions } from 'tiddlywiki';
import { ChatGPTOptions, historyManager, isChinese, renderChatingConversation, renderConversation } from './utils';
import './style.less';

class ChatGPTWidget extends Widget {
  private containerNodeTag: HTMLTags = 'div';

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

  private scroll = false;

  private readonly = false;

  private chatGPTOptions: Partial<ChatGPTOptions> = {};

  private systemMessage = '';

  initialise(parseTreeNode: IParseTreeNode, options: IWidgetInitialiseOptions) {
    super.initialise(parseTreeNode, options);
    this.computeAttributes();
  }

  execute() {
    this.containerNodeTag = this.getAttribute('component', 'div') as HTMLTags;
    this.containerNodeClass = this.getAttribute('className', '');
    this.historyTiddler = this.getAttribute('history', '') || this.tmpHistoryTiddler;
    this.scroll = this.getAttribute('scroll')?.toLowerCase?.() === 'yes';
    this.readonly = this.getAttribute('readonly')?.toLowerCase?.() === 'yes';

    const temperature = Number(this.getAttribute('temperature'));
    const topP = Number(this.getAttribute('top_p'));
    const maxTokens = Number.parseInt(this.getAttribute('max_tokens')!, 10);
    const presencePenalty = Number(this.getAttribute('presence_penalty'));
    const frequencyPenalty = Number(this.getAttribute('frequency_penalty'));
    this.chatGPTOptions = {
      model: this.getAttribute('model', 'llama'),
      temperature: temperature >= 0 && temperature <= 2 ? temperature : undefined,
      top_p: topP >= 0 && topP <= 1 ? topP : undefined,
      max_tokens: Number.isSafeInteger(maxTokens) && maxTokens > 0
        ? maxTokens
        : undefined,
      presence_penalty: presencePenalty >= -2 && presencePenalty <= 2
        ? presencePenalty
        : undefined,
      frequency_penalty: frequencyPenalty >= -2 && frequencyPenalty <= 2
        ? frequencyPenalty
        : undefined,
      user: this.getAttribute('user'),
    };
    this.systemMessage = this.getAttribute('system_message', 'A chat between a user and an assistant. You are a helpful assistant.\nUSER:');
    this.makeChildWidgets();
  }

  render(parent: Element, nextSibling: Element | null) {
    if ($tw.browser === undefined || window?.observables?.languageModel?.runLLama$ === undefined) {
      return;
    }
    this.execute();
    const conversations = $tw.utils.domMaker('div', {
      class: 'conversations',
    });
    const container = $tw.utils.domMaker(this.containerNodeTag, {
      class: `tidgi-language-model-container ${this.containerNodeClass}`,
      children: [conversations],
    }) as HTMLDivElement;
    nextSibling ? nextSibling.before(container) : parent.append(container);
    this.domNodes.push(container);
    this.chat(container, conversations);
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
      let fillChatInput: ((user: string) => void) | undefined;
      if (!this.readonly) {
        const chatInput = $tw.utils.domMaker('input', {
          class: 'chat-input',
          attributes: {
            type: 'text',
            placeholder: zh ? '输入一个问题...' : 'Ask a question...',
            autofocus: true,
          },
        });
        fillChatInput = (user: string) => (chatInput.value = user);
        const chatButton = $tw.utils.domMaker('button', {
          class: 'chat-button',
          innerHTML: this.chatButtonText,
          attributes: {
            title: zh ? '进行对话' : 'Chat',
          },
        });
        container.prepend(
          $tw.utils.domMaker('div', {
            class: 'chat-box',
            children: [chatInput, chatButton],
          }),
        );

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
          chatInput.value = '';
          apiLock = true;
          chatButton.disabled = true;
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
            };
            setHistory([...getHistory(), newHistory]);
            conversation.remove();
            const resultConversation = renderConversation(
              newHistory,
              zh,
              this.editButtonText,
              this.deleteButtonText,
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
            await window.service.languageModel.abortLLama(id);
            apiLock = false;
            chatButton.disabled = false;
            conversation.remove();
          };
          const { conversation, answerBox, printError } = renderChatingConversation(zh, userInputText, this.cancelButtonText, conversations, onCancel);
          conversations.prepend(conversation);

          // 流式调用
          try {
            const onerror = (error: Error) => {
              console.error(error);
              printError(String(error));
              apiLock = false;
              chatButton.disabled = false;
            };

            window.observables.languageModel.runLLama$({
              completionOptions: {
                prompt: `${this.systemMessage}${userInputText}\nASSISTANT:\n`,
              },
              id,
            }).subscribe({
              next: (data) => {
                try {
                  if (data.id !== id) return;
                  accumulatedAnswer = `${accumulatedAnswer}${data.token ?? ''}`;
                  answerBox.textContent = `${accumulatedAnswer}█`;
                  created = Date.now();
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
