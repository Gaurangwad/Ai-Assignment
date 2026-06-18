// AI layer — a rich, "assistant-while-you-write" experience plus agent insights.
//
// Uses Claude (claude-opus-4-8) when ANTHROPIC_API_KEY is set, and otherwise
// falls back to fast deterministic heuristics — so the prototype always works.
//
// Capabilities:
//   assist()         live triage while writing: department, urgency, confidence,
//                    a rephrased/polished title + description, tags, a
//                    completeness check, and a self-help deflection tip.
//   similarTickets() previously-resolved tickets with a match %.
//   agentInsights()  for agents: a one-line summary, suggested resolution steps,
//                    and a drafted first response.
import Anthropic from '@anthropic-ai/sdk';
import { DEPARTMENTS, PRIORITIES } from './store.js';

const MODEL = 'claude-opus-4-8';
const hasKey = !!process.env.ANTHROPIC_API_KEY;
const client = hasKey ? new Anthropic() : null;

export function aiStatus() {
  return { enabled: hasKey, model: hasKey ? MODEL : null };
}

// ---------------------------------------------------------------------------
// Keyword signals — power the fallback classifier and tag extraction.
// ---------------------------------------------------------------------------
const SIGNALS = {
  IT: ['laptop', 'password', 'login', 'vpn', 'wifi', 'network', 'email', 'outlook',
    'software', 'install', 'access', 'account', 'server', 'printer', 'screen',
    'computer', 'system', 'error', 'bug', 'crash', 'reset', 'hardware', 'monitor'],
  HR: ['leave', 'vacation', 'payroll', 'salary', 'benefits', 'onboarding', 'offboarding',
    'policy', 'harassment', 'manager', 'appraisal', 'review', 'pto', 'sick',
    'recruitment', 'hiring', 'contract', 'employee', 'attendance', 'holiday'],
  Finance: ['invoice', 'reimbursement', 'expense', 'payment', 'budget', 'vendor',
    'tax', 'refund', 'billing', 'purchase', 'receipt', 'claim', 'finance',
    'accounting', 'cost', 'transfer', 'bank'],
  Admin: ['desk', 'office', 'chair', 'facility', 'cleaning', 'maintenance', 'badge',
    'parking', 'supplies', 'stationery', 'visitor', 'building',
    'cafeteria', 'seating', 'booking', 'room'],
};

const URGENT_WORDS = ['urgent', 'asap', 'immediately', 'critical', 'blocked', 'down',
  'cannot work', "can't work", 'outage', 'emergency', 'security', 'breach', 'deadline'];
const MILD_WORDS = ['soon', 'today', 'tomorrow', 'slow', 'intermittent', 'when possible', 'this week'];
const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'have', 'cannot', 'please',
  'when', 'from', 'into', 'about', 'there', 'their', 'would', 'could', 'should', 'been', 'just',
  'your', 'mine', 'they', 'them', 'will', 'what', 'which', 'while', 'after', 'before', 'keeps',
  'keep', 'every', 'few', 'work', 'working', 'home', 'very', 'really', 'need', 'needs', 'want',
  'getting', 'goes', 'gets', 'still', 'again', 'some', 'much', 'over', 'where', 'cant', 'dont']);

// Small self-help knowledge base for deflection (keyword -> tip).
const KB = [
  { dept: 'IT', match: ['password', 'reset', 'locked'], tip: 'Try the self-service password reset portal first — it unlocks most accounts in under a minute.' },
  { dept: 'IT', match: ['vpn', 'disconnect'], tip: 'Restart the VPN client and switch to the nearest gateway; this clears a large share of VPN drops.' },
  { dept: 'IT', match: ['printer', 'print'], tip: 'Power-cycle the printer and re-add it from Settings → Printers before raising a ticket.' },
  { dept: 'IT', match: ['wifi', 'network', 'slow'], tip: 'Forget and rejoin the network, and move closer to an access point — that resolves most intermittent Wi-Fi issues.' },
  { dept: 'HR', match: ['leave', 'balance', 'pto', 'vacation'], tip: 'Your live balance is on the HRIS “My Balance” page; annual carry-over is applied on the 1st of the year.' },
  { dept: 'HR', match: ['payslip', 'payroll', 'salary'], tip: 'Payslips appear under Documents → Payroll within 24 hours of payday.' },
  { dept: 'Finance', match: ['reimbursement', 'expense', 'receipt', 'claim'], tip: 'Attach an itemised receipt to every claim — missing receipts are the single biggest cause of delays.' },
  { dept: 'Finance', match: ['invoice', 'vendor', 'portal'], tip: 'The vendor portal rejects files over 5 MB — compress the PDF and re-upload.' },
  { dept: 'Admin', match: ['access card', 'badge', 'card'], tip: 'Tap firmly and try a second reader; if it still fails we can re-encode the card.' },
  { dept: 'Admin', match: ['room', 'booking', 'meeting'], tip: 'Most double-bookings clear once a stale recurring invite is removed from the room calendar.' },
];

