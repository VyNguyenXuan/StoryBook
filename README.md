# StoryBook
Turns a book's text into character portraits and chapter illustrations via the Gemini API, following the 5-step pipeline (Style → Characters → Portraits → Chapters → Illustrations) from Google's reference notebook.

## Disclaimer
> As you can find in the Repo, there is no .CLAUDE/ file to be found. Its true i used Claude to help me with coding and reviewing however i did not have the funds to use the VSC in-built version of Claude (only applies to Pro above), the Claude i used is the Web/App Claude.

## Quick start

```bash
./start.sh
```

- It should automatically create a `.env`
- Fill in your API key and switch the `GEMINI_PROVIDER` from "mock" to "real" if you want to run on real keys
- Then open **http://localhost:3001**.

## Run tests

```bash
./test.sh
```

- Runs the full backend + frontend-logic test suite
- See `TESTING.md` for what's covered and what isn't

## Prerequisites

- Node.js 18+

## Environment variables

See `.env.example`. Key one: `GEMINI_PROVIDER` — `mock`(default) or `real`.
Switching to `real` requires `GEMINI_API_KEY` and a Gemini project with billing enabled

## Architecture overview

```
backend/
  src/
    server.js
    db.js
    services/
      pipeline.js
      imageStore.js
      caps.js
      stepRunner.js
    providers/
      mockProvider.js
      geminiProvider.js
    routes/
      projects.js
      users.js
  test/      
frontend/
  index.html / styles.css / app.js
  helpers.js
DECISIONS.md 
TESTING.md
```

