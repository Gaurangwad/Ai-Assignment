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
  ticketView: 'list',
  analyticsSrc: 'live',
  gran: 'month',
  csv: null,
  railOpen: true,
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
const PRI_TEXT = { urgent: 'Urgent', mild: 'Mild', normal: 'Non-urgent' };
const PRI_COLOR = { urgent: '#e5484d', mild: '#d9a800', normal: '#2faf5f' };

// Single coloured inline-SVG icons used across the UI (no emoji).
const ICON = {
  ai: (c = '#2f6df6', s = 15) =>
    `<svg class="ic" viewBox="0 0 24 24" width="${s}" height="${s}" fill="${c}" aria-hidden="true"><path d="M12 2l1.7 5L19 8.7l-5.3 1.8L12 16l-1.7-5.5L5 8.7 10.3 7z"/></svg>`,
  check: (c = '#2faf5f', s = 15) =>
    `<svg class="ic" viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="${c}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M8 12.5l2.5 2.5L16 9"/></svg>`,
  dot: (p) =>
    `<svg class="ic" viewBox="0 0 8 8" width="8" height="8" style="margin-right:5px" aria-hidden="true"><circle cx="4" cy="4" r="4" fill="${PRI_COLOR[p]}"/></svg>`,
};
// Coloured-dot priority label for HTML contexts.
const priLabel = (p) => `${ICON.dot(p)}${PRI_TEXT[p]}`;
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
  wireChat();
  wireTheme();
  wireAnalytics();
  wireChartTip();
  wireRag();
  applyRoleVisibility();
  renderHomeRail();
  refreshNotifications();
  setInterval(refreshNotifications, 15000);
  showAIStatus();
}

// Floating tooltip for charts (bars, points, heatmap cells with data-tip).
function wireChartTip() {
  const tip = document.createElement('div');
  tip.id = 'chartTip'; tip.className = 'chart-tip';
  document.body.appendChild(tip);
  document.addEventListener('mousemove', (e) => {
    const el = e.target.closest && e.target.closest('[data-tip]');
    if (el) {
      tip.textContent = el.getAttribute('data-tip');
      tip.style.display = 'block';
      const x = Math.min(window.innerWidth - tip.offsetWidth - 10, e.clientX + 14);
      tip.style.left = Math.max(8, x) + 'px';
      tip.style.top = (e.clientY + 14) + 'px';
    } else { tip.style.display = 'none'; }
  });
}

// ---------------------------------------------------------------------------
// Dark mode
// ---------------------------------------------------------------------------
const SUN = `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`;
const MOON = `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>`;
function wireTheme() {
  const btn = $('#themeToggle');
  const paint = () => { btn.innerHTML = document.documentElement.getAttribute('data-theme') === 'dark' ? SUN : MOON; };
  paint();
  btn.onclick = () => {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    if (dark) { document.documentElement.removeAttribute('data-theme'); localStorage.setItem('hd-theme', 'light'); }
    else { document.documentElement.setAttribute('data-theme', 'dark'); localStorage.setItem('hd-theme', 'dark'); }
    paint();
    if (currentView === 'analytics') loadAnalytics(); // recolour charts for theme
  };
}

// ---------------------------------------------------------------------------
// Progress stepper (Open ●—○—○—○ Closed)
// ---------------------------------------------------------------------------
function stepperHTML(status, mini = false) {
  const flow = state.meta.statuses;
  const cur = flow.indexOf(status);
  return `<div class="stepper${mini ? ' mini' : ''}">${flow.map((s, i) => {
    const cls = i < cur ? 'done' : i === cur ? 'current' : '';
    return `<div class="st ${cls}"><span class="bar"></span><span class="dot"></span>${mini ? '' : `<span class="lbl">${s}</span>`}</div>`;
  }).join('')}</div>`;
}

// ---------------------------------------------------------------------------
// Home rail: My open tickets + Recently asked
// ---------------------------------------------------------------------------
function recentKey() { return `hd-recent-${state.user}`; }
function getRecent() { try { return JSON.parse(localStorage.getItem(recentKey()) || '[]'); } catch { return []; } }
function pushRecent(q) {
  const list = getRecent().filter((x) => x.toLowerCase() !== q.toLowerCase());
  list.unshift(q);
  localStorage.setItem(recentKey(), JSON.stringify(list.slice(0, 6)));
}

async function renderHomeRail() {
  // My open tickets
  try {
    const rows = await api('/api/tickets?requester=' + encodeURIComponent(state.user));
    const open = rows.filter((t) => t.status !== 'Closed');
    $('#myOpenCount').textContent = open.length;
    $('#myOpenList').innerHTML = open.length
      ? open.slice(0, 5).map((t) => `<div class="rail-item" data-id="${t.id}">
          <div class="id">${t.id} · ${esc(t.category)}</div>
          <h6>${esc(t.title)}</h6>
          ${stepperHTML(t.status, true)}
        </div>`).join('')
      : `<div class="rail-empty">No open tickets — nice.</div>`;
    $$('#myOpenList .rail-item').forEach((el) => (el.onclick = () => openDrawer(el.dataset.id)));
  } catch { /* ignore */ }

  // Recently asked
  const recent = getRecent();
  $('#clearRecent').hidden = !recent.length;
  $('#recentList').innerHTML = recent.length
    ? recent.map((q) => `<div class="recent-chip">${ICON.ai('#6b7686', 13)}<span>${esc(q)}</span></div>`).join('')
    : `<div class="rail-empty">Your recent questions show up here.</div>`;
  $$('#recentList .recent-chip').forEach((el, i) => (el.onclick = () => { switchView('ask'); submitChat(recent[i]); }));
  $('#clearRecent').onclick = () => { localStorage.removeItem(recentKey()); renderHomeRail(); };
}

// ---------------------------------------------------------------------------
// Ask AI — conversational assistant
// ---------------------------------------------------------------------------
const CHAT_EXAMPLES = [
  "My monitor isn't turning on",
  'I forgot my password',
  'Where do I submit my expense report?',
  'VPN keeps dropping',
];

function wireChat() {
  const box = $('#chatBox'), send = $('#chatSend');
  send.onclick = () => submitChat();
  box.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitChat(); });
  $('#chatSuggest').innerHTML = CHAT_EXAMPLES.map((t) => `<button>${esc(t)}</button>`).join('');
  $$('#chatSuggest button').forEach((b) => (b.onclick = () => { $('#chatBox').value = b.textContent; submitChat(); }));
  // Friendly greeting.
  addBubble('bot', `<div class="botline">${ICON.ai('#2f6df6', 15)} Assistant</div>Hi ${esc((state.user || '').split(' ')[0] || 'there')} — tell me what's going on and I'll try to fix it right away or get it to the right team.`);
}

function addBubble(role, html) {
  const log = $('#chatLog');
  const div = document.createElement('div');
  div.className = `bubble ${role}`;
  div.innerHTML = html;
  log.appendChild(div);
  div.scrollIntoView({ behavior: 'smooth', block: 'end' });
  return div;
}

