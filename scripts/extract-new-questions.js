const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const BANK = path.join(DATA_DIR, "questions.json");
const OUTPUT = path.join(DATA_DIR, "new_questions.json");
const ID_LIST = process.argv[2];

if (!ID_LIST || !fs.existsSync(ID_LIST)) {
  console.error("Usage: node scripts/extract-new-questions.js <id-list-file>");
  console.error("The id-list file should contain one 8-hex questionId per line.");
  process.exit(1);
}

const bank = JSON.parse(fs.readFileSync(BANK, "utf8"));
const ids = fs.readFileSync(ID_LIST, "utf8")
  .split(/\r?\n/)
  .map(line => line.trim())
  .filter(Boolean);

const byId = new Map(bank.map(q => [q.questionId, q]));
const extracted = [];
const missing = [];

for (const id of ids) {
  const q = byId.get(id);
  if (!q) {
    missing.push(id);
    continue;
  }
  extracted.push({ ...q, isNew: true });
}

if (!extracted.length) {
  console.error("No questions matched. Nothing written.");
  process.exit(1);
}

fs.writeFileSync(OUTPUT, JSON.stringify(extracted));
console.log(`Wrote ${extracted.length} new questions to ${OUTPUT}`);
if (missing.length) {
  console.warn(`Not found in bank (${missing.length}): ${missing.join(", ")}`);
}
