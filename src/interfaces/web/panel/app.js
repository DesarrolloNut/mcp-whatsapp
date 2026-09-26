(function () {
  let token = localStorage.getItem('mcp_admin_token') || null;
  let cachedProviders = [];
  let cachedChannels = [];
  let cachedChats = [];
  let activeSelectedChatId = null;
  let activeSelectedChannel = null;
  let chatSearchQuery = '';
  let qrPollInterval = null;
  let activeQrChannelId = null;

  // DOM Elements
  const loginView = document.getElementById('login-view');
  const appView = document.getElementById('app-view');
  const loginForm = document.getElementById('login-form');
  const loginError = document.getElementById('login-error');
  const logoutBtn = document.getElementById('logout-btn');
  const loggedUser = document.getElementById('logged-user');

  // Navigation
  const navItems = document.querySelectorAll('.nav-item');
  const tabPanes = document.querySelectorAll('.tab-pane');

  // Chats & Messages Explorer Elements
  const dashRecentChats = document.getElementById('dash-recent-chats');
  const chatChannelSelect = document.getElementById('chat-channel-select');
  const chatSearchInput = document.getElementById('chat-search-input');
  const chatsListContainer = document.getElementById('chats-list-container');
  const chatViewerEmpty = document.getElementById('chat-viewer-empty');
  const chatViewerActive = document.getElementById('chat-viewer-active');
  const activeChatAvatar = document.getElementById('active-chat-avatar');
  const activeChatTitle = document.getElementById('active-chat-title');
  const activeChatJid = document.getElementById('active-chat-jid');
  const activeChatChannel = document.getElementById('active-chat-channel');
  const chatMessagesStream = document.getElementById('chat-messages-stream');
  const chatReplyForm = document.getElementById('chat-reply-form');
  const chatReplyInput = document.getElementById('chat-reply-input');
  const chatReplySendBtn = document.getElementById('chat-reply-send-btn');
  const refreshChatsBtn = document.getElementById('refresh-chats-btn');
  const refreshActiveChatBtn = document.getElementById('refresh-active-chat-btn');

  // Modals
  const providerModal = document.getElementById('provider-modal');
  const channelModal = document.getElementById('channel-modal');
  const qrModal = document.getElementById('qr-modal');
  const sendMessageModal = document.getElementById('send-message-modal');
  const openProviderModalBtn = document.getElementById('open-provider-modal-btn');
  const openChannelModalBtn = document.getElementById('open-channel-modal-btn');
  const closeButtons = document.querySelectorAll('.close-modal');

  // Forms & Inputs
  const providerForm = document.getElementById('provider-form');
  const channelForm = document.getElementById('channel-form');
  const sendMessageForm = document.getElementById('send-message-form');
  const providerTypeSelect = document.getElementById('p-type');
  const providerExternalFields = document.getElementById('p-external-fields');
  const providerBaileysNote = document.getElementById('p-baileys-note');
  const providerUrlInput = document.getElementById('p-url');
  const providerKeyInput = document.getElementById('p-key');
  const channelInstanceGroup = document.getElementById('c-instance-group');
  const providerModalError = document.getElementById('provider-modal-error');
  const channelModalError = document.getElementById('channel-modal-error');

  // Send Message Modal Elements
  const smModalSubtitle = document.getElementById('sm-modal-subtitle');
  const smChannelNameInput = document.getElementById('sm-channel-name');
  const smRecipientInput = document.getElementById('sm-recipient');
  const smTextInput = document.getElementById('sm-text');
  const smModalAlert = document.getElementById('sm-modal-alert');
  const smSubmitBtn = document.getElementById('sm-submit-btn');
  const smBtnText = document.getElementById('sm-btn-text');
  // QR Modal Elements
  const qrModalTitle = document.getElementById('qr-modal-title');
  const qrModalSubtitle = document.getElementById('qr-modal-subtitle');
  const qrStatusBadge = document.getElementById('qr-status-badge');
  const qrLoader = document.getElementById('qr-loader');
  const qrLoaderText = document.getElementById('qr-loader-text');
  const qrImageWrapper = document.getElementById('qr-image-wrapper');
  const qrImage = document.getElementById('qr-image');
  const qrSuccessCard = document.getElementById('qr-success-card');
  const qrConnectedPhone = document.getElementById('qr-connected-phone');
  const qrLogoutActionBtn = document.getElementById('qr-logout-action-btn');
  const qrRetryActionBtn = document.getElementById('qr-retry-action-btn');

  // Tables & Stats
  const providersTableBody = document.getElementById('providers-table-body');
  const channelsTableBody = document.getElementById('channels-table-body');
  const channelProviderSelect = document.getElementById('c-provider');
  const statProviders = document.getElementById('stat-providers');
  const statChannels = document.getElementById('stat-channels');
  const statDefaultChannel = document.getElementById('stat-default-channel');
  const statUptime = document.getElementById('stat-uptime');
  const refreshDashboardBtn = document.getElementById('refresh-dashboard-btn');

  // Helper: Format relative or short date/time
  function formatChatTime(ts) {
    if (!ts) return '';
    const date = new Date(typeof ts === 'number' && ts < 10000000000 ? ts * 1000 : ts);
    if (isNaN(date.getTime())) return '';
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    if (isToday) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) {
      return 'Ayer';
    }
    return date.toLocaleDateString([], { day: '2-digit', month: '2-digit' });
  }

  function formatTime(ts) {
    if (!ts) return '';
    const date = new Date(typeof ts === 'number' && ts < 10000000000 ? ts * 1000 : ts);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // Helper API fetch
  async function api(path, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(path, { ...options, headers });
    if (res.status === 401) {
      handleLogout();
      throw new Error('Sesión expirada o no autorizada');
    }

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Error en la petición');
    }
    return data;
  }

  // Auth Handling
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.classList.add('hidden');

    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value.trim();

    try {
      const res = await api('/api/admin/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });

      token = res.token;
      localStorage.setItem('mcp_admin_token', token);
      localStorage.setItem('mcp_admin_user', res.user.username);
      initApp(res.user.username);
    } catch (err) {
      loginError.textContent = err.message;
      loginError.classList.remove('hidden');
    }
  });

  function handleLogout() {
    token = null;
    stopQrPolling();
    localStorage.removeItem('mcp_admin_token');
    localStorage.removeItem('mcp_admin_user');
    appView.classList.add('hidden');
    loginView.classList.remove('hidden');
  }

  logoutBtn.addEventListener('click', handleLogout);

  // App Initialization
  function initApp(username) {
    loginView.classList.add('hidden');
    appView.classList.remove('hidden');
    loggedUser.textContent = username || localStorage.getItem('mcp_admin_user') || 'admin';
    loadDashboard();
    loadRecentChats();
    loadProviders();
    loadChannels();
    loadTriggers();
  }

  // Tab Navigation
  window.switchTab = (tabId) => {
    navItems.forEach((b) => b.classList.remove('active'));
    tabPanes.forEach((p) => p.classList.remove('active'));

    const navBtn = document.querySelector(`.nav-item[data-tab="${tabId}"]`);
    if (navBtn) navBtn.classList.add('active');

    const targetPane = document.getElementById(`tab-${tabId}`);
    if (targetPane) targetPane.classList.add('active');

    if (tabId === 'dashboard') {
      loadDashboard();
      loadRecentChats();
    }
    if (tabId === 'chats') loadChatsTab();
    if (tabId === 'providers') loadProviders();
    if (tabId === 'channels') loadChannels();
    if (tabId === 'triggers') loadTriggers();
    if (tabId === 'mcp') loadMcpGuide();
  };

  navItems.forEach((btn) => {
    if (btn.tagName.toLowerCase() === 'button') {
      btn.addEventListener('click', () => {
        const tabId = btn.getAttribute('data-tab');
        window.switchTab(tabId);
      });
    }
  });

  // Modal Controls
  openProviderModalBtn.addEventListener('click', () => {
    providerForm.reset();
    providerModalError.classList.add('hidden');
    updateProviderFormVisibility();
    providerModal.classList.remove('hidden');
  });

  openChannelModalBtn.addEventListener('click', () => {
    channelForm.reset();
    channelModalError.classList.add('hidden');
    populateProviderSelect();
    updateChannelFormVisibility();
    channelModal.classList.remove('hidden');
  });

  function closeAllModals() {
    stopQrPolling();
    closeAllDropdowns();
    providerModal.classList.add('hidden');
    channelModal.classList.add('hidden');
    qrModal.classList.add('hidden');
    if (sendMessageModal) sendMessageModal.classList.add('hidden');
  }

  closeButtons.forEach((btn) => {
    btn.addEventListener('click', closeAllModals);
  });

  // Provider Type Selector Toggle
  function updateProviderFormVisibility() {
    const selectedType = providerTypeSelect.value;
    if (selectedType === 'baileys') {
      providerExternalFields.classList.add('hidden');
      providerBaileysNote.classList.remove('hidden');
      providerUrlInput.removeAttribute('required');
      providerKeyInput.removeAttribute('required');
    } else {
      providerExternalFields.classList.remove('hidden');
      providerBaileysNote.classList.add('hidden');
      providerUrlInput.setAttribute('required', 'required');
      providerKeyInput.setAttribute('required', 'required');
    }
  }

  providerTypeSelect.addEventListener('change', updateProviderFormVisibility);

  // Channel Provider Selector Toggle
  function updateChannelFormVisibility() {
    const provId = channelProviderSelect.value;
    const prov = cachedProviders.find((p) => p.id === provId);
    if (prov && prov.type === 'baileys') {
      if (channelInstanceGroup) channelInstanceGroup.classList.add('hidden');
    } else {
      if (channelInstanceGroup) channelInstanceGroup.classList.remove('hidden');
    }
  }

  channelProviderSelect.addEventListener('change', updateChannelFormVisibility);

  // Data Loading: Dashboard
  let cachedDashboardStats = null;
  let currentMcpClient = 'cursor';

  async function loadDashboard() {
    try {
      const stats = await api('/api/admin/dashboard');
      cachedDashboardStats = stats;
      statProviders.textContent = stats.activeProvidersCount;
      statChannels.textContent = stats.activeChannelsCount;
      statDefaultChannel.textContent = stats.defaultChannel
        ? `${stats.defaultChannel.name} (${stats.defaultChannel.phoneNumber || 'Sin num'})`
        : 'Ninguna';

      const hours = Math.floor(stats.uptimeSeconds / 3600);
      const mins = Math.floor((stats.uptimeSeconds % 3600) / 60);
      statUptime.textContent = `${hours}h ${mins}m`;

      const dashMcpUrl = document.getElementById('dash-mcp-url');
      if (dashMcpUrl) {
        dashMcpUrl.textContent = `${window.location.origin}/mcp`;
      }
    } catch (err) {
      console.error('Error loading dashboard:', err);
    }
  }

  // Data Loading: Recent Chats Widget (Top 5 for Dashboard)
  async function loadRecentChats() {
    if (!dashRecentChats) return;
    try {
      const res = await api('/api/chats');
      const chats = res.chats || [];
      if (chats.length === 0) {
        dashRecentChats.innerHTML = `
          <div class="text-center text-muted p-4" style="grid-column: 1 / -1;">
            <div style="font-size: 2rem; margin-bottom: 0.5rem; opacity: 0.6;">💬</div>
            No hay conversaciones sincronizadas aún.<br>
            <small class="text-muted">Los mensajes entrantes y salientes de WhatsApp se registrarán aquí automáticamente.</small>
          </div>
        `;
        return;
      }

      const top5 = chats.slice(0, 5);
      dashRecentChats.innerHTML = top5
        .map((c) => {
          const isGroup = c.isGroup || (c.id && c.id.endsWith('@g.us'));
          const rawName = c.name || c.phoneNumber || (c.id ? c.id.replace(/@s\.whatsapp\.net|@lid|@g\.us/g, '') : 'Desconocido');
          const displayName = escapeHtml(rawName);
          const avatar = isGroup ? '👥' : '👤';
          const timeStr = formatChatTime(c.lastMessageTimestamp || c.timestamp);
          const lastMsgText = typeof c.lastMessage === 'string'
            ? c.lastMessage
            : (c.lastMessage?.text || c.lastMessageText || 'Conversación activa');
          const preview = escapeHtml(lastMsgText);
          const channelName = escapeHtml(c.channel || res.channel || 'predeterminado');
          const unreadBadge = c.unreadCount && c.unreadCount > 0
            ? `<span class="unread-pill">${c.unreadCount}</span>`
            : '';

          return `
            <div class="dash-chat-card" onclick="window.openChatInExplorer('${escapeHtml(c.id)}', '${channelName}')">
              <div class="dash-chat-avatar">${avatar}</div>
              <div class="dash-chat-info">
                <div class="dash-chat-top">
                  <span class="dash-chat-name" title="${displayName}">${displayName}</span>
                  <span class="dash-chat-time">${timeStr}</span>
                </div>
                <div class="dash-chat-bottom">
                  <span class="dash-chat-preview">${preview}</span>
                  <div style="display: flex; gap: 0.35rem; align-items: center;">
                    <span class="badge badge-muted" style="font-size: 0.68rem;">${channelName}</span>
                    ${unreadBadge}
                  </div>
                </div>
              </div>
            </div>
          `;
        })
        .join('');
    } catch (err) {
      dashRecentChats.innerHTML = `<div class="text-center text-muted p-3" style="grid-column: 1 / -1;">Error al cargar conversaciones recientes: ${err.message}</div>`;
    }
  }

  window.openChatInExplorer = async (chatId, channelName) => {
    window.switchTab('chats');
    if (channelName && chatChannelSelect) {
      chatChannelSelect.value = channelName;
    }
    await loadChatsTab(channelName);
    selectChat(chatId, channelName);
  };

  // ── CHATS & MESSAGES EXPLORER TAB ──────────────────────────────────────────

  async function loadChatsTab(preferredChannel) {
    try {
      if (chatChannelSelect) {
        if (!cachedChannels || cachedChannels.length === 0) {
          cachedChannels = await api('/api/admin/channels');
        }
        const currentVal = preferredChannel !== undefined ? preferredChannel : chatChannelSelect.value;
        chatChannelSelect.innerHTML = '<option value="">Línea Predeterminada / Todas</option>' +
          cachedChannels
            .filter((c) => c.isActive)
            .map((c) => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}${c.phoneNumber ? ` (${c.phoneNumber})` : ''}</option>`)
            .join('');
        if (currentVal) {
          chatChannelSelect.value = currentVal;
        }
      }

      const selectedChannel = chatChannelSelect ? chatChannelSelect.value : (preferredChannel || '');
      const queryParam = selectedChannel ? `?channel=${encodeURIComponent(selectedChannel)}` : '';

      if (chatsListContainer) {
        chatsListContainer.innerHTML = '<div class="text-center text-muted p-4">Cargando conversaciones...</div>';
      }

      const res = await api(`/api/chats${queryParam}`);
      cachedChats = res.chats || [];
      renderChatsList();

      if (activeSelectedChatId) {
        const stillExists = cachedChats.find((c) => c.id === activeSelectedChatId);
        if (stillExists) {
          selectChat(activeSelectedChatId, selectedChannel || stillExists.channel);
        }
      }
    } catch (err) {
      if (chatsListContainer) {
        chatsListContainer.innerHTML = `<div class="text-center text-muted p-4">Error al cargar chats: ${err.message}</div>`;
      }
    }
  }

  function renderChatsList() {
    if (!chatsListContainer) return;
    const query = (chatSearchQuery || '').toLowerCase().trim();
    const filtered = cachedChats.filter((c) => {
      if (!query) return true;
      const name = (c.name || '').toLowerCase();
      const id = (c.id || '').toLowerCase();
      const phone = (c.phoneNumber || '').toLowerCase();
      const lastMsg = (typeof c.lastMessage === 'string' ? c.lastMessage : (c.lastMessage?.text || '')) || '';
      return name.includes(query) || id.includes(query) || phone.includes(query) || lastMsg.toLowerCase().includes(query);
    });

    if (filtered.length === 0) {
      chatsListContainer.innerHTML = `
        <div class="text-center text-muted p-4">
          ${query ? 'No se encontraron conversaciones con esa búsqueda.' : 'No hay conversaciones registradas aún.'}
        </div>
      `;
      return;
    }

    chatsListContainer.innerHTML = filtered
      .map((c) => {
        const isGroup = c.isGroup || (c.id && c.id.endsWith('@g.us'));
        const rawName = c.name || c.phoneNumber || (c.id ? c.id.replace(/@s\.whatsapp\.net|@lid|@g\.us/g, '') : 'Desconocido');
        const displayName = escapeHtml(rawName);
        const avatar = isGroup ? '👥' : '👤';
        const timeStr = formatChatTime(c.lastMessageTimestamp || c.timestamp);
        const lastMsgText = typeof c.lastMessage === 'string'
          ? c.lastMessage
          : (c.lastMessage?.text || c.lastMessageText || 'Sin mensajes previos');
        const preview = escapeHtml(lastMsgText);
        const channelName = escapeHtml(c.channel || '');
        const isActive = activeSelectedChatId === c.id;
        const unreadBadge = c.unreadCount && c.unreadCount > 0
          ? `<span class="unread-pill">${c.unreadCount}</span>`
          : '';

        return `
          <div class="chat-item ${isActive ? 'active' : ''}" data-chat-id="${escapeHtml(c.id)}" data-channel="${channelName}">
            <div class="chat-avatar">${avatar}</div>
            <div class="chat-item-content">
              <div class="chat-item-top">
                <span class="chat-item-title" title="${displayName}">${displayName}</span>
                <span class="chat-item-time">${timeStr}</span>
              </div>
              <div class="chat-item-bottom">
                <span class="chat-item-snippet">${preview}</span>
                <div class="chat-item-badges">
                  ${channelName ? `<span class="badge badge-muted" style="font-size: 0.65rem;">${channelName}</span>` : ''}
                  ${unreadBadge}
                </div>
              </div>
            </div>
          </div>
        `;
      })
      .join('');

    chatsListContainer.querySelectorAll('.chat-item').forEach((el) => {
      el.addEventListener('click', () => {
        const chatId = el.getAttribute('data-chat-id');
        const channel = el.getAttribute('data-channel');
        selectChat(chatId, channel);
      });
    });
  }

  async function selectChat(chatId, channelName) {
    activeSelectedChatId = chatId;
    activeSelectedChannel = channelName || (chatChannelSelect ? chatChannelSelect.value : '');

    document.querySelectorAll('.chat-item').forEach((el) => {
      if (el.getAttribute('data-chat-id') === chatId) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
    });

    const chatObj = cachedChats.find((c) => c.id === chatId);
    const isGroup = chatObj ? (chatObj.isGroup || chatObj.id.endsWith('@g.us')) : chatId.endsWith('@g.us');
    const rawName = chatObj?.name || chatObj?.phoneNumber || (chatId ? chatId.replace(/@s\.whatsapp\.net|@lid|@g\.us/g, '') : 'Desconocido');
    const displayName = escapeHtml(rawName);

    if (chatViewerEmpty) chatViewerEmpty.classList.add('hidden');
    if (chatViewerActive) chatViewerActive.classList.remove('hidden');

    if (activeChatAvatar) activeChatAvatar.textContent = isGroup ? '👥' : '👤';
    if (activeChatTitle) activeChatTitle.textContent = displayName;
    if (activeChatJid) activeChatJid.textContent = chatId;
    if (activeChatChannel) activeChatChannel.textContent = activeSelectedChannel || 'predeterminado';

    if (chatMessagesStream) {
      chatMessagesStream.innerHTML = '<div class="text-center text-muted p-4">Cargando mensajes...</div>';
    }

    try {
      const queryChannel = activeSelectedChannel ? `&channel=${encodeURIComponent(activeSelectedChannel)}` : '';
      const res = await api(`/api/messages?chatId=${encodeURIComponent(chatId)}&count=50${queryChannel}`);
      // Sort chronologically (oldest at top, newest at bottom)
      const sorted = (res.messages || []).slice().sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
      renderMessages(sorted);
    } catch (err) {
      if (chatMessagesStream) {
        chatMessagesStream.innerHTML = `<div class="text-center text-muted p-4">Error al cargar mensajes: ${err.message}</div>`;
      }
    }
  }

  function renderMessages(messages) {
    if (!chatMessagesStream) return;
    if (messages.length === 0) {
      chatMessagesStream.innerHTML = `
        <div class="text-center text-muted p-4" style="margin: auto;">
          <div style="font-size: 2.5rem; opacity: 0.5; margin-bottom: 0.5rem;">💬</div>
          No hay mensajes en este chat aún.<br>
          <small class="text-muted">Escribe un mensaje en el campo inferior para responder o iniciar.</small>
        </div>
      `;
      return;
    }

    chatMessagesStream.innerHTML = messages
      .map((m) => {
        const fromMe = Boolean(m.fromMe);
        const bubbleClass = fromMe ? 'outbound' : 'inbound';
        const senderDisplay = !fromMe && m.senderName
          ? `<div class="message-sender">${escapeHtml(m.senderName)}</div>`
          : '';
        const mediaTag = m.type && m.type !== 'text' && m.type !== 'conversation'
          ? `<div class="message-media-tag">📎 ${escapeHtml(m.type)}</div>`
          : '';
        const textContent = m.text || m.caption || '';
        const timeStr = formatTime(m.timestamp);
        const checkmark = fromMe ? '<span style="color: #53bdeb;">✓✓</span>' : '';

        return `
          <div class="message-bubble ${bubbleClass}">
            ${senderDisplay}
            ${mediaTag}
            ${textContent ? `<div class="message-text">${escapeHtml(textContent)}</div>` : ''}
            <div class="message-meta">
              <span>${timeStr}</span>
              ${checkmark}
            </div>
          </div>
        `;
      })
      .join('');

    chatMessagesStream.scrollTop = chatMessagesStream.scrollHeight;
    setTimeout(() => {
      if (chatMessagesStream) {
        chatMessagesStream.scrollTop = chatMessagesStream.scrollHeight;
      }
    }, 40);
  }

  // Search Filter Handler
  if (chatSearchInput) {
    chatSearchInput.addEventListener('input', (e) => {
      chatSearchQuery = e.target.value;
      renderChatsList();
    });
  }

  // Channel Select Filter Handler
  if (chatChannelSelect) {
    chatChannelSelect.addEventListener('change', () => {
      activeSelectedChatId = null;
      if (chatViewerActive) chatViewerActive.classList.add('hidden');
      if (chatViewerEmpty) chatViewerEmpty.classList.remove('hidden');
      loadChatsTab();
    });
  }

  // Refresh Buttons
  if (refreshChatsBtn) {
    refreshChatsBtn.addEventListener('click', () => loadChatsTab());
  }

  if (refreshActiveChatBtn) {
    refreshActiveChatBtn.addEventListener('click', () => {
      if (activeSelectedChatId) {
        selectChat(activeSelectedChatId, activeSelectedChannel);
      }
    });
  }

  // Send Quick Reply Form Handler
  if (chatReplyForm) {
    chatReplyForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!activeSelectedChatId) return;

      const text = chatReplyInput.value.trim();
      if (!text) return;

      const recipient = activeSelectedChatId;
      const channel = activeSelectedChannel || (chatChannelSelect ? chatChannelSelect.value : '');

      const optimisticBubble = document.createElement('div');
      optimisticBubble.className = 'message-bubble outbound';
      optimisticBubble.innerHTML = `
        <div class="message-text">${escapeHtml(text)}</div>
        <div class="message-meta">
          <span>${formatTime(Date.now())}</span>
          <span style="opacity: 0.6;">⏳</span>
        </div>
      `;
      chatMessagesStream.appendChild(optimisticBubble);
      chatMessagesStream.scrollTop = chatMessagesStream.scrollHeight;

      chatReplyInput.value = '';
      chatReplySendBtn.disabled = true;

      try {
        await api('/api/messages/text', {
          method: 'POST',
          body: JSON.stringify({ recipient, text, channel }),
        });

        const metaEl = optimisticBubble.querySelector('.message-meta');
        if (metaEl) {
          metaEl.innerHTML = `<span>${formatTime(Date.now())}</span><span style="color: #53bdeb;">✓✓</span>`;
        }

        // Silently reload chat summaries to update timestamps and snippets
        const queryParam = channel ? `?channel=${encodeURIComponent(channel)}` : '';
        const res = await api(`/api/chats${queryParam}`);
        cachedChats = res.chats || [];
        renderChatsList();
      } catch (err) {
        alert(`Error al enviar mensaje: ${err.message}`);
        optimisticBubble.remove();
      } finally {
        chatReplySendBtn.disabled = false;
        chatReplyInput.focus();
      }
    });
  }

  if (refreshDashboardBtn) {
    refreshDashboardBtn.addEventListener('click', () => {
      loadDashboard();
      loadRecentChats();
    });
  }

  // Data Loading: MCP Connection Guide
  async function loadMcpGuide() {
    try {
      if (!cachedDashboardStats) {
        cachedDashboardStats = await api('/api/admin/dashboard');
      }
      const stats = cachedDashboardStats;
      const origin = window.location.origin;
      const mcpUrl = `${origin}/mcp`;

      const mcpEndpointUrlEl = document.getElementById('mcp-endpoint-url');
      const mcpAuthStatusEl = document.getElementById('mcp-auth-status');
      const mcpDefaultLineEl = document.getElementById('mcp-default-line-display');

      if (mcpEndpointUrlEl) mcpEndpointUrlEl.textContent = mcpUrl;

      if (mcpAuthStatusEl) {
        if (stats.mcp?.authRequired) {
          mcpAuthStatusEl.className = 'badge badge-yellow';
          mcpAuthStatusEl.textContent = 'Requiere Bearer MCP_API_TOKEN';
        } else {
          mcpAuthStatusEl.className = 'badge badge-green';
          mcpAuthStatusEl.textContent = 'Sin auth (Modo Desarrollo Activo)';
        }
      }

      if (mcpDefaultLineEl) {
        mcpDefaultLineEl.textContent = stats.defaultChannel
          ? `${stats.defaultChannel.name}${stats.defaultChannel.phoneNumber ? ` (${stats.defaultChannel.phoneNumber})` : ''}`
          : 'Ninguna (Configurar en Canales)';
      }

      renderMcpSnippet(currentMcpClient, mcpUrl, stats.mcp?.authRequired);
    } catch (err) {
      console.error('Error loading MCP guide:', err);
    }
  }

  function renderMcpSnippet(client, mcpUrl, authRequired) {
    const filenameEl = document.getElementById('mcp-snippet-filename');
    const codeEl = document.getElementById('mcp-snippet-code');

    let filename = '';
    let snippet = '';

    if (client === 'cursor') {
      filename = '.cursor/mcp.json (o Cursor > Settings > Features > MCP)';
      snippet = JSON.stringify(
        {
          mcpServers: {
            whatsapp: {
              url: mcpUrl,
              ...(authRequired ? { headers: { Authorization: 'Bearer tu-token-mcp-secreto' } } : {}),
            },
          },
        },
        null,
        2
      );
    } else if (client === 'claude-desktop') {
      filename = 'claude_desktop_config.json (%APPDATA%\\Claude o ~/Library/Application Support/Claude)';
      snippet = JSON.stringify(
        {
          mcpServers: {
            whatsapp: {
              command: 'npx',
              args: ['-y', '@modelcontextprotocol/inspector', '--sse', mcpUrl],
              ...(authRequired ? { headers: { Authorization: 'Bearer tu-token-mcp-secreto' } } : {}),
            },
          },
        },
        null,
        2
      );
    } else if (client === 'claude-code') {
      filename = 'Terminal / CLI (Claude Code)';
      snippet = authRequired
        ? `claude mcp add whatsapp ${mcpUrl} --header "Authorization: Bearer tu-token-mcp-secreto"`
        : `claude mcp add whatsapp ${mcpUrl}`;
    } else if (client === 'windsurf') {
      filename = '~/.codeium/windsurf/mcp_config.json';
      snippet = JSON.stringify(
        {
          mcpServers: {
            whatsapp: {
              serverUrl: mcpUrl,
              ...(authRequired ? { headers: { Authorization: 'Bearer tu-token-mcp-secreto' } } : {}),
            },
          },
        },
        null,
        2
      );
    }

    if (filenameEl) filenameEl.textContent = filename;
    if (codeEl) codeEl.textContent = snippet;
  }

  // MCP Client Tab Switcher
  document.querySelectorAll('.mcp-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mcp-tab-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentMcpClient = btn.getAttribute('data-client');
      const origin = window.location.origin;
      const mcpUrl = `${origin}/mcp`;
      renderMcpSnippet(currentMcpClient, mcpUrl, cachedDashboardStats?.mcp?.authRequired);
    });
  });

  const refreshMcpBtn = document.getElementById('refresh-mcp-btn');
  if (refreshMcpBtn) {
    refreshMcpBtn.addEventListener('click', async () => {
      cachedDashboardStats = null;
      await loadMcpGuide();
    });
  }

  // 1-Click Copy Buttons
  document.addEventListener('click', async (e) => {
    const copyBtn = e.target.closest('.copy-btn');
    if (!copyBtn) return;

    const targetId = copyBtn.getAttribute('data-target');
    const targetEl = document.getElementById(targetId);
    if (!targetEl) return;

    const textToCopy = targetEl.textContent || targetEl.innerText;
    try {
      await navigator.clipboard.writeText(textToCopy);
      const originalText = copyBtn.innerHTML;
      copyBtn.innerHTML = '✅ ¡Copiado!';
      setTimeout(() => {
        copyBtn.innerHTML = originalText;
      }, 2000);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = textToCopy;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      const originalText = copyBtn.innerHTML;
      copyBtn.innerHTML = '✅ ¡Copiado!';
      setTimeout(() => {
        copyBtn.innerHTML = originalText;
      }, 2000);
    }
  });

  // Data Loading: Providers
  async function loadProviders() {
    try {
      const providers = await api('/api/admin/providers');
      cachedProviders = providers;
      renderProviders(providers);
    } catch (err) {
      providersTableBody.innerHTML = `<tr><td colspan="5" class="text-center text-muted error">Error al cargar proveedores: ${err.message}</td></tr>`;
    }
  }

  function renderProviders(providers) {
    if (providers.length === 0) {
      providersTableBody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No hay proveedores registrados. Crea uno con "+ Nuevo Proveedor".</td></tr>';
      return;
    }

    providersTableBody.innerHTML = providers
      .map(
        (p) => `
        <tr>
          <td><strong>${escapeHtml(p.name)}</strong></td>
          <td><span class="badge ${p.type === 'baileys' ? 'badge-blue' : 'badge-muted'}">${escapeHtml(p.type)}</span></td>
          <td><code>${p.type === 'baileys' ? 'embebido://whatsapp-web' : escapeHtml(p.baseUrl)}</code></td>
          <td><span class="badge ${p.isActive ? 'badge-green' : 'badge-muted'}">${p.isActive ? 'Activo' : 'Inactivo'}</span></td>
          <td>
            <button class="btn btn-secondary btn-sm" onclick="window.testProvider('${p.id}')">⚡ Probar</button>
            ${p.isActive ? `<button class="btn btn-danger btn-sm" onclick="window.deleteProvider('${p.id}')">Desactivar</button>` : ''}
          </td>
        </tr>
      `
      )
      .join('');
  }

  // Data Loading: Channels
  async function loadChannels() {
    try {
      if (!cachedProviders || cachedProviders.length === 0) {
        cachedProviders = await api('/api/admin/providers');
      }
      const channels = await api('/api/admin/channels');
      renderChannels(channels);
    } catch (err) {
      channelsTableBody.innerHTML = `<tr><td colspan="6" class="text-center text-muted error">Error al cargar canales: ${err.message}</td></tr>`;
    }
  }

  function renderChannels(channels) {
    if (channels.length === 0) {
      channelsTableBody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No hay líneas/canales configurados. Crea uno con "+ Nueva Línea / Canal".</td></tr>';
      return;
    }

    channelsTableBody.innerHTML = channels
      .map((c) => {
        const prov = cachedProviders.find((p) => p.id === c.providerId);
        const provName = prov ? prov.name : c.providerId;
        const isBaileys = prov ? prov.type === 'baileys' : false;

        return `
        <tr>
          <td><strong>${escapeHtml(c.name)}</strong></td>
          <td>${c.phoneNumber ? `<code>${escapeHtml(c.phoneNumber)}</code>` : '<span class="text-muted">—</span>'}</td>
          <td><span class="badge ${isBaileys ? 'badge-blue' : 'badge-muted'}">${escapeHtml(provName)}</span></td>
          <td><code>${c.instanceId ? escapeHtml(c.instanceId) : (isBaileys ? '<span class="text-green">directo</span>' : '<span class="text-muted">—</span>')}</code></td>
          <td>
            ${
              c.isDefault
                ? '<span class="badge badge-green">★ Default</span>'
                : `<button class="btn btn-secondary btn-sm" onclick="window.setDefaultChannel('${c.id}')">Hacer Default</button>`
            }
          </td>
          <td>
            <div class="dropdown" id="dropdown-wrapper-${c.id}">
              <button type="button" class="btn-dropdown-trigger" onclick="window.toggleActionMenu(event, '${c.id}')" title="Acciones de línea">⋮</button>
              <div class="dropdown-menu hidden" id="dropdown-menu-${c.id}">
                <button type="button" class="dropdown-item" onclick="window.openSendMessageModal('${escapeHtml(c.name)}', '${escapeHtml(c.phoneNumber || '')}')">
                  💬 Enviar Mensaje
                </button>
                ${
                  isBaileys
                    ? `<button type="button" class="dropdown-item" onclick="window.openQrModal('${c.id}', '${escapeHtml(c.name)}')">
                        📱 Vincular / Estado QR
                      </button>`
                    : ''
                }
                ${
                  !c.isDefault
                    ? `<button type="button" class="dropdown-item" onclick="window.setDefaultChannel('${c.id}')">
                        ★ Hacer Predeterminada
                      </button>`
                    : ''
                }
                <div class="dropdown-divider"></div>
                ${
                  c.isActive
                    ? `<button type="button" class="dropdown-item danger" onclick="window.deleteChannel('${c.id}')">
                        🗑️ Desactivar Línea
                      </button>`
                    : `<span class="dropdown-item text-muted">Línea Inactiva</span>`
                }
              </div>
            </div>
          </td>
        </tr>
      `;
      })
      .join('');
  }

  function populateProviderSelect() {
    channelProviderSelect.innerHTML = '<option value="">Seleccione un proveedor...</option>' +
      cachedProviders
        .filter((p) => p.isActive)
        .map((p) => `<option value="${p.id}">${escapeHtml(p.name)} (${p.type === 'baileys' ? 'Baileys Embebido' : p.type})</option>`)
        .join('');
  }

  // Dropdown Menu Controls
  function closeAllDropdowns() {
    document.querySelectorAll('.dropdown-menu').forEach((m) => m.classList.add('hidden'));
    document.querySelectorAll('.btn-dropdown-trigger').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.dropdown').forEach((d) => d.classList.remove('active'));
  }

  window.toggleActionMenu = (e, channelId) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    const menu = document.getElementById(`dropdown-menu-${channelId}`);
    const wrapper = document.getElementById(`dropdown-wrapper-${channelId}`);
    const trigger = e ? e.currentTarget : (wrapper ? wrapper.querySelector('.btn-dropdown-trigger') : null);
    const isHidden = menu ? menu.classList.contains('hidden') : false;

    closeAllDropdowns();

    if (menu && isHidden) {
      menu.classList.remove('hidden');
      if (trigger) trigger.classList.add('active');
      if (wrapper) wrapper.classList.add('active');
    }
  };

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.dropdown')) {
      closeAllDropdowns();
    }
  });

  // Send Message Modal Handling
  window.openSendMessageModal = (channelName, phoneNumber) => {
    closeAllDropdowns();
    smChannelNameInput.value = channelName;
    smModalSubtitle.textContent = `Desde línea: ${channelName}${phoneNumber ? ` (${phoneNumber})` : ''}`;
    smRecipientInput.value = '';
    smTextInput.value = '';
    smModalAlert.className = 'alert hidden';
    smModalAlert.textContent = '';
    smSubmitBtn.disabled = false;
    smBtnText.textContent = '🚀 Enviar Mensaje';

    sendMessageModal.classList.remove('hidden');
    smRecipientInput.focus();
  };

  if (sendMessageForm) {
    sendMessageForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      smModalAlert.className = 'alert hidden';

      const channel = smChannelNameInput.value.trim();
      const recipient = smRecipientInput.value.trim();
      const text = smTextInput.value.trim();

      if (!recipient || !text) {
        smModalAlert.className = 'alert error';
        smModalAlert.textContent = 'Por favor completa el destinatario y el mensaje.';
        return;
      }

      smSubmitBtn.disabled = true;
      smBtnText.textContent = 'Enviando mensaje...';

      try {
        const res = await api('/api/messages/text', {
          method: 'POST',
          body: JSON.stringify({ recipient, text, channel }),
        });

        smModalAlert.className = 'alert success';
        const msgId = res.result?.messageId || 'OK';
        smModalAlert.innerHTML = `✅ <strong>¡Mensaje Enviado con Éxito!</strong><br><small class="text-muted">ID de entrega: ${escapeHtml(msgId)}</small>`;
        smTextInput.value = '';
      } catch (err) {
        smModalAlert.className = 'alert error';
        smModalAlert.textContent = `❌ Error al enviar mensaje: ${err.message}`;
      } finally {
        smSubmitBtn.disabled = false;
        smBtnText.textContent = '🚀 Enviar Mensaje';
      }
    });
  }

  // Provider Form Submit
  providerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    providerModalError.classList.add('hidden');

    const name = document.getElementById('p-name').value.trim();
    const type = providerTypeSelect.value;
    let baseUrl = providerUrlInput.value.trim();
    let apiKey = providerKeyInput.value.trim();

    if (type === 'baileys') {
      if (!baseUrl) baseUrl = 'embedded://whatsapp-web';
      if (!apiKey) apiKey = 'embedded-session-auth';
    }

    try {
      await api('/api/admin/providers', {
        method: 'POST',
        body: JSON.stringify({ name, type, baseUrl, apiKey }),
      });
      providerModal.classList.add('hidden');
      loadProviders();
      loadDashboard();
    } catch (err) {
      providerModalError.textContent = err.message;
      providerModalError.classList.remove('hidden');
    }
  });

  // Channel Form Submit
  channelForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    channelModalError.classList.add('hidden');

    const name = document.getElementById('c-name').value.trim();
    const providerId = channelProviderSelect.value;
    const phoneNumber = document.getElementById('c-phone').value.trim();
    const instanceId = document.getElementById('c-instance').value.trim();
    const isDefault = document.getElementById('c-default').checked;

    try {
      await api('/api/admin/channels', {
        method: 'POST',
        body: JSON.stringify({ name, providerId, phoneNumber, instanceId, isDefault }),
      });
      channelModal.classList.add('hidden');
      loadChannels();
      loadDashboard();
    } catch (err) {
      channelModalError.textContent = err.message;
      channelModalError.classList.remove('hidden');
    }
  });

  // QR Modal & Session Lifecycle
  function stopQrPolling() {
    if (qrPollInterval) {
      clearInterval(qrPollInterval);
      qrPollInterval = null;
    }
  }

  window.openQrModal = async (channelId, channelName) => {
    closeAllDropdowns();
    activeQrChannelId = channelId;
    stopQrPolling();

    qrModalTitle.textContent = '📱 Vincular WhatsApp Web';
    qrModalSubtitle.textContent = `Canal: ${channelName}`;
    qrStatusBadge.className = 'badge badge-muted badge-pulse';
    qrStatusBadge.textContent = 'Iniciando sesión...';

    qrLoader.classList.remove('hidden');
    qrLoaderText.textContent = 'Iniciando socket y generando código QR...';
    qrImageWrapper.classList.add('hidden');
    qrSuccessCard.classList.add('hidden');
    qrLogoutActionBtn.classList.add('hidden');

    qrModal.classList.remove('hidden');

    try {
      // Trigger session start
      await api(`/api/admin/channels/${channelId}/session/start`, { method: 'POST' });
    } catch (err) {
      console.warn('Session start notice:', err.message);
    }

    // Immediately poll and start loop
    await fetchQrStatus(channelId);
    qrPollInterval = setInterval(() => {
      fetchQrStatus(channelId);
    }, 2500);
  };

  async function fetchQrStatus(channelId) {
    if (activeQrChannelId !== channelId) return;

    try {
      const res = await api(`/api/admin/channels/${channelId}/session/qr`);

      if (res.status === 'connected' || res.isConnected) {
        qrStatusBadge.className = 'badge badge-green';
        qrStatusBadge.textContent = '✅ Conectado y Listo';
        qrLoader.classList.add('hidden');
        qrImageWrapper.classList.add('hidden');
        qrSuccessCard.classList.remove('hidden');
        qrConnectedPhone.textContent = res.userPhone ? `+${res.userPhone}` : 'Conexión activa';
        qrLogoutActionBtn.classList.remove('hidden');
        stopQrPolling();

        // Refresh main lists
        loadChannels();
        loadDashboard();
      } else if (res.status === 'qr_ready' && res.qrDataUrl) {
        qrStatusBadge.className = 'badge badge-yellow badge-pulse';
        qrStatusBadge.textContent = 'Esperando escaneo con tu teléfono...';
        qrLoader.classList.add('hidden');
        qrSuccessCard.classList.add('hidden');
        qrImage.src = res.qrDataUrl;
        qrImageWrapper.classList.remove('hidden');
        qrLogoutActionBtn.classList.add('hidden');
      } else if (res.status === 'connecting') {
        qrStatusBadge.className = 'badge badge-blue badge-pulse';
        qrStatusBadge.textContent = 'Autenticando vinculación...';
        qrLoader.classList.remove('hidden');
        qrLoaderText.textContent = 'Vinculando dispositivo con WhatsApp...';
        qrImageWrapper.classList.add('hidden');
        qrSuccessCard.classList.add('hidden');
      } else if (res.status === 'disconnected') {
        qrStatusBadge.className = 'badge badge-muted';
        qrStatusBadge.textContent = 'Sesión desconectada';
        qrLoader.classList.remove('hidden');
        qrLoaderText.textContent = 'Sesión cerrada o desconectada. Pulsa "Regenerar QR" para vincular.';
        qrImageWrapper.classList.add('hidden');
        qrSuccessCard.classList.add('hidden');
        qrLogoutActionBtn.classList.add('hidden');
      }
    } catch (err) {
      qrStatusBadge.className = 'badge badge-muted';
      qrStatusBadge.textContent = 'Error consultando estado';
      qrLoaderText.textContent = `Error: ${err.message}`;
    }
  }

  // Retry / Regenerate QR Button
  if (qrRetryActionBtn) {
    qrRetryActionBtn.addEventListener('click', async () => {
      if (!activeQrChannelId) return;
      qrLoader.classList.remove('hidden');
      qrLoaderText.textContent = 'Reiniciando sesión y generando nuevo código QR...';
      qrImageWrapper.classList.add('hidden');
      qrSuccessCard.classList.add('hidden');
      qrStatusBadge.className = 'badge badge-muted badge-pulse';
      qrStatusBadge.textContent = 'Regenerando...';

      try {
        await api(`/api/admin/channels/${activeQrChannelId}/session/start`, {
          method: 'POST',
          body: JSON.stringify({ forceNew: true }),
        });
        stopQrPolling();
        await fetchQrStatus(activeQrChannelId);
        qrPollInterval = setInterval(() => {
          fetchQrStatus(activeQrChannelId);
        }, 2500);
      } catch (err) {
        alert(`Error al reiniciar sesión: ${err.message}`);
      }
    });
  }

  // Disconnect / Logout Action Button
  if (qrLogoutActionBtn) {
    qrLogoutActionBtn.addEventListener('click', async () => {
      if (!activeQrChannelId) return;
      if (!confirm('¿Estás seguro de desconectar y cerrar la sesión de WhatsApp para esta línea?')) return;

      try {
        await api(`/api/admin/channels/${activeQrChannelId}/session/logout`, { method: 'POST' });
        alert('Sesión de WhatsApp cerrada exitosamente.');
        stopQrPolling();
        qrSuccessCard.classList.add('hidden');
        qrLogoutActionBtn.classList.add('hidden');
        qrLoader.classList.remove('hidden');
        qrLoaderText.textContent = 'Sesión cerrada. Pulsa "Regenerar QR" para volver a vincular.';
        qrStatusBadge.className = 'badge badge-muted';
        qrStatusBadge.textContent = 'Desconectado';
        loadChannels();
        loadDashboard();
      } catch (err) {
        alert(`Error al cerrar sesión: ${err.message}`);
      }
    });
  }

  // Global Actions
  window.testProvider = async (id) => {
    try {
      const res = await api(`/api/admin/providers/${id}/test`, { method: 'POST' });
      alert(res.message || 'Prueba exitosa');
    } catch (err) {
      alert(`Error en prueba: ${err.message}`);
    }
  };

  window.deleteProvider = async (id) => {
    if (!confirm('¿Estás seguro de desactivar este proveedor?')) return;
    try {
      await api(`/api/admin/providers/${id}`, { method: 'DELETE' });
      loadProviders();
      loadDashboard();
    } catch (err) {
      alert(err.message);
    }
  };

  window.setDefaultChannel = async (id) => {
    try {
      await api(`/api/admin/channels/${id}/set-default`, { method: 'POST' });
      loadChannels();
      loadDashboard();
    } catch (err) {
      alert(err.message);
    }
  };

  window.deleteChannel = async (id) => {
    if (!confirm('¿Estás seguro de desactivar este canal?')) return;
    try {
      await api(`/api/admin/channels/${id}`, { method: 'DELETE' });
      loadChannels();
      loadDashboard();
    } catch (err) {
      alert(err.message);
    }
  };

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ── TRIGGERS & WEBHOOKS MODULE ──────────────────────────────────────────
  let cachedTriggers = [];
  let activeDeliveriesTriggerId = null;

  const triggersTableBody = document.getElementById('triggers-table-body');
  const refreshTriggersBtn = document.getElementById('refresh-triggers-btn');
  const openTriggerModalBtn = document.getElementById('open-trigger-modal-btn');
  const triggerModal = document.getElementById('trigger-modal');
  const triggerForm = document.getElementById('trigger-form');
  const triggerModalTitle = document.getElementById('trigger-modal-title');
  const trigIdInput = document.getElementById('trig-id');
  const trigNameInput = document.getElementById('trig-name');
  const trigChannelSelect = document.getElementById('trig-channel');
  const trigUrlInput = document.getElementById('trig-url');
  const trigMethodSelect = document.getElementById('trig-method');
  const trigHeadersInput = document.getElementById('trig-headers');
  const trigCustomTemplateSection = document.getElementById('trig-custom-template-section');
  const trigTemplateInput = document.getElementById('trig-template');
  const trigFilterTypeSelect = document.getElementById('trig-filter-type');
  const trigFilterKeywordInput = document.getElementById('trig-filter-keyword');
  const trigIgnoreGroupsCheckbox = document.getElementById('trig-ignore-groups');
  const trigTimeoutInput = document.getElementById('trig-timeout');
  const trigRetriesInput = document.getElementById('trig-retries');
  const trigDelayInput = document.getElementById('trig-delay');
  const trigSecretInput = document.getElementById('trig-secret');
  const trigModalAlert = document.getElementById('trig-modal-alert');
  const trigSaveBtn = document.getElementById('trig-save-btn');

  const triggerTestModal = document.getElementById('trigger-test-modal');
  const testResultLoader = document.getElementById('test-result-loader');
  const testResultContent = document.getElementById('test-result-content');
  const testResStatus = document.getElementById('test-res-status');
  const testResDuration = document.getElementById('test-res-duration');
  const testResPayload = document.getElementById('test-res-payload');
  const testResBody = document.getElementById('test-res-body');

  const triggerDeliveriesModal = document.getElementById('trigger-deliveries-modal');
  const deliveriesModalTitle = document.getElementById('deliveries-modal-title');
  const deliveriesTableBody = document.getElementById('deliveries-table-body');
  const delivPendingCount = document.getElementById('deliv-pending-count');
  const delivOkCount = document.getElementById('deliv-ok-count');
  const delivFailedCount = document.getElementById('deliv-failed-count');
  const retryAllFailedBtn = document.getElementById('retry-all-failed-btn');

  // Mode radio change
  document.querySelectorAll('input[name="trig-mode"]').forEach((radio) => {
    radio.addEventListener('change', (e) => {
      if (e.target.value === 'custom') {
        trigCustomTemplateSection.classList.remove('hidden');
      } else {
        trigCustomTemplateSection.classList.add('hidden');
      }
    });
  });

  // Variable Chips click handler
  document.querySelectorAll('.var-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const varText = chip.getAttribute('data-var');
      const start = trigTemplateInput.selectionStart || 0;
      const end = trigTemplateInput.selectionEnd || 0;
      const text = trigTemplateInput.value;
      trigTemplateInput.value = text.substring(0, start) + varText + text.substring(end);
      trigTemplateInput.focus();
      trigTemplateInput.selectionStart = trigTemplateInput.selectionEnd = start + varText.length;
    });
  });

  // Quick Template buttons
  const tplBtnCrm = document.getElementById('tpl-btn-crm');
  const tplBtnSlack = document.getElementById('tpl-btn-slack');
  const tplBtnClean = document.getElementById('tpl-btn-clean');

  if (tplBtnCrm) {
    tplBtnCrm.addEventListener('click', () => {
      trigTemplateInput.value = JSON.stringify({
        source: "WhatsApp - {{channel.name}}",
        phone: "{{sender.phoneNumber}}",
        name: "{{sender.name}}",
        message: "{{message.text}}",
        received_at: "{{message.timestampISO}}"
      }, null, 2);
    });
  }

  if (tplBtnSlack) {
    tplBtnSlack.addEventListener('click', () => {
      trigTemplateInput.value = JSON.stringify({
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "*Nuevo Mensaje WhatsApp:* {{sender.name}} ({{sender.phoneNumber}})"
            }
          },
          {
            type: "section",
            text: {
              type: "plain_text",
              text: "{{message.text}}"
            }
          }
        ]
      }, null, 2);
    });
  }

  if (tplBtnClean) {
    tplBtnClean.addEventListener('click', () => {
      trigTemplateInput.value = '{\n  \n}';
    });
  }

  async function loadTriggers() {
    if (!triggersTableBody) return;
    try {
      const triggers = await api('/api/admin/triggers');
      cachedTriggers = triggers;
      renderTriggers();
    } catch (err) {
      triggersTableBody.innerHTML = `<tr><td colspan="8" class="text-center text-danger">Error: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  function renderTriggers() {
    if (!triggersTableBody) return;
    if (cachedTriggers.length === 0) {
      triggersTableBody.innerHTML = `<tr><td colspan="8" class="text-center text-muted" style="padding: 2.5rem 1rem;">
        No hay disparadores configurados.<br>
        <button class="btn btn-primary btn-sm mt-2" onclick="window.openTriggerModal()">+ Crear el Primer Disparador</button>
      </td></tr>`;
      return;
    }

    triggersTableBody.innerHTML = cachedTriggers.map((t) => {
      const channelObj = cachedChannels.find((c) => c.id === t.channelId);
      const channelLabel = t.channelId ? (channelObj ? channelObj.name : t.channelId) : '⚡ Todos (Global)';
      const isCustom = t.payloadMode === 'custom';
      const stats = t.stats || { pending: 0, delivered: 0, failed: 0 };

      return `
        <tr>
          <td><strong>${escapeHtml(t.name)}</strong></td>
          <td><span class="badge ${t.channelId ? 'badge-yellow' : 'badge-green'}">${escapeHtml(channelLabel)}</span></td>
          <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            <code>${escapeHtml(t.targetUrl)}</code>
          </td>
          <td><span class="badge badge-gray">${escapeHtml(t.targetMethod)}</span></td>
          <td><span class="badge ${isCustom ? 'badge-yellow' : 'badge-green'}">${isCustom ? 'Personalizado' : 'Estándar'}</span></td>
          <td>
            <span class="badge badge-green">${stats.delivered} OK</span>
            ${stats.failed > 0 ? `<span class="badge badge-red">${stats.failed} Fallos</span>` : ''}
            ${stats.pending > 0 ? `<span class="badge badge-yellow">${stats.pending} Pend.</span>` : ''}
          </td>
          <td>
            <label style="cursor: pointer; display: flex; align-items: center; gap: 0.35rem;">
              <input type="checkbox" ${t.isActive ? 'checked' : ''} onchange="window.toggleTriggerActive('${t.id}', this.checked)">
              <small>${t.isActive ? 'Activo' : 'Pausa'}</small>
            </label>
          </td>
          <td>
            <div style="display: flex; gap: 0.35rem; align-items: center;">
              <button type="button" class="btn btn-secondary btn-xs" onclick="window.testTrigger('${t.id}')" title="Probar con datos simulados">⚡ Probar</button>
              <button type="button" class="btn btn-secondary btn-xs" onclick="window.openDeliveries('${t.id}')" title="Ver historial de entregas">📋 Entregas</button>
              <button type="button" class="btn btn-secondary btn-xs" onclick="window.openTriggerModal('${t.id}')" title="Editar">✏</button>
              <button type="button" class="btn btn-danger btn-xs" onclick="window.deleteTrigger('${t.id}')" title="Eliminar">🗑</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  window.openTriggerModal = (triggerId = null) => {
    trigModalAlert.classList.add('hidden');
    trigIdInput.value = triggerId || '';

    // Populate channels dropdown
    trigChannelSelect.innerHTML = `<option value="">⚡ Todos los canales (Global)</option>` +
      cachedChannels.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)} (${escapeHtml(c.phoneNumber || 'Sin número')})</option>`).join('');

    if (triggerId) {
      const t = cachedTriggers.find((item) => item.id === triggerId);
      if (!t) return;
      triggerModalTitle.textContent = '✏ Editar Disparador (Webhook)';
      trigNameInput.value = t.name;
      trigChannelSelect.value = t.channelId || '';
      trigUrlInput.value = t.targetUrl;
      trigMethodSelect.value = t.targetMethod || 'POST';
      trigHeadersInput.value = JSON.stringify(t.targetHeaders || { 'Content-Type': 'application/json' }, null, 2);

      const isCustom = t.payloadMode === 'custom';
      document.querySelector(`input[name="trig-mode"][value="${isCustom ? 'custom' : 'standard'}"]`).checked = true;
      if (isCustom) {
        trigCustomTemplateSection.classList.remove('hidden');
        trigTemplateInput.value = JSON.stringify(t.payloadTemplate || {}, null, 2);
      } else {
        trigCustomTemplateSection.classList.add('hidden');
        trigTemplateInput.value = '';
      }

      trigFilterTypeSelect.value = t.filterMessageType || 'all';
      trigFilterKeywordInput.value = t.filterKeyword || '';
      trigIgnoreGroupsCheckbox.checked = t.filterIgnoreGroups !== false;
      trigTimeoutInput.value = t.timeoutMs || 5000;
      trigRetriesInput.value = t.maxRetries ?? 3;
      trigDelayInput.value = t.retryDelayMs || 10000;
      trigSecretInput.value = t.secretToken || '';
    } else {
      triggerModalTitle.textContent = '⚡ Configurar Disparador (Webhook)';
      trigNameInput.value = '';
      trigChannelSelect.value = '';
      trigUrlInput.value = '';
      trigMethodSelect.value = 'POST';
      trigHeadersInput.value = '{\n  "Content-Type": "application/json"\n}';
      document.querySelector('input[name="trig-mode"][value="standard"]').checked = true;
      trigCustomTemplateSection.classList.add('hidden');
      trigTemplateInput.value = '';
      trigFilterTypeSelect.value = 'all';
      trigFilterKeywordInput.value = '';
      trigIgnoreGroupsCheckbox.checked = true;
      trigTimeoutInput.value = 5000;
      trigRetriesInput.value = 3;
      trigDelayInput.value = 10000;
      trigSecretInput.value = '';
    }

    triggerModal.classList.remove('hidden');
  };

  if (openTriggerModalBtn) {
    openTriggerModalBtn.addEventListener('click', () => window.openTriggerModal());
  }
  if (refreshTriggersBtn) {
    refreshTriggersBtn.addEventListener('click', loadTriggers);
  }

  if (triggerForm) {
    triggerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      trigModalAlert.classList.add('hidden');
      trigSaveBtn.disabled = true;

      try {
        const id = trigIdInput.value;
        const mode = document.querySelector('input[name="trig-mode"]:checked')?.value || 'standard';

        let targetHeaders = {};
        if (trigHeadersInput.value.trim()) {
          try {
            targetHeaders = JSON.parse(trigHeadersInput.value.trim());
          } catch {
            throw new Error('El campo Cabeceras HTTP no contiene un JSON válido');
          }
        }

        let payloadTemplate = {};
        if (mode === 'custom' && trigTemplateInput.value.trim()) {
          try {
            payloadTemplate = JSON.parse(trigTemplateInput.value.trim());
          } catch {
            throw new Error('La plantilla de Carga Útil no contiene un JSON válido');
          }
        }

        const body = {
          name: trigNameInput.value.trim(),
          channelId: trigChannelSelect.value || null,
          targetUrl: trigUrlInput.value.trim(),
          targetMethod: trigMethodSelect.value,
          targetHeaders,
          payloadMode: mode,
          payloadTemplate,
          filterMessageType: trigFilterTypeSelect.value,
          filterKeyword: trigFilterKeywordInput.value.trim() || null,
          filterIgnoreGroups: trigIgnoreGroupsCheckbox.checked,
          timeoutMs: Number(trigTimeoutInput.value) || 5000,
          maxRetries: Number(trigRetriesInput.value) >= 0 ? Number(trigRetriesInput.value) : 3,
          retryDelayMs: Number(trigDelayInput.value) || 10000,
          secretToken: trigSecretInput.value.trim() || null,
        };

        if (id) {
          await api(`/api/admin/triggers/${id}`, { method: 'PUT', body: JSON.stringify(body) });
        } else {
          await api('/api/admin/triggers', { method: 'POST', body: JSON.stringify(body) });
        }

        triggerModal.classList.add('hidden');
        loadTriggers();
      } catch (err) {
        trigModalAlert.textContent = err.message;
        trigModalAlert.className = 'alert error';
        trigModalAlert.classList.remove('hidden');
      } finally {
        trigSaveBtn.disabled = false;
      }
    });
  }

  window.toggleTriggerActive = async (id, isActive) => {
    try {
      await api(`/api/admin/triggers/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ isActive }),
      });
      loadTriggers();
    } catch (err) {
      alert(err.message);
      loadTriggers();
    }
  };

  window.deleteTrigger = async (id) => {
    if (!confirm('¿Estás seguro de eliminar este disparador y su cola de entregas?')) return;
    try {
      await api(`/api/admin/triggers/${id}`, { method: 'DELETE' });
      loadTriggers();
    } catch (err) {
      alert(err.message);
    }
  };

  window.testTrigger = async (id) => {
    triggerTestModal.classList.remove('hidden');
    testResultLoader.classList.remove('hidden');
    testResultContent.classList.add('hidden');

    try {
      const res = await api(`/api/admin/triggers/${id}/test`, { method: 'POST' });
      testResultLoader.classList.add('hidden');
      testResultContent.classList.remove('hidden');

      const isSuccess = res.success;
      testResStatus.textContent = res.statusCode ? `HTTP ${res.statusCode}` : 'Error de Conexión';
      testResStatus.className = `stat-value ${isSuccess ? 'text-green' : 'text-danger'}`;
      testResDuration.textContent = `${res.durationMs} ms`;
      testResPayload.textContent = JSON.stringify(res.payloadSent, null, 2);
      testResBody.textContent = res.responseBody || (res.error ? `Error: ${res.error}` : '(Cuerpo de respuesta vacío)');
    } catch (err) {
      testResultLoader.classList.add('hidden');
      testResultContent.classList.remove('hidden');
      testResStatus.textContent = 'Error';
      testResStatus.className = 'stat-value text-danger';
      testResDuration.textContent = '0 ms';
      testResPayload.textContent = '-';
      testResBody.textContent = err.message;
    }
  };

  window.openDeliveries = async (triggerId) => {
    activeDeliveriesTriggerId = triggerId;
    const t = cachedTriggers.find((item) => item.id === triggerId);
    deliveriesModalTitle.textContent = `📋 Entregas: ${t ? t.name : triggerId}`;
    triggerDeliveriesModal.classList.remove('hidden');
    deliveriesTableBody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">Cargando entregas...</td></tr>';
    loadDeliveries(triggerId);
  };

  async function loadDeliveries(triggerId) {
    try {
      const deliveries = await api(`/api/admin/triggers/${triggerId}/deliveries`);
      const pending = deliveries.filter((d) => d.status === 'pending').length;
      const delivered = deliveries.filter((d) => d.status === 'delivered').length;
      const failed = deliveries.filter((d) => d.status === 'failed').length;

      delivPendingCount.textContent = `${pending} Pendientes`;
      delivOkCount.textContent = `${delivered} Entregadas`;
      delivFailedCount.textContent = `${failed} Fallidas`;

      if (deliveries.length === 0) {
        deliveriesTableBody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">Aún no se han registrado eventos o entregas para este disparador.</td></tr>';
        return;
      }

      deliveriesTableBody.innerHTML = deliveries.map((d) => {
        let statusBadge = `<span class="badge badge-yellow">Pendiente</span>`;
        if (d.status === 'delivered') statusBadge = `<span class="badge badge-green">Entregada</span>`;
        if (d.status === 'failed') statusBadge = `<span class="badge badge-red">Fallida</span>`;

        return `
          <tr>
            <td>${statusBadge}</td>
            <td><small>${escapeHtml(new Date(d.createdAt).toLocaleString())}</small></td>
            <td>${d.attempts} / ${d.maxRetries}</td>
            <td><code>${d.lastStatusCode ? `HTTP ${d.lastStatusCode}` : '-'}</code></td>
            <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(d.lastError || '')}">
              <small class="text-muted">${escapeHtml(d.lastError || '-')}</small>
            </td>
            <td>
              ${d.status !== 'delivered' ? `<button type="button" class="btn btn-secondary btn-xs" onclick="window.retrySingleDelivery('${d.id}')">↻ Reintentar</button>` : '-'}
            </td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      deliveriesTableBody.innerHTML = `<tr><td colspan="6" class="text-center text-danger">Error: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  if (retryAllFailedBtn) {
    retryAllFailedBtn.addEventListener('click', async () => {
      if (!activeDeliveriesTriggerId) return;
      try {
        const res = await api(`/api/admin/triggers/${activeDeliveriesTriggerId}/retry-failed`, { method: 'POST' });
        alert(res.message || 'Entregas fallidas reencoladas para reintento');
        loadDeliveries(activeDeliveriesTriggerId);
        loadTriggers();
      } catch (err) {
        alert(err.message);
      }
    });
  }

  window.retrySingleDelivery = async (deliveryId) => {
    try {
      await api(`/api/admin/triggers/deliveries/${deliveryId}/retry`, { method: 'POST' });
      if (activeDeliveriesTriggerId) {
        loadDeliveries(activeDeliveriesTriggerId);
      }
      loadTriggers();
    } catch (err) {
      alert(err.message);
    }
  };

  // Check initial state
  if (token) {
    initApp();
  } else {
    handleLogout();
  }
})();

