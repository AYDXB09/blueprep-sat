const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");

const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, "data", "questions.json");
const NEW_FILE = path.join(ROOT, "data", "new_questions.json");
const PROGRESS_FILE = path.join(ROOT, "data", "progress.json");
const PORT = Number(process.env.PORT || 4173);

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
    submittedAnswer: progress[question.id]?.answer || ""
  };
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
    const domain = url.searchParams.get("domain") || "all";
    const skill = url.searchParams.get("skill") || "all";
    const difficulties = new Set((url.searchParams.get("difficulty") || "Easy,Medium,Hard").split(","));
    const search = (url.searchParams.get("search") || "").toLowerCase().trim();
    const excludeCorrect = url.searchParams.get("excludeCorrect") === "true";
    const newOnly = url.searchParams.get("newOnly") === "true";
    const excludeActive = url.searchParams.get("excludeActive") === "true" || newOnly;
    const sourcePool = newOnly ? newQuestions : questions;
    const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 50)));
    const filtered = sourcePool.filter(question =>
      (subject === "all" || question.subject === subject) &&
      (domain === "all" || question.domain === domain) &&
      (skill === "all" || question.skill === skill) &&
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
      const question = questions.find(item => item.id === id) || newQuestions.find(item => item.id === id);
      if (!question) continue;
      mistakes.push({ question, answer: record.answer || "", updatedAt: record.updatedAt || 0 });
    }
    mistakes.sort((a, b) => b.updatedAt - a.updatedAt);
    return json(response, 200, { total: mistakes.length, items: mistakes });
  }

  const match = url.pathname.match(/^\/api\/questions\/([0-9a-f-]+)$/i);
  if (request.method === "GET" && match) {
    const question = questions.find(item => item.id === match[1]) || newQuestions.find(item => item.id === match[1]);
    return question ? json(response, 200, question) : json(response, 404, { error: "Question not found" });
  }

  if (request.method === "POST" && url.pathname === "/api/progress") {
    return readBody(request).then(body => {
      if (!questions.some(question => question.id === body.id) && !newQuestions.some(question => question.id === body.id)) return json(response, 404, { error: "Question not found" });
      progress[body.id] = { correct: Boolean(body.correct), answer: String(body.answer || ""), time: Math.max(0, Number(body.time) || 0), updatedAt: Date.now() };
      fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
      return json(response, 200, { ok: true });
    }).catch(error => json(response, 400, { error: error.message }));
  }

  if (request.method === "GET" && url.pathname === "/api/analytics") {
    const items = [];
    for (const [id, record] of Object.entries(progress)) {
      const question = questions.find(item => item.id === id) || newQuestions.find(item => item.id === id);
      if (!question) continue;
      items.push({
        id,
        subject: question.subject,
        domain: question.domain,
        skill: question.skill,
        difficulty: question.difficulty,
        correct: Boolean(record.correct),
        answer: record.answer || "",
        time: record.time || 0,
        updatedAt: record.updatedAt || 0
      });
    }
    items.sort((a, b) => b.updatedAt - a.updatedAt);
    return json(response, 200, { total: items.length, items });
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