// ---------------------------------------------------------------------------
// Text utilities
// ---------------------------------------------------------------------------
function tokenize(text) {
  return (text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2);
}

function heuristicCategory(text) {
  const lower = (text || '').toLowerCase();
  const scores = Object.fromEntries(DEPARTMENTS.map((d) => [d, 0]));
  for (const [dept, words] of Object.entries(SIGNALS)) {
    for (const w of words) if (lower.includes(w)) scores[dept] += 1;
  }
  let best = 'IT', bestScore = -1;
  for (const [dept, score] of Object.entries(scores)) {
    if (score > bestScore) { best = dept; bestScore = score; }
  }
  const totalHits = Object.values(scores).reduce((a, b) => a + b, 0);
  const confidence = totalHits === 0 ? 0.35 : Math.min(0.96, 0.5 + bestScore / (totalHits + 1));
  const matched = SIGNALS[best].filter((w) => lower.includes(w));
  return {
    category: best,
    confidence: Number(confidence.toFixed(2)),
    reason: matched.length
      ? `Matched ${best} signals: ${matched.slice(0, 4).join(', ')}.`
      : 'No strong signal yet — defaulted to IT. Add a little more detail or confirm the department.',
  };
}

function heuristicPriority(text) {
  const lower = (text || '').toLowerCase();
  if (URGENT_WORDS.some((w) => lower.includes(w))) return 'urgent';
  if (MILD_WORDS.some((w) => lower.includes(w))) return 'mild';
  return 'normal';
}

function extractTags(text, category) {
  const lower = (text || '').toLowerCase();
  const fromSignals = (SIGNALS[category] || []).filter((w) => lower.includes(w));
  const freq = new Map();
  for (const w of tokenize(text)) if (!STOP.has(w)) freq.set(w, (freq.get(w) || 0) + 1);
  const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([w]) => w);
  return [...new Set([...fromSignals, ...top])].slice(0, 5);
}

function titleCase(s) {
  return s.replace(/\s+/g, ' ').trim().replace(/^./, (c) => c.toUpperCase());
}

function heuristicRephrase(title, description, category, priority) {
  const desc = (description || '').replace(/\s+/g, ' ').trim();
  const firstSentence = desc.split(/(?<=[.!?])\s/)[0] || desc;
  const t = (title || '').trim();
  // Prefer the title only if it's reasonably specific; otherwise take a natural
  // opening phrase from the description (kept readable, not keyword-stripped).
  const base = t.split(/\s+/).filter(Boolean).length >= 3
    ? t
    : firstSentence.split(/\s+/).slice(0, 9).join(' ').replace(/[,;:]+$/, '');
  const rephrasedTitle = titleCase(base).slice(0, 90);
  const impact = priority === 'urgent'
    ? 'This is blocking my work and needs urgent attention.'
    : priority === 'mild'
      ? 'It is affecting my work and I would like it resolved soon.'
      : 'This is a routine request with no immediate urgency.';
  const rephrasedDescription =
    `${titleCase(firstSentence).replace(/[.?!]?$/, '.')}\n\n` +
    `• What's happening: ${desc.replace(/[.?!]?$/, '.')}\n` +
    `• Impact: ${impact}\n` +
    `• Department: ${category}`;
  return { rephrasedTitle, rephrasedDescription };
}

