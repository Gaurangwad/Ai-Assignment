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
import { ARTICLES } from './kb.js';

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

// Find the best-matching knowledge-base article(s) for a free-text query.
function searchKB(text, limit = 3) {
  const qVec = termFreq(tokenize(text));
  if (![...qVec.keys()].length) return [];
  return ARTICLES
    .map((a) => ({ a, score: cosine(qVec, termFreq(tokenize(`${a.title} ${a.keywords.join(' ')} ${a.steps.join(' ')}`))) }))
    .filter((m) => m.score > 0.08)
    .sort((x, y) => y.score - x.score)
    .slice(0, limit)
    .map((m) => ({ ...m.a, match: Math.round(m.score * 100) }));
}

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
  const hits = searchKB(text, 3);
  const hit = hits.find((h) => h.dept === category) || hits[0];
  return hit ? hit.tip : '';
}

// ---------------------------------------------------------------------------
// Gibberish detection — rejects keyboard-mash like "bhdbhbciebc"; nothing else.
// ---------------------------------------------------------------------------
const COMMON = new Set([
  'the', 'and', 'for', 'you', 'are', 'not', 'can', 'how', 'why', 'who', 'where', 'when', 'what',
  'with', 'this', 'that', 'have', 'need', 'help', 'cant', 'cannot', 'wont', 'dont', 'isnt', 'doesnt',
  'my', 'me', 'is', 'it', 'in', 'on', 'to', 'of', 'do', 'no', 'ok', 'up', 'am', 'an', 'at', 'or', 'so',
  'please', 'turn', 'turning', 'work', 'working', 'home', 'office', 'today', 'now', 'still', 'again',
  'reset', 'password', 'login', 'email', 'monitor', 'screen', 'laptop', 'computer', 'wifi', 'vpn',
  'printer', 'software', 'install', 'access', 'card', 'leave', 'payslip', 'salary', 'expense',
  'report', 'invoice', 'reimbursement', 'submit', 'room', 'booking', 'desk', 'broken', 'slow', 'down',
  'urgent', 'error', 'issue', 'problem', 'request', 'change', 'update', 'new', 'old', 'open',
]);

function looksLikeWord(w) {
  if (COMMON.has(w)) return true;
  if (/\d/.test(w)) return true;          // contains a digit
  if (w.length <= 2) return true;         // short tokens (i, my, hr, ok)
  const vowels = (w.match(/[aeiou]/g) || []).length;
  if (vowels === 0) return false;         // no vowel and длинное -> mash
  if (/[bcdfghjklmnpqrstvwxyz]{5,}/.test(w)) return false; // long consonant run
  return vowels / w.length >= 0.18;
}

export function isGibberish(text) {
  const tokens = (String(text || '').toLowerCase().match(/[a-z0-9]+/g)) || [];
  if (!tokens.length) return true;
  const good = tokens.filter(looksLikeWord).length;
  const hasLongAlpha = tokens.some((t) => /^[a-z]+$/.test(t) && t.length >= 4);
  // Reject ONLY when nothing reads like a word and there's a long mashed token.
  return good === 0 && hasLongAlpha;
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
        'a one-line summary; 3-5 concrete resolution steps the agent should take; a warm, concise, ' +
        'professional first reply to the employee (4-6 sentences, no bracketed placeholders); and a ' +
        'short "resolution" note (1-2 sentences) describing the fix, suitable to save when closing.',
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
              resolution: { type: 'string' },
            },
            required: ['summary', 'steps', 'draft', 'resolution'],
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
  const kb = searchKB(`${ticket.title} ${ticket.description}`, 1)[0] || null;
  const steps = [
    `Acknowledge ${ticket.id} and confirm the impact with ${ticket.requester.split(' ')[0]}.`,
    ...(kb ? kb.steps.slice(0, 3) : []),
    similar.length ? `Reuse the fix from "${similar[0].title}": ${similar[0].resolution}` : 'Reproduce the issue and gather any error details.',
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
  const resolution = kb
    ? `${kb.title}: ${kb.steps.slice(0, 2).join(' ')}`
    : similar.length
      ? `Applied the same fix as "${similar[0].title}": ${similar[0].resolution}`
      : 'Resolved after troubleshooting with the employee and confirming the issue was fixed.';
  return {
    summary: `${ticket.requester} reports: ${ticket.title} (${ticket.priority}).`,
    steps,
    draft,
    resolution,
    kb: kb ? { id: kb.id, title: kb.title, link: kb.link } : null,
    source: 'heuristic',
  };
}

// ---------------------------------------------------------------------------
// resolveQuery() — the conversational assistant. Searches internal docs +
// past closed tickets to answer instantly, offer self-service, or pre-fill a
// ticket. Rejects gibberish.
// ---------------------------------------------------------------------------
const ACTION_LABEL = { password_reset: 'Reset my password now', software_provision: 'Provision it for me' };

