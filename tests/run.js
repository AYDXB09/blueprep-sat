"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const { RW_SKILL_ORDER, DIFFICULTY_RANK, PRACTICE_SIZES, orderLikeSatSection } = require(path.join(ROOT, "lib", "ordering.js"));

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    process.stdout.write(`ok - ${name}\n`);
  } catch (error) {
    failed++;
    failures.push({ name, error });
    process.stdout.write(`FAIL - ${name}\n      ${String(error && error.message || error)}\n`);
  }
}

function loadJson(file) {
  const p = path.join(ROOT, "data", file);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

const questions = loadJson("questions.json");

test("question catalog exists and is a non-empty array", () => {
  assert.ok(Array.isArray(questions) && questions.length > 0, "questions.json should load an array");
});

test("every question has the required schema fields", () => {
  for (const question of questions) {
    assert.ok(question.id, "missing id");
    assert.ok(question.questionId, "missing official College Board questionId");
    assert.ok(["Math", "Reading and Writing"].includes(question.subject), `bad subject ${question.subject}`);
    assert.ok(question.domain, "missing domain");
    assert.ok(question.skill, "missing skill");
    assert.ok(["Easy", "Medium", "Hard"].includes(question.difficulty), `bad difficulty ${question.difficulty}`);
    assert.ok(["mcq", "spr"].includes(question.type), `bad type ${question.type}`);
    assert.ok(question.correctAnswer, "missing correctAnswer");
    if (question.type === "mcq") {
      assert.ok(Array.isArray(question.options) && question.options.length === 4, `mcq ${question.id} should have 4 options`);
      const letters = new Set();
      for (const option of question.options) {
        assert.ok(option && option.id, `option missing id in ${question.id}`);
        assert.ok(typeof option.content === "string" && option.content, `option missing content in ${question.id}`);
        letters.add(String(option.content).trim().charAt(0).toUpperCase());
      }
      assert.ok(/^[A-D]$/.test(String(question.correctAnswer)), `mcq ${question.id} correctAnswer should be A-D`);
    } else {
      assert.ok(String(question.correctAnswer).trim(), `spr ${question.id} correctAnswer should be non-empty`);
    }
  }
});

test("question ids and official questionIds are unique", () => {
  const ids = new Set();
  const official = new Set();
  for (const question of questions) {
    assert.ok(!ids.has(question.id), `duplicate id ${question.id}`);
    assert.ok(!official.has(question.questionId), `duplicate questionId ${question.questionId}`);
    ids.add(question.id);
    official.add(question.questionId);
  }
});

test("official questionIds look like College Board short ids (hex)", () => {
  let checked = 0;
  for (const question of questions) {
    if (!String(question.questionId).startsWith("AI-")) {
      assert.ok(/^[0-9a-fA-F]{8}$/.test(String(question.questionId)), `unexpected questionId format ${question.questionId}`);
      checked++;
    }
  }
  assert.ok(checked > 0, "should have non-AI official ids to check");
});

test("Reading and Writing practice sets order by skill blueprint then difficulty", () => {
  const skills = RW_SKILL_ORDER.slice();
  const skillRank = new Map(skills.map((skill, index) => [skill, index]));
  const input = [];
  for (let i = 0; i < 30; i++) {
    const skill = skills[(i * 7) % skills.length];
    const difficulty = ["Easy", "Medium", "Hard"][i % 3];
    input.push({ id: `q${i}`, subject: "Reading and Writing", skill, difficulty, type: "mcq" });
  }
  const ordered = orderLikeSatSection(input, "Reading and Writing");
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1];
    const cur = ordered[i];
    const prevSkill = skillRank.get(prev.skill) ?? skills.length;
    const curSkill = skillRank.get(cur.skill) ?? skills.length;
    assert.ok(prevSkill < curSkill || (prevSkill === curSkill && (DIFFICULTY_RANK[prev.difficulty] ?? 2) <= (DIFFICULTY_RANK[cur.difficulty] ?? 2)), `misordered at ${i}`);
  }
});

test("Math practice sets order Easy before Medium before Hard", () => {
  const input = [];
  for (let i = 0; i < 30; i++) {
    input.push({ id: `m${i}`, subject: "Math", skill: "Algebra", difficulty: ["Easy", "Medium", "Hard"][i % 3], type: i % 5 === 0 ? "spr" : "mcq" });
  }
  const ordered = orderLikeSatSection(input, "Math");
  let sawMedium = false, sawHard = false;
  for (const question of ordered) {
    if (question.difficulty === "Medium") sawMedium = true;
    if (question.difficulty === "Hard") sawHard = true;
    if (sawHard) assert.notStrictEqual(question.difficulty, "Medium", "Hard should not precede Medium");
    if (sawMedium) assert.notStrictEqual(question.difficulty, "Easy", "Medium should not precede Easy");
  }
  const spr = ordered.filter(question => question.type === "spr");
  assert.ok(spr.length > 0, "Math set should contain student-produced responses");
});

