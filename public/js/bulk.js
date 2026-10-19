/* ============================================================
 * bulk.js — Bulk Messaging frontend module
 * Runs AFTER app.js — reads window.currentSessionId &
 * window.authToken set by app.js
 * ============================================================ */
'use strict';

// ─── State ────────────────────────────────────────────────────────────────────
let _bulkSessionId   = null;
let _selectedListId  = null;
let _selectedListName = null;
let _leadsPage       = 1;
const LEADS_PER_PAGE = 100;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function bulkApi(path, opts = {}) {
  const token = window.authToken || localStorage.getItem('wb_token');
  return fetch(path, {
    ...opts,
    headers: {
      ...(opts.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  }).then(async (r) => {
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(json.message || `HTTP ${r.status}`);
    return json;
  });
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString();
}

function statusTag(status) {
  const map = {
    pending:   'tag-gray',
    sent:      'tag-green',
    failed:    'tag-red',
    skipped:   'tag-orange',
    running:   'tag-blue',
    completed: 'tag-green',
    cancelled: 'tag-gray',
  };
  return `<span class="tag ${map[status] || 'tag-gray'}">${status}</span>`;
}

function getSessionId() {
  return _bulkSessionId
    || window.currentSessionId
    || document.getElementById('session-selector')?.value
    || null;
}

// ─── Init: called when Bulk Messaging page becomes active ─────────────────────
function onBulkPageEnter() {
  _bulkSessionId = getSessionId();
  if (!_bulkSessionId) {
    showToast('Select a session first', 'warning');
    return;
  }
  hookBulkSocket();
  loadBulkMessages();
  loadLeadLists();
  loadCampaigns();
  refreshBulkDropdowns();
  checkCampaignSessionStatus();
}

// Hook into the existing page switcher from app.js
const _origShowPage = window.showPage;
if (typeof _origShowPage === 'function') {
  window.showPage = function (page) {
    _origShowPage(page);
    if (page === 'bulk') setTimeout(onBulkPageEnter, 50);
  };
}

// Also hook session selector change
const _origOnSessionChange = window.onSessionChange;
if (typeof _origOnSessionChange === 'function') {
  window.onSessionChange = function (val) {
    _origOnSessionChange(val);
    _bulkSessionId = val;
    const activePage = document.querySelector('.page.active');
    if (activePage && activePage.id === 'page-bulk') {
      onBulkPageEnter();
    }
  };
}

// ─── Sub-tab switching ────────────────────────────────────────────────────────
function switchBulkTab(tab) {
  document.querySelectorAll('.bulk-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.bulk-tab-panel').forEach((p) => p.classList.toggle('active', p.id === `bulk-tab-${tab}`));
  if (tab === 'campaigns') {
    refreshBulkDropdowns();
    checkCampaignSessionStatus();
  }
}

// ─── Socket.io: live campaign progress & session state ───────────────────────
function hookBulkSocket() {
  const sock = window.socket || (typeof state !== 'undefined' && state.socket);
  if (!sock || sock._bulkHooked) return;
  sock._bulkHooked = true;

  sock.on('bulk_progress', (data) => {
    updateProgressBar(data);
    if (data.status === 'completed' || data.status === 'cancelled' || data.status === 'failed') {
      setTimeout(loadCampaigns, 500);
    }
  });

  sock.on('status', (data) => {
    if (data.sessionId === getSessionId()) {
      checkCampaignSessionStatus();
    }
  });

  sock.on('qr', (data) => {
    if (data.sessionId === getSessionId()) {
      const qrImg = document.getElementById('bulk-qr-img');
      if (qrImg && data.qr) {
        qrImg.src = data.qr;
        const load = document.getElementById('bulk-qr-loading');
        const cont = document.getElementById('bulk-qr-container');
        if (load) load.style.display = 'none';
        if (cont) cont.style.display = 'block';
      }
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SETUP MESSAGES
// ═══════════════════════════════════════════════════════════════════════════════

async function loadBulkMessages() {
  const sid = getSessionId();
  if (!sid) return;
  try {
    const { messages } = await bulkApi(`/api/bulk/${sid}/messages`);
    renderBulkMessages(messages);
  } catch (err) {
    showToast('Failed to load messages: ' + err.message, 'error');
  }
}

function renderBulkMessages(messages) {
  const tbody = document.getElementById('bulk-messages-tbody');
  if (!tbody) return;
  if (!messages || messages.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;opacity:.5;padding:1.5rem">No saved messages yet</td></tr>';
    return;
  }
  tbody.innerHTML = messages.map((m) => `
    <tr>
      <td><strong>${esc(m.title)}</strong></td>
      <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(m.bodyText || '—')}</td>
      <td>${m.media && m.media.length ? `<span class="tag tag-blue">${m.media.length} file(s)</span>` : '—'}</td>
      <td>${fmtDate(m.createdAt)}</td>
      <td>
        <button class="btn btn-ghost btn-sm" onclick="editBulkMessage('${m.id}')">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteBulkMessage('${m.id}')">Delete</button>
      </td>
    </tr>
  `).join('');
}

function showBulkMsgModal(id) {
  document.getElementById('bm-title').value   = '';
  document.getElementById('bm-body').value    = '';
  document.getElementById('bm-media-list').innerHTML = '';
  document.getElementById('bm-editing-id').value = '';
  document.getElementById('bulk-msg-modal-title').textContent = 'New Message';
  document.getElementById('bm-save-btn').textContent = 'Save';
  document.getElementById('modal-bulk-msg').style.display = 'flex';
  initCloudinaryDropzone();
  checkCloudinaryStatus();
}

async function editBulkMessage(id) {
  const sid = getSessionId();
  try {
    const { message: m } = await bulkApi(`/api/bulk/${sid}/messages/${id}`);
    document.getElementById('bm-editing-id').value = m.id;
    document.getElementById('bm-title').value      = m.title;
    document.getElementById('bm-body').value       = m.bodyText || '';
    document.getElementById('bulk-msg-modal-title').textContent = 'Edit Message';
    document.getElementById('bm-save-btn').textContent = 'Update';
    // Render media rows
    const list = document.getElementById('bm-media-list');
    list.innerHTML = '';
    (m.media || []).forEach((item) => addMediaRow(item));
    document.getElementById('modal-bulk-msg').style.display = 'flex';
    initCloudinaryDropzone();
    checkCloudinaryStatus();
  } catch (err) {
    showToast('Failed to load message: ' + err.message, 'error');
  }
}

async function checkCloudinaryStatus() {
  const sid = getSessionId();
  const badge = document.getElementById('bm-cloudinary-badge');
  if (!sid || !badge) return;
  try {
    const res = await bulkApi(`/api/bulk/${sid}/media/status`);
    if (res.configured) {
      badge.className = 'tag tag-green';
      badge.textContent = `☁️ Cloudinary (${res.cloudName})`;
      badge.title = 'Cloudinary credentials active';
    } else {
      badge.className = 'tag tag-orange';
      badge.textContent = '⚠️ Cloudinary Key Needed';
      badge.title = 'Set CLOUDINARY_API_KEY in .env file to enable uploads';
    }
  } catch (_) {
    badge.className = 'tag tag-gray';
    badge.textContent = '☁️ Cloudinary';
  }
}

function initCloudinaryDropzone() {
  const dropzone = document.getElementById('bm-dropzone');
  if (!dropzone || dropzone._dragInit) return;
  dropzone._dragInit = true;

  ['dragenter', 'dragover'].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('dragover');
    }, false);
  });

  ['dragleave', 'drop'].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('dragover');
    }, false);
  });

  dropzone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    if (dt && dt.files && dt.files.length) {
      handleBulkMediaFileUpload(dt.files);
    }
  }, false);
}

