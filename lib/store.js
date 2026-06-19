// Tiny JSON-file persistence layer. No native deps, single-process safe.
// Good enough for a prototype; swap for a real DB in production.
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { buildSeed } from './seedData.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Pick a writable data path. On serverless (e.g. Vercel) the project root is
// read-only, so writes go to the OS temp dir. If even that fails, we fall back
// to memory-only mode so the app never crashes.
const DATA_FILE =
  process.env.DATA_FILE ||
  (process.env.VERCEL || process.env.AWS_REGION
    ? path.join(os.tmpdir(), 'support-data.json')
    : path.join(__dirname, '..', 'data.json'));

export const DEPARTMENTS = ['IT', 'HR', 'Finance', 'Admin'];
export const PRIORITIES = ['urgent', 'mild', 'normal']; // red / yellow / green
export const STATUSES = ['Open', 'In Progress', 'Resolved', 'Closed'];

let memoryOnly = false;

function read() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (parsed && Array.isArray(parsed.tickets) && parsed.tickets.length) return parsed;
  } catch {
    /* missing or unreadable — fall through to seed */
  }
  return buildSeed(); // auto-seed so the app always has data
}

function write(db) {
  if (memoryOnly) return;
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
  } catch {
    // Read-only filesystem (serverless) — keep running from memory.
    memoryOnly = true;
  }
}

let db = read();

function persist() {
  write(db);
}

// Persist the freshly seeded dataset where possible (no-op in memory mode).
persist();

export function getDB() {
  return db;
}

export function resetWith(seedDb) {
  db = seedDb;
  persist();
}

export function listTickets(filters = {}) {
  let rows = [...db.tickets];
  const { category, priority, status, requester, q } = filters;
  if (category) rows = rows.filter((t) => t.category === category);
  if (priority) rows = rows.filter((t) => t.priority === priority);
  if (status) rows = rows.filter((t) => t.status === status);
  if (requester) rows = rows.filter((t) => t.requester === requester);
  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter(
      (t) =>
        t.title.toLowerCase().includes(needle) ||
        t.description.toLowerCase().includes(needle)
    );
  }
  // Urgent first, then most recently updated.
  const rank = { urgent: 0, mild: 1, normal: 2 };
  rows.sort((a, b) => {
    if (rank[a.priority] !== rank[b.priority]) return rank[a.priority] - rank[b.priority];
    return new Date(b.updatedAt) - new Date(a.updatedAt);
  });
  return rows;
}

export function getTicket(id) {
  return db.tickets.find((t) => t.id === id) || null;
}

export function resolvedTickets() {
  return db.tickets.filter((t) => t.status === 'Resolved' || t.status === 'Closed');
}

export function createTicket({ title, description, category, priority, requester, aiCategorized }) {
  const now = new Date().toISOString();
  db.counter += 1;
  const ticket = {
    id: `TK-${String(db.counter).padStart(4, '0')}`,
    title: title.trim(),
    description: description.trim(),
    category,
    priority,
    status: 'Open',
    requester: (requester || 'Anonymous').trim(),
    agent: null,
    aiCategorized: !!aiCategorized,
    resolution: '',
    csat: null,
    replies: [],
    createdAt: now,
    updatedAt: now,
    history: [{ status: 'Open', at: now, note: 'Ticket created' }],
  };
  db.tickets.push(ticket);
  notify(ticket.requester, ticket.id, `Ticket ${ticket.id} created and routed to ${category}.`);
  persist();
  return ticket;
}

export function updateStatus(id, status, note, agent) {
  const ticket = getTicket(id);
  if (!ticket) return null;
  const now = new Date().toISOString();
  ticket.status = status;
  if (agent !== undefined && agent !== null && agent !== '') ticket.agent = agent;
  ticket.updatedAt = now;
  ticket.history.push({ status, at: now, note: note || `Status changed to ${status}`, agent: ticket.agent });
  notify(
    ticket.requester,
    ticket.id,
    `Your ticket ${ticket.id} ("${ticket.title}") moved to ${status}.`
  );
  persist();
  return ticket;
}

export function setResolution(id, text) {
  const ticket = getTicket(id);
  if (!ticket) return null;
  ticket.resolution = text;
  ticket.updatedAt = new Date().toISOString();
  persist();
  return ticket;
}

// Agent posts a reply to the employee; auto-moves Open -> In Progress.
export function addReply(id, message, agent) {
  const ticket = getTicket(id);
  if (!ticket || !message) return null;
  const now = new Date().toISOString();
  ticket.replies = ticket.replies || [];
  ticket.replies.push({ from: 'agent', agent: agent || 'Support Agent', message, at: now });
  ticket.agent = agent || ticket.agent || 'Support Agent';
  ticket.updatedAt = now;
  if (ticket.status === 'Open') {
    ticket.status = 'In Progress';
    ticket.history.push({ status: 'In Progress', at: now, note: 'Agent replied', agent: ticket.agent });
  }
  notify(ticket.requester, ticket.id,
    `${ticket.agent} replied to ${ticket.id}: "${message.slice(0, 80)}${message.length > 80 ? '…' : ''}"`);
  persist();
  return ticket;
}

