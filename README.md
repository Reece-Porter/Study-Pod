# 🎙️ Study Pod

Turn any topic into a listenable podcast. Type what you want to learn and Study Pod generates a two-host teaching conversation — **Alex** (the curious co-host who asks the questions you would ask) and **Sam** (the expert who explains) — then plays it aloud in your browser with a synced, clickable transcript.

## Two ways to run it

### 1. On the web (GitHub Pages) — no server needed

The site deploys automatically to GitHub Pages from this branch:

**https://reece-porter.github.io/Study-Pod/**

With no backend available, the browser talks to the Claude API directly. The page shows an **API key field** — paste your Anthropic key (from [platform.claude.com](https://platform.claude.com)). The key is stored only in your browser's localStorage and is sent only to `api.anthropic.com`, never to any other server.

> Tip: use a dedicated API key with a spending limit for browser use, so you can revoke it independently.

### 2. Locally with a server (key stays server-side)

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-...
npm start        # open http://localhost:3000
```

In this mode the server holds the key and visitors never see a key field. This is also the mode to use if you later host it on Render/Railway/Fly/etc. for other people, since it doesn't require each visitor to have their own key.

The frontend auto-detects which mode it's in by probing `/api/health`.

## How it works

1. **You enter a topic** (plus an episode length and your experience level).
2. **Claude** (`claude-opus-4-8`) writes a structured podcast script — a JSON array of dialogue turns, enforced with the API's structured-output schema so it always parses. The request is streamed to avoid timeouts on long episodes.
3. **Your browser voices it** using the Web Speech API, assigning each host a distinct voice. No TTS account needed.

## Features

- **Episode length**: ~5, ~10, or ~20 minutes of listening
- **Difficulty levels**: beginner / intermediate / advanced — changes how much is assumed and how deep it goes
- **Player**: play/pause, restart, playback speed, progress bar
- **Synced transcript**: the current line is highlighted; click any line to jump there
- **Transcript download** as a text file

## Project layout

```
server.js                     Express server (optional backend mode)
public/index.html             UI
public/app.js                 Player, speech synthesis, generation (both modes)
public/prompts.js             Shared prompt/schema (used by server and browser)
public/style.css              Styling
.github/workflows/pages.yml   GitHub Pages deployment
```

## Notes

- Speech quality depends on the voices installed in your browser/OS. Chrome, Edge, and Safari all ship good English voices; if only one voice is available, the app differentiates the hosts by pitch.
- The Pages deployment publishes the `public/` folder as-is — `server.js` is simply unused there.