async function submitChat(text) {
  const box = $('#chatBox');
  const message = (text || box.value).trim();
  if (!message) return;
  box.value = '';
  pushRecent(message);
  renderHomeRail();
  addBubble('user', esc(message));
  const thinking = addBubble('bot', `<div class="botline">${ICON.ai('#2f6df6', 15)} Assistant</div><span class="spin">${ICON.ai('#6b7686', 14)}</span> Searching our help docs…`);
  try {
    const r = await api('/api/ai/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    thinking.remove();
    renderBotAnswer(r);
  } catch (e) {
    thinking.remove();
    addBubble('bot warn', `Sorry, I hit a problem: ${esc(e.message)}`);
  }
}

function renderBotAnswer(r) {
  if (r.type === 'gibberish') {
    addBubble('bot warn', `<div class="botline">${ICON.ai('#a9700a', 15)} Assistant</div>${esc(r.reply)}`);
    return;
  }
  let html = `<div class="botline">${ICON.ai('#2f6df6', 15)} Assistant${r.resolved ? `<span class="resolved-tag">Quick fix</span>` : ''}</div>${esc(r.reply)}`;
  if (r.article && r.article.steps && r.article.steps.length) {
    html += `<ol class="steps">${r.article.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`;
    if (r.article.link) {
      html += `<a class="kb-link" href="${esc(r.article.link)}" target="_blank" rel="noopener">${ICON.ai('#2f6df6', 13)} Open the help doc</a>`;
    }
  }
  if (r.similar && r.similar.length) {
    html += `<div class="past">Past resolved cases: ${r.similar.map((s) => `<b>${esc(s.title)}</b> (${s.match}%)`).join(', ')}.</div>`;
  }
  // Suggestions are never applied automatically — the employee decides.
  html += `<div class="hint-line">This is just a suggestion — it's your call. Accept it, or raise a ticket for a person to help.</div>`;
  html += `<div class="bubble-actions">`;
  if (r.action) html += `<button class="self" data-act="accept">${esc(r.action.label)}</button>`;
  else if (r.resolved) html += `<button class="done" data-act="solved">This solved it</button>`;
  html += `<button class="raise">${r.resolved || r.action ? 'No, raise a ticket' : 'Raise a ticket'}</button></div>`;

  const bubble = addBubble('bot', html);
  const self = bubble.querySelector('.self');
  if (self) self.onclick = () => runSelfService(r, self);
  const done = bubble.querySelector('.done');
  if (done) done.onclick = () => markSolved(done);
  bubble.querySelector('.raise').onclick = () => raiseFromChat(r.suggestedTicket);
}

function markSolved(btn) {
  btn.disabled = true; btn.textContent = 'Marked resolved ✓';
  addBubble('bot', `<div class="botline">${ICON.check('#1d7a42', 15)} Resolved</div>Glad that helped — I've closed this off, no ticket needed. If it comes back, just ask again or raise a ticket.`);
}

async function runSelfService(r, btn) {
  btn.disabled = true; btn.textContent = 'Working…';
  try {
    const res = await api('/api/ai/action', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: r.action.id, requester: state.user }),
    });
    addBubble('bot', `<div class="botline">${ICON.check('#1d7a42', 15)} Done</div>${esc(res.message)}`);
    btn.textContent = 'Accepted ✓';
    confirmFix(r); // even after an autofix, let them reject and escalate
  } catch (e) {
    btn.disabled = false; btn.textContent = 'Try again';
    addBubble('bot warn', `Couldn't complete that: ${esc(e.message)}`);
  }
}

// After any self-service fix, confirm it worked — and still offer to escalate.
function confirmFix(r) {
  const bubble = addBubble('bot',
    `Did that sort it out?<div class="bubble-actions">` +
    `<button class="done">Yes, all good</button>` +
    `<button class="raise">No, raise a ticket</button></div>`);
  bubble.querySelector('.done').onclick = (e) => {
    e.target.disabled = true; e.target.textContent = 'Thanks ✓';
    addBubble('bot', `<div class="botline">${ICON.check('#1d7a42', 15)} Nice</div>Great — glad it's working now.`);
  };
  bubble.querySelector('.raise').onclick = () => raiseFromChat(r.suggestedTicket);
}

function raiseFromChat(t) {
  switchView('new');
  if (!t) return;
  $('#f-title').value = t.title || '';
  $('#f-desc').value = t.description || '';
  if (t.category) { $('#f-cat').value = t.category; state.category = t.category; $('#catTag').hidden = false; }
  if (t.priority) setPriority(t.priority);
  runAssist(true);
}

function showAIStatus() {
  document.title = state.meta.ai.enabled
    ? 'AI-assisted support'
    : 'Internal Support';
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
  sel.onchange = () => { state.user = sel.value; refreshNotifications(); renderHomeRail(); if (currentView === 'tickets') loadTickets(); };
}

function buildPriorityPicker() {
  const wrap = $('#priorityPicker');
  wrap.innerHTML = state.meta.priorities
    .map((p) => `<div class="pri" data-p="${p}">${ICON.dot(p)}${PRI_TEXT[p]}</div>`)
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
let currentView = 'ask';
function wireNav() {
  $$('#nav button').forEach((b) => (b.onclick = () => switchView(b.dataset.view)));
}
function switchView(view) {
  // Analytics is agent-only; Ask AI is employee-only.
  if (view === 'analytics' && state.role !== 'agent') view = 'tickets';
  if (view === 'ask' && state.role !== 'employee') view = 'tickets';
  currentView = view;
  $$('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $$('.view').forEach((v) => (v.hidden = v.id !== `view-${view}`));
  if (view === 'tickets') loadTickets();
  if (view === 'analytics') loadAnalytics();
  if (view === 'ask') renderHomeRail();
}

// Role-restricted UI: Analytics + RAG bot are agent-only; Ask AI is employee-only.
function applyRoleVisibility() {
  const isEmp = state.role === 'employee';
  const analyticsBtn = $('#nav button[data-view="analytics"]');
  const askBtn = $('#nav button[data-view="ask"]');
  if (analyticsBtn) analyticsBtn.style.display = isEmp ? 'none' : '';
  if (askBtn) askBtn.style.display = isEmp ? '' : 'none';
  // RAG knowledge bot — agent only.
  const fab = $('#ragFab'), panel = $('#ragPanel');
  if (isEmp) { if (fab) fab.style.display = 'none'; if (panel) panel.hidden = true; }
  else if (fab && panel) { fab.style.display = panel.hidden ? '' : 'none'; }
  // Redirect away from a view the current role can't access.
  if (isEmp && currentView === 'analytics') switchView('ask');
  if (!isEmp && currentView === 'ask') switchView('tickets');
}
function wireRoleSwitch() {
  $$('#roleSwitch button').forEach((b) => {
    b.onclick = () => {
      state.role = b.dataset.role;
      $$('#roleSwitch button').forEach((x) => x.classList.toggle('active', x === b));
      $('#userSelect').style.display = state.role === 'agent' ? 'none' : '';
      $('#bell').title = state.role === 'agent' ? 'Urgent ticket alerts' : 'Notifications';
      applyRoleVisibility();
      refreshNotifications();
      if (currentView === 'tickets') loadTickets();
    };
  });
}

// ---------------------------------------------------------------------------
// New ticket + AI assist
// ---------------------------------------------------------------------------
let lastAssist = null;       // most recent assist payload
let lastApplied = null;      // {field, prev} for one-click undo

function wireNewTicket() {
  const desc = $('#f-desc'), title = $('#f-title');
  const trigger = debounce(runAssist, 650);
  desc.addEventListener('input', trigger);
  title.addEventListener('input', trigger);
  $('#btnAnalyze').onclick = () => runAssist(true);
  $('#btnSubmit').onclick = submitTicket;
}

async function runAssist(force = false) {
  const title = $('#f-title').value.trim();
  const description = $('#f-desc').value.trim();
  const body = $('#assistBody');
  if (description.length < 10 && !force) return;
  if (description.length < 6) { body.innerHTML = `<div class="assist-empty">Add a few more words and I'll get to work.</div>`; return; }

  body.innerHTML = `<div class="assist-empty"><span class="spin">${ICON.ai()}</span> Analysing with ${state.meta.ai.enabled ? 'Claude' : 'AI'}…</div>`;
  try {
    const a = await api('/api/ai/assist', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description }),
    });
    lastAssist = a;
    // Auto-apply routing (the employee can still override the dropdown).
    $('#f-cat').value = a.category;
    state.category = a.category;
    $('#catTag').hidden = false;
    if (a.priority) setPriority(a.priority);
    renderAssist(a);
  } catch (e) {
    body.innerHTML = `<div class="assist-empty" style="color:var(--red)">AI unavailable: ${esc(e.message)}</div>`;
  }
}

