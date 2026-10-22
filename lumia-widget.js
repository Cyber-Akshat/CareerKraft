(() => {
  if (window.__careerkraftLumiaLoaded) return;
  window.__careerkraftLumiaLoaded = true;

  const MAX_MESSAGE_LENGTH = 3000;
  const SUGGESTED_PROMPTS = [
    'What should I focus on next?',
    'Help me with my current activity',
    'What are my strongest skills?',
    'Which skill should I improve next?'
  ];

  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  };

  function pageContext() {
    const stepId = Number(new URLSearchParams(window.location.search).get('step'));
    return {
      path: window.location.pathname,
      stepId: Number.isSafeInteger(stepId) && stepId > 0 ? stepId : null
    };
  }

  function createWidget() {
    const root = element('div', 'lumia-widget');
    root.id = 'lumia-widget';

    const launcher = element('button', 'lumia-launcher');
    launcher.id = 'lumia-launcher';
    launcher.type = 'button';
    launcher.setAttribute('aria-label', 'Open Lumia');
    launcher.setAttribute('aria-expanded', 'false');
    launcher.setAttribute('aria-controls', 'lumia-panel');
    const orb = element('span', 'lumia-launcher-orb', '\u2726');
    orb.setAttribute('aria-hidden', 'true');
    const unread = element('span', 'lumia-unread');
    unread.hidden = true;
    unread.setAttribute('aria-label', 'Unread Lumia response');
    launcher.append(orb, element('span', 'lumia-launcher-text', 'Ask Lumia'), unread);

    const panel = element('section', 'lumia-panel');
    panel.id = 'lumia-panel';
    panel.hidden = true;
    panel.setAttribute('aria-hidden', 'true');
    panel.setAttribute('aria-label', 'Chat with Lumia');

    const header = element('header', 'lumia-header');
    const identity = element('div', 'lumia-identity');
    const identityOrb = element('div', 'lumia-header-orb', '\u2726');
    identityOrb.setAttribute('aria-hidden', 'true');
    const identityCopy = element('div', 'lumia-identity-text');
    identityCopy.append(element('strong', '', 'Lumia'), element('span', '', 'Your CareerKraft companion'));
    identity.append(identityOrb, identityCopy);
    const actions = element('div', 'lumia-header-actions');
    const newChat = element('button', 'lumia-header-button', '+');
    newChat.id = 'lumia-new-chat';
    newChat.type = 'button';
    newChat.title = 'New conversation';
    newChat.setAttribute('aria-label', 'Start a new conversation');
    const close = element('button', 'lumia-header-button lumia-close-button', '\u00d7');
    close.id = 'lumia-close';
    close.type = 'button';
    close.setAttribute('aria-label', 'Close Lumia');
    actions.append(newChat, close);
    header.append(identity, actions);

    const context = element('div', 'lumia-context-strip');
    const contextDot = element('span', 'lumia-context-dot');
    contextDot.setAttribute('aria-hidden', 'true');
    const contextText = element('span', '', 'Connected to your CareerKraft journey');
    context.append(contextDot, contextText);

    const chat = element('div', 'lumia-chat');
    chat.id = 'lumia-chat';
    chat.setAttribute('role', 'log');
    chat.setAttribute('aria-label', 'Lumia conversation');
    chat.setAttribute('aria-live', 'polite');
    chat.setAttribute('aria-relevant', 'additions');

    const welcome = element('section', 'lumia-welcome');
    welcome.id = 'lumia-welcome';
    const welcomeOrb = element('div', 'lumia-welcome-orb', '\u2726');
    welcomeOrb.setAttribute('aria-hidden', 'true');
    const suggestions = element('div', 'lumia-suggestions');
    for (const prompt of SUGGESTED_PROMPTS) {
      const suggestion = element('button', 'lumia-suggestion', prompt);
      suggestion.type = 'button';
      suggestion.dataset.prompt = prompt;
      suggestions.append(suggestion);
    }
    welcome.append(
      welcomeOrb,
      element('span', 'lumia-welcome-label', 'YOUR CAREER COMPANION'),
      element('h2', '', 'What can I help you with?'),
      element('p', '', 'I understand your roadmap, activities and verified skills, so you can ask me about what to work on next.'),
      suggestions
    );
    chat.append(welcome);

    const composer = element('footer', 'lumia-composer');
    const inputWrap = element('div', 'lumia-input-wrap');
    const textarea = element('textarea', 'lumia-input');
    textarea.id = 'lumia-input';
    textarea.rows = 1;
    textarea.maxLength = MAX_MESSAGE_LENGTH;
    textarea.placeholder = 'Ask Lumia about your journey...';
    textarea.setAttribute('aria-label', 'Message Lumia');
    textarea.setAttribute('aria-describedby', 'lumia-privacy-notice lumia-composer-hint lumia-status');
    const send = element('button', 'lumia-send', '\u2191');
    send.id = 'lumia-send';
    send.type = 'button';
    send.disabled = true;
    send.setAttribute('aria-label', 'Send message');
    inputWrap.append(textarea, send);
    const privacyNotice = element('p', 'lumia-privacy-notice', 'Lumia may use your CareerKraft progress and skills to personalise its guidance. ');
    privacyNotice.id = 'lumia-privacy-notice';
    const privacyLink = element('a', '', 'Privacy Policy');
    privacyLink.href = '/privacy.html#ai';
    privacyNotice.append(privacyLink);
    const composerFooter = element('div', 'lumia-composer-footer');
    const hint = element('span', '', 'Enter to send \u00b7 Shift + Enter for a new line');
    hint.id = 'lumia-composer-hint';
    const counter = element('span', 'lumia-character-count', `0/${MAX_MESSAGE_LENGTH}`);
    counter.id = 'lumia-character-count';
    composerFooter.append(hint, counter);
    const status = element('p', 'lumia-status');
    status.id = 'lumia-status';
    status.setAttribute('role', 'status');
    const historyRetry = element('button', 'lumia-retry-button', 'Retry loading conversation');
    historyRetry.id = 'lumia-history-retry';
    historyRetry.type = 'button';
    historyRetry.hidden = true;
    composer.append(privacyNotice, inputWrap, composerFooter, status, historyRetry);

    panel.append(header, context, chat, composer);
    root.append(launcher, panel);
    document.body.append(root);
    return { root, launcher, unread, panel, newChat, close, contextText, chat, welcome, suggestions, textarea, send, counter, status, historyRetry };
  }

  function messageElement(role, text) {
    const row = element('div', `lumia-message lumia-message-${role}`);
    row.setAttribute('role', 'article');
    row.setAttribute('aria-label', role === 'assistant' ? 'Lumia' : 'You');
    const avatar = element('div', 'lumia-message-avatar', role === 'assistant' ? '\u2726' : 'You');
    avatar.setAttribute('aria-hidden', 'true');
    const body = element('div', 'lumia-message-content');
    body.append(element('div', 'lumia-message-bubble', text));
    row.append(avatar, body);
    return row;
  }

  function typingElement() {
    const row = element('div', 'lumia-message lumia-message-assistant lumia-typing-message');
    row.setAttribute('role', 'status');
    row.setAttribute('aria-label', 'Lumia is thinking');
    const avatar = element('div', 'lumia-message-avatar', '\u2726');
    avatar.setAttribute('aria-hidden', 'true');
    const bubble = element('div', 'lumia-message-bubble lumia-typing');
    bubble.setAttribute('aria-hidden', 'true');
    for (let index = 0; index < 3; index += 1) bubble.append(element('span', '', '\u2022'));
    row.append(avatar, bubble);
    return row;
  }

  function resizeTextarea(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 130)}px`;
  }

  async function initialise() {
    const auth = window.careerAuth;
    if (!auth || typeof auth.getSession !== 'function' || typeof auth.request !== 'function') return;
    let userId;
    try {
      const { data, error } = await auth.getSession();
      if (error || !data?.session?.user) return;
      userId = Number(data.session.user.id);
      if (!Number.isSafeInteger(userId) || userId <= 0) return;
    } catch {
      return;
    }

    const ui = createWidget();
    const lastReadKey = `careerkraft-lumia-last-read-${userId}`;
    let conversationId = null;
    let latestAssistantMessageId = 0;
    let lastReadMessageId = 0;
    let loading = true;
    let sending = false;
    let historyPending = false;
    let historyFailed = false;
    let creatingConversation = false;
    let isOpen = false;
    let focusTimer = null;
    try { lastReadMessageId = Number(window.localStorage.getItem(lastReadKey)) || 0; }
    catch { lastReadMessageId = 0; }

    function scrollBottom() {
      ui.chat.scrollTop = ui.chat.scrollHeight;
    }

    function markRead() {
      if (latestAssistantMessageId > lastReadMessageId) {
        lastReadMessageId = latestAssistantMessageId;
        try { window.localStorage.setItem(lastReadKey, String(lastReadMessageId)); }
        catch { /* Server history remains available if browser storage is disabled. */ }
      }
      ui.unread.hidden = true;
    }

    function updateComposer() {
      const length = ui.textarea.value.length;
      ui.counter.textContent = `${length}/${MAX_MESSAGE_LENGTH}`;
      ui.counter.classList.toggle('is-over-limit', length > MAX_MESSAGE_LENGTH);
      ui.send.disabled = loading || sending || historyFailed || !ui.textarea.value.trim() || length > MAX_MESSAGE_LENGTH;
      ui.newChat.disabled = loading || sending;
      ui.historyRetry.disabled = loading || sending;
      ui.newChat.setAttribute('aria-busy', String(loading || sending));
      ui.textarea.readOnly = sending;
      ui.chat.setAttribute('aria-busy', String(sending || loading));
      for (const button of ui.suggestions.children) button.disabled = loading || sending || historyFailed;
    }

    function updateContext(context) {
      const career = context?.career?.title;
      const level = context?.currentLevel;
      ui.contextText.textContent = typeof career === 'string' && career && typeof level === 'string' && level
        ? `${career} \u00b7 ${level[0].toUpperCase()}${level.slice(1)} journey`
        : typeof career === 'string' && career ? career : 'Connected to your CareerKraft journey';
    }

    function openPanel() {
      isOpen = true;
      markRead();
      clearTimeout(focusTimer);
      ui.panel.hidden = false;
      ui.panel.classList.add('is-open');
      ui.panel.setAttribute('aria-hidden', 'false');
      ui.launcher.setAttribute('aria-expanded', 'true');
      ui.launcher.setAttribute('aria-label', 'Close Lumia');
      focusTimer = setTimeout(() => {
        if (isOpen && !ui.panel.hidden && !document.querySelector('dialog[open]')) ui.textarea.focus();
      }, 220);
      scrollBottom();
    }

    function closePanel() {
      isOpen = false;
      clearTimeout(focusTimer);
      ui.panel.hidden = true;
      ui.panel.classList.remove('is-open');
      ui.panel.setAttribute('aria-hidden', 'true');
      ui.launcher.setAttribute('aria-expanded', 'false');
      ui.launcher.setAttribute('aria-label', 'Open Lumia');
      ui.launcher.focus();
    }

    async function loadHistory() {
      if (historyPending || sending || creatingConversation) return;
      historyPending = true;
      loading = true;
      ui.status.textContent = 'Loading your conversation...';
      ui.historyRetry.hidden = true;
      updateComposer();
      try {
        const { data, error } = await auth.request('lumia/history');
        if (error || !Array.isArray(data?.messages)) throw new Error(error?.message || "I couldn't restore your conversation.");
        historyFailed = false;
        ui.status.textContent = '';
        conversationId = data.conversation?.id || null;
        const messages = Array.isArray(data.messages) ? data.messages : [];
        ui.chat.replaceChildren(ui.welcome);
        for (const message of messages) {
          if (!['user', 'assistant'].includes(message.role) || typeof message.content !== 'string') continue;
          ui.chat.append(messageElement(message.role, message.content));
          if (message.role === 'assistant' && Number.isSafeInteger(Number(message.id))) {
            latestAssistantMessageId = Math.max(latestAssistantMessageId, Number(message.id));
          }
        }
        ui.welcome.hidden = messages.length > 0;
        updateContext(data.context);
        ui.unread.hidden = latestAssistantMessageId <= lastReadMessageId;
        if (isOpen) markRead();
        scrollBottom();
      } catch (error) {
        historyFailed = true;
        ui.contextText.textContent = 'Conversation unavailable';
        ui.status.textContent = error.message || "I couldn't restore your conversation.";
        ui.historyRetry.hidden = false;
      } finally {
        historyPending = false;
        loading = false;
        updateComposer();
      }
    }

    async function sendMessage(suppliedMessage) {
      if (sending || loading || historyFailed) return;
      const message = (typeof suppliedMessage === 'string' ? suppliedMessage : ui.textarea.value).trim();
      if (!message) {
        ui.status.textContent = 'Ask Lumia a question first.';
        return;
      }
      if (message.length > MAX_MESSAGE_LENGTH) {
        ui.status.textContent = 'Your message is too long. Please shorten it to 3,000 characters.';
        return;
      }
      sending = true;
      ui.status.textContent = '';
      ui.welcome.hidden = true;
      const pendingMessage = messageElement('user', message);
      ui.chat.append(pendingMessage);
      ui.textarea.value = '';
      resizeTextarea(ui.textarea);
      updateComposer();
      const typing = typingElement();
      ui.chat.append(typing);
      scrollBottom();
      try {
        const { data, error } = await auth.request('lumia/chat', {
          message,
          conversationId,
          pageContext: pageContext()
        });
        typing.remove();
        if (error) throw new Error(error.message || "I couldn't respond right now. Please try again.");
        conversationId = data?.conversationId || conversationId;
        const answer = typeof data?.answer === 'string' ? data.answer.trim() : '';
        if (!answer) throw new Error("I couldn't create a response right now. Please try again.");
        updateContext(data.context);
        ui.chat.append(messageElement('assistant', answer));
        const assistantId = Number(data.assistantMessageId);
        if (Number.isSafeInteger(assistantId) && assistantId > 0) {
          latestAssistantMessageId = assistantId;
          if (isOpen) markRead();
          else ui.unread.hidden = false;
        }
        scrollBottom();
      } catch (error) {
        typing.remove();
        pendingMessage.remove();
        ui.textarea.value = message;
        resizeTextarea(ui.textarea);
        ui.status.textContent = error.message || "I couldn't connect right now. Your question is still here; please try again.";
      } finally {
        typing.remove();
        sending = false;
        updateComposer();
      }
    }

    async function startNewConversation() {
      if (sending || loading) return;
      creatingConversation = true;
      loading = true;
      ui.status.textContent = 'Starting a new conversation...';
      updateComposer();
      try {
      const { data, error } = await auth.request('lumia/new-conversation', {});
      if (error || !data?.conversation?.id) throw new Error(error?.message || "I couldn't start a new conversation.");
      historyFailed = false;
      ui.historyRetry.hidden = true;
      conversationId = data.conversation.id;
      latestAssistantMessageId = 0;
      ui.chat.replaceChildren(ui.welcome);
      ui.welcome.hidden = false;
      ui.textarea.value = '';
      ui.status.textContent = 'New conversation ready.';
      ui.contextText.textContent = 'Connected to your CareerKraft journey';
      resizeTextarea(ui.textarea);
      markRead();
      updateComposer();
      ui.textarea.focus();
      } catch (error) {
        ui.status.textContent = error.message || "I couldn't start a new conversation. Please try again.";
      } finally { creatingConversation = false; loading = false; updateComposer(); }
    }

    ui.launcher.addEventListener('click', () => isOpen ? closePanel() : openPanel());
    ui.close.addEventListener('click', closePanel);
    ui.newChat.addEventListener('click', () => { void startNewConversation(); });
    ui.historyRetry.addEventListener('click', () => { void loadHistory(); });
    ui.send.addEventListener('click', () => { void sendMessage(); });
    ui.textarea.addEventListener('input', () => {
      ui.status.textContent = '';
      resizeTextarea(ui.textarea);
      updateComposer();
    });
    ui.textarea.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
        event.preventDefault();
        void sendMessage();
      }
    });
    ui.suggestions.addEventListener('click', event => {
      const button = event.target.closest?.('.lumia-suggestion');
      if (button && ui.suggestions.contains(button) && !button.disabled) void sendMessage(button.dataset.prompt);
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !event.defaultPrevented && isOpen && !document.querySelector('dialog[open]')) {
        event.preventDefault();
        closePanel();
      }
    });
    updateComposer();
    void loadHistory();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialise, { once: true });
  } else {
    void initialise();
  }
})();