test("student-produced responses are interleaved within a difficulty band, not clustered", () => {
  const { interleaveSpr } = require(path.join(ROOT, "lib", "ordering.js"));
  const band = [];
  for (let i = 0; i < 12; i++) band.push({ id: `x${i}`, type: i % 6 === 0 ? "spr" : "mcq" });
  const spr = band.filter(question => question.type === "spr").length;
  const ordered = interleaveSpr(band);
  const positions = [];
  ordered.forEach((question, index) => { if (question.type === "spr") positions.push(index); });
  let maxGap = 0;
  for (let i = 1; i < positions.length; i++) maxGap = Math.max(maxGap, positions[i] - positions[i - 1]);
  const stride = Math.max(1, Math.round(band.length / (spr + 1)));
  assert.ok(maxGap <= stride, `spr gap ${maxGap} should be <= stride ${stride}`);
});

test("practice size configs match the SAT blueprint", () => {
  assert.strictEqual(PRACTICE_SIZES.module["Reading and Writing"].count, 27);
  assert.strictEqual(PRACTICE_SIZES.module["Reading and Writing"].seconds, 32 * 60);
  assert.strictEqual(PRACTICE_SIZES.module.Math.count, 22);
  assert.strictEqual(PRACTICE_SIZES.section["Reading and Writing"].count, 54);
  assert.strictEqual(PRACTICE_SIZES.section.Math.count, 44);
});

test("progress records are consistent with the catalog and carry per-question time", () => {
  const progress = loadJson("progress.json") || {};
  const known = new Set(questions.map(question => question.id));
  let legacyOrphans = 0;
  for (const [id, record] of Object.entries(progress)) {
    if (!known.has(id)) { legacyOrphans++; continue; }
    assert.ok(typeof record.correct === "boolean", `progress ${id} correct should be boolean`);
    if ("time" in record) {
      assert.ok(typeof record.time === "number" && record.time >= 0, `progress ${id} time should be a non-negative number`);
    }
  }
  process.stdout.write(`      note: ${legacyOrphans} progress record(s) reference questions no longer in the catalog (legacy AI/imported).\n`);
});

test("session records are consistent, carry per-question time, and map to real questions", () => {
  const sessions = loadJson("sessions.json") || [];
  const newQ = loadJson("new_questions.json") || [];
  const known = new Set(questions.map(question => question.id));
  const knownNew = new Set(newQ.map(question => question.id));
  let legacyOrphans = 0;
  for (const session of sessions) {
    assert.ok(Array.isArray(session.questions), "session.questions should be an array");
    for (const entry of session.questions) {
      const inCatalog = known.has(entry.id) || knownNew.has(entry.id);
      if (!inCatalog) { legacyOrphans++; continue; }
      assert.ok(typeof entry.time === "number" && entry.time >= 0, `session question ${entry.id} time should be a non-negative number`);
      const answer = String(entry.answer || "").trim();
      assert.ok(!answer || /^[A-D]$/.test(answer) || /^-?\d+(\.\d+)?$/.test(answer) || /^\d+\/\d+$/.test(answer), `session question ${entry.id} answer should be A-D, numeric, a fraction, or empty`);
      assert.ok(Array.isArray(entry.struck) ? entry.struck.every(letter => /^[A-D]$/.test(String(letter))) : true, `session question ${entry.id} struck should be A-D letters`);
    }
  }
  process.stdout.write(`      note: ${legacyOrphans} session entry/entries reference questions no longer in the catalog (legacy AI/imported).\n`);
});

test("review mode never POSTs answers to /api/progress (keeps stored records untouched)", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const start = html.indexOf("async function revealAnswer");
  assert.ok(start !== -1, "revealAnswer should exist");
  const end = html.indexOf("\n    }", start);
  const body = html.slice(start, end);
  assert.ok(!body.includes("/api/progress"), "revealAnswer (review path) must not write to /api/progress");
  const sessionReview = html.indexOf("function startSessionReview");
  assert.ok(sessionReview !== -1, "startSessionReview should exist");
  const sessionReviewEnd = html.indexOf("\n    }", sessionReview);
  const sessionReviewBody = html.slice(sessionReview, sessionReviewEnd);
  assert.ok(!sessionReviewBody.includes("new Set(questions.map"), "startSessionReview should not auto-reveal every question");
  assert.ok(sessionReviewBody.includes("reviewingStored"), "startSessionReview should mark reviewingStored so exit never writes");
});

test("every /api/progress write in the app is guarded from review mode", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const occurrences = html.split('"/api/progress"').length - 1;
  assert.ok(occurrences >= 1, "app should still write progress during practice");
  for (const marker of ["!state.reviewingStored", "state.sessionMode === \"review\""]) {
    assert.ok(html.includes(marker), `expected guard marker ${marker}`);
  }
});

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
if (failed) {
  for (const failure of failures) process.stdout.write(`\n  ${failure.name}: ${failure.error && failure.error.stack || failure.error}\n`);
  process.exitCode = 1;
}
