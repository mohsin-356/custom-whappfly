/* ═══════════════════════════════════════════════════
   WhatsBridge Dashboard — Client App
   ═══════════════════════════════════════════════════ */

'use strict';

// ── State ──────────────────────────────────────────
const state = {
  token: localStorage.getItem('wb_token'),
  apiKey: null,
  currentSession: localStorage.getItem('wb_session') || null,
  socket: null,
  sessions: [],
  webhookPage: 1,
  eventLogPage: 1,
  apiKeyVisible: false,
};

// ── Bootstrap ──────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  updateClock();
  setInterval(updateClock, 1000);

  if (state.token) {
    showApp();
  } else {
    document.getElementById('login-screen').style.display = 'flex';
  }

  document.getElementById('login-form').addEventListener('submit', handleLogin);
});

// ── Clock ───────────────────────────────────────────
function updateClock() {
  const el = document.getElementById('topbar-time');
  if (el) el.textContent = new Date().toLocaleTimeString();
}

// ── Auth ───────────────────────────────────────────
async function handleLogin(e) {
  e.preventDefault();
  const password = document.getElementById('login-password').value;
  const btn = document.getElementById('login-btn');
  btn.disabled = true;
  btn.querySelector('span').textContent = 'Signing in…';

  try {
    const res = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
      skipAuth: true,
    });

    if (res.success) {
      state.token = res.token;
      localStorage.setItem('wb_token', res.token);
      document.getElementById('login-screen').style.display = 'none';
      showApp();
    } else {
      showLoginError(res.message || 'Login failed');
    }
  } catch (err) {
    showLoginError('Connection error. Is the server running?');
  } finally {
    btn.disabled = false;
    btn.querySelector('span').textContent = 'Sign In';
  }
}

function showLoginError(msg) {
  const el = document.getElementById('login-error');
  el.textContent = msg;
  el.style.display = 'block';
}

function handleLogout() {
  state.token = null;
  localStorage.removeItem('wb_token');
  localStorage.removeItem('wb_session');
  if (state.socket) state.socket.disconnect();
  document.getElementById('app').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('login-password').value = '';
  document.getElementById('login-error').style.display = 'none';
}

// ── App Init ────────────────────────────────────────
async function showApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';

  setupNavigation();
  await loadSessions();
  loadSystemStatus();

  // Get API key for display
  try {
    const res = await apiFetch('/api/status', { skipAuth: true });
    if (!res.success) {
      // Token might be expired
      handleLogout();
    }
  } catch (_) {}

  // Show API key from env (fetched from server)
  document.getElementById('settings-api-key').value = '(check your .env API_KEY)';

  // Connect Socket.io
  connectSocket();

  // Navigate to last page
  const savedPage = localStorage.getItem('wb_page') || 'overview';
  navigateTo(savedPage);

  // Restore last session
  if (state.currentSession) {
    document.getElementById('session-selector').value = state.currentSession;
    await selectSession(state.currentSession);
  }
}

// ── Navigation ──────────────────────────────────────
function setupNavigation() {
  document.querySelectorAll('.nav-item').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      navigateTo(link.dataset.page);
    });
  });
}

function navigateTo(page) {
  document.querySelectorAll('.nav-item').forEach((l) => l.classList.remove('active'));
  document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));

  const navLink = document.querySelector(`[data-page="${page}"]`);
  const pageEl = document.getElementById(`page-${page}`);

  if (navLink) navLink.classList.add('active');
  if (pageEl) pageEl.classList.add('active');

  localStorage.setItem('wb_page', page);

  // Lazy load data for pages
  if (page === 'webhook' && state.currentSession) loadWebhookConfig();
  if (page === 'logs' && state.currentSession) loadEventLogs();
  if (page === 'sessions') renderSessionsTable();
  if (page === 'settings') loadSystemStatus();
}