async function handleBulkMediaFileUpload(fileList) {
  if (!fileList || fileList.length === 0) return;
  const sid = getSessionId();
  if (!sid) {
    showToast('Select a session first', 'warning');
    return;
  }

  const spinner = document.getElementById('bm-upload-spinner');
  const inner = document.getElementById('bm-dropzone-inner');
  const statusText = document.getElementById('bm-upload-status-text');

  if (spinner) spinner.style.display = 'flex';
  if (inner) inner.style.display = 'none';
  if (statusText) statusText.textContent = `Uploading ${fileList.length} file(s) to Cloudinary…`;

  const token = window.authToken || localStorage.getItem('wb_token');
  const formData = new FormData();
  for (let i = 0; i < fileList.length; i++) {
    formData.append('files', fileList[i]);
  }

  try {
    const res = await fetch(`/api/bulk/${sid}/media/upload`, {
      method: 'POST',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: formData,
    });

    const json = await res.json();
    if (!res.ok) {
      throw new Error(json.message || `Upload failed (HTTP ${res.status})`);
    }

    const items = json.files || (json.media ? [json.media] : []);
    items.forEach((item) => {
      addMediaRow({
        type: item.type,
        url: item.url,
        caption: item.originalFilename || item.caption || '',
        mimetype: item.mimetype,
        fileName: item.originalFilename || item.fileName || '',
      });
    });

    showToast(`Uploaded ${items.length} file(s) to Cloudinary!`, 'success');
  } catch (err) {
    showToast(`Upload failed: ${err.message}`, 'error');
  } finally {
    if (spinner) spinner.style.display = 'none';
    if (inner) inner.style.display = 'flex';
    const input = document.getElementById('bm-file-input');
    if (input) input.value = '';
  }
}

async function saveBulkMessage() {
  const sid     = getSessionId();
  const editId  = document.getElementById('bm-editing-id').value;
  const title   = document.getElementById('bm-title').value.trim();
  const bodyText = document.getElementById('bm-body').value;
  const media   = collectMediaRows();

  if (!title) { showToast('Title is required', 'warning'); return; }

  try {
    if (editId) {
      await bulkApi(`/api/bulk/${sid}/messages/${editId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, bodyText, media }),
      });
      showToast('Message updated', 'success');
    } else {
      await bulkApi(`/api/bulk/${sid}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, bodyText, media }),
      });
      showToast('Message created', 'success');
    }
    closeModal('modal-bulk-msg');
    loadBulkMessages();
    refreshBulkDropdowns();
  } catch (err) {
    showToast('Save failed: ' + err.message, 'error');
  }
}

async function deleteBulkMessage(id) {
  if (!confirm('Delete this message template?')) return;
  const sid = getSessionId();
  try {
    await bulkApi(`/api/bulk/${sid}/messages/${id}`, { method: 'DELETE' });
    showToast('Message deleted', 'success');
    loadBulkMessages();
    refreshBulkDropdowns();
  } catch (err) {
    showToast('Delete failed: ' + err.message, 'error');
  }
}

