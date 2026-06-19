import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  DEPARTMENTS, PRIORITIES, STATUSES,
  listTickets, getTicket, createTicket, updateStatus, setResolution,
  addReply, setCsat, agentStats, prioritizeQueue,
  resolvedTickets, listNotifications, markNotificationsRead, stats,
} from './lib/store.js';
import { assist, categorize, similarTickets, agentInsights, resolveQuery, runAction, aiStatus } from './lib/ai.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
// The store auto-seeds itself on first load, so there's nothing to do here.

const asyncH = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  console.error(e);
  res.status(500).json({ error: e.message });
});

// --- Metadata -------------------------------------------------------------
app.get('/api/meta', (req, res) => {
  res.json({ departments: DEPARTMENTS, priorities: PRIORITIES, statuses: STATUSES, ai: aiStatus() });
});

// --- Tickets --------------------------------------------------------------
app.get('/api/tickets', (req, res) => {
  res.json(listTickets(req.query));
});

app.get('/api/tickets/:id', (req, res) => {
  const t = getTicket(req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  res.json(t);
});

app.post('/api/tickets', (req, res) => {
  const { title, description, category, priority, requester, aiCategorized } = req.body || {};
  if (!title || !description) return res.status(400).json({ error: 'title and description are required' });
  if (!DEPARTMENTS.includes(category)) return res.status(400).json({ error: 'invalid category' });
  if (!PRIORITIES.includes(priority)) return res.status(400).json({ error: 'invalid priority' });
  res.status(201).json(createTicket({ title, description, category, priority, requester, aiCategorized }));
});

app.patch('/api/tickets/:id/status', (req, res) => {
  const { status, note, agent } = req.body || {};
  if (!STATUSES.includes(status)) return res.status(400).json({ error: 'invalid status' });
  const t = updateStatus(req.params.id, status, note, agent);
  if (!t) return res.status(404).json({ error: 'Not found' });
  res.json(t);
});

app.patch('/api/tickets/:id/resolution', (req, res) => {
  const t = setResolution(req.params.id, (req.body && req.body.resolution) || '');
  if (!t) return res.status(404).json({ error: 'Not found' });
  res.json(t);
});

// Agent sends a reply to the employee (auto-moves Open -> In Progress).
app.post('/api/tickets/:id/reply', (req, res) => {
  const { message, agent } = req.body || {};
  if (!message || !message.trim()) return res.status(400).json({ error: 'message is required' });
  const t = addReply(req.params.id, message.trim(), agent);
  if (!t) return res.status(404).json({ error: 'Not found' });
  res.json(t);
});

// Employee satisfaction rating.
app.post('/api/tickets/:id/csat', (req, res) => {
  const t = setCsat(req.params.id, (req.body && req.body.rating) ? 1 : 0);
  if (!t) return res.status(404).json({ error: 'Not found' });
  res.json(t);
});

// Agent dashboard data.
app.get('/api/agent/stats', (req, res) => res.json(agentStats()));
app.get('/api/agent/prioritize', (req, res) => res.json(prioritizeQueue()));

// --- AI layer -------------------------------------------------------------
// Rich, in-flow assistant: routing + confidence, rephrased title/description,
// tags, completeness, self-help, and similar tickets — in one call.
app.post('/api/ai/assist', asyncH(async (req, res) => {
  const { title, description } = req.body || {};
  const [a, similar] = await Promise.all([
    assist({ title, description }),
    Promise.resolve(similarTickets({ title, description }, resolvedTickets())),
  ]);
  res.json({ ...a, similar });
}));

app.post('/api/ai/categorize', asyncH(async (req, res) => {
  const { title, description } = req.body || {};
  res.json(await categorize({ title, description }));
}));

app.post('/api/ai/similar', (req, res) => {
  const { title, description } = req.body || {};
  res.json(similarTickets({ title, description }, resolvedTickets()));
});

// Conversational assistant: instant answers from internal docs + past tickets,
// self-service for simple cases, or a pre-filled ticket. Rejects gibberish.
app.post('/api/ai/chat', asyncH(async (req, res) => {
  const { message } = req.body || {};
  res.json(await resolveQuery({ message }, resolvedTickets()));
}));

// Run a simulated self-service action (password reset, software provisioning).
app.post('/api/ai/action', (req, res) => {
  const { action, requester } = req.body || {};
  res.json(runAction(action, { requester }));
});

// Agent insights: summary + resolution steps + drafted first response.
app.post('/api/ai/draft/:id', asyncH(async (req, res) => {
  const t = getTicket(req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  const similar = similarTickets({ title: t.title, description: t.description }, resolvedTickets());
  const insights = await agentInsights(t, similar);
  res.json({ ...insights, similar });
}));

// --- Notifications --------------------------------------------------------
app.get('/api/notifications', (req, res) => {
  res.json(listNotifications({ requester: req.query.requester, audience: req.query.audience }));
});

app.post('/api/notifications/read', (req, res) => {
  const b = req.body || {};
  markNotificationsRead({ requester: b.requester, audience: b.audience });
  res.json({ ok: true });
});

// --- Analytics ------------------------------------------------------------
app.get('/api/stats', (req, res) => {
  res.json(stats());
});

// Only start a listener when run directly (local dev). On Vercel/serverless the
// platform imports the exported app as the request handler instead.
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    const ai = aiStatus();
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`AI layer: ${ai.enabled ? `Claude (${ai.model})` : 'heuristic fallback (set ANTHROPIC_API_KEY for Claude)'}`);
  });
}

export default app;
