// Tiny JSON-file persistence layer. No native deps, single-process safe.
// Good enough for a prototype; swap for a real DB in production.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, '..', 'data.json');

export const DEPARTMENTS = ['IT', 'HR', 'Finance', 'Admin'];
export const PRIORITIES = ['urgent', 'mild', 'normal']; // red / yellow / green
export const STATUSES = ['Open', 'In Progress', 'Resolved', 'Closed'];

const empty = { tickets: [], notifications: [], counter: 0, notifCounter: 0 };

function read() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return JSON.parse(JSON.stringify(empty));
  }
}

function write(db) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

let db = read();

function persist() {
  write(db);
}

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
