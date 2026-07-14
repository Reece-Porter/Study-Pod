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

const ttsSupported = "speechSynthesis" in window;

let episode = null; // { title, lines: [{speaker, text}], topic, length, level }
let currentIndex = 0;
let playing = false;
let voices = { ALEX: null, SAM: null };

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

  const length = form.elements.length.value;
  const level = form.elements.level.value;

  stopPlayback();
  playerEl.hidden = true;
  loadingEl.hidden = false;
  generateBtn.disabled = true;

  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic, length, level }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to generate the episode.");
    episode = data;
    renderEpisode();
  } catch (err) {
    formError.textContent = err.message;
    formError.hidden = false;
  } finally {
    loadingEl.hidden = true;
    generateBtn.disabled = false;
  }
});

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
