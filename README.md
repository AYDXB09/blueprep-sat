# BluePrep

Local SAT question-bank practice with a Bluebook-style player.

## Run

```powershell
npm start
```

Open <http://localhost:4173>.

## Refresh The Catalog

```powershell
npm run download
```

The downloader retrieves the public SAT inventory from the College Board SAT Suite Question Bank API, resumes interrupted detail downloads from a checkpoint, marks questions that appear in official full-length practice tests, and writes the normalized catalog to `data/questions.json`.

The application stores answer history in `data/progress.json` after a practice set is completed. This powers the **Exclude correctly answered questions** filter.
