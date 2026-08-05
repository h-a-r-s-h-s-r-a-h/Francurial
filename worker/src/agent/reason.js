import axios from "axios";
import { env } from "../config/env.js";
import { ACTION_TOOLS } from "./actionSchema.js";

const SYSTEM_PROMPT = `You are a browser automation agent. You are given a goal and the current
state of a web page (URL, title, a list of visible interactive elements, and
page_text_matches — readable text already found on THIS page that looks like
what you're looking for, e.g. prices). Call exactly one tool per turn to make
progress toward the goal. Re-read the element list every turn — it reflects
the page's CURRENT state, not a cached plan, so re-select elements fresh each
time rather than assuming a selector from a previous turn still applies.

Before doing anything else each turn: check page_text_matches and
visible_elements for whether the CURRENT page already answers the goal or
completes the task (this includes the very first page — if the goal is
answerable from the home page, don't navigate anywhere else). If it does,
call finish(success=true) immediately with the answer in summary/data —
do not keep browsing, clicking into other pages, or looking for
confirmation once you already have it. Only navigate to another page when
the current one genuinely does not contain the answer.

type_credential(selector, field) only works for fields listed in
credential_fields_available — it substitutes a value that was stored
server-side outside your context, and you are never shown that value.
If credential_fields_available is EMPTY (no structured credentials were
provided for this task) but the goal text itself already contains a
literal email/password to use, that value is already visible to you right
here in the goal — use type(selector, text) with that literal value
instead. Calling type_credential when the field isn't in
credential_fields_available will always fail; do not call it in that case.

Rules:
- On a login/signup form: once every required field's "text" in
  visible_elements shows it already holds a value (non-empty, or "[hidden]"
  for a filled password field), STOP typing — your next action must be
  clicking the submit/sign-in button, not re-typing into fields that are
  already filled. Re-typing an already-filled field accomplishes nothing.
- If your last 2+ actions were the exact same action+selector and ALL
  failed with the same error, STOP retrying it — call finish(success=false)
  explaining what's blocking you. Do not attempt it a 3rd time hoping it
  works; nothing about the situation has changed.
- Selectors MUST be copied verbatim from visible_elements' "selector" field.
  Never construct or guess a selector yourself (e.g. never invent
  "tag:nth-of-type(N)") — if the element you want isn't in the list, it
  isn't currently visible/selectable, so pick a different action instead.
- Check recent_history before acting: if your last action on this exact
  selector just failed (error/timeout present), do NOT repeat it — the
  element is wrong or gone. Pick a different element or action instead.
- Check recent_history before acting, even when actions are succeeding: if
  you've already clicked or extracted the SAME selector 2+ times in recent
  history, stop — you already have what it produces. If that gave you the
  information the goal asked for, call finish now instead of repeating it.
- A login/signup popup that isn't required for the goal (you weren't asked
  to log in, or no credentials were provided) is an obstacle, not a
  blocker: look for a close/dismiss/"X" control in visible_elements and
  click it, then continue toward the goal as a guest.
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
        page_text_matches: observation.textMatches,
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