function completeness(title, description) {
  const lower = (description || '').toLowerCase();
  const missing = [];
  if ((description || '').length < 40) missing.push('a bit more detail about the problem');
  if (!/(tried|already|attempt|restart|checked)/.test(lower)) missing.push('what you have already tried');
  if (!/(error|message|code|since|when|happens)/.test(lower)) missing.push('any error message or when it started');
  if (!title || title.trim().length < 4) missing.push('a short, specific title');
  const score = Math.max(0, Math.round(100 - missing.length * 22));
  return { score, missing: missing.slice(0, 3) };
}

function selfHelp(text, category) {
  const lower = (text || '').toLowerCase();
  const hit = KB.find((k) => k.dept === category && k.match.some((w) => lower.includes(w)))
    || KB.find((k) => k.match.some((w) => lower.includes(w)));
  return hit ? hit.tip : '';
}

// ---------------------------------------------------------------------------
// assist() — the live, in-flow assistant for the ticket composer.
// ---------------------------------------------------------------------------
export async function assist({ title = '', description = '' }) {
  const text = `${title}\n${description}`.trim();
  const cat = heuristicCategory(text);
  const priority = heuristicPriority(text);
  const fallback = {
    ...cat,
    priority,
    tags: extractTags(text, cat.category),
    ...heuristicRephrase(title, description, cat.category, priority),
    ...completeness(title, description),
    selfHelp: selfHelp(text, cat.category),
    summary: titleCase((description || title).split(/(?<=[.!?])\s/)[0] || '').slice(0, 120),
    source: 'heuristic',
  };
  if (!client || text.length < 8) return fallback;

  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 900,
      system:
        'You are an in-app assistant helping an employee write a clear internal support ticket, ' +
        'similar to AI helpers in tools like Jira and Linear. From their rough title/description:\n' +
        '- pick the best department (IT, HR, Finance, Admin) and urgency (urgent=work-blocking/security/deadline, ' +
        'mild=needed soon/degraded, normal=routine).\n' +
        '- rewrite the title into a short, specific, professional one (max ~10 words).\n' +
        '- rewrite the description into a clear, well-structured ticket (a one-line problem statement, then concise ' +
        'bullets for what is happening, impact, and anything tried). Keep the employee\'s facts; do not invent details.\n' +
        '- extract 3-5 short lowercase tags.\n' +
        '- list up to 3 specific missing details that would speed up resolution.\n' +
        '- give a completeness score 0-100.\n' +
        '- if the issue is commonly self-resolvable, give one concrete self-help tip; otherwise empty string.\n' +
        '- give a one-line summary for the agent.',
      messages: [{ role: 'user', content: `Title: ${title}\nDescription: ${description}` }],
      output_config: {
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              category: { type: 'string', enum: DEPARTMENTS },
              priority: { type: 'string', enum: PRIORITIES },
              confidence: { type: 'number' },
              reason: { type: 'string' },
              rephrasedTitle: { type: 'string' },
              rephrasedDescription: { type: 'string' },
              tags: { type: 'array', items: { type: 'string' } },
              missing: { type: 'array', items: { type: 'string' } },
              score: { type: 'number' },
              selfHelp: { type: 'string' },
              summary: { type: 'string' },
            },
            required: ['category', 'priority', 'confidence', 'reason', 'rephrasedTitle',
              'rephrasedDescription', 'tags', 'missing', 'score', 'selfHelp', 'summary'],
            additionalProperties: false,
          },
        },
      },
    });
    const block = res.content.find((b) => b.type === 'text');
    return { ...fallback, ...JSON.parse(block.text), source: 'claude' };
  } catch (err) {
    console.warn('AI assist failed, using heuristic:', err.message);
    return fallback;
  }
}

// Lightweight categorize kept for compatibility (delegates to assist()).
export async function categorize(input) {
  const a = await assist(input);
  return { category: a.category, priority: a.priority, confidence: a.confidence, reason: a.reason, source: a.source };
}

