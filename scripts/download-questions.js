const fs = require("node:fs");
const path = require("node:path");

const API = "https://qbank-api.collegeboard.org/msreportingquestionbank-prod/questionbank";
const DATA_DIR = path.join(__dirname, "..", "data");
const OUTPUT = path.join(DATA_DIR, "questions.json");
const CHECKPOINT = path.join(DATA_DIR, "questions.checkpoint.json");
const CONCURRENCY = 12;

const sections = [
  { subject: "Reading and Writing", test: 1, domain: "INI,CAS,EOI,SEC" },
  { subject: "Math", test: 2, domain: "H,P,Q,S" }
];

async function request(url, body, attempts = 5) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, {
        method: body ? "POST" : "GET",
        headers: body ? { "content-type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined
      });
      if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
      return response.json();
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, attempt * 750));
    }
  }
  throw lastError;
}

function normalize(summary, detail, subject, liveItems) {
  const answerOptions = detail.answerOptions || [];
  const correctKeys = detail.keys || [];
  let correctAnswer = Array.isArray(detail.correct_answer) ? detail.correct_answer[0] : detail.correct_answer;
  if (!correctAnswer && correctKeys.length) {
    const index = answerOptions.findIndex(option => correctKeys.includes(option.id));
    if (index >= 0) correctAnswer = String.fromCharCode(65 + index);
  }
  return {
    id: summary.external_id,
    questionId: summary.questionId,
    subject,
    domain: summary.primary_class_cd_desc,
    domainCode: summary.primary_class_cd,
    skill: summary.skill_desc,
    skillCode: summary.skill_cd,
    difficulty: { E: "Easy", M: "Medium", H: "Hard" }[summary.difficulty] || "Easy",
    scoreBand: summary.score_band_range_cd,
    active: liveItems.has(summary.external_id),
    type: detail.type || "mcq",
    stimulus: detail.stimulus || "",
    stem: detail.stem || "",
    options: answerOptions.map(option => ({ id: option.id, content: option.content || "" })),
    correctAnswer: correctAnswer || "",
    rationale: detail.rationale || ""
  };
}

async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  console.log("Fetching College Board lookup and SAT inventories...");
  const lookup = await request(`${API}/lookup`);
  const liveBySubject = {
    "Reading and Writing": new Set(lookup.readingLiveItems || []),
    Math: new Set(lookup.mathLiveItems || [])
  };
  const summaries = [];
  for (const section of sections) {
    const items = await request(`${API}/digital/get-questions`, {
      asmtEventId: 99,
      test: section.test,
      domain: section.domain
    });
    console.log(`${section.subject}: ${items.length} summaries`);
    items.forEach(item => {
      if (item.external_id) summaries.push({ ...item, _subject: section.subject });
      else console.warn(`Skipping ${item.questionId || "unknown"}: no external_id`);
    });
  }

  let saved = {};
  if (fs.existsSync(CHECKPOINT)) {
    try { saved = JSON.parse(fs.readFileSync(CHECKPOINT, "utf8")); } catch { saved = {}; }
  }
  let completed = Object.keys(saved).length;
  console.log(`Downloading details (${completed}/${summaries.length} already cached)...`);
  let cursor = 0;
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (cursor < summaries.length) {
      const summary = summaries[cursor++];
      if (saved[summary.external_id]) continue;
      try {
        const detail = await request(`${API}/digital/get-question`, { external_id: summary.external_id });
        saved[summary.external_id] = normalize(summary, detail, summary._subject, liveBySubject[summary._subject]);
        completed++;
      } catch (error) {
        console.warn(`Skipping ${summary.external_id}: ${error.message}`);
        continue;
      }
      if (completed % 50 === 0) {
        fs.writeFileSync(CHECKPOINT, JSON.stringify(saved));
        console.log(`${completed}/${summaries.length}`);
      }
    }
  });
  await Promise.all(workers);
  const ordered = summaries.map(summary => saved[summary.external_id]).filter(Boolean);
  fs.writeFileSync(OUTPUT, JSON.stringify(ordered));
  if (fs.existsSync(CHECKPOINT)) fs.unlinkSync(CHECKPOINT);
  console.log(`Saved ${ordered.length} questions to ${OUTPUT}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
