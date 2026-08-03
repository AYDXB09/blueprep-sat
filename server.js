const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");
const crypto = require("node:crypto");
const { URL } = require("node:url");

const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, "data", "questions.json");
const NEW_FILE = path.join(ROOT, "data", "new_questions.json");
const PROGRESS_FILE = path.join(ROOT, "data", "progress.json");
const SESSIONS_FILE = path.join(ROOT, "data", "sessions.json");
const IMPORTED_FILE = path.join(ROOT, "data", "imported_tests.json");
const PORT = Number(process.env.PORT || 4173);
const K2_API_KEY = process.env.K2_API_KEY || readDotEnv().K2_API_KEY || "";
const K2_MODEL = process.env.K2_MODEL || "MBZUAI-IFM/K2-Think-v2";
const K2_BASE = process.env.K2_BASE || "api.k2think.ai";

function readDotEnv() {
  const result = {};
  try {
    const raw = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (match) result[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
  return result;
}

if (!fs.existsSync(DATA_FILE)) {
  console.error("Question catalog missing. Run `npm run download` first.");
  process.exit(1);
}

const questions = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
const newQuestions = fs.existsSync(NEW_FILE) ? JSON.parse(fs.readFileSync(NEW_FILE, "utf8")) : [];
questions.forEach(question => {
  question.skill = question.skill.trim();
  if (question.skill.toLowerCase() === "cross-text connections") question.skill = "Cross-Text Connections";
});
newQuestions.forEach(question => {
  question.skill = question.skill.trim();
  if (question.skill.toLowerCase() === "cross-text connections") question.skill = "Cross-Text Connections";
  question.isNew = true;
});

let progress = {};
try { progress = JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf8")); } catch { progress = {}; }

let sessions = [];
try { sessions = JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf8")); } catch { sessions = []; }
if (!Array.isArray(sessions)) sessions = [];

let importedTests = [];
try { importedTests = JSON.parse(fs.readFileSync(IMPORTED_FILE, "utf8")); } catch { importedTests = []; }
if (!Array.isArray(importedTests)) importedTests = [];

const aiQuestions = [];

function saveSessions() {
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
}

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

function buildPracticeSet(subject, size, profile, source) {
  const setup = PRACTICE_SIZES[size]?.[subject];
  if (!setup) throw new Error("Choose Reading and Writing or Math and a valid practice length.");
  const pool = source === "new" ? newQuestions : questions;
  const available = pool.filter(question => question.subject === subject && !question.active && !progress[question.id]);
  if (available.length < setup.count) throw new Error(`Only ${available.length} unattempted questions remain for this section and source.`);
  const picked = [];
  const used = new Set();
  const weights = DIFFICULTY_PROFILES[profile] || DIFFICULTY_PROFILES.balanced;
  const targets = Object.entries(weights).map(([difficulty, weight]) => [difficulty, Math.floor(setup.count * weight)]);
  let remaining = setup.count - targets.reduce((sum, [, count]) => sum + count, 0);
  for (const [difficulty] of [...targets].sort((a, b) => weights[b[0]] - weights[a[0]])) {
    if (!remaining) break;
    const target = targets.find(item => item[0] === difficulty);
    target[1]++; remaining--;
  }
  for (const [difficulty, target] of targets) {
    for (const question of shuffle(available.filter(item => item.difficulty === difficulty && !used.has(item.id))).slice(0, target)) {
      picked.push(question); used.add(question.id);
    }
  }
  if (subject === "Math" && !picked.some(question => question.type === "spr")) {
    const spr = shuffle(available.filter(item => item.type === "spr" && !used.has(item.id)))[0];
    if (spr) { const replaced = picked.pop(); used.delete(replaced.id); picked.push(spr); used.add(spr.id); }
  }
  if (picked.length < setup.count) {
    for (const question of shuffle(available.filter(item => !used.has(item.id))).slice(0, setup.count - picked.length)) picked.push(question);
  }
  const ordered = orderLikeSatSection(picked, subject);
  return { questions: ordered.map(questionSummary), seconds: Math.round(setup.seconds), count: setup.count, profile, source };
}

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

function json(response, status, value) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", chunk => {
      body += chunk;
      if (body.length > 1_000_000) reject(new Error("Request too large"));
    });
    request.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch (error) { reject(error); }
    });
    request.on("error", reject);
  });
}

function parseCsvRows(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += char;
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field); field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      rows.push(row); row = [];
    } else {
      field += char;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function parseTrackerCsv(text) {
  const rows = parseCsvRows(String(text || ""));
  let title = "Imported SAT practice test";
  let answerIdx = -1, correctedIdx = -1, idIdx = -1;
  let currentSubject = "", currentModule = "";
  const questions = [];
  for (const rawRow of rows) {
    const cells = rawRow.map(cell => String(cell || "").trim());
    const joined = cells.join(" ");
    if (!joined.trim()) continue;
    const titleMatch = joined.match(/\b(?:SAT|Practice Test|Bluebook)[^\d]*(\d+)\b/i);
    if (titleMatch && !/[RM]\s+\d+\.\d+/i.test(joined)) title = `SAT ${titleMatch[1]}`;
    if (/module\s+\d+/i.test(joined)) {
      currentModule = (joined.match(/module\s+(\d+)/i) || [])[1] || "";
      if (/reading and writing/i.test(joined) || /(^|\s)RW($|\s)/i.test(joined)) currentSubject = "Reading and Writing";
      else if (/math/i.test(joined) || /(^|\s)M($|\s)/i.test(joined)) currentSubject = "Math";
      continue;
    }
    if (/reading and writing/i.test(joined) && !/module/i.test(joined)) { currentSubject = "Reading and Writing"; continue; }
    if (/^\s*math\s*$/i.test(joined)) { currentSubject = "Math"; continue; }
    const answerCol = cells.findIndex(cell => /^answer$/i.test(cell));
    const correctedCol = cells.findIndex(cell => /^corrected$/i.test(cell));
    if (answerCol >= 0 && correctedCol >= 0) {
      answerIdx = answerCol; correctedIdx = correctedCol;
      idIdx = cells.findIndex(cell => /question|item|^\s*#\s*$/i.test(cell));
      if (idIdx < 0 && answerIdx > 0) idIdx = answerIdx - 1;
      continue;
    }
    if (answerIdx < 0) continue;
    const answer = cells[answerIdx] || "";
    const corrected = cells[correctedIdx] || "";
    if (!answer) continue;
    const qid = (idIdx >= 0 && cells[idIdx]) || cells[0] || "";
    const qidMatch = String(qid).match(/(\d+\.\d+)/);
    if (!qidMatch) continue;
    const subjectFromId = String(qid).match(/\b(RW|M)\b/i);
    const subject = subjectFromId ? (subjectFromId[1].toUpperCase() === "RW" ? "Reading and Writing" : "Math") : currentSubject;
    const moduleFromId = String(qid).match(/[RM]\s*(\d+)\.\d+/i);
    const module = moduleFromId ? moduleFromId[1] : currentModule;
    if (!subject || !module) continue;
    questions.push({
      id: qid,
      subject,
      module,
      number: qidMatch[1],
      answer,
      correct: !corrected,
      correctAnswer: corrected || ""
    });
  }
  const stats = { total: questions.length, correct: questions.filter(question => question.correct).length };
  return { title, questions, stats };
}

function callK2(messages, options = {}) {
  return new Promise((resolve, reject) => {
    if (!K2_API_KEY) return reject(new Error("K2 API key is not configured. Set K2_API_KEY in .env"));
    const payload = {
      model: K2_MODEL,
      messages,
      stream: false
    };
    if (options.responseFormat) payload.response_format = { type: "json_object" };
    if (options.maxTokens) payload.max_completion_tokens = options.maxTokens;
    const body = JSON.stringify(payload);
    const request = https.request({
      hostname: K2_BASE,
      path: "/v1/chat/completions",
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
        authorization: `Bearer ${K2_API_KEY}`
      }
    }, response => {
      let data = "";
      response.on("data", chunk => data += chunk);
      response.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
            return reject(new Error(parsed.error?.message || `K2 API error ${response.statusCode}`));
          }
          resolve(parsed.choices?.[0]?.message?.content || "");
        } catch (error) {
          reject(new Error(`Invalid K2 response: ${data.slice(0, 300)}`));
        }
      });
    });
    request.on("error", reject);
    request.setTimeout(120000, () => request.destroy(new Error("K2 API timed out")));
    request.write(body);
    request.end();
  });
}

