// src/shared/prompt-check/assessment.mjs — Shaper ask screens: the contract of Guide's check (POST /api/shape/guide/check).
// The five checks and their two label sets (plain for a plain-register lead, technical otherwise), the default
// questions, the sizes, the prompt limit, the request validator and the reply normalizer. The labels are fixed here,
// never taken from a model reply. Pure and browser-safe, so the composer reads the same labels and limit.
import { answererLeadKeys, isPlainLead } from '../answerer.mjs';

export const GUIDE_CHECK_IDS = Object.freeze(['who', 'what', 'trigger', 'limits', 'done']);

export const GUIDE_CHECK_LABELS = Object.freeze({
  plain: Object.freeze({
    who: 'Who is it for', what: 'What they get', trigger: 'What starts it', limits: 'Limits', done: 'How you know it worked',
  }),
  technical: Object.freeze({
    who: 'Who calls it', what: 'The behaviour', trigger: 'Trigger and scope', limits: 'Constraints', done: 'Acceptance checks',
  }),
});

/** The question an open check asks when the model gave none of its own. */
export const GUIDE_DEFAULT_QUESTIONS = Object.freeze({
  plain: Object.freeze({
    who: 'Who will use it, and in what role?',
    what: 'What will they have once it is done?',
    trigger: 'When should it happen, and what makes it start?',
    limits: 'Is there anything it must not do or change?',
    done: 'What will you see when it works?',
  }),
  technical: Object.freeze({
    who: 'Which user, service or caller invokes it?',
    what: 'What exactly should it do, step by step?',
    trigger: 'What event starts it, and what does it touch?',
    limits: 'Which limits on performance, data or compatibility apply?',
    done: 'Which checks prove it works?',
  }),
});

export const GUIDE_SIZES = Object.freeze(['small', 'medium', 'large']);
export const GUIDE_PROMPT_MAX = 8000;
export const GUIDE_QUESTION_MAX = 160;

const refusal = (code, status, message) => Object.assign(new Error(message), { code, status });
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** 'plain' for a plain-register lead (Product, UX, Compliance), 'technical' for any other lead and for no role. */
export function guideRegister(role) {
  return typeof role === 'string' && role !== '' && isPlainLead(role) ? 'plain' : 'technical';
}

/** The size by word count: under 60 words small, under 200 medium, else large. */
export function sizeByWords(text) {
  const n = String(text ?? '').split(/\s+/).filter(Boolean).length;
  return n < 60 ? 'small' : n < 200 ? 'medium' : 'large';
}

/** The request body → `{ text, role }` (`role` a known lead or null). Throws an Error with `code` and `status`. */
export function assertGuideCheckInput(body) {
  const obj = isObject(body);
  const role = obj ? body.role : undefined;
  const noRole = role === null || role === undefined || role === '';
  if (!noRole && !(typeof role === 'string' && answererLeadKeys({ smallRuns: true }).includes(role))) {
    throw refusal('GUIDE_BAD_ROLE', 400, 'Guide does not know that role.');
  }
  const prompt = obj ? body.prompt : undefined;
  if (typeof prompt !== 'string' || prompt.trim() === '') throw refusal('GUIDE_BAD_PROMPT', 400, 'Guide needs a prompt to check.');
  if (prompt.length > GUIDE_PROMPT_MAX) {
    throw refusal('GUIDE_PROMPT_TOO_LONG', 413, `The prompt is longer than Guide checks (${GUIDE_PROMPT_MAX} characters).`);
  }
  return { text: prompt, role: noRole ? null : role };
}

/** One line, trimmed, at most GUIDE_QUESTION_MAX characters; '' when it is not a usable string. */
const cleanQuestion = (q) => (typeof q === 'string' ? q.replace(/\s+/g, ' ').trim().slice(0, GUIDE_QUESTION_MAX).trimEnd() : '');

function normalizeSize(size, text) {
  if (size === 'very-large') return 'large';
  return GUIDE_SIZES.includes(size) ? size : sizeByWords(text);
}

/** A model reply → five checks in GUIDE_CHECK_IDS order, each covered or with a question, and a size. Never throws. */
export function normalizeGuideCheck(raw, { register, text }) {
  const reg = register === 'plain' ? 'plain' : 'technical';
  const reply = isObject(raw) ? raw : {};
  const entries = isObject(reply.checks) ? reply.checks : {};
  const checks = GUIDE_CHECK_IDS.map((id) => {
    const e = Object.hasOwn(entries, id) && isObject(entries[id]) ? entries[id] : {};
    const covered = e.covered === true;
    const question = covered ? '' : cleanQuestion(e.question) || GUIDE_DEFAULT_QUESTIONS[reg][id];
    return { id, label: GUIDE_CHECK_LABELS[reg][id], covered, question };
  });
  return { register: reg, size: normalizeSize(reply.size, text), checks };
}
