// Shared between the Node server (server.js) and the browser (app.js, static mode).
// Keep this file dependency-free plain ESM.

export const MODEL = "claude-opus-4-8";
export const MAX_TOKENS = 32000;

export const LENGTH_GUIDE = {
  short: "about 5 minutes of listening — roughly 700–900 words of dialogue",
  medium: "about 10 minutes of listening — roughly 1,400–1,800 words of dialogue",
  long: "about 20 minutes of listening — roughly 2,800–3,600 words of dialogue",
};

export const LEVEL_GUIDE = {
  beginner:
    "The listener is completely new to this topic. Define every term, lean on everyday analogies, and avoid jargon.",
  intermediate:
    "The listener knows the basics. Skip introductory definitions, go deeper into mechanisms, trade-offs, and common misconceptions.",
  advanced:
    "The listener is experienced. Discuss nuances, edge cases, current debates, and connections to adjacent topics at a technical level.",
};

export const SCRIPT_SCHEMA = {
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

export const SYSTEM_PROMPT = `You are a podcast script writer for "Study Pod", a show that teaches any topic through a natural conversation between two hosts:

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

export function buildUserPrompt(topic, length, level) {
  return `Write a Study Pod episode teaching this topic: "${topic}"

Episode length: ${LENGTH_GUIDE[length]}.
Audience level: ${LEVEL_GUIDE[level]}`;
}
