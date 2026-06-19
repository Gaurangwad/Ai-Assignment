# Internal Support Ticketing with an AI Layer — Build Summary

## 1. Overview

This is a web app that lets employees raise internal support tickets to the right
department — **IT, HR, Finance, or Admin** — and track them all the way to
resolution. It covers the full ticket lifecycle: an employee describes a problem
with a title, description, department, and a colour-coded urgency (red = urgent,
yellow = mild, green = non-urgent); the ticket is routed to the correct department
queue; an agent moves it through **Open → In Progress → Resolved → Closed**; and
the employee is notified at every step.

On top of the basics, I built a practical AI layer. Employees can simply describe
a problem in plain language and get an instant answer from an internal knowledge
base and past resolved tickets — and for simple, low-priority cases they can
self-serve (for example, a password reset) without waiting for a human, while
always keeping the option to raise a ticket instead. While writing a ticket, the
tool suggests the department and urgency, rephrases the text to be clearer, pulls
up possible duplicates, and scores how complete the request is. Agents get a
drafted first reply, suggested resolution steps, a small personal stats panel, an
"tackle next" prioritisation, and a separate knowledge bot that answers questions
from the live ticket history. There is also an analytics page (agent-only) with a
zoomable timeline, department and status breakdowns, a complaints heatmap, and
CSV import/export.

The whole experience is intentionally **simple and minimalist**. The employee
side leads with a single "describe your problem" box rather than a long form, the
agent side uses a familiar board/list view, colours and one-line hints do the
explaining, and there's a dark mode. The goal was that nobody needs training to
use it.

## 2. Core architecture and tech stack

The app is deliberately lightweight, with a clear split between a small API and a
single-page front end.

**Back end — Node.js + Express.** A compact Express server exposes a REST API
(`/api/tickets`, `/api/stats`, `/api/agent/*`, and the `/api/ai/*` endpoints) and
also serves the static front-end files. I chose Express because it stands up a
clean API and static hosting with almost no boilerplate, and keeping the whole
stack in JavaScript made the code consistent end to end.

**Data — a small JSON file store.** Tickets, notifications, and stats live in a
single JSON store module. This was the fastest path to a working prototype with
no database to provision; on a read-only serverless host it automatically falls
back to in-memory so it never crashes. The store is the single source of truth,
and every API route reads and writes through it.

**AI layer — `lib/ai.js` + a knowledge base (`lib/kb.js`).** All AI features go
through one module. It calls Claude when an API key is present and otherwise uses
deterministic fallbacks (a keyword classifier and a TF-cosine similarity search),
so the app works either way. The conversational assistant and the RAG bot both
retrieve from the live tickets plus the knowledge base on every request, which is
what lets them stay current as new tickets come in.

**Front end — a vanilla-JavaScript single-page app.** One `index.html`, one
`styles.css`, and one `app.js`. It talks to the API with `fetch`, switches views
in the browser, and renders all charts as inline SVG. I skipped a framework and a
chart library on purpose: it removes a build step and a large dependency tree,
loads fast, runs fully offline, and keeps the code easy to read and change.

**How it connects.** The browser loads the SPA from Express; the SPA calls the
`/api/*` routes; those routes read/write the JSON store and, for anything
intelligent, call the AI module, which in turn pulls context from the store and
the knowledge base before answering. Deployment is on **Vercel**, where the same
Express app runs as a serverless function with the static assets bundled
alongside it.

## 3. Use of an LLM in the build

I used a large language model (Claude) as an assistant while building this, in the
same way I'd use a sharp pair-programmer. It helped me think through ideas and
trade-offs, sanity-check my approach, scaffold some of the basic structure, write
boilerplate faster, point out gaps in my testing, and track down a couple of
stubborn bugs (for example, a CSS issue where a stylesheet rule was overriding the
`hidden` attribute). The product decisions, the architecture, how the pieces fit
together, the feature design, and the debugging judgment were mine — the model
sped up the routine parts so I could spend more time on the design and the
details that actually matter. The app's own AI features also use the same model
at runtime, with the heuristic fallbacks I designed so it keeps working without a
key.

## 4. Most significant technical and design decisions

**AI with a deterministic fallback (so it always works).** *Idea:* an AI demo is
useless if it dies without an API key. *What:* every AI feature has a real
fallback — keyword classification and cosine-similarity retrieval. *Why:* the
prototype runs and demos anywhere, and gets noticeably smarter when a key is
added, without changing any of the calling code.

**Clear separation of the employee and agent experiences.** *Idea:* the two users
want completely different things. *What:* employees see only their own tickets,
the conversational "Ask AI", and self-service; agents see all tickets, analytics,
the knowledge bot, and their stats. *Why:* it keeps each side simple and
uncluttered, and avoids exposing cross-ticket data to employees.

**A dependency-light front end with self-rendered SVG charts.** *Idea:* match the
"simple and minimalist" brief in the code, not just the look. *What:* vanilla JS,
hand-written CSS, and charts (including a zoomable timeline and a complaints
heatmap) drawn as inline SVG. *Why:* no build step, no CDN, fast load, works
offline, and full control over how everything looks and behaves.

**RAG over live tickets so the assistants "keep learning".** *Idea:* the most
useful answers come from what the organisation has already solved. *What:* the
chat assistant and the knowledge bot retrieve the most relevant tickets and help
articles on each question and answer strictly within that, declining when the
question is out of scope. *Why:* answers stay grounded and current as the ticket
history grows, instead of relying on a fixed, stale script.

**Self-service that stays optional.** *Idea:* automation should help, never take
over. *What:* even for simple cases, the AI never resolves anything on its own —
the employee accepts the suggested fix, marks it solved, or raises a ticket, and
can still escalate after a self-service action. *Why:* it builds trust and keeps
the person in control, which is what makes people actually use a tool like this.