export async function resolveQuery({ message = '' }, resolved = []) {
  const text = String(message || '').trim();
  if (isGibberish(text)) {
    return {
      type: 'gibberish',
      reply: "Hmm, that doesn't look like something I can help with yet. Try describing your issue in a few words — for example, “my monitor won't turn on” or “where do I submit my expense report?”.",
    };
  }

  const kbHits = searchKB(text, 3);
  const similar = similarTickets({ title: '', description: text }, resolved, 3);
  const best = kbHits[0] || null;
  const dept = best ? best.dept : heuristicCategory(text).category;
  const priority = heuristicPriority(text);

  const fallback = {
    type: 'answer',
    reply: best
      ? `This looks like a ${best.dept} question — “${best.title}”. ${best.tip} Here are the steps:`
      : `I couldn't find an instant answer in our help docs, but I can route this to the ${dept} team for you.`,
    article: best ? { id: best.id, title: best.title, steps: best.steps, link: best.link, dept: best.dept } : null,
    action: best && best.action ? { id: best.action, label: ACTION_LABEL[best.action] } : null,
    similar,
    resolved: !!(best && best.simple),
    suggestedTicket: {
      title: best ? best.title : text.split(/\s+/).slice(0, 9).join(' '),
      description: text,
      category: dept,
      priority,
    },
    source: 'heuristic',
  };
  if (!client) return fallback;

  try {
    const docs = kbHits.length
      ? kbHits.map((a) => `- [${a.id}] ${a.title} (${a.dept}); steps: ${a.steps.join(' | ')}; link: ${a.link}`).join('\n')
      : 'No close documentation match.';
    const past = similar.length
      ? similar.map((s) => `- ${s.title}: ${s.resolution}`).join('\n')
      : 'No similar past tickets.';
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 700,
      system:
        'You are a friendly internal IT/HR/Finance/Admin help assistant. An employee describes a problem in plain ' +
        'language. Using ONLY the provided knowledge-base articles and past resolved tickets, give a warm, concise, ' +
        'human answer with clear step-by-step guidance. If an article has a self-service action (password_reset or ' +
        'software_provision) and clearly fits, offer it. Decide "resolved" = true only when the steps are simple and ' +
        'the employee can fix it themselves without a human. Never invent facts beyond the provided material. Also ' +
        'produce a suggested ticket (title, description, department, urgency) in case they still need a human.',
      messages: [{
        role: 'user',
        content: `Employee said: "${text}"\n\nKnowledge base:\n${docs}\n\nPast resolved tickets:\n${past}`,
      }],
      output_config: {
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              reply: { type: 'string' },
              steps: { type: 'array', items: { type: 'string' } },
              link: { type: 'string' },
              actionId: { type: 'string', enum: ['password_reset', 'software_provision', 'none'] },
              resolved: { type: 'boolean' },
              suggestedTitle: { type: 'string' },
              department: { type: 'string', enum: DEPARTMENTS },
              priority: { type: 'string', enum: PRIORITIES },
            },
            required: ['reply', 'steps', 'link', 'actionId', 'resolved', 'suggestedTitle', 'department', 'priority'],
            additionalProperties: false,
          },
        },
      },
    });
    const p = JSON.parse(res.content.find((b) => b.type === 'text').text);
    return {
      type: 'answer',
      reply: p.reply,
      article: p.steps && p.steps.length
        ? { id: best ? best.id : 'kb', title: best ? best.title : 'Suggested steps', steps: p.steps, link: p.link || (best && best.link) || '', dept: p.department }
        : null,
      action: p.actionId && p.actionId !== 'none' ? { id: p.actionId, label: ACTION_LABEL[p.actionId] } : null,
      similar,
      resolved: !!p.resolved,
      suggestedTicket: { title: p.suggestedTitle || text.slice(0, 60), description: text, category: p.department, priority: p.priority },
      source: 'claude',
    };
  } catch (err) {
    console.warn('AI resolveQuery failed, using heuristic:', err.message);
    return fallback;
  }
}

// Simulated self-service actions (password reset, software provisioning).
export function runAction(action, { requester = 'you' } = {}) {
  const name = requester.split(' ')[0] || 'you';
  if (action === 'password_reset') {
    return { ok: true, message: `Done, ${name} — a secure password-reset link has just been emailed to your registered address. It expires in 30 minutes.` };
  }
  if (action === 'software_provision') {
    return { ok: true, message: `All set — your software request is auto-approved and queued. It'll install on your device within ~15 minutes. No ticket needed.` };
  }
  return { ok: false, message: 'That self-service action isn’t available — I’ll raise a ticket instead.' };
}