function extractJson(text) {
  let cleaned = String(text || "").trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) cleaned = fence[1].trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("No JSON object in model output");
  return JSON.parse(cleaned.slice(start, end + 1));
}

function stripHtml(html) {
  const text = String(html || "")
    .replace(/<math[^>]*alttext="([^"]*)"[^>]*>[\s\S]*?<\/math>/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ").trim();
  return text;
}

function cleanOptionText(text) {
  return String(text || "")
    .trim()
    .replace(/^[A-Da-d][\s.:)\]]+\s*/i, "")
    .trim();
}

const ALLOWED_TAGS = new Set(["p", "br", "div", "span", "strong", "b", "em", "i", "u", "sub", "sup", "ul", "ol", "li", "table", "thead", "tbody", "tr", "th", "td", "figure", "figcaption", "svg", "g", "rect", "line", "circle", "path", "polygon", "text", "tspan", "defs", "pattern", "math", "mrow", "mi", "mo", "mn", "msup", "msub", "mfrac", "msqrt", "annotation", "semantics"]);
const ALLOWED_ATTRS = new Set(["alt", "title", "width", "height", "x", "y", "x1", "y1", "x2", "y2", "rx", "ry", "r", "cx", "cy", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "viewbox", "viewBox", "font-size", "font-family", "text-anchor", "transform", "d", "points", "colspan", "rowspan", "align", "xmlns", "role", "aria-label", "alttext", "patternunits", "patterntransform"]);

