// AI layer: auto-categorisation, similar-ticket surfacing, and agent draft replies.
//
// Uses Claude (claude-opus-4-8) when ANTHROPIC_API_KEY is set, and falls back to
// fast deterministic heuristics otherwise — so the prototype always works.
import Anthropic from '@anthropic-ai/sdk';
import { DEPARTMENTS, PRIORITIES } from './store.js';

const MODEL = 'claude-opus-4-8';
const hasKey = !!process.env.ANTHROPIC_API_KEY;
const client = hasKey ? new Anthropic() : null;

export function aiStatus() {
  return { enabled: hasKey, model: hasKey ? MODEL : null };
}

// ---------------------------------------------------------------------------
// Keyword signals — used by the fallback classifier and to explain decisions.
// ---------------------------------------------------------------------------
const SIGNALS = {
  IT: ['laptop', 'password', 'login', 'vpn', 'wifi', 'network', 'email', 'outlook',
    'software', 'install', 'access', 'account', 'server', 'printer', 'screen',
    'computer', 'system', 'error', 'bug', 'crash', 'reset', 'hardware', 'monitor'],
  HR: ['leave', 'vacation', 'payroll', 'salary', 'benefits', 'onboarding', 'offboarding',
    'policy', 'harassment', 'manager', 'appraisal', 'review', 'pto', 'sick',
    'recruitment', 'hiring', 'contract', 'employee', 'attendance', 'holiday'],
  Finance: ['invoice', 'reimbursement', 'expense', 'payment', 'budget', 'vendor',
    'tax', 'refund', 'billing', 'purchase', 'po', 'receipt', 'claim', 'finance',
    'accounting', 'cost', 'transfer', 'bank'],
  Admin: ['desk', 'office', 'chair', 'facility', 'cleaning', 'maintenance', 'badge',
    'parking', 'meeting room', 'supplies', 'stationery', 'visitor', 'building',
    'cafeteria', 'access card', 'seating', 'room booking'],
};

const URGENT_WORDS = ['urgent', 'asap', 'immediately', 'critical', 'blocked', 'down',
  'cannot work', "can't work", 'outage', 'emergency', 'security', 'breach', 'deadline'];
const MILD_WORDS = ['soon', 'today', 'tomorrow', 'slow', 'intermittent', 'when possible', 'this week'];

function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

function heuristicCategory(text) {
  const lower = (text || '').toLowerCase();
  const scores = Object.fromEntries(DEPARTMENTS.map((d) => [d, 0]));
  for (const [dept, words] of Object.entries(SIGNALS)) {
    for (const w of words) {
      if (lower.includes(w)) scores[dept] += 1;
    }
  }
  let best = 'IT';
  let bestScore = -1;
  for (const [dept, score] of Object.entries(scores)) {
    if (score > bestScore) {
      best = dept;
      bestScore = score;
    }
  }
  const totalHits = Object.values(scores).reduce((a, b) => a + b, 0);
  const confidence = totalHits === 0 ? 0.35 : Math.min(0.95, 0.5 + bestScore / (totalHits + 1));
  const matched = SIGNALS[best].filter((w) => lower.includes(w));
  return {
    category: best,
    confidence: Number(confidence.toFixed(2)),
    reason: matched.length
      ? `Matched ${best} keywords: ${matched.slice(0, 4).join(', ')}.`
      : 'No strong signal found; defaulted to IT. Please confirm the department.',
  };
}

function heuristicPriority(text) {
  const lower = (text || '').toLowerCase();
  if (URGENT_WORDS.some((w) => lower.includes(w))) return 'urgent';
  if (MILD_WORDS.some((w) => lower.includes(w))) return 'mild';
  return 'normal';
}