// ---------------------------------------------------------------------------
// similarTickets() — local TF-cosine over resolved tickets (always on).
// ---------------------------------------------------------------------------
export function similarTickets({ title = '', description = '' }, resolved, limit = 4) {
  const queryTokens = tokenize(`${title} ${description}`);
  if (!queryTokens.length || !resolved.length) return [];
  const qVec = termFreq(queryTokens);
  return resolved
    .map((t) => ({ ticket: t, score: cosine(qVec, termFreq(tokenize(`${t.title} ${t.description} ${t.resolution || ''}`))) }))
    .filter((s) => s.score > 0.06)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => ({
      id: s.ticket.id, title: s.ticket.title, category: s.ticket.category,
      status: s.ticket.status, resolution: s.ticket.resolution || '',
      match: Math.round(s.score * 100),
    }));
}

function termFreq(tokens) {
  const m = new Map();
  for (const t of tokens) m.set(t, (m.get(t) || 0) + 1);
  return m;
}
function cosine(a, b) {
  let dot = 0;
  for (const [k, v] of a) if (b.has(k)) dot += v * b.get(k);
  const magA = Math.sqrt([...a.values()].reduce((s, v) => s + v * v, 0));
  const magB = Math.sqrt([...b.values()].reduce((s, v) => s + v * v, 0));
  return magA && magB ? dot / (magA * magB) : 0;
}

// ---------------------------------------------------------------------------
// agentInsights() — summary + resolution steps + drafted first response.
// ---------------------------------------------------------------------------
export async function agentInsights(ticket, similar = []) {
  const fallback = heuristicInsights(ticket, similar);
  if (!client) return fallback;
  try {
    const context = similar.length
      ? `Similar resolved tickets:\n${similar.map((s) => `- ${s.title}: ${s.resolution}`).join('\n')}`
      : 'No similar resolved tickets were found.';
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 800,
      system:
        `You are a senior ${ticket.category} support agent. For the ticket below produce: ` +
        'a one-line summary; 3-5 concrete resolution steps the agent should take; and a warm, concise, ' +
        'professional first reply to the employee (4-6 sentences, no bracketed placeholders).',
      messages: [{
        role: 'user',
        content: `Employee: ${ticket.requester}\nTitle: ${ticket.title}\nDescription: ${ticket.description}\n` +
          `Urgency: ${ticket.priority}\n\n${context}`,
      }],
      output_config: {
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              summary: { type: 'string' },
              steps: { type: 'array', items: { type: 'string' } },
              draft: { type: 'string' },
            },
            required: ['summary', 'steps', 'draft'],
            additionalProperties: false,
          },
        },
      },
    });
    const block = res.content.find((b) => b.type === 'text');
    return { ...JSON.parse(block.text), source: 'claude' };
  } catch (err) {
    console.warn('AI agentInsights failed, using heuristic:', err.message);
    return fallback;
  }
}

// Kept for compatibility.
export async function draftResponse(ticket, similar = []) {
  return (await agentInsights(ticket, similar)).draft;
}

function heuristicInsights(ticket, similar) {
  const tip = selfHelp(`${ticket.title} ${ticket.description}`, ticket.category);
  const steps = [
    `Acknowledge ${ticket.id} and confirm the impact with ${ticket.requester.split(' ')[0]}.`,
    similar.length ? `Reuse the fix from "${similar[0].title}": ${similar[0].resolution}` : 'Reproduce the issue and gather any error details.',
    tip ? `Suggest the quick self-check: ${tip}` : 'Apply the fix and verify with the employee.',
    'Update the ticket status and record resolution notes for future matching.',
  ];
  const hint = similar.length
    ? ` We've resolved similar cases before — for example "${similar[0].title}".`
    : '';
  const draft =
    `Hi ${ticket.requester.split(' ')[0] || 'there'},\n\n` +
    `Thanks for reaching out to the ${ticket.category} team about "${ticket.title}". ` +
    `I've picked up your ticket (${ticket.id}) and I'm looking into it now.${hint}\n\n` +
    `I'll follow up shortly with next steps. If anything is blocking you in the meantime, just reply here.\n\n` +
    `Best,\n${ticket.category} Support`;
  return {
    summary: `${ticket.requester} reports: ${ticket.title} (${ticket.priority}).`,
    steps,
    draft,
    source: 'heuristic',
  };
}