function renderAssist(a) {
  const conf = Math.round((a.confidence || 0) * 100);
  const score = a.score ?? 0;
  const meterClass = score >= 75 ? 'good' : score >= 45 ? 'warn' : '';
  const cards = [];

  // Routing
  const confClass = conf >= 75 ? 'good' : conf >= 50 ? 'warn' : '';
  cards.push(`<div class="acard">
    <div class="ahead">${ICON.ai('#6b7686', 13)} Suggested routing</div>
    <div class="big">${esc(a.category)} · ${priLabel(a.priority)}</div>
    <div class="meter ${confClass}" style="margin-top:8px"><i style="width:${conf}%"></i></div>
    <div class="reason">${conf}% confident — ${esc(a.reason || '')}</div>
  </div>`);

  // Rephrase / improve writing
  if (a.rephrasedTitle || a.rephrasedDescription) {
    cards.push(`<div class="acard">
      <div class="ahead">${ICON.ai('#6b7686', 13)} Improve the wording</div>
      ${a.rephrasedTitle ? `<div style="font-size:12px;color:var(--muted)">Suggested title</div><div class="rephrase" id="rpTitle">${esc(a.rephrasedTitle)}</div>` : ''}
      ${a.rephrasedDescription ? `<div style="font-size:12px;color:var(--muted);margin-top:8px">Suggested description</div><div class="rephrase" id="rpDesc">${esc(a.rephrasedDescription)}</div>` : ''}
      <div class="apply-row">
        <button class="apply-btn" id="applyAll">Apply both</button>
        ${a.rephrasedTitle ? `<button class="apply-btn sec" id="applyTitle">Title</button>` : ''}
        ${a.rephrasedDescription ? `<button class="apply-btn sec" id="applyDesc">Description</button>` : ''}
      </div>
      <button class="apply-btn sec" id="undoApply" style="margin-top:8px" hidden>Undo</button>
    </div>`);
  }

  // Tags
  if (a.tags && a.tags.length) {
    cards.push(`<div class="acard">
      <div class="ahead">Tags</div>
      <div class="tags">${a.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
    </div>`);
  }

  // Completeness
  cards.push(`<div class="acard">
    <div class="ahead">Ticket completeness</div>
    <div class="big" style="font-size:14px">${score}/100</div>
    <div class="meter ${meterClass}"><i style="width:${score}%"></i></div>
    ${a.missing && a.missing.length
      ? `<div class="reason">Add for a faster fix:</div><ul class="miss-list">${a.missing.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>`
      : `<div class="reason">Looks complete — good to submit.</div>`}
  </div>`);

  // Self-help deflection
  if (a.selfHelp) {
    cards.push(`<div class="acard">
      <div class="ahead">${ICON.check('#1d7a42', 13)} Before you submit</div>
      <div class="selfhelp">${esc(a.selfHelp)}</div>
    </div>`);
  }

  // Similar tickets (keep match %)
  if (a.similar && a.similar.length) {
    cards.push(`<div class="acard dup">
      <div class="ahead">Possible duplicates</div>
      ${a.similar.map((s) => `<div class="sim-item">
        <div><strong>${esc(s.title)}</strong>
          <div class="meta">${esc(s.id)} · ${esc(s.status)}${s.resolution ? ' — ' + esc(s.resolution) : ''}</div>
        </div>
        <div class="pct">${s.match}%</div>
      </div>`).join('')}
    </div>`);
  }

  $('#assistBody').innerHTML = cards.join('');
  const mode = $('#assistMode');
  mode.hidden = false;
  mode.innerHTML = a.source === 'claude' ? `Powered by <b>Claude</b>` : `Smart heuristics — set an API key for <b>Claude</b>`;

  // Wire apply / undo
  const applyTitle = () => { stash('#f-title'); $('#f-title').value = a.rephrasedTitle; };
  const applyDesc = () => { stash('#f-desc'); $('#f-desc').value = a.rephrasedDescription; };
  if ($('#applyTitle')) $('#applyTitle').onclick = () => { applyTitle(); showUndo(); };
  if ($('#applyDesc')) $('#applyDesc').onclick = () => { applyDesc(); showUndo(); };
  if ($('#applyAll')) $('#applyAll').onclick = () => {
    lastApplied = { title: $('#f-title').value, desc: $('#f-desc').value };
    if (a.rephrasedTitle) $('#f-title').value = a.rephrasedTitle;
    if (a.rephrasedDescription) $('#f-desc').value = a.rephrasedDescription;
    showUndo();
  };
  if ($('#undoApply')) $('#undoApply').onclick = () => {
    if (!lastApplied) return;
    if (lastApplied.title !== undefined) $('#f-title').value = lastApplied.title;
    if (lastApplied.desc !== undefined) $('#f-desc').value = lastApplied.desc;
    lastApplied = null; $('#undoApply').hidden = true;
  };
}
function stash(sel) {
  lastApplied = lastApplied || {};
  if (sel === '#f-title') lastApplied.title = $('#f-title').value;
  if (sel === '#f-desc') lastApplied.desc = $('#f-desc').value;
}
function showUndo() { if ($('#undoApply')) $('#undoApply').hidden = false; }

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
    msg.innerHTML = `${ICON.check()} Ticket ${esc(t.id)} created and routed to the ${esc(t.category)} queue. You'll be notified as it progresses.`;
    $('#f-title').value = ''; $('#f-desc').value = '';
    $('#catTag').hidden = true;
    $('#assistBody').innerHTML = `<div class="assist-empty">Ticket submitted. Start a new one and I'll assist again.</div>`;
    $('#assistMode').hidden = true;
    lastAssist = null; lastApplied = null;
    setPriority('normal');
    refreshNotifications();
    renderHomeRail();
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
  $$('#viewToggle button').forEach((b) => {
    b.onclick = () => {
      state.ticketView = b.dataset.mode;
      $$('#viewToggle button').forEach((x) => x.classList.toggle('active', x === b));
      loadTickets();
    };
  });
  $('#exportCsvBtn').onclick = () => downloadTicketsCsv(lastTicketRows);
  $('#statsToggle').onclick = () => { state.railOpen = !state.railOpen; renderAgentRail(); };
}

let lastTicketRows = [];

