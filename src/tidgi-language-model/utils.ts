export const CHAT_COMPLETION_URL = 'https://api.openai.com/v1/chat/completions';

export interface ChatHistory {
  assistant: string;
  created: number;
  id: string;
  user: string;
}

export interface ChatGPTOptions {
  frequency_penalty: number;
  max_tokens: number;
  model: string;
  presence_penalty: number;
  temperature: number;
  top_p: number;
  user: string;
}

export const isChinese = () => $tw.wiki.getTiddler('$:/language')!.fields.text.includes('zh');

export const renderConversation = (
  { id, assistant, user, created }: ChatHistory,
  zh: boolean,
  editButtonText: string,
  deleteButtonText: string,
  onEdit?: (user: string) => void,
  onDelete?: () => void,
) => {
  let editButton: HTMLButtonElement | undefined;
  if (onEdit !== undefined) {
    editButton = $tw.utils.domMaker('button', {
      class: 'edit-button',
      innerHTML: editButtonText,
      attributes: {
        title: zh ? '重新生成问题' : 'Regenerate question',
      },
    });
    editButton.addEventListener('click', () => {
      onEdit(user);
    });
  }
  let deleteButton: HTMLButtonElement | undefined;
  if (onDelete !== undefined) {
    deleteButton = $tw.utils.domMaker('button', {
      class: 'delete-button',
      innerHTML: deleteButtonText,
      attributes: {
        title: zh ? '删除问题' : 'Delete question',
      },
    });
    deleteButton.addEventListener('click', () => {
      onDelete();
    });
  }
  return $tw.utils.domMaker('div', {
    class: 'chatgpt-conversation',
    attributes: {
      'chatgpt-conversation': id,
    },
    children: [
      $tw.utils.domMaker('div', {
        class: 'chatgpt-conversation-message chatgpt-conversation-assistant',
        innerHTML: $tw.wiki.renderText(
          'text/html',
          'text/vnd.tiddlywiki',
          assistant,
        ),
      }),
      $tw.utils.domMaker('div', {
        class: 'chatgpt-conversation-message chatgpt-conversation-user',
        children: [
          $tw.utils.domMaker('div', {
            class: 'conversation-datetime',
            text: new Date(created).toLocaleString(),
          }),
          $tw.utils.domMaker('p', { text: user }),
          ...((deleteButton === undefined) ? [] : [deleteButton]),
          ...((editButton === undefined) ? [] : [editButton]),
        ],
      }),
    ],
  });
};

export const renderChatingConversation = (
  zh: boolean,
  user: string,
  cancelButtonText: string,
  conversations: HTMLElement,
  onCancel?: (conversation: HTMLDivElement) => void,
) => {
  const answerBox = $tw.utils.domMaker('pre', {
    text: zh ? '思考中...' : 'Thinking...',
    style: {
      background: 'transparent',
      marginTop: '0',
      marginBottom: '0',
      padding: '0',
      border: 'none',
    },
  });
  // eslint-disable-next-line prefer-const
  let conversation: HTMLDivElement;
  let cancelButton: HTMLButtonElement | undefined;
  if (onCancel !== undefined) {
    cancelButton = $tw.utils.domMaker('button', {
      class: 'cancel-button',
      innerHTML: cancelButtonText,
      attributes: {
        title: zh ? '中止生成' : 'Cancel generation',
      },
    });
    cancelButton.addEventListener('click', () => {
      onCancel(conversation);
    });
  }
  conversation = $tw.utils.domMaker('div', {
    class: 'chatgpt-conversation chatgpt-conversation-chating',
    children: [
      $tw.utils.domMaker('div', {
        class: 'chatgpt-conversation-message chatgpt-conversation-assistant',
        children: [
          $tw.utils.domMaker('p', {
            children: [answerBox],
          }),
          ...((cancelButton === undefined) ? [] : [cancelButton]),
        ],
      }),
      $tw.utils.domMaker('div', {
        class: 'chatgpt-conversation-message chatgpt-conversation-user',
        children: [
          $tw.utils.domMaker('div', {
            class: 'conversation-datetime',
            text: new Date().toLocaleString(),
          }),
          $tw.utils.domMaker('p', { text: user }),
        ],
      }),
    ],
  });
  const printError = (error: string) => {
    conversation.remove();
    conversations.append(
      $tw.utils.domMaker('div', {
        class: 'chatgpt-conversation chatgpt-conversation-error',
        children: [
          $tw.utils.domMaker('div', {
            class: 'chatgpt-conversation-message chatgpt-conversation-user',
            children: [$tw.utils.domMaker('p', { text: user })],
          }),
          $tw.utils.domMaker('div', {
            class: 'chatgpt-conversation-message chatgpt-conversation-assistant',
            text: error,
          }),
        ],
      }),
    );
  };
  return { conversation, answerBox, printError };
};

export const historyManager = (tiddler: string) => ({
  getHistory: () => {
    let history: ChatHistory[] = [];
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/strict-boolean-expressions, @typescript-eslint/prefer-nullish-coalescing
      history = JSON.parse($tw.wiki.getTiddlerText(tiddler) || '[]');
    } catch {}
    return history;
  },
  setHistory: (history: ChatHistory[]) => {
    $tw.wiki.addTiddler(
      new $tw.Tiddler($tw.wiki.getTiddler(tiddler) ?? {}, {
        title: tiddler,
        text: JSON.stringify(history),
        type: 'application/json',
      }),
    );
  },
});
