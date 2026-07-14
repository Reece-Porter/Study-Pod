import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3000;

// Resolves credentials from ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / an `ant auth login` profile
const client = new Anthropic();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const LENGTH_GUIDE = {
  short: "about 5 minutes of listening — roughly 700–900 words of dialogue",
  medium: "about 10 minutes of listening — roughly 1,400–1,800 words of dialogue",
  long: "about 20 minutes of listening — roughly 2,800–3,600 words of dialogue",
};

const LEVEL_GUIDE = {
  beginner:
    "The listener is completely new to this topic. Define every term, lean on everyday analogies, and avoid jargon.",
  intermediate:
    "The listener knows the basics. Skip introductory definitions, go deeper into mechanisms, trade-offs, and common misconceptions.",
  advanced:
    "The listener is experienced. Discuss nuances, edge cases, current debates, and connections to adjacent topics at a technical level.",
};

const SCRIPT_SCHEMA = {
  type: "object",
  properties: {
    title: {
      type: "string",
      description: "A catchy episode title for this podcast episode",
    },
    lines: {
      type: "array",
      description: "The dialogue, in order, alternating naturally between the two hosts",
      items: {
        type: "object",
        properties: {
          speaker: {
            type: "string",
            enum: ["ALEX", "SAM"],
            description: "ALEX is the curious co-host, SAM is the expert",
          },
          text: {
            type: "string",
            description: "What the speaker says, as natural spoken language",
          },
        },
        required: ["speaker", "text"],
        additionalProperties: false,
      },
    },
  },
  required: ["title", "lines"],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You are a podcast script writer for "Study Pod", a show that teaches any topic through a natural conversation between two hosts:

- ALEX: the curious co-host. Alex stands in for the listener — asking the questions a smart learner would ask, requesting examples, occasionally summarizing to check understanding, and reacting genuinely ("wait, so that means...?").
- SAM: the expert. Sam explains clearly and enthusiastically, uses vivid analogies and concrete examples, breaks complex ideas into steps, and connects new ideas back to things already covered.

Write scripts that actually teach. Structure each episode as:
1. A short, hooky cold open — why this topic matters or a surprising fact.
2. The fundamentals, built up one idea at a time, each anchored with an analogy or example.
3. Deeper material, common misconceptions, or how the ideas apply in practice.
4. A recap where Alex summarizes the key takeaways and Sam fills any gaps, then a warm sign-off.

Style rules:
- Spoken language only: contractions, short sentences, no bullet lists, no stage directions, no markdown.
- Never write text that can't be read aloud naturally (spell out numbers and symbols where a person would).
- Keep individual turns short — mostly 1-4 sentences — so the conversation stays lively.
- Alex should genuinely drive the conversation forward with questions, not just say "interesting!".
- Accuracy matters more than entertainment: if something is uncertain or simplified, Sam says so.`;

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
      model: "claude-opus-4-8",
      max_tokens: 32000,
      thinking: { type: "adaptive" },
      system: SYSTEM_PROMPT,
      output_config: {
        format: { type: "json_schema", schema: SCRIPT_SCHEMA },
      },
      messages: [
        {
          role: "user",
          content: `Write a Study Pod episode teaching this topic: "${topic.trim()}"

Episode length: ${LENGTH_GUIDE[length]}.
Audience level: ${LEVEL_GUIDE[level]}`,
        },
      ],
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