// Employee satisfaction rating (1 = good, 0 = bad).
export function setCsat(id, rating) {
  const ticket = getTicket(id);
  if (!ticket) return null;
  ticket.csat = rating ? 1 : 0;
  ticket.updatedAt = new Date().toISOString();
  persist();
  return ticket;
}

// ---- Agent metrics & AI prioritisation -------------------------------------
const dayKey = (d) => new Date(d).toISOString().slice(0, 10);
const firstAt = (t, status) => { const h = t.history.find((x) => x.status === status); return h ? h.at : null; };
const resolvedAtOf = (t) => firstAt(t, 'Resolved') || firstAt(t, 'Closed');

export function agentStats() {
  const today = dayKey(new Date());
  let resolvedToday = 0, assignedToday = 0, totalResolved = 0;
  let frSum = 0, frCount = 0, resSum = 0, resCount = 0, csatPos = 0, csatTotal = 0;
  let earliest = Date.now();
  for (const t of db.tickets) {
    earliest = Math.min(earliest, +new Date(t.createdAt));
    const inProg = firstAt(t, 'In Progress');
    const resAt = resolvedAtOf(t);
    if (inProg && dayKey(inProg) === today) assignedToday++;
    if (resAt && dayKey(resAt) === today) resolvedToday++;
    if (t.status === 'Resolved' || t.status === 'Closed') totalResolved++;
    if (inProg) { frSum += +new Date(inProg) - +new Date(t.createdAt); frCount++; }
    if (resAt) { resSum += +new Date(resAt) - +new Date(t.createdAt); resCount++; }
    if (typeof t.csat === 'number') { csatTotal++; if (t.csat >= 1) csatPos++; }
  }
  const days = Math.max(1, Math.ceil((Date.now() - earliest) / 86400000));
  const hrs = (ms) => Math.round(ms / 3600000 * 10) / 10;
  return {
    resolvedToday, assignedToday, totalResolved,
    avgResolvedDaily: Math.round(totalResolved / days * 10) / 10,
    avgFirstResponseHrs: frCount ? hrs(frSum / frCount) : null,
    avgResolutionHrs: resCount ? hrs(resSum / resCount) : null,
    csat: csatTotal ? Math.round(csatPos / csatTotal * 100) : null,
    csatCount: csatTotal,
  };
}

// Suggest which open tickets to tackle next: urgency + "ease" (ease is
// estimated from how quickly similar tickets have been resolved before).
export function prioritizeQueue(limit = 5) {
  const catHrs = {};
  for (const t of db.tickets) {
    const resAt = resolvedAtOf(t);
    if (resAt) (catHrs[t.category] = catHrs[t.category] || []).push((+new Date(resAt) - +new Date(t.createdAt)) / 3600000);
  }
  const avgCat = {};
  for (const [k, v] of Object.entries(catHrs)) avgCat[k] = v.reduce((a, b) => a + b, 0) / v.length;
  const vals = Object.values(avgCat);
  const globalAvg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 24;
  const maxEst = Math.max(globalAvg, ...vals, 1);
  const uw = { urgent: 3, mild: 2, normal: 1 };
  const open = db.tickets.filter((t) => t.status === 'Open' || t.status === 'In Progress');
  const items = open.map((t) => {
    const est = avgCat[t.category] ?? globalAvg;
    const ease = 1 - est / maxEst; // 0..1, higher = historically faster to close
    return {
      id: t.id, title: t.title, category: t.category, priority: t.priority, status: t.status,
      estHours: Math.round(est * 10) / 10,
      score: uw[t.priority] * 2 + ease * 2,
    };
  }).sort((a, b) => b.score - a.score).slice(0, limit);
  return { items };
}


function notify(requester, ticketId, message) {
  db.notifCounter += 1;
  db.notifications.push({
    id: db.notifCounter,
    requester,
    ticketId,
    message,
    read: false,
    at: new Date().toISOString(),
  });
}

export function listNotifications(requester) {
  return db.notifications
    .filter((n) => !requester || n.requester === requester)
    .sort((a, b) => new Date(b.at) - new Date(a.at));
}

export function markNotificationsRead(requester) {
  db.notifications.forEach((n) => {
    if (!requester || n.requester === requester) n.read = true;
  });
  persist();
}

export function stats() {
  const byDept = Object.fromEntries(DEPARTMENTS.map((d) => [d, 0]));
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  const byPriority = Object.fromEntries(PRIORITIES.map((p) => [p, 0]));
  const byMonth = {};
  for (const t of db.tickets) {
    byDept[t.category] = (byDept[t.category] || 0) + 1;
    byStatus[t.status] = (byStatus[t.status] || 0) + 1;
    byPriority[t.priority] = (byPriority[t.priority] || 0) + 1;
    const month = t.createdAt.slice(0, 7); // YYYY-MM
    byMonth[month] = (byMonth[month] || 0) + 1;
  }
  // Last 6 months, chronological.
  const months = [];
  const d = new Date();
  for (let i = 5; i >= 0; i--) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    const key = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`;
    months.push({ month: key, count: byMonth[key] || 0 });
  }
  return {
    total: db.tickets.length,
    byDept,
    byStatus,
    byPriority,
    byMonth: months,
  };
}