// ── Media rows ────────────────────────────────────────────────────────────────
function addMediaRow(item = {}) {
  const list = document.getElementById('bm-media-list');
  const div  = document.createElement('div');
  div.className = 'bm-media-row';

  const type = item.type || 'image';
  const url  = item.url || '';
  const isCloudinary = url.includes('cloudinary.com') || url.includes('res.cloudinary.com');

  let thumbHtml = '';
  if (url && (type === 'image' || (!type && /\.(jpg|jpeg|png|webp|gif|svg)$/i.test(url)))) {
    thumbHtml = `<img src="${esc(url)}" class="bm-media-thumb" alt="Preview" onerror="this.outerHTML='<div class=\\'bm-media-thumb\\'>🖼️</div>'" />`;
  } else if (type === 'video') {
    thumbHtml = '<div class="bm-media-thumb">🎥</div>';
  } else if (type === 'audio') {
    thumbHtml = '<div class="bm-media-thumb">🎵</div>';
  } else {
    thumbHtml = '<div class="bm-media-thumb">📄</div>';
  }

  div.innerHTML = `
    ${thumbHtml}
    <div class="bm-media-info">
      <div style="display:flex;gap:6px;align-items:center">
        <select class="form-input" style="width:115px;padding:3px 6px;font-size:0.75rem" data-media-field="type" onchange="updateMediaRowThumb(this)">
          <option value="image"    ${type === 'image'    ? 'selected' : ''}>🖼️ Image</option>
          <option value="video"    ${type === 'video'    ? 'selected' : ''}>🎥 Video</option>
          <option value="audio"    ${type === 'audio'    ? 'selected' : ''}>🎵 Audio</option>
          <option value="document" ${type === 'document' ? 'selected' : ''}>📄 Document</option>
        </select>
        <input class="form-input" style="font-size:0.78rem;padding:3px 8px" placeholder="Caption / filename" data-media-field="caption" value="${esc(item.caption || item.fileName || '')}" />
        ${isCloudinary ? '<span class="tag tag-green" style="font-size:0.6rem;padding:1px 5px;flex-shrink:0" title="Hosted on Cloudinary">☁️ Cloudinary</span>' : ''}
        <button class="btn btn-danger btn-sm" style="padding:2px 8px" onclick="this.closest('.bm-media-row').remove()">✕</button>
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        <input class="form-input" style="font-size:0.75rem;padding:2px 8px" placeholder="URL (https://…)" data-media-field="url" value="${esc(url)}" oninput="updateMediaRowThumb(this)" />
        ${url ? `<a href="${esc(url)}" target="_blank" class="bm-media-link" title="Open media in new tab">View ↗</a>` : ''}
      </div>
    </div>
  `;
  list.appendChild(div);
}

function updateMediaRowThumb(el) {
  const row = el.closest('.bm-media-row');
  if (!row) return;
  const url = row.querySelector('[data-media-field="url"]')?.value.trim() || '';
  const type = row.querySelector('[data-media-field="type"]')?.value || 'image';
  const existingThumb = row.querySelector('.bm-media-thumb');
  if (!existingThumb) return;

  if (url && (type === 'image' || (!type && /\.(jpg|jpeg|png|webp|gif|svg)$/i.test(url)))) {
    existingThumb.outerHTML = `<img src="${esc(url)}" class="bm-media-thumb" alt="Preview" onerror="this.outerHTML='<div class=\\'bm-media-thumb\\'>🖼️</div>'" />`;
  } else if (type === 'video') {
    existingThumb.outerHTML = '<div class="bm-media-thumb">🎥</div>';
  } else if (type === 'audio') {
    existingThumb.outerHTML = '<div class="bm-media-thumb">🎵</div>';
  } else {
    existingThumb.outerHTML = '<div class="bm-media-thumb">📄</div>';
  }
}

function collectMediaRows() {
  const rows = document.querySelectorAll('#bm-media-list .bm-media-row');
  return Array.from(rows).map((row) => ({
    type:     row.querySelector('[data-media-field="type"]').value,
    url:      row.querySelector('[data-media-field="url"]').value.trim(),
    caption:  row.querySelector('[data-media-field="caption"]').value.trim(),
    mimetype: null,
    fileName: row.querySelector('[data-media-field="caption"]').value.trim() || null,
  })).filter((i) => i.url);
}

// ═══════════════════════════════════════════════════════════════════════════════
// LEAD LISTS
// ═══════════════════════════════════════════════════════════════════════════════

let _cachedLeadLists = [];

async function loadLeadLists() {
  const sid = getSessionId();
  if (!sid) return;
  try {
    const { lists } = await bulkApi(`/api/bulk/${sid}/lists`);
    _cachedLeadLists = lists || [];
    renderLeadLists(lists);
    refreshBulkDropdowns(null, lists);
  } catch (err) {
    showToast('Failed to load lead lists: ' + err.message, 'error');
  }
}

function renderLeadLists(lists) {
  const ul = document.getElementById('lead-lists-ul');
  if (!ul) return;
  if (!lists || lists.length === 0) {
    ul.innerHTML = '<li class="lead-list-item" style="opacity:.5;padding:1rem">No lists yet</li>';
    return;
  }
  ul.innerHTML = lists.map((l) => `
    <li class="lead-list-item ${_selectedListId === l.id ? 'active' : ''}" onclick="selectLeadList('${l.id}', '${esc(l.name)}')">
      <div class="ll-name">${esc(l.name)}</div>
      <div class="ll-meta">${l.totalContacts || 0} contacts</div>
      <div class="ll-actions" onclick="event.stopPropagation()">
        <button class="icon-btn" title="Edit" onclick="editLeadList('${l.id}', '${esc(l.name)}', '${esc(l.description || '')}')">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="icon-btn" title="Delete" style="color:#ef4444" onclick="deleteLeadList('${l.id}')">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,6 5,6 21,6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
        </button>
      </div>
    </li>
  `).join('');
}

