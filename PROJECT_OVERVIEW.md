# Helpdesk — Internal Support Ticketing with an AI Layer

**Project Overview**

## 1. What it is

Helpdesk is a web application through which employees can raise support tickets to
internal departments — **IT, HR, Finance, and Admin** — and track them to
resolution. It covers the full ticket lifecycle: an employee describes a problem,
the ticket is routed to the right department queue, an agent moves it through
**Open → In Progress → Resolved → Closed**, and the employee is notified at every
step.

What sets it apart is a built-in **AI layer**. Instead of forcing employees to know
which team to contact or how to phrase a request, a conversational assistant
understands the problem in plain language, answers instantly from an internal
knowledge base and past resolved tickets, and — for simple, low-priority cases —
offers one-click self-service (such as a password reset) that the employee can
accept or reject. Harder cases become a pre-filled ticket. The design is
deliberately **simple, minimalist, and humanized**, taking UX cues from tools like
Jira and Linear without copying them.

## 2. Features it has

**Full ticket lifecycle**
- Raise a ticket with a title, description, department, and colour-coded urgency
  (red = urgent, yellow = mild, green = non-urgent).
- Automatic routing to the relevant department queue.
- Agent status workflow with in-app notifications to the employee on every move.
- Priority-aware filtering by department, urgency, status, and free-text search.

**AI layer**
- **Conversational assistant ("Ask AI")** — answers plain-language questions from
  internal docs + past closed tickets, with step-by-step guidance and links.
- **Optional self-service** — password resets and software provisioning for simple
  cases; nothing is applied automatically, the employee always accepts, rejects,
  or escalates to a human.
- **Live writing assist** — suggests the department and urgency, rephrases and
  polishes the ticket text (one-click apply), extracts tags, scores completeness,
  and flags possible duplicates with a match percentage.
- **Agent recommender** — drafts a first reply and recommends a summary and
  step-by-step resolution drawn from documentation and similar past tickets.
- **Gibberish rejection** — nonsense input (e.g. `bhdbhbciebc`) is rejected, and
  only gibberish.

**Analytics & UX**
- Dashboard with monthly ticket totals, department-wise counts, and an
  Open/In-Progress/Resolved/Closed breakdown (self-rendered SVG charts).
- A Jira-style **Kanban board** for agents alongside a list view.
- Minimalist, modular interface with single coloured icons instead of emojis.

## 3. Tech stack used

| Layer | Technology |
|---|---|
| Runtime | Node.js (ES Modules) |
| Web server / API | Express |
| AI | Anthropic Claude (`claude-opus-4-8`) via the official SDK, with deterministic heuristic fallbacks |
| Data store | Lightweight JSON file store (memory fallback on serverless) |
| Frontend | Vanilla JavaScript single-page app, hand-written CSS |
| Charts | Inline SVG (no charting library) |
| Knowledge base | In-repo internal documentation module |
| Deployment | Vercel (serverless function + bundled static assets) |

## 4. Why that tech / language was chosen

- **Node.js + Express** — JavaScript across the whole stack keeps the codebase
  small and consistent, and Express is the simplest way to stand up a clean REST
  API and serve the frontend with almost no boilerplate.
- **Vanilla JS + hand-written CSS (no framework)** — the brief asked for a simple,
  minimalist, modular UI. Skipping React/Tailwind removes a build step and a large
  dependency tree, so the prototype loads fast and stays easy to read and modify.
- **Inline SVG charts (no chart library)** — guarantees the analytics render
  offline with zero external/CDN dependencies and no version risk.
- **JSON file store (not a database)** — fastest path to a working prototype with
  no native build steps or external services; it degrades gracefully to in-memory
  on a read-only serverless filesystem, and can be swapped for a hosted database
  later without touching the API.
- **Claude (`claude-opus-4-8`) with heuristic fallbacks** — Claude provides the
  genuine natural-language understanding the AI features need (classification,
  rephrasing, conversational answers). The deterministic fallbacks (keyword
  classifier + TF-cosine similarity) mean the app still works fully without an API
  key, which is ideal for a demo.
- **Vercel** — zero-config serverless hosting that runs the Express app and static
  assets directly, giving a public URL with minimal setup.

## 5. Use-case

The primary use-case is **internal employee support inside an organisation**.

- An employee whose **monitor won't turn on** opens "Ask AI", gets the fix in
  three steps, and resolves it themselves — no ticket, no agent time spent.
- An employee who **forgot their password** is offered a one-click reset and
  accepts it; if it doesn't help, they escalate to a ticket from the same chat.
- An employee unsure **where to submit an expense report** gets the exact portal
  link and steps instantly.
- A genuinely complex issue becomes a **pre-filled, correctly-routed ticket**, and
  the assigned agent receives an AI summary, suggested resolution steps, and a
  drafted reply — closing it faster.
- A team lead opens **Analytics** to see ticket volume by month and department and
  the open-vs-resolved split, to spot bottlenecks and staffing needs.

The result is fewer tickets reaching humans, faster resolution for the ones that
do, and a support experience that feels effortless for employees.