function downloadTicketsCsv(rows) {
  if (!rows || !rows.length) return;
  const head = ['id', 'title', 'department', 'priority', 'status', 'requester', 'createdAt', 'updatedAt'];
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [head.join(',')].concat(
    rows.map((t) => [t.id, t.title, t.category, t.priority, t.status, t.requester, t.createdAt, t.updatedAt].map(cell).join(','))
  );
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'tickets.csv'; a.click();
  URL.revokeObjectURL(url);
}

async function loadTickets() {
  const params = new URLSearchParams();
  const cat = $('#flt-cat').value, pri = $('#flt-pri').value, st = $('#flt-status').value, q = $('#flt-q').value.trim();
  if (cat) params.set('category', cat);
  if (pri) params.set('priority', pri);
  if (st) params.set('status', st);
  if (q) params.set('q', q);
  if (state.role === 'employee') params.set('requester', state.user);
  $('#ticketsTitle').textContent = state.role === 'employee' ? `My tickets` : 'Department queues';

  const rows = await api('/api/tickets?' + params.toString());
  lastTicketRows = rows;
  const mode = state.ticketView; // 'list' (cards) | 'rows' | 'board'
  $('#ticketGrid').hidden = mode !== 'list';
  $('#rowsList').hidden = mode !== 'rows';
  $('#board').hidden = mode !== 'board';
  if (mode === 'board') renderBoard(rows);
  else if (mode === 'rows') renderRows(rows);
  else renderList(rows);
  renderAgentRail();
}

function renderRows(rows) {
  const el = $('#rowsList');
  if (!rows.length) { el.innerHTML = `<div class="empty">No tickets match these filters.</div>`; return; }
  el.innerHTML = rows.map((t) => `<div class="trow" data-id="${t.id}">
      <span class="tr-id">${t.id}</span>
      <span class="tr-title">${esc(t.title)}</span>
      <span class="chip dept">${esc(t.category)}</span>
      <span class="chip status-${t.status.replace(/\s/g, '')}">${esc(t.status)}</span>
      <span class="tr-req">${esc(t.requester)}</span>
      <span class="tr-strip" style="background:${PRI_COLOR[t.priority]}" title="${PRI_TEXT[t.priority]}"></span>
    </div>`).join('');
  $$('.trow', el).forEach((x) => (x.onclick = () => openDrawer(x.dataset.id)));
}

// ---------------------------------------------------------------------------
// Agent rail: personal mini-stats + AI "tackle next" prioritisation
// ---------------------------------------------------------------------------
async function renderAgentRail() {
  const rail = $('#agentRail'), layout = $('#ticketsLayout'), toggle = $('#statsToggle');
  if (state.role !== 'agent') {
    rail.hidden = true; layout.classList.remove('with-rail');
    if (toggle) toggle.hidden = true;
    return;
  }
  if (toggle) { toggle.hidden = false; toggle.textContent = state.railOpen ? 'Hide stats' : 'Show stats'; }
  if (!state.railOpen) { rail.hidden = true; layout.classList.remove('with-rail'); return; }
  rail.hidden = false; layout.classList.add('with-rail');
  try {
    const [s, p] = await Promise.all([api('/api/agent/stats'), api('/api/agent/prioritize')]);
    const fr = s.avgFirstResponseHrs == null ? '—' : `${s.avgFirstResponseHrs}h`;
    const csat = s.csat == null ? '—' : `${s.csat}%`;
    const tiles = `
      <div class="stat-grid">
        <div class="stat hi"><div class="sv">${s.assignedToday}</div><div class="sl">Assigned today</div></div>
        <div class="stat hi"><div class="sv">${s.resolvedToday}</div><div class="sl">Resolved today</div></div>
        <div class="stat"><div class="sv">${s.avgResolvedDaily}</div><div class="sl">Avg / day</div></div>
        <div class="stat"><div class="sv">${s.totalResolved}</div><div class="sl">Total resolved</div></div>
        <div class="stat"><div class="sv">${fr}</div><div class="sl">First response</div></div>
        <div class="stat csat"><div class="sv">${csat}</div><div class="sl">CSAT${s.csatCount ? ` · ${s.csatCount}` : ''}</div></div>
      </div>`;
    const list = (p.items || []).map((it) => `<div class="next-item" data-id="${it.id}">
        <div class="ni-top">${priLabel(it.priority)}<span class="ni-est">~${it.estHours}h</span></div>
        <div class="ni-title">${esc(it.title)}</div>
      </div>`).join('') || `<div class="rail-empty">Queue is clear.</div>`;
    rail.innerHTML = `
      <div class="rail-card">
        <div class="rail-head"><span>Your stats</span><button class="rail-x" id="railClose" title="Hide panel">✕</button></div>
        ${tiles}
      </div>
      <div class="rail-card">
        <div class="rail-head"><span>${ICON.ai('#2f6df6', 14)} Tackle next</span></div>
        <div class="next-list">${list}</div>
        <div class="micro">Ordered by urgency and ease — <i>easier resolution is estimated from how long similar (urgent) tickets took to resolve before.</i></div>
      </div>`;
    $$('#agentRail .next-item').forEach((el) => (el.onclick = () => openDrawer(el.dataset.id)));
    $('#railClose').onclick = () => { state.railOpen = false; renderAgentRail(); };
  } catch { rail.innerHTML = ''; }
}

// ---------------------------------------------------------------------------
// RAG knowledge bot (floating, bottom-right)
// ---------------------------------------------------------------------------
let ragGreeted = false;
function wireRag() {
  $('#ragFab').onclick = () => {
    $('#ragPanel').hidden = false; $('#ragFab').style.display = 'none';
    if (!ragGreeted) {
      ragGreeted = true;
      ragBubble('bot', 'Hi! I learn from your tickets and help docs. Ask me anything in plain words — for example, “how do we usually fix VPN drops?” or “who reported access card issues?”.');
    }
    $('#ragBox').focus();
  };
  $('#ragClose').onclick = () => { $('#ragPanel').hidden = true; $('#ragFab').style.display = ''; };
  $('#ragSend').onclick = ragSend;
  $('#ragBox').addEventListener('keydown', (e) => { if (e.key === 'Enter') ragSend(); });
}
function ragBubble(role, html) {
  const log = $('#ragLog');
  const div = document.createElement('div');
  div.className = `rag-bubble ${role}`;
  div.innerHTML = html;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
  return div;
}
async function ragSend() {
  const box = $('#ragBox');
  const question = box.value.trim();
  if (!question) return;
  box.value = '';
  ragBubble('user', esc(question));
  const thinking = ragBubble('bot', `<span class="spin">${ICON.ai('#6b7686', 13)}</span> Searching tickets & docs…`);
  try {
    const r = await api('/api/ai/rag', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question }) });
    let html = esc(r.reply);
    if (r.sources && r.sources.length) {
      html += `<div class="rag-src">Sources: ${r.sources.map((s) => `<span>${esc(s.id)} (${s.match}%)</span>`).join(' ')}</div>`;
    }
    thinking.innerHTML = html;
  } catch (e) {
    thinking.innerHTML = `Sorry, I hit a problem: ${esc(e.message)}`;
  }
  $('#ragLog').scrollTop = $('#ragLog').scrollHeight;
}

function renderList(rows) {
  const grid = $('#ticketGrid');
  if (!rows.length) { grid.innerHTML = `<div class="empty">No tickets match these filters.</div>`; return; }
  grid.innerHTML = rows.map(ticketCard).join('');
  $$('.tcard', grid).forEach((el) => (el.onclick = () => openDrawer(el.dataset.id)));
}