function selectLeadList(id, name) {
  _selectedListId   = id;
  _selectedListName = name;
  _leadsPage = 1;
  document.querySelectorAll('.lead-list-item').forEach((li) => li.classList.remove('active'));
  document.getElementById('selected-list-name').textContent = name;
  document.getElementById('bulk-contacts-empty').style.display  = 'none';
  document.getElementById('bulk-contacts-detail').style.display = 'block';
  // Reset CSV file input
  const fi = document.getElementById('csv-file-input');
  if (fi) fi.value = '';
  document.getElementById('csv-import-result').style.display = 'none';
  loadLeads();
}

function showLeadListModal() {
  document.getElementById('ll-name').value = '';
  document.getElementById('ll-desc').value = '';
  document.getElementById('ll-editing-id').value = '';
  document.getElementById('ll-modal-title').textContent = 'New Lead List';
  document.getElementById('ll-save-btn').textContent = 'Create';
  document.getElementById('modal-lead-list').style.display = 'flex';
}

function editLeadList(id, name, desc) {
  document.getElementById('ll-editing-id').value = id;
  document.getElementById('ll-name').value = name;
  document.getElementById('ll-desc').value = desc;
  document.getElementById('ll-modal-title').textContent = 'Edit Lead List';
  document.getElementById('ll-save-btn').textContent = 'Update';
  document.getElementById('modal-lead-list').style.display = 'flex';
}

