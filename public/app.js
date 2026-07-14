import {
  MODEL,
  MAX_TOKENS,
  SCRIPT_SCHEMA,
  SYSTEM_PROMPT,
  buildUserPrompt,
} from "./prompts.js";

const form = document.getElementById("generate-form");
const topicInput = document.getElementById("topic");
const generateBtn = document.getElementById("generate-btn");
const formError = document.getElementById("form-error");
const loadingEl = document.getElementById("loading");
const playerEl = document.getElementById("player");
const titleEl = document.getElementById("episode-title");
const metaEl = document.getElementById("episode-meta");
const transcriptEl = document.getElementById("transcript");
const playBtn = document.getElementById("play-btn");
const stopBtn = document.getElementById("stop-btn");
const speedSelect = document.getElementById("speed");
const downloadBtn = document.getElementById("download-btn");
const progressBar = document.getElementById("progress-bar");
const ttsNote = document.getElementById("tts-note");
const keySection = document.getElementById("key-section");
const keyInput = document.getElementById("api-key");

const ttsSupported = "speechSynthesis" in window;
const KEY_STORAGE = "study-pod-api-key";

let serverMode = false; // true when a backend with the API key is available
let episode = null; // { title, lines: [{speaker, text}], topic, length, level }
let currentIndex = 0;
let playing = false;
let voices = { ALEX: null, SAM: null };

// ---------- Mode detection ----------
// When served by server.js, /api/health answers and the server holds the key.
// On static hosting (e.g. GitHub Pages) there is no backend, so the browser
// calls the Claude API directly with a key the user provides.

async function detectMode() {
  try {
    const res = await fetch("api/health");
    if (res.ok) {
      const data = await res.json();
      serverMode = data.ok === true;
    }
  } catch {
    serverMode = false;
  }
  keySection.hidden = serverMode;
  if (!serverMode) {
    keyInput.value = localStorage.getItem(KEY_STORAGE) || "";
  }
}
detectMode();

// ---------- Voice selection ----------

function pickVoices() {
  if (!ttsSupported) return;
  const all = speechSynthesis.getVoices();
  if (!all.length) return;

  const english = all.filter((v) => v.lang.toLowerCase().startsWith("en"));
  const pool = english.length >= 1 ? english : all;

  // Prefer local/natural voices, and try to get two that sound distinct.
  const ranked = [...pool].sort((a, b) => {
    const score = (v) =>
      (v.localService ? 2 : 0) +
      (/natural|neural|premium|enhanced/i.test(v.name) ? 3 : 0) +
      (v.default ? 1 : 0);
    return score(b) - score(a);
  });

  voices.SAM = ranked[0] || null;
  voices.ALEX = ranked.find((v) => v !== voices.SAM) || ranked[0] || null;
}

if (ttsSupported) {
  pickVoices();
  speechSynthesis.onvoiceschanged = pickVoices;
}

// ---------- Generation ----------

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  formError.hidden = true;

  const topic = topicInput.value.trim();
  if (!topic) return;

  // NB: form.elements.length is the control count, not the "length" radio group
  const fields = new FormData(form);
  const length = fields.get("length");
  const level = fields.get("level");

  stopPlayback();
  playerEl.hidden = true;
  loadingEl.hidden = false;
  generateBtn.disabled = true;

  try {
    episode = serverMode
      ? await generateViaServer(topic, length, level)
      : await generateInBrowser(topic, length, level);
    renderEpisode();
  } catch (err) {
    formError.textContent = err.message;
    formError.hidden = false;
  } finally {
    loadingEl.hidden = true;
    generateBtn.disabled = false;
  }
});

async function generateViaServer(topic, length, level) {
  const res = await fetch("api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic, length, level }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to generate the episode.");
  return data;
}

async function generateInBrowser(topic, length, level) {
  const key = keyInput.value.trim();
  if (!key) {
    keyInput.focus();
    throw new Error("Enter your Anthropic API key above — it stays in this browser and is only sent to Anthropic.");
  }
  localStorage.setItem(KEY_STORAGE, key);

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      stream: true,
      thinking: { type: "adaptive" },
      system: SYSTEM_PROMPT,
      output_config: { format: { type: "json_schema", schema: SCRIPT_SCHEMA } },
      messages: [{ role: "user", content: buildUserPrompt(topic, length, level) }],
    }),
  });

  if (!res.ok) {
    let message = `The Claude API returned an error (${res.status}).`;
    try {
      const err = await res.json();
      if (err?.error?.message) message = err.error.message;
    } catch {
      /* non-JSON error body */
    }
    if (res.status === 401) {
      message = "That API key was rejected. Double-check it (it should start with sk-ant-) and try again.";
    } else if (res.status === 429) {
      message = "Rate limited — please wait a moment and try again.";
    }
    throw new Error(message);
  }

  // Accumulate the streamed response (SSE)
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let stopReason = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop();
    for (const raw of events) {
      const dataLine = raw.split("\n").find((l) => l.startsWith("data:"));
      if (!dataLine) continue;
      let ev;
      try {
        ev = JSON.parse(dataLine.slice(5));
      } catch {
        continue;
      }
      if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
        text += ev.delta.text;
      } else if (ev.type === "message_delta" && ev.delta?.stop_reason) {
        stopReason = ev.delta.stop_reason;
      } else if (ev.type === "error") {
        throw new Error(ev.error?.message || "The Claude API reported a streaming error.");
      }
    }
  }

  if (stopReason === "refusal") {
    throw new Error("This topic couldn't be turned into an episode. Try rephrasing it or picking a different topic.");
  }
  if (stopReason === "max_tokens") {
    throw new Error("The episode came out too long to finish. Try a shorter episode length.");
  }

  let script;
  try {
    script = JSON.parse(text);
  } catch {
    throw new Error("The model returned an unreadable script. Please try again.");
  }
  return { title: script.title, lines: script.lines, topic, length, level };
}

