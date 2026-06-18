'use strict';

// ---------------------------------------------------------------------------
// State + tiny helpers
// ---------------------------------------------------------------------------
const state = {
  meta: { departments: [], priorities: [], statuses: [], ai: { enabled: false } },
  role: 'employee',
  user: 'Priya Sharma',
  priority: 'normal',
  category: 'IT',
};
const USERS = ['Priya Sharma', 'Daniel Kim', 'Aisha Khan', 'Tom Reyes', 'Lena Fischer', 'Marco Bianchi'];

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const api = async (url, opts) => {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const PRI_LABEL = { urgent: '🔴 Urgent', mild: '🟡 Mild', normal: '🟢 Non-urgent' };
const timeAgo = (iso) => {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function boot() {
  state.meta = await api('/api/meta');
  hydrateSelects();
  buildUserSelect();
  buildPriorityPicker();
  wireNav();
  wireRoleSwitch();
  wireNewTicket();
  wireFilters();
  wireBell();
  refreshNotifications();
  setInterval(refreshNotifications, 15000);
  showAIStatus();
}

function showAIStatus() {
  const hint = $('#aiHints');
  if (!state.meta.ai.enabled) {
    // Subtle note that heuristics are in use; not an error.
    document.title = 'Helpdesk · Internal Support';
  }
}

function hydrateSelects() {
  const cat = $('#f-cat'), fcat = $('#flt-cat'), fstatus = $('#flt-status');
  state.meta.departments.forEach((d) => {
    cat.append(new Option(d, d));
    fcat.append(new Option(d, d));
  });
  state.meta.statuses.forEach((s) => fstatus.append(new Option(s, s)));
  cat.value = state.category;
  cat.onchange = () => { state.category = cat.value; $('#catTag').hidden = true; };
}

function buildUserSelect() {
  const sel = $('#userSelect');
  USERS.forEach((u) => sel.append(new Option(u, u)));
  sel.value = state.user;
  sel.onchange = () => { state.user = sel.value; refreshNotifications(); if (currentView === 'tickets') loadTickets(); };
}

function buildPriorityPicker() {
  const wrap = $('#priorityPicker');
  wrap.innerHTML = state.meta.priorities
    .map((p) => `<div class="pri" data-p="${p}">${PRI_LABEL[p].replace(/^\S+\s/, '')}</div>`)
    .join('');
  $$('.pri', wrap).forEach((el) => {
    el.onclick = () => setPriority(el.dataset.p);
  });
  setPriority('normal');
}
function setPriority(p) {
  state.priority = p;
  $$('.pri').forEach((el) => el.classList.toggle('sel', el.dataset.p === p));
}

// ---------------------------------------------------------------------------
// Navigation / role
// ---------------------------------------------------------------------------
let currentView = 'new';
function wireNav() {
  $$('#nav button').forEach((b) => (b.onclick = () => switchView(b.dataset.view)));
}
function switchView(view) {
  currentView = view;
  $$('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $$('.view').forEach((v) => (v.hidden = v.id !== `view-${view}`));
  if (view === 'tickets') loadTickets();
  if (view === 'analytics') loadAnalytics();
}
function wireRoleSwitch() {
  $$('#roleSwitch button').forEach((b) => {
    b.onclick = () => {
      state.role = b.dataset.role;
      $$('#roleSwitch button').forEach((x) => x.classList.toggle('active', x === b));
      $('#userSelect').style.display = state.role === 'agent' ? 'none' : '';
      $('#bell').style.display = state.role === 'agent' ? 'none' : '';
      if (currentView === 'tickets') loadTickets();
    };
  });
}

// ---------------------------------------------------------------------------
// New ticket + AI assist
// ---------------------------------------------------------------------------
function wireNewTicket() {
  const desc = $('#f-desc'), title = $('#f-title');
  const trigger = debounce(runAI, 700);
  desc.addEventListener('input', trigger);
  title.addEventListener('input', trigger);
  $('#btnAnalyze').onclick = runAI;
  $('#btnSubmit').onclick = submitTicket;
}

async function runAI() {
  const title = $('#f-title').value.trim();
  const description = $('#f-desc').value.trim();
  if (description.length < 12) return;

  const hints = $('#aiHints');
  hints.hidden = false;
  hints.innerHTML = `<span class="spin">✨</span> Analysing with ${state.meta.ai.enabled ? 'Claude' : 'AI'}…`;

  try {
    const [cat, similar] = await Promise.all([
      api('/api/ai/categorize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, description }) }),
      api('/api/ai/similar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, description }) }),
    ]);

    // Apply suggested category + priority.
    $('#f-cat').value = cat.category;
    state.category = cat.category;
    $('#catTag').hidden = false;
    if (cat.priority) setPriority(cat.priority);

    const conf = Math.round((cat.confidence || 0) * 100);
    const badge = cat.source === 'claude' ? 'Claude' : 'AI';
    hints.innerHTML =
      `<strong>✨ Suggested: ${esc(cat.category)} · ${PRI_LABEL[cat.priority] || cat.priority}</strong>` +
      ` <span class="ai-tag">${badge} · ${conf}% confident</span>` +
      `<div class="reason">${esc(cat.reason || '')}</div>`;

    renderSimilar(similar);
  } catch (e) {
    hints.innerHTML = `<span style="color:var(--red)">AI unavailable: ${esc(e.message)}</span>`;
  }
}

function renderSimilar(list) {
  const box = $('#similarBox'), out = $('#similarList');
  if (!list.length) { box.hidden = true; return; }
  box.hidden = false;
  out.innerHTML = list
    .map(
      (s) => `<div class="sim-item">
        <div>
          <div><strong>${esc(s.title)}</strong></div>
          <div class="meta">${esc(s.id)} · ${esc(s.category)} · ${esc(s.status)}${s.resolution ? ' — ' + esc(s.resolution) : ''}</div>
        </div>
        <div class="pct">${s.match}% match</div>
      </div>`
    )
    .join('');
}

async function submitTicket() {
  const title = $('#f-title').value.trim();
  const description = $('#f-desc').value.trim();
  const msg = $('#newMsg');
  if (!title || !description) {
    msg.hidden = false; msg.className = 'inline-msg err'; msg.textContent = 'Please add a title and description.';
    return;
  }
  try {
    const t = await api('/api/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title, description,
        category: $('#f-cat').value,
        priority: state.priority,
        requester: state.user,
        aiCategorized: !$('#catTag').hidden,
      }),
    });
    msg.hidden = false; msg.className = 'inline-msg ok';
    msg.textContent = `✅ Ticket ${t.id} created and routed to the ${t.category} queue. You'll be notified as it progresses.`;
    $('#f-title').value = ''; $('#f-desc').value = '';
    $('#aiHints').hidden = true; $('#similarBox').hidden = true; $('#catTag').hidden = true;
    setPriority('normal');
    refreshNotifications();
  } catch (e) {
    msg.hidden = false; msg.className = 'inline-msg err'; msg.textContent = e.message;
  }
}

// ---------------------------------------------------------------------------
// Tickets list
// ---------------------------------------------------------------------------
function wireFilters() {
  ['#flt-cat', '#flt-pri', '#flt-status'].forEach((s) => ($(s).onchange = loadTickets));
  $('#flt-q').oninput = debounce(loadTickets, 250);
}

async function loadTickets() {
  const params = new URLSearchParams();
  const cat = $('#flt-cat').value, pri = $('#flt-pri').value, st = $('#flt-status').value, q = $('#flt-q').value.trim();
  if (cat) params.set('category', cat);
  if (pri) params.set('priority', pri);
  if (st) params.set('status', st);
  if (q) params.set('q', q);
  // Employees only see their own tickets.
  if (state.role === 'employee') params.set('requester', state.user);
  $('#ticketsTitle').textContent = state.role === 'employee' ? `My tickets` : 'Department queues';

  const rows = await api('/api/tickets?' + params.toString());
  const grid = $('#ticketGrid');
  if (!rows.length) { grid.innerHTML = `<div class="empty">No tickets match these filters.</div>`; return; }
  grid.innerHTML = rows.map(ticketCard).join('');
  $$('.tcard', grid).forEach((el) => (el.onclick = () => openDrawer(el.dataset.id)));
}

function ticketCard(t) {
  return `<div class="tcard p-${t.priority}" data-id="${t.id}">
    <div class="id">${t.id}</div>
    <h4>${esc(t.title)}</h4>
    <div class="desc">${esc(t.description)}</div>
    <div class="foot">
      <span class="dot ${t.priority}"></span>
      <span class="chip dept">${esc(t.category)}</span>
      <span class="chip status-${t.status.replace(/\s/g, '')}">${esc(t.status)}</span>
      <span class="chip">${esc(t.requester)}</span>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Ticket drawer (detail + agent actions)
// ---------------------------------------------------------------------------
async function openDrawer(id) {
  const t = await api('/api/tickets/' + id);
  const drawer = $('#drawer'), overlay = $('#drawerOverlay');
  const isAgent = state.role === 'agent';

  drawer.innerHTML = `
    <div class="dh">
      <div>
        <div class="id" style="color:var(--muted);font-size:11px;font-weight:600">${t.id}</div>
        <h2>${esc(t.title)}</h2>
        <div class="foot" style="display:flex;gap:6px;margin-top:6px">
          <span class="chip dept">${esc(t.category)}</span>
          <span class="chip status-${t.status.replace(/\s/g, '')}">${esc(t.status)}</span>
          <span class="chip">${PRI_LABEL[t.priority]}</span>
        </div>
      </div>
      <button class="close" id="drawerClose">✕</button>
    </div>

    <div class="section">
      <h3>Description</h3>
      <div class="desc-full">${esc(t.description)}</div>
      <div style="color:var(--muted);font-size:12px;margin-top:8px">Raised by ${esc(t.requester)} · ${timeAgo(t.createdAt)}${t.agent ? ' · Agent: ' + esc(t.agent) : ''}</div>
    </div>

    <div class="section">
      <h3>Lifecycle</h3>
      ${isAgent ? statusFlow(t) : `<div class="agent-only-note">Switch to the Agent view to update status. Current: <strong>${esc(t.status)}</strong></div>`}
    </div>

    ${isAgent ? `
    <div class="section">
      <h3>AI suggested first response</h3>
      <button class="ghost" id="btnDraft">✨ Generate draft reply</button>
      <textarea class="draft-box" id="draftBox" placeholder="Click generate to draft a first response based on this ticket and similar resolved cases…"></textarea>
    </div>
    <div class="section">
      <h3>Resolution notes</h3>
      <textarea id="resBox" rows="3" placeholder="What fixed it? Saved for future AI similar-ticket matching.">${esc(t.resolution || '')}</textarea>
      <div class="actions" style="margin-top:8px"><button class="ghost" id="btnSaveRes">Save notes</button></div>
    </div>` : ''}

    <div class="section">
      <h3>Timeline</h3>
      <div class="timeline">
        ${t.history.slice().reverse().map((h) => `<div class="tl-item"><strong>${esc(h.status)}</strong> — ${esc(h.note || '')}<div class="t">${timeAgo(h.at)}</div></div>`).join('')}
      </div>
    </div>`;

  drawer.hidden = false; overlay.hidden = false;
  $('#drawerClose').onclick = closeDrawer;
  overlay.onclick = closeDrawer;

  if (isAgent) {
    $$('.status-flow button').forEach((b) => (b.onclick = () => changeStatus(t.id, b.dataset.s)));
    $('#btnDraft').onclick = () => generateDraft(t.id);
    $('#btnSaveRes').onclick = () => saveResolution(t.id);
  }
}
function closeDrawer() { $('#drawer').hidden = true; $('#drawerOverlay').hidden = true; }

function statusFlow(t) {
  const flow = state.meta.statuses;
  const cur = flow.indexOf(t.status);
  return `<div class="status-flow">${flow
    .map((s, i) => {
      const isCur = s === t.status;
      // Allow moving to the next/previous step or reopening.
      const enabled = !isCur && (i === cur + 1 || i === cur - 1 || (t.status === 'Closed' && s === 'Open') || (t.status === 'Resolved' && s === 'In Progress'));
      return `<button data-s="${s}" class="${isCur ? 'cur' : ''}" ${enabled ? '' : 'disabled'}>${isCur ? '● ' : ''}${s}</button>`;
    })
    .join('')}</div>
    <div style="color:var(--muted);font-size:12px;margin-top:8px">Open → In Progress → Resolved → Closed. The employee is notified on every move.</div>`;
}

async function changeStatus(id, status) {
  await api(`/api/tickets/${id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, agent: 'Support Agent', note: `Moved to ${status} by agent` }),
  });
  openDrawer(id);
  loadTickets();
  refreshNotifications();
}

