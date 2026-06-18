# Helpdesk — Internal Support Ticketing with an AI Layer

A minimalist web app for employees to raise support tickets to internal
departments (**IT, HR, Finance, Admin**) and track them through their full
lifecycle, with an integrated AI layer and built-in analytics.

> Built with a user-first design: the employee describes a problem in plain
> language and the tool does the routing, duplicate-checking, and first-reply
> drafting for them.

---

## Features

### Full ticket lifecycle
- Employees raise a ticket with **title, description, department, and urgency**.
- **Urgency is colour-coded**: 🔴 Urgent · 🟡 Mild · 🟢 Non-urgent.
- Tickets route to the relevant **department queue**.
- Agents move a ticket through **Open → In Progress → Resolved → Closed**.
- The employee is **notified (in-app bell)** every time their ticket moves.
- **Priority-aware filtering** by department, urgency, status, and free text.

### AI layer
1. **Conversational assistant ("Ask AI")** — employees describe a problem in
   plain language ("My monitor isn't turning on", "Where do I submit my expense
   report?"). The assistant searches the internal knowledge base + past closed
   tickets and replies with a humanized, step-by-step answer and a doc link.
   Simple low-priority cases are resolved with **one-click self-service**
   (password reset, software provisioning) — no human needed. Anything harder
   becomes a **pre-filled ticket**. Gibberish (e.g. `bhdbhbciebc`) is rejected,
   and only gibberish.
2. **Auto-categorisation + live assist** — while raising a ticket, the right
   department + urgency are suggested, the wording is rephrased/polished
   (one-click apply), tags are extracted, completeness is scored, and similar
   resolved tickets are surfaced with a match %.
3. **Agent recommender** — for the assigned agent, the system searches internal
   docs and past closed tickets to recommend a summary, step-by-step resolution,
   and a drafted first reply.

The AI uses **Claude (`claude-opus-4-8`)** when `ANTHROPIC_API_KEY` is set, and
falls back to fast, deterministic heuristics (keyword classifier + TF-cosine
similarity) otherwise — **so the prototype always works, key or no key**.

### Analytics
A dedicated page with:
- **Monthly total tickets** (last 6 months).
- **Department-wise** ticket counts.
- **Open vs In Progress vs Resolved vs Closed** breakdown.

Charts are rendered as inline SVG — **no external chart library or CDN**, so it
runs fully offline.

---

## Run it

```bash
npm install
npm run seed     # optional: load 20 sample tickets (auto-seeds on first run)
npm start        # http://localhost:3000
```

To enable the real Claude-powered AI layer:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npm start
```

---

## How to use the prototype

The header has an **Employee / Agent** toggle to switch perspective (no login —
it's a prototype) and an "acting as" employee selector.

- **As an Employee**: go to *Raise ticket*, type a description — AI suggestions
  appear automatically. Submit, then watch the 🔔 bell for status updates under
  *Tickets* (you only see your own).
- **As an Agent**: go to *Tickets* to see all department queues, filter by
  priority, open a ticket, advance its status, generate an AI draft reply, and
  save resolution notes (which feed future similar-ticket matching).
- **Analytics** is available to both.

---

## Architecture

```
server.js          Express API + static hosting
lib/store.js       JSON-file persistence (tickets, notifications, stats)
lib/ai.js          AI layer: Claude + deterministic fallbacks
lib/seed.js        Sample data
public/            Vanilla-JS SPA (index.html, styles.css, app.js)
```

### API
| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/meta` | Departments, priorities, statuses, AI status |
| `GET` | `/api/tickets` | List + filter (`category`, `priority`, `status`, `requester`, `q`) |
| `POST` | `/api/tickets` | Create a ticket |
| `PATCH` | `/api/tickets/:id/status` | Advance lifecycle status |
| `PATCH` | `/api/tickets/:id/resolution` | Save resolution notes |
| `POST` | `/api/ai/chat` | Conversational assistant (answer / self-service / pre-fill); rejects gibberish |
| `POST` | `/api/ai/action` | Run a self-service action (password reset, software provisioning) |
| `POST` | `/api/ai/assist` | Live composer assist (routing, rephrase, tags, completeness, similar) |
| `POST` | `/api/ai/similar` | Surface similar resolved tickets |
| `POST` | `/api/ai/draft/:id` | Agent summary + resolution steps + drafted reply |
| `GET` | `/api/notifications` | Employee notifications |
| `GET` | `/api/stats` | Analytics aggregates |

No external dependencies beyond `express` and the official `@anthropic-ai/sdk`.
