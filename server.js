import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import {
  MODEL,
  MAX_TOKENS,
  LENGTH_GUIDE,
  LEVEL_GUIDE,
  SCRIPT_SCHEMA,
  SYSTEM_PROMPT,
  buildUserPrompt,
} from "./public/prompts.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3000;

// Resolves credentials from ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / an `ant auth login` profile
const client = new Anthropic();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// The frontend probes this to decide between server mode and
// direct-browser mode (static hosting, e.g. GitHub Pages).
app.get("/api/health", (req, res) => res.json({ ok: true }));

app.post("/api/generate", async (req, res) => {
  const { topic, length = "medium", level = "beginner" } = req.body ?? {};

  if (!topic || typeof topic !== "string" || !topic.trim()) {
    return res.status(400).json({ error: "Please provide a topic to study." });
  }
  if (!LENGTH_GUIDE[length] || !LEVEL_GUIDE[level]) {
    return res.status(400).json({ error: "Invalid length or level option." });
  }

  try {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: "adaptive" },
      system: SYSTEM_PROMPT,
      output_config: {
        format: { type: "json_schema", schema: SCRIPT_SCHEMA },
      },
      messages: [{ role: "user", content: buildUserPrompt(topic.trim(), length, level) }],
    });

    const message = await stream.finalMessage();

    if (message.stop_reason === "refusal") {
      return res.status(422).json({
        error: "This topic couldn't be turned into an episode. Try rephrasing it or picking a different topic.",
      });
    }
    if (message.stop_reason === "max_tokens") {
      return res.status(502).json({
        error: "The episode came out too long to finish. Try a shorter episode length.",
      });
    }

    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock) {
      return res.status(502).json({ error: "The model returned no script. Please try again." });
    }

    const script = JSON.parse(textBlock.text);
    return res.json({
      title: script.title,
      lines: script.lines,
      topic: topic.trim(),
      length,
      level,
    });
  } catch (err) {
    if (
      err instanceof Anthropic.AuthenticationError ||
      /authentication|apiKey|x-api-key/i.test(err?.message ?? "")
    ) {
      return res.status(500).json({
        error: "The server's ANTHROPIC_API_KEY is missing or invalid. Set it and restart the server.",
      });
    }
    if (err instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ error: "Rate limited — please wait a moment and try again." });
    }
    if (err instanceof Anthropic.APIError) {
      console.error("Claude API error:", err.status, err.message);
      return res.status(502).json({ error: "The script generator hit an API error. Please try again." });
    }
    console.error("Unexpected error:", err);
    return res.status(500).json({ error: "Something went wrong generating the episode." });
  }
});

app.listen(PORT, () => {
  console.log(`Study Pod running at http://localhost:${PORT}`);
});