// ── Socket.io ───────────────────────────────────────
function connectSocket() {
  state.socket = io({ auth: { token: state.token } });

  state.socket.on('connect', () => {
    console.log('[Socket] Connected:', state.socket.id);
    if (state.currentSession) {
      state.socket.emit('join_session', state.currentSession);
    }
  });

  state.socket.on('disconnect', () => {
    console.log('[Socket] Disconnected');
  });

  state.socket.on('status', (data) => {
    if (data.sessionId === state.currentSession) {
      updateConnectionStatus(data.status, data.info);
    }
    // Refresh sessions list
    loadSessions(false);
  });

  state.socket.on('qr', (data) => {
    if (data.sessionId === state.currentSession) {
      showQR(data.qr);
    }
  });

  state.socket.on('message', (data) => {
    if (data.sessionId === state.currentSession) {
      appendLiveLog('info', `↓ ${data.event} from ${data.senderName || data.chatId}`);
    }
  });

  state.socket.on('log', (data) => {
    if (data.sessionId === state.currentSession) {
      appendLiveLog(data.level, data.message);
    }
  });

  state.socket.on('metrics', (data) => {
    if (data.sessionId === state.currentSession) {
      updateMetrics(data.metrics);
    }
  });

  state.socket.on('group.update', (data) => {
    if (data.sessionId === state.currentSession) {
      appendLiveLog('info', `↓ group.update: ${data.groupName || data.groupId}`);
    }
  });
}

// ── Sessions ────────────────────────────────────────
async function loadSessions(updateSelector = true) {
  try {
    const res = await apiFetch('/api/sessions');
    if (!res.success) return;

    state.sessions = res.sessions || [];

    if (updateSelector) {
      const sel = document.getElementById('session-selector');
      const current = sel.value;
      sel.innerHTML = '<option value="">Select a session…</option>';
      for (const s of state.sessions) {
        const opt = document.createElement('option');
        opt.value = s.sessionId;
        opt.textContent = `${s.label || s.sessionId} — ${s.runtimeStatus || s.status}`;
        if (s.sessionId === current) opt.selected = true;
        sel.appendChild(opt);
      }
    }

    renderSessionsTable();
  } catch (err) {
    console.error('loadSessions error:', err);
  }
}

function renderSessionsTable() {
  const tbody = document.getElementById('sessions-tbody');
  if (!tbody) return;

  if (state.sessions.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No sessions yet. Click "+ New Session" to get started.</td></tr>';
    return;
  }

  tbody.innerHTML = state.sessions.map((s) => `
    <tr>
      <td>${s.label || '—'}</td>
      <td class="mono">${s.sessionId}</td>
      <td>${s.phone || '—'}</td>
      <td><span class="tag ${statusTag(s.runtimeStatus || s.status)}">${s.runtimeStatus || s.status}</span></td>
      <td>${s.connectedAt ? new Date(s.connectedAt).toLocaleString() : '—'}</td>
      <td>
        <div style="display:flex;gap:4px">
          <button class="btn btn-ghost btn-sm" onclick="selectSession('${s.sessionId}')">Select</button>
          <button class="btn btn-secondary btn-sm" onclick="reconnectSession('${s.sessionId}')">Reconnect</button>
          <button class="btn btn-danger btn-sm" onclick="confirmDeleteSession('${s.sessionId}')">Delete</button>
        </div>
      </td>
    </tr>
  `).join('');
}

async function onSessionChange(sessionId) {
  if (!sessionId) return;
  await selectSession(sessionId);
}

async function selectSession(sessionId) {
  state.currentSession = sessionId;
  localStorage.setItem('wb_session', sessionId);

  // Join socket room
  if (state.socket) {
    state.socket.emit('join_session', sessionId);
  }

  // Update info panel
  document.getElementById('info-session-id').textContent = sessionId;
  document.getElementById('session-selector').value = sessionId;

  // Fetch latest status
  try {
    const res = await apiFetch(`/api/sessions/${sessionId}/status`);
    if (res.success) {
      updateConnectionStatus(res.status, res.info);
      if (res.qr) showQR(res.qr);
      document.getElementById('info-connected-at').textContent =
        res.connectedAt ? new Date(res.connectedAt).toLocaleString() : '—';
      document.getElementById('info-last-seen').textContent =
        res.lastSeenAt ? new Date(res.lastSeenAt).toLocaleString() : '—';
    }
  } catch (_) {}

  // Load webhook info
  loadWebhookConfig(false);
  clearLiveLog();

  // Refresh page-specific data
  const activePage = document.querySelector('.page.active')?.id?.replace('page-', '');
  if (activePage === 'webhook') loadWebhookConfig();
  if (activePage === 'logs') loadEventLogs();
}

