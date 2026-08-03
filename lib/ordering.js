"use strict";

const PRACTICE_SIZES = {
  quarter: { "Reading and Writing": { count: 7, seconds: 8 * 60 }, Math: { count: 6, seconds: 9 * 60 } },
  half: { "Reading and Writing": { count: 14, seconds: 16 * 60 }, Math: { count: 11, seconds: 17.5 * 60 } },
  module: { "Reading and Writing": { count: 27, seconds: 32 * 60 }, Math: { count: 22, seconds: 35 * 60 } },
  section: { "Reading and Writing": { count: 54, seconds: 64 * 60 }, Math: { count: 44, seconds: 70 * 60 } }
};
const DIFFICULTY_PROFILES = {
  balanced: { Easy: 0.25, Medium: 0.50, Hard: 0.25 },
  higher: { Easy: 0.10, Medium: 0.40, Hard: 0.50 },
  easy: { Easy: 0.65, Medium: 0.30, Hard: 0.05 },
  hard: { Easy: 0, Medium: 0, Hard: 1 }
};

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

const RW_SKILL_ORDER = [
  "Words in Context",
  "Text Structure and Purpose",
  "Cross-Text Connections",
  "Central Ideas and Details",
  "Command of Evidence",
  "Inferences",
  "Boundaries",
  "Form, Structure, and Sense",
  "Transitions",
  "Rhetorical Synthesis"
];
const DIFFICULTY_RANK = { Easy: 0, Medium: 1, Hard: 2 };

function orderLikeSatSection(questions, subject) {
  if (subject === "Reading and Writing") {
    const order = new Map(RW_SKILL_ORDER.map((skill, index) => [skill, index]));
    return [...questions].sort((a, b) => {
      const aOrder = order.has(a.skill) ? order.get(a.skill) : RW_SKILL_ORDER.length;
      const bOrder = order.has(b.skill) ? order.get(b.skill) : RW_SKILL_ORDER.length;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return (DIFFICULTY_RANK[a.difficulty] ?? 2) - (DIFFICULTY_RANK[b.difficulty] ?? 2);
    });
  }
  const bands = { Easy: [], Medium: [], Hard: [] };
  questions.forEach(question => (bands[question.difficulty] || bands.Hard).push(question));
  const ordered = [];
  for (const difficulty of ["Easy", "Medium", "Hard"]) {
    ordered.push(...interleaveSpr(bands[difficulty]));
  }
  return ordered;
}

function interleaveSpr(band) {
  if (!band.length) return [];
  const mcq = shuffle(band.filter(item => item.type !== "spr"));
  const spr = shuffle(band.filter(item => item.type === "spr"));
  if (!spr.length) return mcq;
  const result = [];
  const stride = Math.max(1, Math.round((mcq.length + spr.length) / (spr.length + 1)));
  let mcqIndex = 0, sprIndex = 0;
  for (let i = 0; i < mcq.length + spr.length; i++) {
    if ((i % stride === stride - 1 || mcqIndex >= mcq.length) && sprIndex < spr.length) result.push(spr[sprIndex++]);
    else if (mcqIndex < mcq.length) result.push(mcq[mcqIndex++]);
    else result.push(spr[sprIndex++]);
  }
  return result;
}

module.exports = {
  PRACTICE_SIZES,
  DIFFICULTY_PROFILES,
  RW_SKILL_ORDER,
  DIFFICULTY_RANK,
  shuffle,
  orderLikeSatSection,
  interleaveSpr
};