// ---------------------------------------------------------------------------
// 1. Auto-categorise a ticket from its description.
// ---------------------------------------------------------------------------
export async function categorize({ title = '', description = '' }) {
  const text = `${title}\n${description}`.trim();
  const fallback = { ...heuristicCategory(text), priority: heuristicPriority(text), source: 'heuristic' };
  if (!client || !text) return fallback;

  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 400,
      system:
        'You triage internal employee support tickets for a company. ' +
        'Pick the single best department and an urgency level. ' +
        'Departments: IT (devices, accounts, software, network), ' +
        'HR (leave, payroll, benefits, people issues), ' +
        'Finance (invoices, expenses, reimbursements, budgets), ' +
        'Admin (office, facilities, supplies, building access). ' +
        'Urgency: urgent (work-blocking, security, hard deadline), ' +
        'mild (needed soon, degraded), normal (routine request).',
      messages: [
        {
          role: 'user',
          content: `Ticket title: ${title}\nTicket description: ${description}`,
        },
      ],
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
            },
            required: ['category', 'priority', 'confidence', 'reason'],
            additionalProperties: false,
          },
        },
      },
    });
    const block = res.content.find((b) => b.type === 'text');
    const parsed = JSON.parse(block.text);
    return { ...parsed, source: 'claude' };
  } catch (err) {
    console.warn('AI categorize failed, using heuristic:', err.message);
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// 2. Surface similar previously-resolved tickets (local TF-cosine; always on).
// ---------------------------------------------------------------------------
export function similarTickets({ title = '', description = '' }, resolved, limit = 3) {
  const queryTokens = tokenize(`${title} ${description}`);
  if (!queryTokens.length || !resolved.length) return [];

  const qVec = termFreq(queryTokens);
  const scored = resolved.map((t) => {
    const tVec = termFreq(tokenize(`${t.title} ${t.description} ${t.resolution || ''}`));
    return { ticket: t, score: cosine(qVec, tVec) };
  });
  return scored
    .filter((s) => s.score > 0.06)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => ({
      id: s.ticket.id,
      title: s.ticket.title,
      category: s.ticket.category,
      status: s.ticket.status,
      resolution: s.ticket.resolution || '',
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
  if (!magA || !magB) return 0;
  return dot / (magA * magB);
}

// ---------------------------------------------------------------------------
// 3. Auto-draft a suggested first response for the agent.
// ---------------------------------------------------------------------------
export async function draftResponse(ticket, similar = []) {
  if (!client) return heuristicDraft(ticket, similar);
  try {
    const context = similar.length
      ? `Similar resolved tickets for reference:\n${similar
          .map((s) => `- ${s.title}: ${s.resolution}`)
          .join('\n')}`
      : 'No similar resolved tickets were found.';
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 500,
      system:
        `You are a ${ticket.category} support agent writing the first reply to an employee. ` +
        'Be warm, concise, and professional. Acknowledge the issue, state the immediate next ' +
        'step or a likely fix, and set expectations. 4-6 sentences. No placeholders in brackets.',
      messages: [
        {
          role: 'user',
          content:
            `Employee: ${ticket.requester}\nTitle: ${ticket.title}\n` +
            `Description: ${ticket.description}\nUrgency: ${ticket.priority}\n\n${context}`,
        },
      ],
    });
    const block = res.content.find((b) => b.type === 'text');
    return block ? block.text.trim() : heuristicDraft(ticket, similar);
  } catch (err) {
    console.warn('AI draft failed, using heuristic:', err.message);
    return heuristicDraft(ticket, similar);
  }
}

function heuristicDraft(ticket, similar) {
  const hint = similar.length
    ? ` We've handled similar requests before — for example "${similar[0].title}", which we resolved by: ${similar[0].resolution}`
    : '';
  return (
    `Hi ${ticket.requester.split(' ')[0] || 'there'},\n\n` +
    `Thanks for reaching out to the ${ticket.category} team about "${ticket.title}". ` +
    `I've picked up your ticket (${ticket.id}) and I'm looking into it now.${hint}\n\n` +
    `I'll update you shortly with next steps. If anything is blocking you in the meantime, ` +
    `just reply here and let me know.\n\nBest,\n${ticket.category} Support`
  );
}