function updateConnectionStatus(status, info) {
  const badge = document.getElementById('global-status-badge');
  const text = document.getElementById('global-status-text');
  const label = document.getElementById('connection-status-label');

  badge.className = `status-badge status-${status}`;
  text.textContent = statusLabel(status);
  label.textContent = statusLabel(status);
  label.className = `tag ${statusTag(status)}`;

  document.getElementById('info-status').innerHTML = `<span class="tag ${statusTag(status)}">${statusLabel(status)}</span>`;

  const isConnected = status === 'connected';
  const isQrReady = status === 'qr_ready';

  // Show/hide QR vs connected info
  document.getElementById('qr-image').style.display = isQrReady ? 'block' : 'none';
  document.getElementById('connected-info').style.display = isConnected ? 'flex' : 'none';
  if (!isQrReady && !isConnected) {
    document.querySelector('.qr-placeholder').style.display = 'flex';
    document.getElementById('qr-image').style.display = 'none';
  } else {
    document.querySelector('.qr-placeholder').style.display = 'none';
  }

  // Action buttons
  document.getElementById('btn-connect').style.display = !isConnected ? 'inline-flex' : 'none';
  document.getElementById('btn-disconnect').style.display = isConnected ? 'inline-flex' : 'none';

  if (info) {
    document.getElementById('info-phone').textContent = info.phone || '—';
    document.getElementById('info-name').textContent = info.name || '—';
    document.getElementById('connected-name').textContent = info.name || '—';
    document.getElementById('connected-phone').textContent = info.phone || '—';
  }
}

function showQR(qrDataUrl) {
  const img = document.getElementById('qr-image');
  const placeholder = document.querySelector('.qr-placeholder');
  const connInfo = document.getElementById('connected-info');

  img.src = qrDataUrl;
  img.style.display = 'block';
  placeholder.style.display = 'none';
  connInfo.style.display = 'none';
}

// ── Session Actions ──────────────────────────────────
async function connectSession() {
  if (!state.currentSession) return showToast('warn', 'Select a session first');
  try {
    const res = await apiFetch(`/api/sessions/${state.currentSession}/connect`, { method: 'POST' });
    showToast(res.success ? 'success' : 'error', res.message);
  } catch (err) {
    showToast('error', err.message);
  }
}

async function disconnectSession() {
  if (!state.currentSession) return;
  try {
    const res = await apiFetch(`/api/sessions/${state.currentSession}/disconnect`, { method: 'POST' });
    showToast(res.success ? 'success' : 'error', res.message);
  } catch (err) {
    showToast('error', err.message);
  }
}

async function restartSession() {
  if (!state.currentSession) return showToast('warn', 'Select a session first');
  try {
    const res = await apiFetch(`/api/sessions/${state.currentSession}/restart`, { method: 'POST' });
    showToast(res.success ? 'success' : 'error', res.message);
  } catch (err) {
    showToast('error', err.message);
  }
}

async function logoutSession() {
  if (!state.currentSession) return;
  if (!confirm('Logout from WhatsApp? You will need to scan a new QR.')) return;
  try {
    const res = await apiFetch(`/api/sessions/${state.currentSession}/logout`, { method: 'POST' });
    showToast(res.success ? 'success' : 'error', res.message);
  } catch (err) {
    showToast('error', err.message);
  }
}

async function reconnectSession(sessionId) {
  try {
    const res = await apiFetch(`/api/sessions/${sessionId}/connect`, { method: 'POST' });
    showToast(res.success ? 'success' : 'error', res.message);
    if (res.success) {
      await selectSession(sessionId);
      navigateTo('overview');
    }
  } catch (err) {
    showToast('error', err.message);
  }
}

async function confirmDeleteSession(sessionId) {
  if (!confirm(`Delete session "${sessionId}"? This will permanently remove all auth files.`)) return;
  try {
    const res = await apiFetch(`/api/sessions/${sessionId}`, { method: 'DELETE' });
    showToast(res.success ? 'success' : 'error', res.message);
    if (res.success) {
      if (state.currentSession === sessionId) {
        state.currentSession = null;
        localStorage.removeItem('wb_session');
      }
      await loadSessions();
    }
  } catch (err) {
    showToast('error', err.message);
  }
}