function sanitizeHtml(html) {
  let out = String(html || "").replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]*on[a-z]+\s*=[^ >]*>/gi, "").replace(/javascript\s*:/gi, "");
  out = out.replace(/<(\/?)([a-zA-Z0-9]+)([^>]*)>/g, (match, closing, tag, attrs) => {
    const name = tag.toLowerCase();
    if (!ALLOWED_TAGS.has(name)) return "";
    let safeAttrs = "";
    const attrPattern = /([a-zA-Z:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;
    let attrMatch;
    while ((attrMatch = attrPattern.exec(attrs)) !== null) {
      const attrName = attrMatch[1].toLowerCase();
      if (!ALLOWED_ATTRS.has(attrName) && !ALLOWED_ATTRS.has(attrMatch[1])) continue;
      safeAttrs += ` ${attrMatch[1]}="${attrMatch[3] || attrMatch[4] || attrMatch[5]}"`;
    }
    return `<${closing}${name}${safeAttrs}>`;
  });
  out = out.replace(/&(?!amp;|lt;|gt;|quot;|#\d+;|#x[0-9a-fA-F]+;)/g, "&amp;");
  return out || "<p></p>";
}

function humanizeMath(text) {
  return String(text || "")
    .replace(/StartFraction\s*/g, "(")
    .replace(/\s*Over\s+/g, "/")
    .replace(/\s*EndFraction\s*/g, ")")
    .replace(/equals/g, "=")
    .replace(/minus/g, "-")
    .replace(/plus/g, "+")
    .replace(/times/g, "*")
    .replace(/greater than or equal to/g, ">=")
    .replace(/less than or equal to/g, "<=")
    .replace(/greater than/g, ">")
    .replace(/less than/g, "<")
    .replace(/left parenthesis/g, "(")
    .replace(/right parenthesis/g, ")");
}

function findQuestion(id) {
  return questions.find(item => item.id === id) || newQuestions.find(item => item.id === id) || aiQuestions.find(item => item.id === id);
}

function questionStemText(question) {
  return `${humanizeMath(stripHtml(question.stem || ""))} ${stripHtml(question.stimulus || "")}`.trim();
}

function questionSummary(question) {
  return {
    id: question.id,
    questionId: question.questionId,
    subject: question.subject,
    domain: question.domain,
    skill: question.skill,
    difficulty: question.difficulty,
    active: question.active,
    type: question.type,
    completed: Boolean(progress[question.id]),
    correct: Boolean(progress[question.id]?.correct),
    unknown: Boolean(progress[question.id]?.unknown),
    submittedAnswer: progress[question.id]?.answer || ""
  };
}

function buildPerformanceDigest() {
  const attempts = [];
  for (const [id, record] of Object.entries(progress)) {
    const question = findQuestion(id);
    if (!question) continue;
    let struck = [], strikeLog = [];
    for (const session of sessions) {
      const item = session.questions.find(entry => entry.id === id);
      if (item && item.struck) struck = item.struck;
      if (item && item.strikeLog) strikeLog = item.strikeLog;
    }
    attempts.push({
      id,
      subject: question.subject,
      domain: question.domain,
      skill: question.skill,
      difficulty: question.difficulty,
      type: question.type,
      correct: Boolean(record.correct),
      unknown: Boolean(record.unknown),
      answer: record.answer || "",
      correctAnswer: question.correctAnswer || "",
      time: record.time || 0,
      attempts: record.attempts || 1,
      struck,
      strikeLog,
      updatedAt: record.updatedAt || 0
    });
  }
  const bySubject = {};
  const byDomain = {};
  const bySkill = {};
  const byDifficulty = {};
  for (const attempt of attempts) {
    (bySubject[attempt.subject] = bySubject[attempt.subject] || []).push(attempt);
    (byDomain[attempt.domain] = byDomain[attempt.domain] || []).push(attempt);
    (bySkill[attempt.skill] = bySkill[attempt.skill] || []).push(attempt);
    (byDifficulty[attempt.difficulty] = byDifficulty[attempt.difficulty] || []).push(attempt);
  }
  const summarize = (name, group) => {
    const total = group.length;
    const correct = group.filter(item => item.correct).length;
    const correctTime = group.filter(item => item.correct).reduce((sum, item) => sum + (item.time || 0), 0);
    const incorrectTime = group.filter(item => !item.correct).reduce((sum, item) => sum + (item.time || 0), 0);
    const struckCorrect = group.filter(item => item.struck && item.correctAnswer && item.struck.includes(item.correctAnswer) && !item.correct).length;
    const repeatedlyWrong = group.filter(item => !item.correct && (item.attempts || 1) > 1).length;
    return {
      name,
      total,
      correct,
      incorrect: total - correct,
      accuracy: total ? Math.round(100 * correct / total) : 0,
      avgTimeCorrect: correct ? Math.round(correctTime / correct) : 0,
      avgTimeIncorrect: total - correct ? Math.round(incorrectTime / (total - correct)) : 0,
      struckCorrectCount: struckCorrect,
      repeatedlyWrongCount: repeatedlyWrong
    };
  };
  const total = attempts.length;
  const correct = attempts.filter(item => item.correct).length;
  return {
    totalAttempts: total,
    correct,
    incorrect: total - correct,
    accuracy: total ? Math.round(100 * correct / total) : 0,
    totalTime: attempts.reduce((sum, item) => sum + (item.time || 0), 0),
    sessions: sessions.map(session => ({
      id: session.id,
      mode: session.mode || "practice",
      subject: session.subject || "",
      createdAt: session.createdAt || 0,
      total: session.questions.length,
      correct: session.questions.filter(item => item.correct).length,
      totalTime: session.questions.reduce((sum, item) => sum + (item.time || 0), 0),
      struckTotal: session.questions.reduce((sum, item) => sum + ((item.struck || []).length), 0)
    })),
    subjects: Object.entries(bySubject).map(([name, group]) => summarize(name, group)).sort((a, b) => b.total - a.total),
    domains: Object.entries(byDomain).map(([name, group]) => summarize(name, group)).sort((a, b) => b.incorrect - a.incorrect),
    skills: Object.entries(bySkill).map(([name, group]) => summarize(name, group)).sort((a, b) => b.incorrect - a.incorrect),
    difficulties: Object.entries(byDifficulty).map(([name, group]) => summarize(name, group)).sort((a, b) => b.total - a.total),
    recentWrong: attempts.filter(item => !item.correct).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 12),
    importedTests: importedTests.map(test => {
      const wrong = test.questions.filter(question => !question.correct);
      return { title: test.title, total: test.questions.length, correct: test.questions.length - wrong.length, wrong: wrong.length, wrongQuestions: wrong.slice(0, 25).map(question => `${question.id} (${question.subject} M${question.module} Q${question.number})`) };
    })
  };
}

function digestToText(digest) {
  const fmtTime = seconds => seconds ? `${Math.floor(seconds / 60)}m${seconds % 60}s` : "0s";
  const lines = [];
  lines.push(`OVERALL: ${digest.totalAttempts} attempts, ${digest.correct} correct, ${digest.incorrect} incorrect, ${digest.accuracy}% accuracy, ${fmtTime(digest.totalTime)} total time.`);
  lines.push("");
  lines.push("BY SUBJECT:");
  for (const s of digest.subjects) lines.push(`- ${s.name}: ${s.correct}/${s.total} (${s.accuracy}%), avg time correct ${fmtTime(s.avgTimeCorrect)}, avg time incorrect ${fmtTime(s.avgTimeIncorrect)}${s.repeatedlyWrongCount ? `, ${s.repeatedlyWrongCount} repeatedly wrong` : ""}.`);
  lines.push("");
  lines.push("BY DOMAIN (worst first):");
  for (const d of digest.domains.slice(0, 8)) lines.push(`- ${d.name}: ${d.correct}/${d.total} (${d.accuracy}%), ${d.struckCorrectCount} struck the correct answer but still got it wrong, ${d.repeatedlyWrongCount} repeatedly wrong.`);
  lines.push("");
  lines.push("BY SKILL (worst first, top 12):");
  for (const s of digest.skills.slice(0, 12)) lines.push(`- ${s.name}: ${s.correct}/${s.total} (${s.accuracy}%), avg time ${fmtTime(s.avgTimeCorrect)} correct vs ${fmtTime(s.avgTimeIncorrect)} incorrect${s.struckCorrectCount ? `, struck correct answer ${s.struckCorrectCount}x without choosing it` : ""}${s.repeatedlyWrongCount ? `, ${s.repeatedlyWrongCount} repeatedly wrong` : ""}.`);
  lines.push("");
  lines.push("BY DIFFICULTY:");
  for (const d of digest.difficulties) lines.push(`- ${d.name}: ${d.correct}/${d.total} (${d.accuracy}%).`);
  lines.push("");
  lines.push("SESSION TREND (most recent first):");
  for (const session of digest.sessions.slice(0, 10)) {
    const date = new Date(session.createdAt).toLocaleString();
    lines.push(`- ${date} (${session.mode}${session.subject ? " " + session.subject : ""}): ${session.correct}/${session.total} correct, ${fmtTime(session.totalTime)} total, ${session.struckTotal} choices struck.`);
  }
  lines.push("");
  lines.push("MOST RECENT WRONG ANSWERS:");
  for (const item of digest.recentWrong.slice(0, 8)) {
    lines.push(`- [${item.subject}/${item.domain}/${item.skill}/${item.difficulty}] your answer "${item.answer}" vs correct "${item.correctAnswer}", ${fmtTime(item.time)} spent, struck ${item.struck.length ? item.struck.join(",") : "none"}, attempt #${item.attempts}.`);
  }
  if (digest.importedTests && digest.importedTests.length) {
    lines.push("");
    lines.push("IMPORTED PAST SAT TESTS:");
    for (const test of digest.importedTests) {
      lines.push(`- ${test.title}: ${test.correct}/${test.total} correct (${test.wrong} wrong). Wrong question IDs: ${test.wrongQuestions.length ? test.wrongQuestions.join(", ") : "none"}.`);
    }
  }
  return lines.join("\n");
}

function buildFullContext() {
  const digest = buildPerformanceDigest();
  const base = digestToText(digest);
  const lines = [base, ""];
  lines.push("PER-QUESTION DETAIL (most recent first, max 40):");
  const entries = [];
  for (const [id, record] of Object.entries(progress)) {
    const question = findQuestion(id);
    if (!question) continue;
    let struck = [], strikeLog = [];
    for (const session of sessions) {
      const item = session.questions.find(entry => entry.id === id);
      if (item && item.struck) struck = item.struck;
      if (item && item.strikeLog) strikeLog = item.strikeLog;
    }
    entries.push({
      updatedAt: record.updatedAt || 0,
      id,
      subject: question.subject,
      domain: question.domain,
      skill: question.skill,
      difficulty: question.difficulty,
      type: question.type,
      correct: Boolean(record.correct),
      answer: record.answer || "",
      correctAnswer: question.correctAnswer || "",
      time: record.time || 0,
      attempts: record.attempts || 1,
      struck,
      strikeLog
    });
  }
  entries.sort((a, b) => b.updatedAt - a.updatedAt);
  for (const entry of entries.slice(0, 40)) {
    const strikeSeq = Array.isArray(entry.strikeLog) && entry.strikeLog.length
      ? entry.strikeLog.map(log => `${log.letter} at ${log.at}s`).join(", ")
      : ((entry.struck && entry.struck.length) ? entry.struck.join(",") + " (timing unavailable)" : "none");
    lines.push(`- Q ${entry.id} [${entry.subject}/${entry.domain}/${entry.skill}/${entry.difficulty}] ${entry.correct ? "CORRECT" : "WRONG"}: your answer "${entry.answer}", correct "${entry.correctAnswer}", ${entry.time}s spent, attempts ${entry.attempts}, struck sequence: ${strikeSeq}.`);
  }
  lines.push("");
  lines.push("SESSION DETAIL (most recent 8):");
  for (const session of sessions.slice(-8)) {
    const date = new Date(session.createdAt).toLocaleString();
    const perQuestion = session.questions.map(item => {
      const q = item.question || findQuestion(item.id);
      const label = q ? `${q.domain}/${q.skill}` : item.id;
      const strikeSeq = Array.isArray(item.strikeLog) && item.strikeLog.length ? item.strikeLog.map(log => `${log.letter}@${log.at}s`).join(",") : ((item.struck && item.struck.length) ? item.struck.join(",") : "none");
      return `[${label} ${item.correct ? "ok" : "X"} ${item.time || 0}s struck:${strikeSeq}]`;
    }).join(" ");
    lines.push(`- ${date} (${session.mode}${session.subject ? " " + session.subject : ""}) ${session.questions.filter(q => q.correct).length}/${session.questions.length} correct: ${perQuestion}`);
  }
  if (importedTests.length) {
    lines.push("");
    lines.push("IMPORTED PAST TESTS (answer sheets uploaded from real practice tests):");
    for (const test of importedTests.slice(0, 8)) {
      const wrong = test.questions.filter(question => !question.correct);
      lines.push(`- "${test.title}": ${test.questions.length} questions, ${test.questions.length - wrong.length} correct, ${wrong.length} wrong.`);
      for (const question of wrong.slice(0, 20)) {
        lines.push(`  * ${question.id} [${question.subject}, module ${question.module}, Q${question.number}]: answered "${question.answer}", correct "${question.correctAnswer}".`);
      }
      if (wrong.length > 20) lines.push(`  * ... and ${wrong.length - 20} more wrong questions.`);
    }
  }
  return lines.join("\n");
}

function buildQuestionContext(questionId) {
  if (!questionId) return "None (student is not asking about a specific question).";
  const question = findQuestion(questionId);
  if (question) {
    const options = (question.options || []).map(option => `- ${stripHtml(option.content)}`).join("\n");
    const progressRecord = progress[questionId];
    const attemptDetail = progressRecord ? `The student answered "${progressRecord.answer}" (${progressRecord.correct ? "correct" : "incorrect"}), spent ${progressRecord.time || 0}s, ${progressRecord.attempts || 1} attempt(s).` : "The student has not answered this question yet.";
    return [
      `Subject: ${question.subject}, Strand: ${question.domain}, Skill: ${question.skill}, Difficulty: ${question.difficulty}, Type: ${question.type}`,
      `Stem: ${questionStemText(question)}`,
      options ? `Options:\n${options}` : "",
      `Correct answer: ${question.correctAnswer}`,
      attemptDetail,
      `Rationale: ${stripHtml(question.rationale || "")}`
    ].filter(Boolean).join("\n");
  }
  const importedItem = importedTests.flatMap(test => test.questions.map(entry => ({ test, entry }))).find(entry => entry.entry.id === questionId);
  if (importedItem) {
    const { test, entry } = importedItem;
    const modules = {};
    for (const q of test.questions) {
      modules[q.subject] = modules[q.subject] || {};
      modules[q.subject][q.module] = modules[q.subject][q.module] || { total: 0, correct: 0 };
      modules[q.subject][q.module].total++;
      if (q.correct) modules[q.subject][q.module].correct++;
    }
    return [
      `This question is from the imported past test "${test.title}" (question ID "${entry.id}").`,
      `Subject: ${entry.subject}, Module: ${entry.module}, Question #${entry.number}`,
      `The student answered "${entry.answer}" and the recorded correct answer is "${entry.correctAnswer}" (${entry.correct ? "correct" : "incorrect"}).`,
      `That test's score on ${entry.subject} module ${entry.module}: ${modules[entry.subject]?.[entry.module]?.correct || 0}/${modules[entry.subject]?.[entry.module]?.total || 0} correct.`,
      "NOTE: Imported past tests only carry the student's answer sheet (question IDs, answers, correct answers) — the actual question text, options, and skill tags are NOT available. Infer the likely skill from the SAT blueprint, question number, and module, and coach accordingly."
    ].join("\n");
  }
  return `Question id ${questionId} not found in the bank.`;
}

function handleApi(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/meta") {
    const domains = {};
    for (const question of questions) {
      domains[question.subject] ||= {};
      domains[question.subject][question.domain] ||= new Set();
      domains[question.subject][question.domain].add(question.skill);
    }
    return json(response, 200, {
      count: questions.length,
      newCount: newQuestions.length,
      activeCount: questions.filter(question => question.active).length,
      completedCount: Object.keys(progress).length,
      correctCount: Object.values(progress).filter(item => item.correct).length,
      domains: Object.fromEntries(Object.entries(domains).map(([subject, values]) => [subject, Object.fromEntries(Object.entries(values).map(([domain, skills]) => [domain, [...skills].sort()]))]))
    });
  }

  if (request.method === "GET" && url.pathname === "/api/questions") {
    const subject = url.searchParams.get("subject") || "all";
    const domains = new Set((url.searchParams.get("domain") || "all").split(",").filter(Boolean));
    const skills = new Set((url.searchParams.get("skill") || "all").split(",").filter(Boolean));
    const difficulties = new Set((url.searchParams.get("difficulty") || "Easy,Medium,Hard").split(","));
    const search = (url.searchParams.get("search") || "").toLowerCase().trim();
    const excludeCorrect = url.searchParams.get("excludeCorrect") === "true";
    const newOnly = url.searchParams.get("newOnly") === "true";
    const excludeActive = url.searchParams.get("excludeActive") === "true" || newOnly;
    const sourcePool = newOnly ? newQuestions : questions;
    const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));
    const fetchAll = url.searchParams.get("all") === "true";
    const limit = fetchAll ? Infinity : Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 50)));
    const filtered = sourcePool.filter(question =>
      (subject === "all" || question.subject === subject) &&
      (domains.has("all") || domains.has(question.domain)) &&
      (skills.has("all") || skills.has(question.skill)) &&
      difficulties.has(question.difficulty) &&
      (!excludeActive || !question.active) &&
      (!excludeCorrect || !progress[question.id]?.correct) &&
      (!search || `${question.questionId} ${question.subject} ${question.domain} ${question.skill}`.toLowerCase().includes(search))
    );
    return json(response, 200, { total: filtered.length, offset, items: filtered.slice(offset, offset + limit).map(questionSummary) });
  }

  if (url.pathname === "/api/practice") {
    if (request.method !== "POST") return json(response, 405, { error: "Use POST to build a practice set" });
    return readBody(request).then(body => {
      if (body.source === "new" && !newQuestions.length) throw new Error("No new questions downloaded yet. Run `npm run detect` to fetch newly released College Board questions, or use the main question bank.");
      return json(response, 200, buildPracticeSet(body.subject, body.size, body.profile, body.source === "new" ? "new" : "bank"));
    }).catch(error => json(response, 400, { error: error.message }));
  }

  if (request.method === "GET" && url.pathname === "/api/mistakes") {
    const mistakes = [];
    for (const [id, record] of Object.entries(progress)) {
      if (record.correct) continue;
      const question = findQuestion(id);
      if (!question) continue;
      mistakes.push({
        question,
        answer: record.answer || "",
        correct: Boolean(record.correct),
        unknown: Boolean(record.unknown),
        time: record.time || 0,
        attempts: record.attempts || 1,
        struck: [],
        updatedAt: record.updatedAt || 0
      });
    }
    for (const mistake of mistakes) {
      let latest = null;
      for (const session of sessions) {
        const item = session.questions.find(entry => entry.id === mistake.question.id);
        if (item) latest = item;
      }
      if (latest && latest.struck) mistake.struck = latest.struck.filter(letter => /^[A-D]$/.test(String(letter)));
      if (latest && latest.strikeLog) mistake.strikeLog = latest.strikeLog.slice(0, 50);
      if (latest && latest.unknown) mistake.unknown = true;
    }
    mistakes.sort((a, b) => b.updatedAt - a.updatedAt);
    return json(response, 200, { total: mistakes.length, items: mistakes });
  }

  const match = url.pathname.match(/^\/api\/questions\/([0-9a-f-]+)$/i);
  if (request.method === "GET" && match) {
    const question = findQuestion(match[1]);
    return question ? json(response, 200, question) : json(response, 404, { error: "Question not found" });
  }

  if (request.method === "POST" && url.pathname === "/api/progress") {
    return readBody(request).then(body => {
      if (!findQuestion(body.id)) return json(response, 404, { error: "Question not found" });
      const previous = progress[body.id] || {};
      progress[body.id] = { correct: Boolean(body.correct), answer: String(body.answer || ""), unknown: Boolean(body.unknown), time: Math.max(0, Number(body.time) || 0), attempts: (previous.attempts || 0) + 1, updatedAt: Date.now() };
      fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
      return json(response, 200, { ok: true });
    }).catch(error => json(response, 400, { error: error.message }));
  }

  if (request.method === "GET" && url.pathname === "/api/analytics") {
    const items = [];
    for (const [id, record] of Object.entries(progress)) {
      const question = findQuestion(id);
      if (!question) continue;
      items.push({
        id,
        subject: question.subject,
        domain: question.domain,
        skill: question.skill,
        difficulty: question.difficulty,
        correct: Boolean(record.correct),
        unknown: Boolean(record.unknown),
        answer: record.answer || "",
        time: record.time || 0,
        updatedAt: record.updatedAt || 0
      });
    }
    items.sort((a, b) => b.updatedAt - a.updatedAt);
    return json(response, 200, { total: items.length, items });
  }

  if (request.method === "GET" && url.pathname === "/api/sessions") {
    const summary = sessions.map(session => ({
      id: session.id,
      mode: session.mode || "practice",
      subject: session.subject || "",
      createdAt: session.createdAt || 0,
      total: session.questions.length,
      correct: session.questions.filter(item => item.correct).length,
      totalTime: session.questions.reduce((sum, item) => sum + (item.time || 0), 0)
    })).sort((a, b) => b.createdAt - a.createdAt);
    return json(response, 200, { total: summary.length, items: summary });
  }

  const sessionMatch = url.pathname.match(/^\/api\/sessions\/([0-9a-z-]+)$/i);
  if (request.method === "GET" && sessionMatch) {
    const session = sessions.find(item => item.id === sessionMatch[1]);
    if (!session) return json(response, 404, { error: "Session not found" });
    return json(response, 200, {
      id: session.id,
      mode: session.mode || "practice",
      subject: session.subject || "",
      createdAt: session.createdAt || 0,
      questions: session.questions.map(item => {
        const question = item.question || findQuestion(item.id);
        return {
          id: item.id,
          answer: item.answer || "",
          correct: Boolean(item.correct),
          unknown: Boolean(item.unknown),
          time: item.time || 0,
          struck: item.struck || [],
          strikeLog: item.strikeLog || [],
          question: question ? questionSummary(question) : null,
          questionId: question?.questionId || item.id
        };
      })
    });
  }

  if (request.method === "GET" && url.pathname === "/api/tests/imported") {
    const summary = importedTests.map(test => ({
      id: test.id,
      title: test.title,
      createdAt: test.createdAt || 0,
      total: test.questions.length,
      correct: test.questions.filter(question => question.correct).length
    })).sort((a, b) => b.createdAt - a.createdAt);
    return json(response, 200, { total: summary.length, items: summary });
  }

  const importedMatch = url.pathname.match(/^\/api\/tests\/imported\/([0-9a-z-]+)$/i);
  if (importedMatch) {
    const test = importedTests.find(item => item.id === importedMatch[1]);
    if (request.method === "GET" && test) {
      const bySubject = {};
      for (const question of test.questions) {
        const entry = (bySubject[question.subject] = bySubject[question.subject] || {});
        entry[question.module] = entry[question.module] || { total: 0, correct: 0 };
        entry[question.module].total++;
        if (question.correct) entry[question.module].correct++;
      }
      return json(response, 200, { id: test.id, title: test.title, createdAt: test.createdAt, questions: test.questions, bySubject });
    }
    if (request.method === "DELETE" && test) {
      importedTests = importedTests.filter(item => item.id !== test.id);
      fs.writeFileSync(IMPORTED_FILE, JSON.stringify(importedTests, null, 2));
      return json(response, 200, { ok: true });
    }
    return json(response, 404, { error: "Imported test not found" });
  }

  if (request.method === "POST" && url.pathname === "/api/tests/import") {
    return readBody(request).then(body => {
      const parsed = parseTrackerCsv(body.csv);
      if (!parsed.questions.length) return json(response, 400, { error: "No questions could be parsed from that CSV. Make sure it has Answer and Corrected columns with question IDs like \"SAT8 RW 1.1\"." });
      const test = {
        id: crypto.randomUUID().slice(0, 13),
        title: body.title || parsed.title,
        createdAt: Date.now(),
        questions: parsed.questions
      };
      importedTests.unshift(test);
      if (importedTests.length > 100) importedTests.length = 100;
      fs.writeFileSync(IMPORTED_FILE, JSON.stringify(importedTests, null, 2));
      return json(response, 200, { id: test.id, title: test.title, total: test.questions.length, correct: test.questions.filter(question => question.correct).length });
    }).catch(error => json(response, 400, { error: error.message }));
  }


  if (request.method === "POST" && url.pathname === "/api/session") {
    return readBody(request).then(body => {
      const questionsList = Array.isArray(body.questions) ? body.questions.slice(0, 200) : [];
      const session = {
        id: crypto.randomUUID().slice(0, 13),
        mode: body.mode || "practice",
        subject: body.subject || "",
        createdAt: Date.now(),
        questions: questionsList.map(item => ({
          id: item.id,
          answer: String(item.answer || ""),
          correct: Boolean(item.correct),
          unknown: Boolean(item.unknown),
          time: Math.max(0, Number(item.time) || 0),
          struck: Array.isArray(item.struck) ? item.struck.filter(letter => /^[A-D]$/.test(String(letter))) : [],
          strikeLog: Array.isArray(item.strikeLog) ? item.strikeLog.slice(0, 50).map(entry => ({ letter: String(entry.letter || ""), at: Math.max(0, Number(entry.at) || 0) })).filter(entry => /^[A-D]$/.test(entry.letter)) : [],
          question: item.question || null
        }))
      };
      sessions.push(session);
      if (sessions.length > 200) sessions = sessions.slice(-200);
      saveSessions();
      return json(response, 200, { id: session.id });
    }).catch(error => json(response, 400, { error: error.message }));
  }

  if (request.method === "POST" && url.pathname === "/api/ai/advice") {
    if (!K2_API_KEY) return json(response, 400, { error: "AI is not configured. Set K2_API_KEY in .env to use AI performance coaching." });
    return (async () => {
      const digest = buildPerformanceDigest();
      const text = digestToText(digest);
      const prompt = [
        "You are an elite SAT tutor and performance coach. Analyze the student's complete practice history below and give specific, honest, actionable advice.",
        "",
        "The data includes accuracy by subject/domain/skill/difficulty, average time on correct vs incorrect answers, which questions were struck (answer choices eliminated) but still answered wrong, repeatedly-wrong questions, session trends, and recent wrong answers.",
        "",
        "Structure your response with these sections:",
        "1. OVERVIEW - 2-3 sentences summarizing where the student stands.",
        "2. BIGGEST WEAKNESSES - the 3-5 skills/domains with the weakest accuracy and why, using the numbers.",
        "3. PATTERNS - time usage (too slow/fast on correct vs incorrect), strike-out behavior (are they striking the right answer then picking wrong?), and repeated mistakes.",
        "4. SPECIFIC NEXT STEPS - concrete, prioritized actions with exact skill names the student should drill next, and study strategy.",
        "",
        "Use the exact skill and domain names from the data. Be blunt and specific. Do not be generic.",
        "",
        "MATH FORMATTING: The app renders LaTeX. Any math in your advice MUST be written as LaTeX inline math between \\( and \\), e.g. \\(x^2 + 3x = 10\\). Never use unicode math symbols or HTML sub/sup. Do NOT use markdown tables (they render badly) -- use short bullet lists instead.",
        "",
        "STUDENT DATA:",
        text
      ].join("\n");
      let advice = "";
      for (let attempt = 0; attempt < 2 && !advice; attempt++) {
        const content = await callK2([{ role: "user", content: prompt }], { maxTokens: 16000 });
        advice = String(content || "").trim();
      }
      if (!advice) return json(response, 502, { error: "The AI coach could not produce advice. Try again." });
      return json(response, 200, { advice, digest });
    })().catch(error => json(response, 502, { error: error.message }));
  }

  if (request.method === "POST" && url.pathname === "/api/ai/pasttest") {
    if (!K2_API_KEY) return json(response, 400, { error: "AI is not configured. Set K2_API_KEY in .env to use AI past-test analysis." });
    return readBody(request).then(async body => {
      const test = importedTests.find(item => item.id === body.testId);
      if (!test) return json(response, 404, { error: "Imported test not found" });
      const wrong = test.questions.filter(question => !question.correct);
      const wrongText = wrong.length
        ? wrong.map(question => `- ${question.id} [${question.subject}, module ${question.module}, Q${question.number}]: student answered "${question.answer}", correct answer "${question.correctAnswer}".`).join("\n")
        : "- none.";
      const skillsBySubject = {};
      for (const question of questions) {
        (skillsBySubject[question.subject] = skillsBySubject[question.subject] || new Set()).add(question.skill);
      }
      const skillsText = Object.entries(skillsBySubject).map(([subject, skills]) => `${subject}: ${[...skills].join(", ")}`).join("\n");
      const prompt = [
        "You are an elite SAT tutor. The student has uploaded their answer sheet from a real SAT practice test. For each wrong question we ONLY know the question ID, subject, module, question number, their answer, and the correct answer -- NOT the question text.",
        "",
        `TEST: ${test.title} -- ${test.questions.length} questions, ${test.questions.filter(q => q.correct).length} correct, ${wrong.length} wrong.`,
        "",
        "WRONG QUESTIONS:",
        wrongText,
        "",
        "SAT BLUEPRINT CONVENTIONS YOU MUST USE:",
        "- In Reading and Writing, question order within a module roughly follows: Words in Context early, then Text Structure and Purpose, Cross-Text Connections, Central Ideas and Details, Command of Evidence, Inferences, Boundaries, Form Structure and Sense, Transitions, Rhetorical Synthesis near the end. Module 1 is generally easier than Module 2.",
        "- In Math, early questions are typically easy algebra (linear equations, systems, inequalities, operations), middle questions cover quadratics, functions, exponents, data analysis (mean/median, scatterplots, probability), and the later questions and Module 2 add harder geometry, advanced functions, and multi-step problems.",
        "- High question numbers within a module are harder and more likely to be the harder route of an adaptive test.",
        "",
        "Do the following:",
        "1. For EACH wrong question, infer the most likely skill from the SAT blueprint (question number, module, subject) and write 1-2 sentences explaining what it likely tests and the common trap, based on the wrong answer the student chose.",
        "2. Group the wrong questions into 3-6 'weak concepts' (skill areas) with an estimated accuracy in each.",
        "3. Explain the most likely reasons the student is making these mistakes (using the pattern of their wrong answers), and give specific next steps to fix each weak concept.",
        "",
        `AVAILABLE SKILL NAMES (use these exact names so drills can be generated):\n${skillsText}`,
        "",
        "MATH FORMATTING: The app renders LaTeX. Any math in your reply MUST be written as LaTeX inline math between \\( and \\), e.g. \\(x^2 + 3x = 10\\). Never use unicode math symbols or HTML sub/sup. Do NOT use markdown tables.",
        "",
        "Respond with ONLY a single valid JSON object, no markdown, exactly this shape: {\"analysis\": \"markdown coaching\", \"wrong\": [{\"id\": \"question id\", \"skill\": \"exact skill name\", \"explanation\": \"why missed / likely trap\"}], \"weakConcepts\": [{\"skill\": \"exact skill name\", \"reason\": \"why weak\", \"count\": number}], \"nextSteps\": [\"step 1\", \"step 2\"]}.",
        "Finish with the closing brace of the JSON object."
      ].join("\n");
      let result = null;
      let lastError = "No response from model";
      for (let attempt = 0; attempt < 3 && result === null; attempt++) {
        const content = await callK2([{ role: "user", content: prompt }], { maxTokens: 16000 });
        if (!content || !content.trim()) { lastError = "Empty model output"; continue; }
        try { result = extractJson(content); } catch (error) { lastError = error.message; }
      }
      if (!result) return json(response, 502, { error: `The model returned invalid output. ${lastError}` });
      const analysis = String(result.analysis || "").trim();
      if (!analysis) return json(response, 502, { error: "The model produced no analysis. Try again." });
      return json(response, 200, {
        analysis,
        wrong: Array.isArray(result.wrong) ? result.wrong.slice(0, 60) : [],
        weakConcepts: Array.isArray(result.weakConcepts) ? result.weakConcepts.slice(0, 8) : [],
        nextSteps: Array.isArray(result.nextSteps) ? result.nextSteps.slice(0, 8) : []
      });
    }).catch(error => json(response, 502, { error: error.message }));
  }

  if (request.method === "POST" && url.pathname === "/api/ai/similar") {
    if (!K2_API_KEY) return json(response, 400, { error: "AI is not configured. Set K2_API_KEY in .env to use similar-problem generation." });
    return readBody(request).then(async body => {
      const question = findQuestion(body.id);
      if (!question) return json(response, 404, { error: "Question not found" });
      const optionsText = (question.options || []).map(option => `- ${stripHtml(option.content)}`).join("\n");
      const source = {
        subject: question.subject,
        domain: question.domain,
        skill: question.skill,
        difficulty: question.difficulty,
        type: question.type,
        stem: questionStemText(question),
        options: optionsText,
        correctAnswer: question.correctAnswer
      };
      const typeHint = question.type === "spr"
        ? "This is a student-produced response (grid-in) question. The answer is a single number or fraction; produce NO options."
        : "This is a multiple-choice question. Produce exactly 4 answer options.";
      const prompt = [
        "You are an expert SAT question writer who matches the exact style, tone, and framing conventions of the College Board Digital SAT.",
        "",
        `Generate a NEW original question on the same concept as the source below, for subject "${source.subject}", strand "${source.domain}", skill "${source.skill}", difficulty "${source.difficulty}".`,
        "The new question must test the SAME underlying skill and concept but use DIFFERENT numbers, wording, context, or scenario so it is not a copy.",
        "If the source has a passage, data table, or graph, write a fresh equivalent passage/data so the question stands alone.",
        "If the source question displays data in a table, chart, or graph, the new question MUST also present its data visually. Embed a simple inline HTML table (using <table>, <tr>, <td> tags) inside the stem so the data is readable, and do NOT say \"shown below\" or \"as shown in the graph\" unless you actually include that table.",
        "The stem may contain HTML for the passage/data table, but keep all other text as plain text (paragraphs separated by blank lines, rendered as-is). Do NOT use markdown like **bold** or # headers.",
        typeHint,
        "",
        "MATH FORMATTING: The student's app renders math with LaTeX. Any math symbols, formulas, equations, exponents, fractions, or variables in the stem, options, or rationale MUST be written as LaTeX inline math between \\( and \\), e.g. \\(x^2 + 3x = 10\\). NEVER use unicode math symbols, HTML sub/sup, or plaintext like x^2 without LaTeX. Keep LaTeX short and self-contained.",
        "",
        "SOURCE QUESTION:",
        `Stem: ${source.stem}`,
        source.options ? `Options:\n${source.options}` : "",
        `Correct answer: ${source.correctAnswer}`,
        "",
        'Respond with ONLY a single valid JSON object, no markdown, matching exactly this shape: {"stem": "question text", "options": [], "correctAnswer": "answer", "rationale": "explanation"}.',
        `options is an array of exactly 4 strings (multiple choice) or an empty array (grid-in). For multiple choice, correctAnswer is the letter "A", "B", "C", or "D". For grid-in, correctAnswer is the numeric answer as a string.`,
        "Keep the difficulty and length comparable to the source. Finish with the closing brace of the JSON object."
      ].filter(Boolean).join("\n");
      let generated = null;
      let lastError = "No response from model";
      for (let attempt = 0; attempt < 3 && generated === null; attempt++) {
        const content = await callK2([{ role: "user", content: prompt }], { maxTokens: 16000 });
        if (!content || !content.trim()) { lastError = "Empty model output"; continue; }
        try {
          generated = extractJson(content);
        } catch (error) {
          lastError = error.message;
          try { fs.writeFileSync(path.join(ROOT, "data", "ai_debug.txt"), `QID: ${question.id}\n\n${content}`); } catch (_) {}
        }
      }
      if (!generated) return json(response, 502, { error: `The model returned invalid output. ${lastError}` });
      const mcq = question.type !== "spr";
      let options = [];
      let correctAnswer = String(generated.correctAnswer || "").trim();
      if (mcq) {
        const rawOptions = Array.isArray(generated.options) ? generated.options : [];
        const letters = ["A", "B", "C", "D"];
        if (correctAnswer.length === 1 && /[A-D]/i.test(correctAnswer)) correctAnswer = correctAnswer.toUpperCase();
        options = letters.slice(0, Math.max(4, rawOptions.length) && 4).map((letter, index) => ({
          id: crypto.randomUUID(),
          content: `<p>${cleanOptionText(stripHtml(rawOptions[index] || ""))}</p>`
        }));
        if (!/[A-D]/.test(correctAnswer)) correctAnswer = "";
      } else {
        correctAnswer = correctAnswer.replace(/[^\d./-]/g, "");
      }
      const newQuestion = {
        id: crypto.randomUUID(),
        questionId: `AI-${question.skill.replace(/[^A-Za-z]/g, "").slice(0, 20)}`,
        subject: question.subject,
        domain: question.domain,
        skill: question.skill,
        difficulty: question.difficulty,
        active: false,
        type: question.type,
        stimulus: "",
        stem: sanitizeHtml(generated.stem || ""),
        options,
        correctAnswer,
        rationale: `<p>${stripHtml(generated.rationale || "")}</p>`,
        aiGenerated: true,
        sourceId: question.id
      };
      aiQuestions.push(newQuestion);
      if (aiQuestions.length > 200) aiQuestions.splice(0, aiQuestions.length - 200);
      return json(response, 200, newQuestion);
    }).catch(error => json(response, 502, { error: error.message }));
  }

  if (request.method === "POST" && url.pathname === "/api/ai/generate") {
    if (!K2_API_KEY) return json(response, 400, { error: "AI is not configured. Set K2_API_KEY in .env to generate practice questions." });
    return readBody(request).then(async body => {
      const subject = String(body.subject || "").trim();
      const domain = String(body.domain || "").trim();
      const skill = String(body.skill || "").trim();
      const difficulty = ["Easy", "Medium", "Hard"].includes(body.difficulty) ? body.difficulty : "Medium";
      const type = body.type === "spr" ? "spr" : "mcq";
      if (!subject || !skill) return json(response, 400, { error: "subject and skill are required" });
      const typeHint = type === "spr"
        ? "This is a student-produced response (grid-in) question. The answer is a single number or fraction; produce NO options."
        : "This is a multiple-choice question. Produce exactly 4 answer options.";
      const prompt = [
        "You are an expert SAT question writer who matches the exact style, tone, and framing conventions of the College Board Digital SAT.",
        "",
        `Generate a NEW original question for subject "${subject}", strand "${domain}", skill "${skill}", difficulty "${difficulty}".`,
        "The question must test exactly that skill and be appropriate for that difficulty. Use fresh numbers, wording, context, and scenario.",
        "If the question needs a passage, data table, or graph, write an original passage/data so it stands alone.",
        "If the question displays data in a table, chart, or graph, it MUST present the data visually. Embed a simple inline HTML table (using <table>, <tr>, <td> tags) inside the stem so the data is readable, and do NOT say \"shown below\" or \"as shown in the graph\" unless you actually include that table.",
        "The stem may contain HTML for the passage/data table, but keep all other text as plain text (paragraphs separated by blank lines, rendered as-is). Do NOT use markdown like **bold** or # headers.",
        typeHint,
        "",
        "MATH FORMATTING: The student's app renders math with LaTeX. Any math symbols, formulas, equations, exponents, fractions, or variables in the stem, options, or rationale MUST be written as LaTeX inline math between \\( and \\), e.g. \\(x^2 + 3x = 10\\). NEVER use unicode math symbols, HTML sub/sup, or plaintext like x^2 without LaTeX. Keep LaTeX short and self-contained.",
        "",
        'Respond with ONLY a single valid JSON object, no markdown, matching exactly this shape: {"stem": "question text", "options": [], "correctAnswer": "answer", "rationale": "explanation"}.',
        "options is an array of exactly 4 strings (multiple choice) or an empty array (grid-in). For multiple choice, correctAnswer is the letter \"A\", \"B\", \"C\", or \"D\". For grid-in, correctAnswer is the numeric answer as a string.",
        "Finish with the closing brace of the JSON object."
      ].join("\n");
      let generated = null;
      let lastError = "No response from model";
      for (let attempt = 0; attempt < 3 && generated === null; attempt++) {
        const content = await callK2([{ role: "user", content: prompt }], { maxTokens: 16000 });
        if (!content || !content.trim()) { lastError = "Empty model output"; continue; }
        try {
          generated = extractJson(content);
        } catch (error) {
          lastError = error.message;
          try { fs.writeFileSync(path.join(ROOT, "data", "ai_debug.txt"), `SKILL: ${skill}\n\n${content}`); } catch (_) {}
        }
      }
      if (!generated) return json(response, 502, { error: `The model returned invalid output. ${lastError}` });
      const mcq = type !== "spr";
      let options = [];
      let correctAnswer = String(generated.correctAnswer || "").trim();
      if (mcq) {
        const rawOptions = Array.isArray(generated.options) ? generated.options : [];
        const letters = ["A", "B", "C", "D"];
        if (correctAnswer.length === 1 && /[A-D]/i.test(correctAnswer)) correctAnswer = correctAnswer.toUpperCase();
        options = letters.slice(0, 4).map((letter, index) => ({
          id: crypto.randomUUID(),
          content: `<p>${cleanOptionText(stripHtml(rawOptions[index] || ""))}</p>`
        }));
        if (!/[A-D]/.test(correctAnswer)) correctAnswer = "";
      } else {
        correctAnswer = correctAnswer.replace(/[^\d./-]/g, "");
      }
      const newQuestion = {
        id: crypto.randomUUID(),
        questionId: `AI-${skill.replace(/[^A-Za-z]/g, "").slice(0, 20)}`,
        subject,
        domain,
        skill,
        difficulty,
        active: false,
        type,
        stimulus: "",
        stem: sanitizeHtml(generated.stem || ""),
        options,
        correctAnswer,
        rationale: `<p>${stripHtml(generated.rationale || "")}</p>`,
        aiGenerated: true,
        sourceId: ""
      };
      aiQuestions.push(newQuestion);
      if (aiQuestions.length > 200) aiQuestions.splice(0, aiQuestions.length - 200);
      return json(response, 200, newQuestion);
    }).catch(error => json(response, 502, { error: error.message }));
  }

  if (request.method === "POST" && url.pathname === "/api/ai/chat") {
    if (!K2_API_KEY) return json(response, 400, { error: "AI is not configured. Set K2_API_KEY in .env to use the AI assistant." });
    return readBody(request).then(async body => {
      const history = Array.isArray(body.messages) ? body.messages.slice(-20).map(message => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: String(message.content || "").slice(0, 4000)
      })) : [];
      const context = buildFullContext();
      const prompt = [
        "You are BluePrep Assistant, an elite SAT tutor embedded inside the student's practice app. You have access to the student's ENTIRE practice history in fine detail, including exactly which answer choices they struck out (eliminated), the second-by-second timing of those strikes, how long they spent per question, their answers vs the correct answers, skill/domain/difficulty tags, and their full session history.",
        "",
        "Use every relevant detail to coach them precisely. Quote their actual data. Never be generic.",
        "You may also take ACTIONS on the app. When the student asks you to do something in the app (start practice, drill a skill, review mistakes, generate a similar problem, open analytics, etc.), set the `action` field. Otherwise set it to null.",
        "",
        "Available actions (return exactly one, or null):",
        '{ "type": "start_practice", "subject": "Math"|"Reading and Writing", "domain": "strand name", "skill": "exact skill name", "difficulty": "Easy"|"Medium"|"Hard"|"any", "count": number, "mode": "test"|"practice" }  -- starts a practice/test using REAL questions from the question bank filtered to those criteria.',
        '{ "type": "open_mistakes", "subject": "all"|"Math"|"Reading and Writing", "skill": "exact skill name or empty" }  -- opens the mistakes review page filtered to those criteria.',
        '{ "type": "generate_similar", "questionId": "exact id of a question" }  -- generates an AI-similar problem for that question and starts it.',
        '{ "type": "generate_question", "subject": "Math"|"Reading and Writing", "domain": "strand name", "skill": "exact skill name", "difficulty": "Easy"|"Medium"|"Hard" }  -- creates a brand-new AI-written question on that skill and starts it as practice.',
        '{ "type": "open_sessions" }  -- opens the practice/session history.',
        '{ "type": "open_past_tests" }  -- opens the imported past-tests page (uploaded answer sheets from real practice tests).',
        '{ "type": "open_analytics" }  -- opens the analytics page.',
        "",
        "When taking an action, first say in your reply what you are doing and why, then set the action field. Only use exact skill/domain names that exist in the data below. For start_practice, pick a count between 5 and 30. For generate_question, prefer a skill the student is weak at.",
        "",
        "MATH FORMATTING: The app renders LaTeX. Any math in your reply MUST be written as LaTeX inline math between \\( and \\), e.g. \\(x^2 + 3x = 10\\). Never use unicode math symbols or HTML sub/sup. Do NOT use markdown tables (they render badly) -- use short bullet lists instead.",
        "",
        "CURRENT QUESTION CONTEXT (if the student is asking about a specific question):",
        buildQuestionContext(body.questionId),
        "",
        "FULL STUDENT DATA:",
        context,
        "",
        'Respond with ONLY a single valid JSON object, no markdown, exactly this shape: {"reply": "your coaching message", "action": null | one of the action objects above}.',
        "Finish with the closing brace of the JSON object."
      ].filter(Boolean).join("\n");
      const messages = [
        { role: "system", content: "You are BluePrep Assistant, an SAT tutor who replies with a single JSON object containing a `reply` and optional `action`." },
        { role: "user", content: prompt },
        ...history
      ];
      let result = null;
      let lastError = "No response from model";
      for (let attempt = 0; attempt < 3 && result === null; attempt++) {
        const content = await callK2(messages, { maxTokens: 16000 });
        if (!content || !content.trim()) { lastError = "Empty model output"; continue; }
        try {
          result = extractJson(content);
        } catch (error) {
          lastError = error.message;
        }
      }
      if (!result) return json(response, 502, { error: `The model returned invalid output. ${lastError}` });
      const reply = String(result.reply || "").trim();
      const action = result.action && typeof result.action === "object" ? result.action : null;
      if (!reply) return json(response, 502, { error: "The model produced no reply. Try again." });
      return json(response, 200, { reply, action, digest: buildPerformanceDigest() });
    }).catch(error => json(response, 502, { error: error.message }));
  }

  return json(response, 404, { error: "Not found" });
}

function serveStatic(response, pathname) {
  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  if (requested !== "index.html") {
    response.writeHead(404); response.end("Not found"); return;
  }
  const file = path.resolve(ROOT, requested);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    response.writeHead(404); response.end("Not found"); return;
  }
  const type = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json" }[path.extname(file)] || "application/octet-stream";
  response.writeHead(200, { "content-type": type });
  fs.createReadStream(file).pipe(response);
}

http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  if (url.pathname.startsWith("/api/")) {
    Promise.resolve(handleApi(request, response, url)).catch(error => json(response, 500, { error: error.message }));
  } else serveStatic(response, decodeURIComponent(url.pathname));
}).listen(PORT, () => console.log(`BluePrep running at http://localhost:${PORT}`));
