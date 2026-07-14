# 🎙️ Study Pod

Turn any topic into a listenable podcast. Type what you want to learn and Study Pod generates a two-host teaching conversation — **Alex** (the curious co-host who asks the questions you would ask) and **Sam** (the expert who explains) — then plays it aloud in your browser with a synced, clickable transcript.

## How it works

1. **You enter a topic** (plus an episode length and your experience level).
2. **The server asks Claude** (`claude-opus-4-8`) to write a structured podcast script — a JSON array of dialogue turns, enforced with the API's structured-output schema so it always parses.
3. **Your browser voices it** using the Web Speech API, assigning each host a distinct voice. No TTS account or extra API keys needed.

## Running it

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-...   # or copy .env.example and use a dotenv loader
npm start
```

Then open http://localhost:3000.

## Features

- **Episode length**: ~5, ~10, or ~20 minutes of listening
- **Difficulty levels**: beginner / intermediate / advanced — changes how much is assumed and how deep it goes
- **Player**: play/pause, restart, playback speed, progress bar
- **Synced transcript**: the current line is highlighted; click any line to jump there
- **Transcript download** as a text file

## Project layout

```
server.js          Express server + Claude API call (script generation)
public/index.html  UI
public/app.js      Player, speech synthesis, transcript sync
public/style.css   Styling
```

## Notes

- Speech quality depends on the voices installed in your browser/OS. Chrome, Edge, and Safari all ship good English voices; if only one voice is available, the app differentiates the hosts by pitch.
- Script generation streams server-side to avoid HTTP timeouts on long episodes; the browser receives the finished script as JSON.