// ── New Session Modal ────────────────────────────────
function showNewSessionModal() {
  document.getElementById('modal-new-session').style.display = 'flex';
  document.getElementById('new-session-label').value = '';
  document.getElementById('new-session-id').value = '';
  document.getElementById('new-session-label').focus();
}

function closeModal(id) {
  document.getElementById(id).style.display = 'none';
}

async function createSession() {
  const label = document.getElementById('new-session-label').value.trim();
  const sessionId = document.getElementById('new-session-id').value.trim();

  try {
    const body = {};
    if (label) body.label = label;
    if (sessionId) body.sessionId = sessionId;

    const res = await apiFetch('/api/sessions', { method: 'POST', body: JSON.stringify(body) });
    closeModal('modal-new-session');

    if (res.success) {
      showToast('success', `Session created: ${res.sessionId}`);
      await loadSessions();
      await selectSession(res.sessionId);
      navigateTo('overview');
    } else {
      showToast('error', res.message);
    }
  } catch (err) {
    showToast('error', err.message);
  }
}

// ── Webhook ─────────────────────────────────────────
async function loadWebhookConfig(updateStats = true) {
  if (!state.currentSession) return;
  try {
    const res = await apiFetch(`/api/sessions/${state.currentSession}/webhook`);
    if (!res.success) return;

    const wh = res.webhook;
    document.getElementById('wh-test-url').value = wh.testUrl || '';
    document.getElementById('wh-prod-url').value = wh.productionUrl || '';
    document.getElementById('wh-mode').value = wh.mode || 'testing';
    document.getElementById('wh-enabled').checked = wh.enabled !== false;
    document.getElementById('wh-secret').value = '';

    document.getElementById('wh-mode-badge').textContent = wh.mode;
    document.getElementById('wh-mode-badge').className = `tag ${wh.mode === 'production' ? 'tag-green' : 'tag-blue'}`;

    // Update overview info
    document.getElementById('info-webhook-mode').textContent = wh.mode;
    document.getElementById('info-webhook-url').textContent = wh.activeUrl || '—';

    if (updateStats && wh.stats) {
      document.getElementById('wh-stat-sent').textContent = wh.stats.totalSent;
      document.getElementById('wh-stat-failed').textContent = wh.stats.totalFailed;
      document.getElementById('wh-stat-last').textContent = wh.stats.lastCalledAt
        ? new Date(wh.stats.lastCalledAt).toLocaleTimeString() : '—';
      document.getElementById('wh-stat-last-success').textContent = wh.stats.lastSuccessAt
        ? new Date(wh.stats.lastSuccessAt).toLocaleTimeString() : '—';
    }

    loadWebhookLogs();
  } catch (_) {}
}