function renderBoard(rows) {
  const board = $('#board');
  const cols = state.meta.statuses;
  board.innerHTML = cols.map((status) => {
    const items = rows.filter((t) => t.status === status);
    const cards = items.length
      ? items.map((t) => `<div class="bcard p-${t.priority}" data-id="${t.id}">
          <div class="id">${t.id}</div>
          <h5>${esc(t.title)}</h5>
          <div class="bfoot">
            <span class="dot ${t.priority}"></span>
            <span class="chip dept">${esc(t.category)}</span>
            <span class="chip">${esc(t.requester)}</span>
          </div>
        </div>`).join('')
      : `<div class="bempty">—</div>`;
    return `<div class="bcol">
      <div class="bcol-head">${status}<span class="cnt">${items.length}</span></div>
      ${cards}
    </div>`;
  }).join('');
  $$('.bcard', board).forEach((el) => (el.onclick = () => openDrawer(el.dataset.id)));
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
          <span class="chip">${priLabel(t.priority)}</span>
        </div>
      </div>
      <button class="close" id="drawerClose" aria-label="Close"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#6b7686" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </div>

    <div class="section">
      <h3>Description</h3>
      <div class="desc-full">${esc(t.description)}</div>
      <div style="color:var(--muted);font-size:12px;margin-top:8px">Raised by ${esc(t.requester)} · ${timeAgo(t.createdAt)}${t.agent ? ' · Agent: ' + esc(t.agent) : ''}</div>
    </div>

    <div class="section">
      <h3>Progress</h3>
      ${stepperHTML(t.status)}
      ${isAgent ? statusFlow(t) : `<div class="agent-only-note" style="margin-top:8px">You'll be notified automatically as this moves. Switch to the Agent view to update it.</div>`}
    </div>

    ${(t.replies && t.replies.length) ? `
    <div class="section">
      <h3>Conversation</h3>
      ${t.replies.map((r) => `<div class="reply-bubble"><div class="rb-head">${esc(r.agent)} · ${timeAgo(r.at)}</div>${esc(r.message)}</div>`).join('')}
    </div>` : ''}

    ${(!isAgent && (t.status === 'Resolved' || t.status === 'Closed')) ? `
    <div class="section">
      <h3>How did we do?</h3>
      ${t.csat == null
        ? `<div class="csat-row"><button class="csat up" data-r="1">${THUMB_UP} Helpful</button><button class="csat down" data-r="0">${THUMB_DOWN} Not really</button></div>`
        : `<div class="csat-done">${t.csat >= 1 ? THUMB_UP + ' Thanks for the feedback!' : THUMB_DOWN + ' Thanks — we\'ll do better.'}</div>`}
    </div>` : ''}

    ${isAgent ? `
    <div class="section">
      <h3>AI agent assist</h3>
      <button class="ghost" id="btnDraft">${ICON.ai()} Analyse & draft reply</button>
      <div id="insights" class="insights" hidden></div>
      <textarea class="draft-box" id="draftBox" placeholder="Click analyse to get a summary, suggested resolution steps, and a drafted first reply…"></textarea>
      <div class="draft-actions">
        <button class="primary sm" id="btnSendReply">Send reply to employee</button>
        <button class="ghost sm" id="btnResolveWith">Resolve with this</button>
      </div>
      <div class="micro">“Send reply” posts the draft to the employee and moves the ticket to <b>In Progress</b>. “Resolve with this” saves the AI resolution note and marks it <b>Resolved</b>.</div>
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
  lastInsights = null;
  $('#drawerClose').onclick = closeDrawer;
  overlay.onclick = closeDrawer;

  if (isAgent) {
    $$('.status-flow button').forEach((b) => (b.onclick = () => changeStatus(t.id, b.dataset.s)));
    $('#btnDraft').onclick = () => generateDraft(t.id);
    $('#btnSaveRes').onclick = () => saveResolution(t.id);
    $('#btnSendReply').onclick = () => sendReply(t.id);
    $('#btnResolveWith').onclick = () => resolveWith(t.id);
  } else {
    $$('.csat').forEach((b) => (b.onclick = () => rateTicket(t.id, b.dataset.r)));
  }
}
function closeDrawer() { $('#drawer').hidden = true; $('#drawerOverlay').hidden = true; }

const THUMB_UP = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10v11M2 13v6a2 2 0 0 0 2 2h13.3a2 2 0 0 0 2-1.7l1.2-7A2 2 0 0 0 17.8 10H13l.8-4.2A2 2 0 0 0 11.9 3L7 10"/></svg>`;
const THUMB_DOWN = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 14V3M22 11V5a2 2 0 0 0-2-2H6.7a2 2 0 0 0-2 1.7l-1.2 7A2 2 0 0 0 5.2 14H10l-.8 4.2A2 2 0 0 0 11.1 21L17 14"/></svg>`;

async function sendReply(id) {
  const msg = ($('#draftBox').value || '').trim();
  const btn = $('#btnSendReply');
  if (!msg) { btn.textContent = 'Write or generate a reply first'; setTimeout(() => (btn.textContent = 'Send reply to employee'), 1600); return; }
  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    await api(`/api/tickets/${id}/reply`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: msg, agent: 'Support Agent' }) });
    await openDrawer(id);
    loadTickets(); refreshNotifications();
  } catch (e) { btn.disabled = false; btn.textContent = 'Send reply to employee'; }
}

async function resolveWith(id) {
  const resText = (lastInsights && lastInsights.resolution) || ($('#resBox').value || '').trim() || 'Resolved after troubleshooting with the employee.';
  const btn = $('#btnResolveWith');
  btn.disabled = true; btn.textContent = 'Resolving…';
  try {
    await api(`/api/tickets/${id}/resolution`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resolution: resText }) });
    await api(`/api/tickets/${id}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'Resolved', agent: 'Support Agent', note: 'Resolved using AI-suggested resolution' }) });
    await openDrawer(id);
    loadTickets(); refreshNotifications();
  } catch (e) { btn.disabled = false; btn.textContent = 'Resolve with this'; }
}

async function rateTicket(id, rating) {
  await api(`/api/tickets/${id}/csat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rating: Number(rating) }) });
  openDrawer(id);
}

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
  renderHomeRail();
}

let lastInsights = null;