function renderEpisode() {
  titleEl.textContent = episode.title;
  const lengthLabel = { short: "~5 min", medium: "~10 min", long: "~20 min" }[episode.length];
  metaEl.textContent = `${episode.topic} · ${lengthLabel} · ${episode.level} · ${episode.lines.length} exchanges`;

  transcriptEl.innerHTML = "";
  episode.lines.forEach((line, i) => {
    const div = document.createElement("div");
    div.className = `line ${line.speaker.toLowerCase()}`;
    div.dataset.index = i;
    div.innerHTML = `<span class="speaker"></span><span class="text"></span>`;
    div.querySelector(".speaker").textContent = line.speaker;
    div.querySelector(".text").textContent = line.text;
    div.addEventListener("click", () => jumpTo(i));
    transcriptEl.appendChild(div);
  });

  currentIndex = 0;
  updateProgress();
  ttsNote.hidden = ttsSupported;
  playBtn.disabled = !ttsSupported;
  playerEl.hidden = false;
  playerEl.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------- Playback ----------

function speakLine(index) {
  if (!episode || index >= episode.lines.length) {
    stopPlayback();
    currentIndex = 0;
    updateProgress();
    return;
  }

  currentIndex = index;
  highlightLine(index);
  updateProgress();

  const line = episode.lines[index];
  const utter = new SpeechSynthesisUtterance(line.text);
  const voice = voices[line.speaker];
  if (voice) utter.voice = voice;

  // If both hosts ended up with the same voice, differentiate by pitch.
  const sameVoice = voices.ALEX === voices.SAM;
  utter.pitch = line.speaker === "ALEX" ? (sameVoice ? 1.25 : 1.05) : sameVoice ? 0.85 : 1.0;
  utter.rate = parseFloat(speedSelect.value);

  utter.onend = () => {
    if (playing) speakLine(index + 1);
  };
  utter.onerror = (e) => {
    // "interrupted"/"canceled" fire when we cancel deliberately — ignore those.
    if (playing && e.error !== "interrupted" && e.error !== "canceled") {
      speakLine(index + 1);
    }
  };

  speechSynthesis.speak(utter);
}

function startPlayback(fromIndex = currentIndex) {
  if (!ttsSupported || !episode) return;
  speechSynthesis.cancel();
  playing = true;
  playBtn.textContent = "⏸ Pause";
  speakLine(fromIndex);
}

function pausePlayback() {
  playing = false;
  speechSynthesis.cancel(); // cancel rather than pause: resume() is unreliable across browsers
  playBtn.textContent = "▶ Play";
}

function stopPlayback() {
  playing = false;
  if (ttsSupported) speechSynthesis.cancel();
  playBtn.textContent = "▶ Play";
}

function jumpTo(index) {
  if (playing) {
    startPlayback(index);
  } else {
    currentIndex = index;
    highlightLine(index);
    updateProgress();
  }
}

playBtn.addEventListener("click", () => {
  if (playing) {
    pausePlayback();
  } else {
    startPlayback();
  }
});

stopBtn.addEventListener("click", () => {
  stopPlayback();
  currentIndex = 0;
  highlightLine(-1);
  updateProgress();
  transcriptEl.scrollTop = 0;
});

speedSelect.addEventListener("change", () => {
  // Restart the current line at the new speed if we're mid-playback.
  if (playing) startPlayback(currentIndex);
});

function highlightLine(index) {
  transcriptEl.querySelectorAll(".line").forEach((el) => {
    const active = Number(el.dataset.index) === index;
    el.classList.toggle("active", active);
    if (active) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
}

function updateProgress() {
  if (!episode) return;
  const pct = (currentIndex / episode.lines.length) * 100;
  progressBar.style.width = `${pct}%`;
}

// ---------- Transcript download ----------

downloadBtn.addEventListener("click", () => {
  if (!episode) return;
  const text = [
    `${episode.title}`,
    `Topic: ${episode.topic} · Level: ${episode.level}`,
    "",
    ...episode.lines.map((l) => `${l.speaker}: ${l.text}`),
  ].join("\n\n");

  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${episode.title.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "study-pod-episode"}.txt`;
  a.click();
  URL.revokeObjectURL(url);
});