async function saveWebhook() {
  if (!state.currentSession) return showToast('warn', 'Select a session first');
  const body = {
    testUrl: document.getElementById('wh-test-url').value.trim() || null,
    productionUrl: document.getElementById('wh-prod-url').value.trim() || null,
    mode: document.getElementById('wh-mode').value,
    enabled: document.getElementById('wh-enabled').checked,
  };
  const secret = document.getElementById('wh-secret').value.trim();
  if (secret) body.secret = secret;

  try {
    const res = await apiFetch(`/api/sessions/${state.currentSession}/webhook`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    showToast(res.success ? 'success' : 'error', res.success ? 'Webhook saved' : res.message);
    if (res.success) loadWebhookConfig();
  } catch (err) {
    showToast('error', err.message);
  }
}

async function deleteWebhook() {
  if (!state.currentSession) return;
  if (!confirm('Delete webhook configuration?')) return;
  try {
    const res = await apiFetch(`/api/sessions/${state.currentSession}/webhook`, { method: 'DELETE' });
    showToast(res.success ? 'success' : 'error', res.message);
    if (res.success) loadWebhookConfig();
  } catch (err) {
    showToast('error', err.message);
  }
}

async function testWebhookUrl(type) {
  const url = type === 'test'
    ? document.getElementById('wh-test-url').value.trim()
    : document.getElementById('wh-prod-url').value.trim();

  if (!url) return showToast('warn', 'Enter a URL first');
  if (!state.currentSession) return showToast('warn', 'Select a session first');

  showToast('info', 'Testing webhook…');
  try {
    const res = await apiFetch(`/api/sessions/${state.currentSession}/webhook/test`, {
      method: 'POST',
      body: JSON.stringify({ url }),
    });
    showToast(res.success ? 'success' : 'error', `${res.message} (${res.responseTime}ms)`);
  } catch (err) {
    showToast('error', err.message);
  }
}

async function loadWebhookLogs() {
  if (!state.currentSession) return;
  const filter = document.getElementById('wh-log-filter')?.value;
  const params = new URLSearchParams({ page: state.webhookPage, limit: 20 });
  if (filter !== undefined && filter !== '') params.append('success', filter);

  try {
    const res = await apiFetch(`/api/sessions/${state.currentSession}/webhook/logs?${params}`);
    if (!res.success) return;

    const tbody = document.getElementById('wh-logs-tbody');
    if (!res.logs.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No webhook logs yet</td></tr>';
      return;
    }

    tbody.innerHTML = res.logs.map((l) => `
      <tr>
        <td>${new Date(l.triggeredAt).toLocaleString()}</td>
        <td>${l.eventType}</td>
        <td><span class="tag ${l.success ? 'tag-green' : 'tag-red'}">${l.statusCode || (l.success ? '2xx' : 'ERR')}</span></td>
        <td>${l.responseTime ? l.responseTime + 'ms' : '—'}</td>
        <td>${l.attempts}</td>
      </tr>
    `).join('');

    renderPagination('wh-logs-pagination', res.total, res.page, res.limit, (p) => {
      state.webhookPage = p;
      loadWebhookLogs();
    });
  } catch (_) {}
}

// ── Event Logs ───────────────────────────────────────
async function loadEventLogs() {
  if (!state.currentSession) return;
  const direction = document.getElementById('log-direction-filter')?.value;
  const params = new URLSearchParams({ page: state.eventLogPage, limit: 50 });
  if (direction) params.append('direction', direction);

  try {
    const res = await apiFetch(`/api/sessions/${state.currentSession}/logs?${params}`);
    if (!res.success) return;

    const tbody = document.getElementById('event-logs-tbody');
    if (!res.logs.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No events logged yet</td></tr>';
      return;
    }

    tbody.innerHTML = res.logs.map((l) => `
      <tr>
        <td>${new Date(l.processedAt).toLocaleString()}</td>
        <td><span class="tag ${l.direction === 'incoming' ? 'tag-green' : 'tag-blue'}">${l.direction}</span></td>
        <td>${l.eventType}</td>
        <td class="mono">${l.chatId ? l.chatId.split('@')[0] : '—'}</td>
        <td>${l.senderNumber || '—'}</td>
        <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${l.summary || '—'}</td>
      </tr>
    `).join('');

    if (res.pagination) {
      renderPagination('event-logs-pagination', res.pagination.total, res.pagination.page, res.pagination.limit, (p) => {
        state.eventLogPage = p;
        loadEventLogs();
      });
    }
  } catch (_) {}
}

// ── System Status ────────────────────────────────────
async function loadSystemStatus() {
  try {
    const res = await apiFetch('/api/status', { skipAuth: false });
    const grid = document.getElementById('system-info-grid');
    if (!res.success || !grid) return;

    grid.innerHTML = `
      <div class="info-item"><span class="info-label">Version</span><span class="info-value">${res.version}</span></div>
      <div class="info-item"><span class="info-label">Status</span><span class="info-value"><span class="tag tag-green">${res.status}</span></span></div>
      <div class="info-item"><span class="info-label">Database</span><span class="info-value"><span class="tag ${res.database === 'connected' ? 'tag-green' : 'tag-red'}">${res.database}</span></span></div>
      <div class="info-item"><span class="info-label">Uptime</span><span class="info-value">${formatUptime(res.uptime)}</span></div>
      <div class="info-item"><span class="info-label">Sessions</span><span class="info-value">${res.sessions.connected}/${res.sessions.total} connected</span></div>
      <div class="info-item"><span class="info-label">Memory</span><span class="info-value">${res.memory.rss}</span></div>
    `;
  } catch (_) {}
}

// ── Metrics ──────────────────────────────────────────
function updateMetrics(metrics) {
  if (!metrics) return;
  document.getElementById('metric-incoming').textContent = metrics.incoming || 0;
  document.getElementById('metric-outgoing').textContent = metrics.outgoing || 0;
  document.getElementById('metric-webhook-sent').textContent = metrics.webhookSent || 0;
  document.getElementById('metric-webhook-failed').textContent = metrics.webhookFailed || 0;
}

// ── Live Log ─────────────────────────────────────────
function appendLiveLog(level, message) {
  const container = document.getElementById('live-log');
  if (!container) return;

  const entry = document.createElement('div');
  entry.className = `live-log-entry ${level}`;
  entry.innerHTML = `<span class="ts">${new Date().toLocaleTimeString()}</span>${escHtml(message)}`;
  container.appendChild(entry);

  // Auto-scroll & cap at 200 entries
  while (container.children.length > 200) container.removeChild(container.firstChild);
  container.scrollTop = container.scrollHeight;
}

function clearLiveLog() {
  const el = document.getElementById('live-log');
  if (el) el.innerHTML = '';
}

// ── Pagination Helper ────────────────────────────────
function renderPagination(containerId, total, page, limit, onPageChange) {
  const el = document.getElementById(containerId);
  if (!el) return;

  const totalPages = Math.ceil(total / limit);
  if (totalPages <= 1) { el.innerHTML = ''; return; }

  let html = '<div class="pagination">';
  html += `<button ${page <= 1 ? 'disabled' : ''} onclick="(${onPageChange.toString()})(${page - 1})">‹</button>`;
  for (let p = Math.max(1, page - 2); p <= Math.min(totalPages, page + 2); p++) {
    html += `<button class="${p === page ? 'active' : ''}" onclick="(${onPageChange.toString()})(${p})">${p}</button>`;
  }
  html += `<button ${page >= totalPages ? 'disabled' : ''} onclick="(${onPageChange.toString()})(${page + 1})">›</button>`;
  html += `<span class="page-info">${total} total</span>`;
  html += '</div>';
  el.innerHTML = html;
}

// ── API Key ──────────────────────────────────────────
function toggleApiKey() {
  state.apiKeyVisible = !state.apiKeyVisible;
  const el = document.getElementById('api-key-val');
  el.textContent = state.apiKeyVisible ? '(see .env file)' : '••••••••';
}

function copyApiKey() {
  const val = document.getElementById('settings-api-key').value;
  navigator.clipboard.writeText(val).then(() => showToast('success', 'Copied to clipboard'));
}

// ── Toast ────────────────────────────────────────────
function showToast(type, message, duration = 4000) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span class="toast-msg">${escHtml(message)}</span>`;
  container.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, duration);
}

// ── API Fetch ────────────────────────────────────────
async function apiFetch(url, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };

  if (!opts.skipAuth && state.token) {
    headers['Authorization'] = `Bearer ${state.token}`;
  }

  const res = await fetch(url, {
    method: opts.method || 'GET',
    headers,
    body: opts.body,
  });

  if (res.status === 401) {
    handleLogout();
    throw new Error('Session expired. Please log in again.');
  }

  return res.json();
}

// ── Helpers ──────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function statusLabel(status) {
  const map = {
    connected: 'Connected', disconnected: 'Disconnected', qr_ready: 'Scan QR',
    connecting: 'Connecting', reconnecting: 'Reconnecting', initializing: 'Initializing',
    logged_out: 'Logged Out', auth_failed: 'Auth Failed', offline: 'Offline',
  };
  return map[status] || status;
}

function statusTag(status) {
  const map = {
    connected: 'tag-green', disconnected: 'tag-red', qr_ready: 'tag-blue',
    connecting: 'tag-orange', reconnecting: 'tag-orange', initializing: 'tag-orange',
    logged_out: 'tag-purple', offline: 'tag-gray',
  };
  return map[status] || 'tag-gray';
}

function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