async function generateDraft(id) {
  const box = $('#draftBox'), btn = $('#btnDraft');
  btn.innerHTML = '<span class="spin">✨</span> Drafting…';
  try {
    const { draft } = await api(`/api/ai/draft/${id}`, { method: 'POST' });
    box.value = draft;
  } catch (e) {
    box.value = 'Could not generate a draft: ' + e.message;
  } finally {
    btn.innerHTML = '✨ Generate draft reply';
  }
}

async function saveResolution(id) {
  await api(`/api/tickets/${id}/resolution`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resolution: $('#resBox').value }),
  });
  const btn = $('#btnSaveRes');
  btn.textContent = 'Saved ✓';
  setTimeout(() => (btn.textContent = 'Save notes'), 1500);
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------
function wireBell() {
  $('#bell').onclick = (e) => {
    if (e.target.closest('.notif-panel')) return;
    const panel = $('#notifPanel');
    panel.hidden = !panel.hidden;
    if (!panel.hidden) {
      api('/api/notifications/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requester: state.user }) })
        .then(refreshNotifications);
    }
  };
  document.addEventListener('click', (e) => { if (!e.target.closest('#bell')) $('#notifPanel').hidden = true; });
}

async function refreshNotifications() {
  if (state.role === 'agent') return;
  const items = await api('/api/notifications?requester=' + encodeURIComponent(state.user));
  const unread = items.filter((n) => !n.read).length;
  const badge = $('#bellBadge');
  badge.hidden = unread === 0;
  badge.textContent = unread;
  const panel = $('#notifPanel');
  panel.innerHTML = items.length
    ? items.slice(0, 20).map((n) => `<div class="notif-item ${n.read ? '' : 'unread'}">${esc(n.message)}<div class="t">${timeAgo(n.at)}</div></div>`).join('')
    : `<div class="notif-empty">No notifications yet.</div>`;
}

// ---------------------------------------------------------------------------
// Analytics — self-rendered SVG charts (no external libraries)
// ---------------------------------------------------------------------------
async function loadAnalytics() {
  const s = await api('/api/stats');
  $('#kpiRow').innerHTML = [
    ['Total tickets', s.total],
    ['Open', s.byStatus.Open || 0],
    ['In Progress', s.byStatus['In Progress'] || 0],
    ['Resolved', (s.byStatus.Resolved || 0) + (s.byStatus.Closed || 0)],
  ].map(([l, n]) => `<div class="kpi"><div class="n">${n}</div><div class="l">${l}</div></div>`).join('');

  $('#chart-month').innerHTML = barChart(
    s.byMonth.map((m) => ({ label: m.month.slice(5), value: m.count })),
    '#2f6df6'
  );
  $('#chart-dept').innerHTML = barChart(
    Object.entries(s.byDept).map(([k, v]) => ({ label: k, value: v })),
    '#7c5cff'
  );
  $('#chart-status').innerHTML = donut([
    { label: 'Open', value: s.byStatus.Open || 0, color: '#56627a' },
    { label: 'In Progress', value: s.byStatus['In Progress'] || 0, color: '#d9a800' },
    { label: 'Resolved', value: s.byStatus.Resolved || 0, color: '#2faf5f' },
    { label: 'Closed', value: s.byStatus.Closed || 0, color: '#6b53c9' },
  ]);
}

function barChart(data, color) {
  const W = 360, H = 180, pad = 28;
  const max = Math.max(1, ...data.map((d) => d.value));
  const bw = (W - pad * 2) / data.length;
  const bars = data.map((d, i) => {
    const h = (d.value / max) * (H - pad * 2);
    const x = pad + i * bw + bw * 0.18;
    const y = H - pad - h;
    const w = bw * 0.64;
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${color}"></rect>
      <text x="${x + w / 2}" y="${y - 6}" text-anchor="middle" font-size="11" fill="#1c2430" font-weight="600">${d.value}</text>
      <text x="${x + w / 2}" y="${H - pad + 16}" text-anchor="middle" font-size="11" fill="#6b7686">${esc(d.label)}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%"><line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="#e6e9ee"/>${bars}</svg>`;
}

function donut(data) {
  const total = data.reduce((a, b) => a + b.value, 0) || 1;
  const R = 70, r = 44, cx = 90, cy = 90;
  let angle = -Math.PI / 2;
  const arcs = data.map((d) => {
    const frac = d.value / total;
    const a2 = angle + frac * Math.PI * 2;
    const large = frac > 0.5 ? 1 : 0;
    const x1 = cx + R * Math.cos(angle), y1 = cy + R * Math.sin(angle);
    const x2 = cx + R * Math.cos(a2), y2 = cy + R * Math.sin(a2);
    const xi2 = cx + r * Math.cos(a2), yi2 = cy + r * Math.sin(a2);
    const xi1 = cx + r * Math.cos(angle), yi1 = cy + r * Math.sin(angle);
    angle = a2;
    if (frac === 0) return '';
    return `<path d="M ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2} L ${xi2} ${yi2} A ${r} ${r} 0 ${large} 0 ${xi1} ${yi1} Z" fill="${d.color}"></path>`;
  }).join('');
  const legend = data.map((d) => `<span><i style="background:${d.color}"></i>${esc(d.label)} (${d.value})</span>`).join('');
  return `<svg viewBox="0 0 180 180" width="180" height="180" style="display:block;margin:0 auto">${arcs}
    <text x="90" y="86" text-anchor="middle" font-size="22" font-weight="700" fill="#1c2430">${total}</text>
    <text x="90" y="104" text-anchor="middle" font-size="11" fill="#6b7686">total</text></svg>
    <div class="legend">${legend}</div>`;
}

boot().catch((e) => {
  document.body.innerHTML = `<div style="padding:40px;font-family:sans-serif">Failed to start: ${e.message}</div>`;
});