async function saveLeadList() {
  const sid    = getSessionId();
  const editId = document.getElementById('ll-editing-id').value;
  const name   = document.getElementById('ll-name').value.trim();
  const desc   = document.getElementById('ll-desc').value.trim();
  if (!name) { showToast('List name is required', 'warning'); return; }

  try {
    if (editId) {
      await bulkApi(`/api/bulk/${sid}/lists/${editId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description: desc }),
      });
      showToast('List updated', 'success');
    } else {
      await bulkApi(`/api/bulk/${sid}/lists`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description: desc }),
      });
      showToast('List created', 'success');
    }
    closeModal('modal-lead-list');
    loadLeadLists();
  } catch (err) {
    showToast('Save failed: ' + err.message, 'error');
  }
}

async function deleteLeadList(id) {
  if (!confirm('Delete this lead list and ALL its contacts?')) return;
  const sid = getSessionId();
  try {
    await bulkApi(`/api/bulk/${sid}/lists/${id}`, { method: 'DELETE' });
    showToast('List deleted', 'success');
    if (_selectedListId === id) {
      _selectedListId = null;
      document.getElementById('bulk-contacts-empty').style.display  = 'block';
      document.getElementById('bulk-contacts-detail').style.display = 'none';
    }
    loadLeadLists();
  } catch (err) {
    showToast('Delete failed: ' + err.message, 'error');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// LEADS
// ═══════════════════════════════════════════════════════════════════════════════

async function loadLeads() {
  const sid = getSessionId();
  if (!sid || !_selectedListId) return;
  try {
    const result = await bulkApi(`/api/bulk/${sid}/lists/${_selectedListId}/leads?page=${_leadsPage}&limit=${LEADS_PER_PAGE}`);
    renderLeads(result.leads, result.total);
  } catch (err) {
    showToast('Failed to load contacts: ' + err.message, 'error');
  }
}

function renderLeads(leads, total) {
  const tbody  = document.getElementById('leads-tbody');
  const empty  = document.getElementById('leads-empty');
  const pgWrap = document.getElementById('leads-pagination');

  if (!leads || leads.length === 0) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    pgWrap.innerHTML = '';
    return;
  }
  empty.style.display = 'none';

  const offset = (_leadsPage - 1) * LEADS_PER_PAGE;
  tbody.innerHTML = leads.map((l, i) => `
    <tr>
      <td>${offset + i + 1}</td>
      <td>${esc(l.contactName)}</td>
      <td>${esc(l.phoneNumber)}</td>
      <td>${statusTag(l.status || 'pending')}</td>
      <td>
        <button class="btn btn-danger btn-sm" onclick="deleteLead('${l.id}')">✕</button>
      </td>
    </tr>
  `).join('');

  // Pagination
  const totalPages = Math.ceil(total / LEADS_PER_PAGE);
  if (totalPages <= 1) { pgWrap.innerHTML = ''; return; }
  const pages = [];
  for (let p = 1; p <= totalPages; p++) {
    pages.push(`<button class="btn btn-ghost btn-sm ${p === _leadsPage ? 'active' : ''}" onclick="goLeadsPage(${p})">${p}</button>`);
  }
  pgWrap.innerHTML = `<div style="display:flex;gap:4px;align-items:center">
    <span style="opacity:.6;font-size:0.8rem">${total} contacts</span>
    <div style="margin-left:auto;display:flex;gap:4px">${pages.join('')}</div>
  </div>`;
}

function goLeadsPage(p) {
  _leadsPage = p;
  loadLeads();
}

let _selectedCSVFile = null;

function showUploadLeadsModal(targetListId = null) {
  const sid = getSessionId();
  if (!sid) { showToast('Select a session first', 'warning'); return; }

  _selectedCSVFile = null;
  const fileInput = document.getElementById('ul-csv-file');
  if (fileInput) fileInput.value = '';
  document.getElementById('ul-list-name').value = '';
  const statusDiv = document.getElementById('ul-upload-status');
  statusDiv.style.display = 'none';
  statusDiv.innerHTML = '';
  document.getElementById('ul-csv-dropzone-inner').style.display = 'flex';
  document.getElementById('ul-file-selected-info').style.display = 'none';
  const submitBtn = document.getElementById('ul-submit-btn');
  submitBtn.disabled = false;
  submitBtn.textContent = 'Upload & Parse Leads';

  // Populate existing lists dropdown
  const select = document.getElementById('ul-existing-select');
  select.innerHTML = '';
  const currentLists = _cachedLeadLists || [];
  currentLists.forEach((l) => {
    const opt = document.createElement('option');
    opt.value = l.id;
    opt.textContent = `${l.name} (${l.totalContacts || 0} contacts)`;
    if (targetListId && l.id === targetListId) opt.selected = true;
    select.appendChild(opt);
  });

  const modeSelect = document.getElementById('ul-target-mode');
  if (targetListId && currentLists.length > 0) {
    modeSelect.value = 'existing';
  } else {
    modeSelect.value = 'new';
  }
  toggleUploadListMode(modeSelect.value);

  document.getElementById('modal-upload-leads').style.display = 'flex';
  initLeadsCSVDropzone();
}

function toggleUploadListMode(mode) {
  const nameGrp = document.getElementById('ul-name-group');
  const existGrp = document.getElementById('ul-existing-group');
  if (mode === 'existing') {
    nameGrp.style.display = 'none';
    existGrp.style.display = 'block';
  } else {
    nameGrp.style.display = 'block';
    existGrp.style.display = 'none';
  }
}

function initLeadsCSVDropzone() {
  const dropzone = document.getElementById('ul-csv-dropzone');
  if (!dropzone || dropzone._dragInit) return;
  dropzone._dragInit = true;

  ['dragenter', 'dragover'].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('dragover');
    }, false);
  });

  ['dragleave', 'drop'].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('dragover');
    }, false);
  });

  dropzone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    if (dt && dt.files && dt.files.length) {
      onLeadCSVSelected(dt.files);
    }
  }, false);
}

function onLeadCSVSelected(files) {
  if (!files || files.length === 0) return;
  const file = files[0];
  if (!file.name.toLowerCase().endsWith('.csv') && file.type !== 'text/csv') {
    showToast('Please select a valid .csv file', 'warning');
    return;
  }

  _selectedCSVFile = file;
  document.getElementById('ul-csv-dropzone-inner').style.display = 'none';
  const info = document.getElementById('ul-file-selected-info');
  info.style.display = 'block';
  document.getElementById('ul-selected-filename').textContent = file.name;
  document.getElementById('ul-selected-filesize').textContent = `(${(file.size / 1024).toFixed(1)} KB)`;

  // Auto-fill list name if empty
  const nameInput = document.getElementById('ul-list-name');
  if (!nameInput.value.trim()) {
    const suggested = file.name.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' ').trim();
    nameInput.value = suggested.charAt(0).toUpperCase() + suggested.slice(1);
  }
}

async function submitLeadsCSVUpload() {
  const sid = getSessionId();
  if (!sid) { showToast('Select a session first', 'warning'); return; }
  if (!_selectedCSVFile) {
    showToast('Please select a CSV file to upload', 'warning');
    return;
  }

  const mode = document.getElementById('ul-target-mode').value;
  const listId = mode === 'existing' ? document.getElementById('ul-existing-select').value : null;
  const listName = document.getElementById('ul-list-name').value.trim();

  if (mode === 'existing' && !listId) {
    showToast('Please select a target list', 'warning');
    return;
  }

  const btn = document.getElementById('ul-submit-btn');
  const statusDiv = document.getElementById('ul-upload-status');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-sm"></span> Parsing &amp; Saving Leads…';
  statusDiv.style.display = 'block';
  statusDiv.innerHTML = '<span style="opacity:0.7">Parsing CSV records and syncing with database…</span>';

  const formData = new FormData();
  formData.append('file', _selectedCSVFile);
  if (listId) formData.append('listId', listId);
  if (listName) formData.append('listName', listName);

  try {
    const token = window.authToken || localStorage.getItem('wb_token');
    const res = await fetch(`/api/bulk/${sid}/leads/upload-csv`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.message || `Upload failed (HTTP ${res.status})`);

    const targetName = data.list?.name || listName || 'Imported Leads';
    statusDiv.innerHTML = `
      <div style="color:var(--wa-green);font-weight:600;margin-bottom:6px">
        ✓ Successfully parsed and imported ${data.inserted} lead(s)!
      </div>
      <div style="font-size:0.8rem;color:var(--text-secondary);margin-bottom:8px">
        List: <strong>${esc(targetName)}</strong> • Total: <strong>${data.totalContacts || data.inserted}</strong> contacts
        ${data.skipped ? ` • <span style="color:#f59e0b">${data.skipped} skipped</span>` : ''}
      </div>
      ${data.errors && data.errors.length ? `<details style="margin-top:4px"><summary style="cursor:pointer;font-size:0.75rem">Show ${data.errors.length} skipped row(s)</summary><pre style="font-size:0.72rem;max-height:100px;overflow:auto">${data.errors.map((e) => `Row ${e.row}: ${e.reason}`).join('\n')}</pre></details>` : ''}
      <div style="margin-top:12px">
        <button class="btn btn-primary btn-sm" onclick="quickLaunchCampaign('${data.listId}', '${esc(targetName)}')">
          🚀 Launch Campaign with this List
        </button>
      </div>
    `;

    showToast(`Imported ${data.inserted} contacts successfully!`, 'success');

    // Reload list and select it
    await loadLeadLists();
    selectLeadList(data.listId, targetName);

    // Refresh campaign dropdowns and pre-select this list
    refreshBulkDropdowns(null, null, data.listId);

  } catch (err) {
    statusDiv.innerHTML = `<span style="color:#ef4444">✗ Error: ${esc(err.message)}</span>`;
    showToast('Import failed: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Upload & Parse Leads';
  }
}

function quickLaunchCampaign(listId, listName) {
  closeModal('modal-upload-leads');
  switchBulkTab('campaigns');
  const sel = document.getElementById('campaign-list-select');
  if (sel) {
    sel.value = listId;
  }
  const titleInput = document.getElementById('campaign-title');
  if (titleInput && !titleInput.value) {
    titleInput.value = `Campaign → ${listName || 'New Leads'}`;
  }
  showToast(`Selected "${listName}" for campaign! Choose a message and click Launch.`, 'info');
}

async function importCSV(event) {
  const sid = getSessionId();
  if (!sid || !_selectedListId) { showToast('Select a session and a list first', 'warning'); return; }
  const file = event.target.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('file', file);

  const resultDiv = document.getElementById('csv-import-result');
  resultDiv.style.display = 'block';
  resultDiv.innerHTML = '<span style="opacity:.6">Uploading & parsing CSV…</span>';

  try {
    const token = window.authToken || localStorage.getItem('wb_token');
    const r = await fetch(`/api/bulk/${sid}/lists/${_selectedListId}/leads/import`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.message || `HTTP ${r.status}`);

    resultDiv.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <div>
          <strong style="color:#22c55e">✓ Imported ${data.inserted} contact(s)</strong>
          ${data.skipped ? `<span style="color:#f59e0b"> · ${data.skipped} skipped</span>` : ''}
        </div>
        <button class="btn btn-primary btn-sm" onclick="quickLaunchCampaign('${_selectedListId}', '${esc(_selectedListName || '')}')">
          🚀 Launch Campaign
        </button>
      </div>
      ${data.errors && data.errors.length ? `<details style="margin-top:4px"><summary style="cursor:pointer;font-size:0.8rem">Show ${data.errors.length} row error(s)</summary><pre style="font-size:0.75rem;max-height:120px;overflow:auto">${data.errors.map((e) => `Row ${e.row}: ${e.reason}`).join('\n')}</pre></details>` : ''}
    `;
    showToast(`Imported ${data.inserted} contacts`, 'success');
    loadLeads();
    loadLeadLists();
    refreshBulkDropdowns(null, null, _selectedListId);
  } catch (err) {
    resultDiv.innerHTML = `<span style="color:#ef4444">✗ ${err.message}</span>`;
    showToast('Import failed: ' + err.message, 'error');
  }

  event.target.value = '';
}

function downloadCSVTemplate() {
  const csv = 'contact_name,phone_number\nJohn Doe,+15551234567\nJane Smith,+15559876543\nAlex Johnson,+447123456789\n';
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'leads_template.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

async function deleteLead(leadId) {
  const sid = getSessionId();
  if (!sid || !_selectedListId) return;
  try {
    await bulkApi(`/api/bulk/${sid}/lists/${_selectedListId}/leads/${leadId}`, { method: 'DELETE' });
    showToast('Contact removed', 'success');
    loadLeads();
    loadLeadLists();
  } catch (err) {
    showToast('Delete failed: ' + err.message, 'error');
  }
}

async function clearAllLeads() {
  if (!confirm('Remove ALL contacts from this list? This cannot be undone.')) return;
  const sid = getSessionId();
  if (!sid || !_selectedListId) return;
  try {
    await bulkApi(`/api/bulk/${sid}/lists/${_selectedListId}/leads`, { method: 'DELETE' });
    showToast('All contacts cleared', 'success');
    loadLeads();
    loadLeadLists();
  } catch (err) {
    showToast('Clear failed: ' + err.message, 'error');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CAMPAIGNS
// ═══════════════════════════════════════════════════════════════════════════════

async function loadCampaigns() {
  const sid = getSessionId();
  if (!sid) return;
  try {
    const { campaigns } = await bulkApi(`/api/bulk/${sid}/campaigns`);
    renderCampaigns(campaigns);
  } catch (err) {
    showToast('Failed to load campaigns: ' + err.message, 'error');
  }
}

function renderCampaigns(campaigns) {
  const tbody = document.getElementById('campaigns-tbody');
  if (!tbody) return;
  if (!campaigns || campaigns.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;opacity:.5;padding:1.5rem">No campaigns yet. Launch one above!</td></tr>';
    return;
  }
  tbody.innerHTML = campaigns.map((c) => `
    <tr>
      <td><strong>${esc(c.title || '—')}</strong></td>
      <td>${statusTag(c.status)}</td>
      <td>${c.total}</td>
      <td style="color:#22c55e">${c.sent}</td>
      <td style="color:#ef4444">${c.failed}</td>
      <td style="color:#f59e0b">${c.skipped}</td>
      <td>${fmtDate(c.startedAt)}</td>
      <td style="display:flex;gap:4px">
        ${c.status === 'running'
          ? `<button class="btn btn-danger btn-sm" onclick="cancelCampaign('${c.id}')">Cancel</button>`
          : `<button class="btn btn-primary btn-sm" onclick="rerunCampaign('${c.messageId || ''}', '${c.listId || ''}', '${esc(c.title || '')}')" title="Re-launch this campaign">Rerun</button>
             <button class="btn btn-danger btn-sm" onclick="deleteCampaign('${c.id}')">Delete</button>`}
      </td>
    </tr>
  `).join('');
}

function rerunCampaign(messageId, listId, title) {
  switchBulkTab('campaigns');
  const mSel = document.getElementById('campaign-message-select');
  if (mSel && messageId) mSel.value = messageId;
  const lSel = document.getElementById('campaign-list-select');
  if (lSel && listId) lSel.value = listId;
  const tInput = document.getElementById('campaign-title');
  if (tInput) tInput.value = title ? (title.includes('Rerun') ? title : `${title} (Rerun)`) : 'Rerun Campaign';
  showToast('info', 'Campaign selected for rerun! Click "Launch Campaign" to start.');
  tInput?.focus();
}

async function refreshBulkDropdowns(messages, lists, preselectedListId = null) {
  const sid = getSessionId();
  if (!sid) return;

  // Refresh messages dropdown
  try {
    const msgs = messages || (await bulkApi(`/api/bulk/${sid}/messages`)).messages;
    const mSel = document.getElementById('campaign-message-select');
    if (mSel) {
      const cur = mSel.value;
      mSel.innerHTML = '<option value="">— choose a message —</option>' +
        (msgs || []).map((m) => `<option value="${m.id}" ${m.id === cur ? 'selected' : ''}>${esc(m.title)}</option>`).join('');
    }
  } catch (_) {}

  // Refresh lists dropdown
  try {
    const lsts = lists || (await bulkApi(`/api/bulk/${sid}/lists`)).lists;
    _cachedLeadLists = lsts || [];
    const lSel = document.getElementById('campaign-list-select');
    if (lSel) {
      const targetId = preselectedListId || lSel.value;
      lSel.innerHTML = '<option value="">— choose a list —</option>' +
        (lsts || []).map((l) => `<option value="${l.id}" ${l.id === targetId ? 'selected' : ''}>${esc(l.name)} (${l.totalContacts || 0})</option>`).join('');
      if (targetId) lSel.value = targetId;
    }
  } catch (_) {}
}

let _currentSessionStatus = 'unknown';

async function checkCampaignSessionStatus() {
  const sid = getSessionId();
  const badge = document.getElementById('campaign-session-badge');
  const banner = document.getElementById('campaign-offline-banner');
  const sidLabel = document.getElementById('campaign-offline-session-id');
  const launchBtn = document.getElementById('btn-launch-campaign');
  if (!sid || !badge) return;

  try {
    const res = await bulkApi(`/api/sessions/${sid}/status`);
    _currentSessionStatus = res.status;

    if (res.status === 'connected') {
      badge.className = 'tag tag-green';
      badge.textContent = `🟢 WhatsApp Connected (${res.info?.name || res.info?.phone || sid})`;
      if (banner) banner.style.display = 'none';
      if (launchBtn) {
        launchBtn.disabled = false;
        launchBtn.title = 'Ready to launch campaign';
      }
    } else if (res.status === 'qr_ready') {
      badge.className = 'tag tag-orange';
      badge.textContent = '🟡 Awaiting QR Scan';
      if (banner) {
        banner.style.display = 'block';
        if (sidLabel) sidLabel.textContent = sid;
      }
    } else {
      badge.className = 'tag tag-red';
      badge.textContent = '🔴 WhatsApp Offline';
      if (banner) {
        banner.style.display = 'block';
        if (sidLabel) sidLabel.textContent = sid;
      }
    }
  } catch (_) {
    if (badge) {
      badge.className = 'tag tag-gray';
      badge.textContent = '⚪ Session Status Unknown';
    }
  }
}

async function showScanQRModal(targetSid = null) {
  const sid = targetSid || getSessionId();
  if (!sid) {
    showToast('warning', 'Select a session first');
    return;
  }

  document.getElementById('modal-bulk-qr').style.display = 'flex';
  document.getElementById('bulk-qr-loading').style.display = 'block';
  document.getElementById('bulk-qr-container').style.display = 'none';
  document.getElementById('bulk-qr-connected').style.display = 'none';

  // Request initialization / connection
  try {
    const token = window.authToken || localStorage.getItem('wb_token');
    await fetch(`/api/sessions/${sid}/connect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch (_) {}

  pollQRStatus(sid);
}

let _qrPollTimer = null;
async function pollQRStatus(sid) {
  if (_qrPollTimer) clearTimeout(_qrPollTimer);

  const check = async () => {
    const modal = document.getElementById('modal-bulk-qr');
    if (!modal || modal.style.display === 'none') return;

    try {
      const res = await bulkApi(`/api/sessions/${sid}/status`);
      _currentSessionStatus = res.status;

      if (res.status === 'connected') {
        document.getElementById('bulk-qr-loading').style.display = 'none';
        document.getElementById('bulk-qr-container').style.display = 'none';
        const connDiv = document.getElementById('bulk-qr-connected');
        connDiv.style.display = 'block';
        document.getElementById('bulk-qr-connected-info').textContent =
          `Connected as ${res.info?.name || ''} (${res.info?.phone || sid})`;
        checkCampaignSessionStatus();
        return;
      } else if (res.qr) {
        document.getElementById('bulk-qr-loading').style.display = 'none';
        document.getElementById('bulk-qr-container').style.display = 'block';
        document.getElementById('bulk-qr-img').src = res.qr;
      }
    } catch (_) {}

    _qrPollTimer = setTimeout(check, 2500);
  };

  check();
}

function retryConnectSession() {
  const sid = getSessionId();
  if (sid) showScanQRModal(sid);
}

let _isLaunchingCampaign = false;

async function launchCampaign() {
  if (_isLaunchingCampaign) return;

  const sid       = getSessionId();
  const messageId = document.getElementById('campaign-message-select').value;
  const listId    = document.getElementById('campaign-list-select').value;
  const delayMs   = parseInt(document.getElementById('campaign-delay').value || '1500', 10);
  const title     = document.getElementById('campaign-title').value.trim();

  if (!sid) { showToast('warning', 'Select a session first'); return; }
  if (!messageId) { showToast('warning', 'Select a message template'); return; }
  if (!listId) { showToast('warning', 'Select a lead list'); return; }

  const btn = document.getElementById('btn-launch-campaign');
  const originalHtml = btn ? btn.innerHTML : 'Launch Campaign';

  // Check session connection before attempting to launch
  if (_currentSessionStatus !== 'connected') {
    try {
      const stat = await bulkApi(`/api/sessions/${sid}/status`);
      _currentSessionStatus = stat.status;
      if (stat.status !== 'connected') {
        showToast('warning', 'WhatsApp session is offline. Scan QR code to connect first.');
        showScanQRModal(sid);
        return;
      }
    } catch (_) {}
  }

  _isLaunchingCampaign = true;
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span style="display:inline-block;animation:spin 1s linear infinite">⏳</span> Starting Campaign...';
  }

  try {
    const { campaign } = await bulkApi(`/api/bulk/${sid}/campaigns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId, listId, delayMs, title }),
    });
    showToast('success', 'Campaign started successfully!');
    document.getElementById('campaign-title').value = '';
    loadCampaigns();
    // Show progress bar
    document.getElementById('bulk-progress-wrap').style.display = 'block';
    updateProgressBar({ campaignId: campaign.id, total: campaign.total, sent: 0, failed: 0, skipped: 0, status: 'running' });
  } catch (err) {
    if (err.message && (err.message.includes('not connected') || err.message.includes('offline') || err.message.includes('QR'))) {
      showToast('warning', 'Session is offline. Please scan the QR code to connect.');
      showScanQRModal(sid);
    } else if (err.message && err.message.includes('already running')) {
      showToast('warning', 'A campaign is already running for this session. Please wait for it to complete or cancel it.');
    } else {
      showToast('error', 'Launch failed: ' + err.message);
    }
  } finally {
    _isLaunchingCampaign = false;
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  }
}

async function cancelCampaign(id) {
  if (!confirm('Cancel this running campaign?')) return;
  const sid = getSessionId();
  try {
    await bulkApi(`/api/bulk/${sid}/campaigns/${id}/cancel`, { method: 'POST' });
    showToast('Cancellation requested', 'success');
    loadCampaigns();
  } catch (err) {
    showToast('Cancel failed: ' + err.message, 'error');
  }
}

async function deleteCampaign(id) {
  if (!confirm('Delete this campaign record?')) return;
  const sid = getSessionId();
  try {
    await bulkApi(`/api/bulk/${sid}/campaigns/${id}`, { method: 'DELETE' });
    showToast('Campaign deleted', 'success');
    loadCampaigns();
  } catch (err) {
    showToast('Delete failed: ' + err.message, 'error');
  }
}

// ─── Progress bar ─────────────────────────────────────────────────────────────
function updateProgressBar(data) {
  const wrap  = document.getElementById('bulk-progress-wrap');
  const label = document.getElementById('bulk-progress-label');
  const pct   = document.getElementById('bulk-progress-pct');
  const fill  = document.getElementById('bulk-progress-fill');
  const stats = document.getElementById('bulk-progress-stats');

  if (!wrap) return;
  wrap.style.display = 'block';

  const total    = data.total || 0;
  const done     = (data.sent || 0) + (data.failed || 0) + (data.skipped || 0);
  const percent  = total > 0 ? Math.round((done / total) * 100) : 0;

  label.textContent = data.status === 'running' ? `Sending… (${data.campaignId?.slice(0, 8)})` : `Campaign ${data.status}`;
  pct.textContent   = `${percent}%`;
  fill.style.width  = `${percent}%`;
  fill.style.background = data.status === 'completed' ? '#22c55e' : data.status === 'failed' || data.status === 'cancelled' ? '#ef4444' : '#3b82f6';
  stats.innerHTML = `
    <span style="color:#22c55e">✓ Sent: ${data.sent || 0}</span> &nbsp;
    <span style="color:#ef4444">✗ Failed: ${data.failed || 0}</span> &nbsp;
    <span style="color:#f59e0b">⊘ Skipped: ${data.skipped || 0}</span> &nbsp;
    <span style="opacity:.6">/ ${total} total</span>
  `;

  if (data.status !== 'running') {
    setTimeout(() => { if (wrap) wrap.style.display = 'none'; }, 6000);
  }
}

// ─── Utility ──────────────────────────────────────────────────────────────────
function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Re-use showToast from app.js if available; else define a fallback
if (typeof window.showToast !== 'function') {
  window.showToast = function (msg, type = 'info') {
    console.log(`[Toast:${type}] ${msg}`);
  };
}