async function generateDraft(id) {
  const box = $('#draftBox'), btn = $('#btnDraft'), ins = $('#insights');
  btn.innerHTML = `<span class="spin">${ICON.ai()}</span> Analysing…`;
  try {
    const r = await api(`/api/ai/draft/${id}`, { method: 'POST' });
    lastInsights = r;
    box.value = r.draft || '';
    ins.hidden = false;
    ins.innerHTML =
      `<div class="ins-card"><div class="ahead">${ICON.ai('#6b7686', 13)} Summary</div><div>${esc(r.summary || '')}</div></div>` +
      (r.resolution
        ? `<div class="ins-card"><div class="ahead">Suggested resolution</div><div>${esc(r.resolution)}</div></div>`
        : '') +
      (r.steps && r.steps.length
        ? `<div class="ins-card"><div class="ahead">Resolution steps</div><ol class="steps">${r.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></div>`
        : '') +
      (r.similar && r.similar.length
        ? `<div class="ins-card"><div class="ahead">Drawn from</div>${r.similar.map((s) => `<div class="meta">${esc(s.id)} · ${esc(s.title)} <span class="pct">${s.match}%</span></div>`).join('')}</div>`
        : '');
  } catch (e) {
    box.value = 'Could not generate insights: ' + e.message;
  } finally {
    btn.innerHTML = `${ICON.ai()} Analyse & draft reply`;
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
function notifScope() {
  return state.role === 'agent' ? { audience: 'agent' } : { requester: state.user };
}
function notifQuery() {
  const s = notifScope();
  return s.audience ? 'audience=agent' : 'requester=' + encodeURIComponent(s.requester);
}

function wireBell() {
  $('#bell').onclick = (e) => {
    if (e.target.closest('.notif-panel')) return;
    const panel = $('#notifPanel');
    panel.hidden = !panel.hidden;
    if (!panel.hidden) {
      api('/api/notifications/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(notifScope()) })
        .then(refreshNotifications);
    }
  };
  document.addEventListener('click', (e) => { if (!e.target.closest('#bell')) $('#notifPanel').hidden = true; });
}

async function refreshNotifications() {
  const items = await api('/api/notifications?' + notifQuery());
  const unread = items.filter((n) => !n.read).length;
  const badge = $('#bellBadge');
  badge.hidden = unread === 0;
  badge.textContent = unread;
  const panel = $('#notifPanel');
  const emptyMsg = state.role === 'agent' ? 'No urgent tickets right now.' : 'No notifications yet.';
  panel.innerHTML = items.length
    ? items.slice(0, 20).map((n) => `<div class="notif-item ${n.read ? '' : 'unread'}">${esc(n.message)}<div class="t">${timeAgo(n.at)}</div></div>`).join('')
    : `<div class="notif-empty">${emptyMsg}</div>`;
}

// ---------------------------------------------------------------------------
// Analytics — modern self-rendered SVG charts + CSV import (no libraries)
// ---------------------------------------------------------------------------
const DEPT_COLORS = { IT: '#2f6df6', HR: '#e5484d', Finance: '#2faf5f', Admin: '#d9a800' };
const PALETTE = ['#2f6df6', '#7c5cff', '#2faf5f', '#d9a800', '#e5484d', '#0bb3c4', '#ef7d2e', '#9b59b6'];
const STATUS_COLORS = { Open: '#7689a5', 'In Progress': '#d9a800', Resolved: '#2faf5f', Closed: '#7c5cff' };
const GRAN_LABEL = { week: 'weekly', month: 'monthly', quarter: 'quarterly', year: 'yearly' };
const cssVar = (n) => (getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#888');
const deptColor = (d, i) => DEPT_COLORS[d] || PALETTE[i % PALETTE.length];

function wireAnalytics() {
  $$('#sourceToggle button').forEach((b) => (b.onclick = () => {
    if (b.dataset.src === 'csv' && !state.csv) { triggerCsv(); return; }
    state.analyticsSrc = b.dataset.src;
    $$('#sourceToggle button').forEach((x) => x.classList.toggle('active', x === b));
    loadAnalytics();
  }));
  $$('#granToggle button').forEach((b) => (b.onclick = () => {
    state.gran = b.dataset.g;
    $$('#granToggle button').forEach((x) => x.classList.toggle('active', x === b));
    loadAnalytics();
  }));
  $('#importCsvBtn').onclick = triggerCsv;
  $('#sampleCsvBtn').onclick = downloadSampleCsv;
  $('#csvFile').addEventListener('change', handleCsvFile);
  // Timeline zoom / pan
  $('#tlZoomIn').onclick = () => tlZoom(-1);
  $('#tlZoomOut').onclick = () => tlZoom(1);
  $('#tlPanL').onclick = () => tlPan(1);
  $('#tlPanR').onclick = () => tlPan(-1);
}
function triggerCsv() { $('#csvFile').click(); }

let lastRecords = [];
let tlState = { window: null, offset: 0 };

async function loadAnalytics() {
  let records, hasStatus;
  if (state.analyticsSrc === 'csv') {
    if (!state.csv) return renderCsvPrompt();
    records = state.csv.records; hasStatus = state.csv.hasStatus;
    showBanner();
  } else {
    const rows = await api('/api/tickets');
    records = rows.map((t) => ({ date: t.createdAt, department: t.category, status: t.status, priority: t.priority }));
    hasStatus = true;
    $('#csvBanner').hidden = true;
  }
  lastRecords = records;
  tlState = { window: null, offset: 0 }; // reset zoom for new data/granularity
  renderKpis(records, hasStatus);
  renderTimeline(records);
  renderDeptChart(records);
  renderStatusChart(records, hasStatus);
  renderHeatmap(records);
}

function tlZoom(dir) {
  if (tlState.window == null) return;
  if (dir < 0) tlState.window = Math.max(3, Math.round(tlState.window / 1.5));
  else tlState.window = tlState.window + Math.max(1, Math.round(tlState.window * 0.5));
  renderTimeline(lastRecords);
}
function tlPan(dir) {
  tlState.offset += dir * Math.max(1, Math.round((tlState.window || 6) / 2));
  renderTimeline(lastRecords);
}

// ---- aggregation by granularity ----
function weekStart(d) { const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); x.setHours(0, 0, 0, 0); return x; }
function periodOf(date, gran) {
  const d = new Date(date);
  if (gran === 'year') return { key: `${d.getFullYear()}`, label: `${d.getFullYear()}`, sort: d.getFullYear() };
  if (gran === 'quarter') { const q = Math.floor(d.getMonth() / 3) + 1; return { key: `${d.getFullYear()}Q${q}`, label: `Q${q} '${String(d.getFullYear()).slice(2)}`, sort: d.getFullYear() * 4 + q }; }
  if (gran === 'week') { const w = weekStart(d); return { key: w.toISOString().slice(0, 10), label: w.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), sort: w.getTime() }; }
  return { key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' }), sort: d.getFullYear() * 12 + d.getMonth() };
}
function aggregate(records, gran) {
  const depts = [...new Set(records.map((r) => r.department))];
  const map = new Map();
  records.forEach((r) => {
    const p = periodOf(r.date, gran);
    if (!map.has(p.key)) map.set(p.key, { label: p.label, sort: p.sort, counts: {} });
    const c = map.get(p.key).counts; c[r.department] = (c[r.department] || 0) + 1;
  });
  const periods = [...map.values()].sort((a, b) => a.sort - b.sort);
  return {
    labels: periods.map((p) => p.label), periods, depts,
    series: depts.map((d, i) => ({ name: d, color: deptColor(d, i), points: periods.map((p) => p.counts[d] || 0) })),
  };
}

function renderKpis(records, hasStatus) {
  const agg = aggregate(records, state.gran);
  const sum = (p) => (p ? Object.values(p.counts).reduce((a, b) => a + b, 0) : 0);
  const cur = sum(agg.periods.at(-1)), prv = sum(agg.periods.at(-2));
  const delta = prv ? Math.round((cur - prv) / prv * 100) : (cur ? 100 : 0);
  const arrow = delta > 0 ? `<div class="delta up">▲ ${delta}% vs prev</div>`
    : delta < 0 ? `<div class="delta down">▼ ${Math.abs(delta)}% vs prev</div>`
      : `<div class="delta flat">— no change</div>`;
  const cards = [['Total', records.length, agg.periods.length ? arrow : '']];
  if (hasStatus) {
    const c = {}; records.forEach((r) => { if (r.status) c[r.status] = (c[r.status] || 0) + 1; });
    cards.push(['Open', c.Open || 0, ''], ['In Progress', c['In Progress'] || 0, ''], ['Resolved', (c.Resolved || 0) + (c.Closed || 0), '']);
  } else {
    const depts = new Set(records.map((r) => r.department)).size;
    const dates = records.map((r) => +new Date(r.date)).filter(Boolean);
    const span = dates.length ? `${new Date(Math.min(...dates)).toLocaleDateString()} – ${new Date(Math.max(...dates)).toLocaleDateString()}` : '—';
    cards.push(['Departments', depts, ''], ['Latest period', cur, ''], ['Date range', `<span style="font-size:12px">${span}</span>`, '']);
  }
  $('#kpiRow').innerHTML = cards.map(([l, n, d]) => `<div class="kpi"><div class="n">${n}</div><div class="l">${l}</div>${d || ''}</div>`).join('');
}

function renderTimeline(records) {
  const agg = aggregate(records, state.gran);
  $('#timelineTitle').textContent = `Tickets over time · ${GRAN_LABEL[state.gran]}`;
  const total = agg.labels.length;
  const ctl = $('.tl-controls');
  if (!total) {
    $('#chart-timeline').innerHTML = `<div class="empty">No data for this view.</div>`;
    $('#timelineLegend').innerHTML = ''; $('#tlRange').textContent = ''; if (ctl) ctl.style.visibility = 'hidden';
    return;
  }
  if (ctl) ctl.style.visibility = 'visible';
  // Apply zoom window.
  if (tlState.window == null) tlState.window = Math.min(total, 12);
  tlState.window = Math.max(3, Math.min(tlState.window, total));
  tlState.offset = Math.max(0, Math.min(tlState.offset, total - tlState.window));
  const end = total - tlState.offset;
  const start = Math.max(0, end - tlState.window);
  const labels = agg.labels.slice(start, end);
  const series = agg.series.map((s) => ({ ...s, points: s.points.slice(start, end) }));
  const visTotal = series.reduce((a, s) => a + s.points.reduce((x, y) => x + y, 0), 0);
  $('#tlRange').textContent = `${labels[0]} – ${labels[labels.length - 1]} · ${visTotal} tickets`;
  // Disable controls at bounds.
  $('#tlZoomOut').disabled = tlState.window >= total;
  $('#tlZoomIn').disabled = tlState.window <= 3;
  $('#tlPanR').disabled = tlState.offset <= 0;
  $('#tlPanL').disabled = start <= 0;
  $('#chart-timeline').innerHTML = lineAreaChart(labels, series);
  $('#timelineLegend').innerHTML = series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('');
}

function renderDeptChart(records) {
  const counts = {}; records.forEach((r) => (counts[r.department] = (counts[r.department] || 0) + 1));
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  const data = Object.entries(counts).sort((a, b) => b[1] - a[1])
    .map(([k, v], i) => ({ label: k, value: v, color: deptColor(k, i), pct: Math.round(v / total * 100) }));
  $('#chart-dept').innerHTML = data.length ? barChartH(data) : `<div class="empty">No data.</div>`;
}

function renderStatusChart(records, hasStatus) {
  const panel = $('#statusPanel');
  if (!hasStatus) { panel.style.display = 'none'; return; }
  panel.style.display = '';
  const counts = {}; records.forEach((r) => { if (r.status) counts[r.status] = (counts[r.status] || 0) + 1; });
  const order = state.meta.statuses;
  const data = order.filter((s) => counts[s]).map((s) => ({ label: s, value: counts[s], color: STATUS_COLORS[s] || '#888' }));
  Object.keys(counts).filter((s) => !order.includes(s)).forEach((s, i) => data.push({ label: s, value: counts[s], color: PALETTE[i % PALETTE.length] }));
  $('#chart-status').innerHTML = data.length ? donutModern(data) : `<div class="empty">No status data.</div>`;
}

// ---- chart primitives ----
function lineAreaChart(labels, series) {
  const W = 760, H = 280, padL = 32, padR = 14, padT = 16, padB = 34;
  const line = cssVar('--line');
  const n = labels.length;
  const maxV = Math.max(1, ...series.flatMap((s) => s.points));
  const x = (i) => (n <= 1 ? padL + (W - padL - padR) / 2 : padL + i * (W - padL - padR) / (n - 1));
  const y = (v) => padT + (1 - v / maxV) * (H - padT - padB);
  let grid = '';
  const ticks = 4;
  for (let t = 0; t <= ticks; t++) {
    const val = Math.round(maxV * t / ticks), yy = y(val);
    grid += `<line x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}" stroke="${line}" stroke-dasharray="3 5"/><text x="${padL - 7}" y="${yy + 3}" text-anchor="end" font-size="10">${val}</text>`;
  }
  const step = Math.max(1, Math.ceil(n / 8));
  let xlab = '';
  labels.forEach((l, i) => { if (i % step === 0 || i === n - 1) xlab += `<text x="${x(i)}" y="${H - padB + 17}" text-anchor="middle" font-size="10">${esc(l)}</text>`; });
  let defs = '', paths = '';
  series.forEach((s, si) => {
    const gid = `tl${si}`;
    defs += `<linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.color}" stop-opacity="0.30"/><stop offset="1" stop-color="${s.color}" stop-opacity="0"/></linearGradient>`;
    const pts = s.points.map((v, i) => `${x(i)},${y(v)}`);
    const area = `M ${x(0)},${y(0)} L ${pts.join(' L ')} L ${x(n - 1)},${y(0)} Z`;
    const dots = s.points.map((v, i) => `<circle class="dot-pt has-tip" cx="${x(i)}" cy="${y(v)}" r="3.5" fill="${s.color}" data-tip="${esc(s.name)} · ${esc(labels[i])}: ${v} ticket${v === 1 ? '' : 's'}"/>`).join('');
    paths += `<path d="${area}" fill="url(#${gid})"/><path d="M ${pts.join(' L ')}" fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>${dots}`;
  });
  return `<svg viewBox="0 0 ${W} ${H}"><defs>${defs}</defs>${grid}<line x1="${padL}" y1="${y(0)}" x2="${W - padR}" y2="${y(0)}" stroke="${line}"/>${paths}${xlab}</svg>`;
}

// Modern horizontal bar chart (HTML/CSS) with hover insight via data-tip.
function barChartH(data) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return `<div class="hbars">${data.map((d) => {
    const w = Math.round(d.value / max * 100);
    return `<div class="hbar has-tip" data-tip="${esc(d.label)} · ${d.value} ticket${d.value === 1 ? '' : 's'} · ${d.pct}% of total">
      <div class="hb-label">${esc(d.label)}</div>
      <div class="hb-track"><div class="hb-fill" style="width:${w}%;background:linear-gradient(90deg, ${d.color}, ${d.color}b3)"></div></div>
      <div class="hb-val">${d.value}<span class="hb-pct">${d.pct}%</span></div>
    </div>`;
  }).join('')}</div>`;
}

function donutModern(data) {
  const total = data.reduce((a, b) => a + b.value, 0) || 1;
  const cx = 90, cy = 90, r = 62, C = 2 * Math.PI * r, gap = data.filter((d) => d.value > 0).length > 1 ? 5 : 0;
  let off = 0, segs = '';
  data.forEach((d) => {
    if (d.value <= 0) return;
    const len = d.value / total * C, dash = Math.max(0.5, len - gap);
    segs += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${d.color}" stroke-width="15" stroke-linecap="round" stroke-dasharray="${dash} ${C - dash}" stroke-dashoffset="${-off}" transform="rotate(-90 ${cx} ${cy})"><title>${esc(d.label)}: ${d.value}</title></circle>`;
    off += len;
  });
  const legend = data.map((d) => `<span><i style="background:${d.color}"></i>${esc(d.label)} (${d.value})</span>`).join('');
  return `<svg viewBox="0 0 180 180" width="180" height="180" style="margin:0 auto">${segs}<text x="90" y="86" text-anchor="middle" font-size="22" font-weight="700" fill="${cssVar('--ink')}">${total}</text><text x="90" y="104" text-anchor="middle" font-size="11" fill="${cssVar('--muted')}">total</text></svg><div class="legend">${legend}</div>`;
}

// Department × time heatmap — where complaints concentrate (most vs least).
function renderHeatmap(records) {
  const agg = aggregate(records, state.gran);
  const total = agg.labels.length;
  if (!total) { $('#heatmap').innerHTML = `<div class="empty">No data.</div>`; $('#heatCaption').textContent = ''; return; }
  const cap = 14, start = Math.max(0, total - cap);
  const labels = agg.labels.slice(start);
  const rows = agg.series.map((s) => ({ name: s.name, points: s.points.slice(start) }));
  const flat = rows.flatMap((r) => r.points);
  const max = Math.max(1, ...flat);
  // intensity 0..1 -> light to strong accent
  const shade = (v) => v === 0 ? 'var(--bg)' : `rgba(229,72,77,${(0.14 + 0.86 * (v / max)).toFixed(3)})`;
  let hotR = '', hotC = '', hot = -1, coldV = Infinity, coldR = '', coldC = '';
  rows.forEach((r) => r.points.forEach((v, c) => {
    if (v > hot) { hot = v; hotR = r.name; hotC = labels[c]; }
    if (v < coldV) { coldV = v; coldR = r.name; coldC = labels[c]; }
  }));
  const head = `<div class="hm-row hm-head"><div class="hm-rowlabel"></div>${labels.map((l) => `<div class="hm-col">${esc(l)}</div>`).join('')}</div>`;
  const body = rows.map((r) => `<div class="hm-row">
      <div class="hm-rowlabel">${esc(r.name)}</div>
      ${r.points.map((v, c) => `<div class="hm-cell has-tip" style="background:${shade(v)};${v > max * 0.66 ? 'color:#fff' : ''}" data-tip="${esc(r.name)} · ${esc(labels[c])}: ${v} complaint${v === 1 ? '' : 's'}">${v || ''}</div>`).join('')}
    </div>`).join('');
  $('#heatmap').innerHTML = `<div class="hm-grid" style="grid-template-columns:90px repeat(${labels.length}, minmax(34px, 1fr))">${head}${body}</div>`;
  $('#heatCaption').innerHTML = `Most complaints: <b>${esc(hotR)}</b> in <b>${esc(hotC)}</b> (${hot}). Quietest: <b>${esc(coldR)}</b> in ${esc(coldC)} (${coldV}). Darker = more complaints — use it to spot where operations need attention.`;
}

// ---- CSV import ----
function splitCsvLine(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (ch === ',' && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur); return out.map((s) => s.trim());
}
function parseCsv(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim());
  if (lines.length < 2) return { error: 'The CSV looks empty.' };
  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const find = (names) => header.findIndex((h) => names.includes(h));
  const di = find(['date', 'created', 'createdat', 'created_at', 'timestamp', 'time', 'opened', 'open_date']);
  const ci = find(['department', 'dept', 'category', 'team']);
  const si = find(['status', 'state']);
  const pi = find(['priority', 'urgency']);
  if (di < 0 || ci < 0) return { error: 'CSV needs a date column and a department (or category) column.' };
  const records = [];
  for (let i = 1; i < lines.length; i++) {
    const f = splitCsvLine(lines[i]);
    const dt = new Date(f[di]); if (isNaN(dt)) continue;
    const dep = (f[ci] || '').trim(); if (!dep) continue;
    const canon = ['IT', 'HR', 'Finance', 'Admin'].find((d) => d.toLowerCase() === dep.toLowerCase());
    records.push({ date: dt.toISOString(), department: canon || dep, status: si >= 0 ? f[si] : undefined, priority: pi >= 0 ? f[pi] : undefined });
  }
  return { records, hasStatus: si >= 0 };
}
function handleCsvFile(e) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const res = parseCsv(String(reader.result));
    if (res.error || !res.records || !res.records.length) { alertBanner(res.error || 'No valid rows found.'); return; }
    const dates = res.records.map((r) => +new Date(r.date));
    state.csv = { name: file.name, records: res.records, hasStatus: res.hasStatus, min: new Date(Math.min(...dates)), max: new Date(Math.max(...dates)) };
    state.analyticsSrc = 'csv';
    $$('#sourceToggle button').forEach((x) => x.classList.toggle('active', x.dataset.src === 'csv'));
    loadAnalytics();
  };
  reader.readAsText(file);
  e.target.value = '';
}
function showBanner() {
  const c = state.csv;
  const b = $('#csvBanner');
  b.hidden = false;
  b.innerHTML = `<div>Showing imported <b>${esc(c.name)}</b> — ${c.records.length} rows · ${c.min.toLocaleDateString()} → ${c.max.toLocaleDateString()}</div><button class="x" id="csvClear">Use live data ✕</button>`;
  $('#csvClear').onclick = () => { state.csv = null; state.analyticsSrc = 'live'; $$('#sourceToggle button').forEach((x) => x.classList.toggle('active', x.dataset.src === 'live')); loadAnalytics(); };
}
function alertBanner(msg) {
  const b = $('#csvBanner'); b.hidden = false;
  b.innerHTML = `<div style="color:var(--red)">${esc(msg)} Try the Sample for the expected format.</div><button class="x" id="csvClear">✕</button>`;
  $('#csvClear').onclick = () => { b.hidden = true; };
}
function renderCsvPrompt() {
  $('#kpiRow').innerHTML = '';
  $('#chart-timeline').innerHTML = `<div class="empty">Import a CSV of issues (date + department, optional status/priority) to see real-time timeline analytics. Use “Sample” for the format.</div>`;
  $('#timelineLegend').innerHTML = ''; $('#chart-dept').innerHTML = ''; $('#statusPanel').style.display = 'none';
  $('#heatmap').innerHTML = ''; $('#heatCaption').textContent = '';
}
function downloadSampleCsv() {
  const deps = ['IT', 'HR', 'Finance', 'Admin'], pr = ['urgent', 'mild', 'normal'], st = ['Open', 'In Progress', 'Resolved', 'Closed'];
  const types = { IT: 'VPN issue', HR: 'Leave request', Finance: 'Expense claim', Admin: 'Access card' };
  const rows = [['date', 'department', 'priority', 'status', 'type']];
  const today = new Date();
  for (let i = 0; i < 48; i++) {
    const d = new Date(today); d.setDate(d.getDate() - Math.floor(Math.random() * 330));
    const dep = deps[i % 4];
    rows.push([d.toISOString().slice(0, 10), dep, pr[i % 3], st[i % 4], types[dep]]);
  }
  const blob = new Blob([rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'tickets-sample.csv'; a.click();
  URL.revokeObjectURL(url);
}

boot().catch((e) => {
  document.body.innerHTML = `<div style="padding:40px;font-family:sans-serif">Failed to start: ${e.message}</div>`;
});
