import axios from "axios";
import { env } from "../config/env.js";
import { ACTION_TOOLS } from "./actionSchema.js";

const SYSTEM_PROMPT = `You are a browser automation agent. You are given a goal and the current
state of a web page (URL, title, and a list of visible interactive elements
with CSS selectors). Call exactly one tool per turn to make progress toward
the goal. Re-read the element list every turn — it reflects the page's
CURRENT state, not a cached plan, so re-select elements fresh each time
rather than assuming a selector from a previous turn still applies.

You are never shown the task's actual login email/password. When a login
form needs them, use type_credential(selector, field) instead of type() —
the real value is substituted outside your context.

Rules:
- Never call finish(success=true) until the goal is actually achieved.
- If the instruction says to stop short of a final action (e.g. "without
  confirming the final purchase"), stop there and call finish(success=true)
  once everything up to that point is done.
- If you are stuck in a loop or the page is in an unexpected state, call
  finish(success=false, summary=...) rather than repeating the same action.`;

export async function reason({ goal, observation, history, model, credentialFieldsAvailable }) {
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: JSON.stringify({
        goal,
        current_page: { url: observation.url, title: observation.title },
        visible_elements: observation.elements,
        recent_history: history.slice(-8),
        credential_fields_available: credentialFieldsAvailable, // e.g. ["email","password"]
      }),
    },
  ];

  const { data } = await axios.post(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      model,
      messages,
      tools: ACTION_TOOLS,
      tool_choice: "required",
    },
    {
      headers: {
        Authorization: `Bearer ${env.openrouterKey}`,
        "Content-Type": "application/json",
      },
      timeout: 60_000,
    }
  );

  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall) {
    return { name: "finish", args: { success: false, summary: "model returned no tool call" } };
  }

  let args;
  try {
    args = JSON.parse(toolCall.function.arguments);
  } catch {
    args = {};
  }
  return { name: toolCall.function.name, args };
}
