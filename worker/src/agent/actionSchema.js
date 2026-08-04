export const ACTION_TOOLS = [
  {
    type: "function",
    function: {
      name: "navigate",
      description: "Navigate the browser to a URL",
      parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
    },
  },
  {
    type: "function",
    function: {
      name: "click",
      description: "Click an element by CSS selector",
      parameters: { type: "object", properties: { selector: { type: "string" } }, required: ["selector"] },
    },
  },
  {
    type: "function",
    function: {
      name: "type",
      description: "Type text into an input/textarea identified by CSS selector",
      parameters: {
        type: "object",
        properties: { selector: { type: "string" }, text: { type: "string" } },
        required: ["selector", "text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "type_credential",
      description:
        "Type the task's stored email or password into a field by CSS selector. You are never shown the " +
        "actual credential value — use this instead of `type` for login fields; the real value is substituted " +
        "server-side.",
      parameters: {
        type: "object",
        properties: { selector: { type: "string" }, field: { type: "string", enum: ["email", "password"] } },
        required: ["selector", "field"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "press_key",
      description: "Press a keyboard key (e.g. Enter, Tab, Escape)",
      parameters: { type: "object", properties: { key: { type: "string" } }, required: ["key"] },
    },
  },
  {
    type: "function",
    function: {
      name: "wait",
      description: "Wait for a number of milliseconds, e.g. for a page to settle",
      parameters: { type: "object", properties: { ms: { type: "number" } }, required: ["ms"] },
    },
  },
  {
    type: "function",
    function: {
      name: "extract",
      description: "Read and return the text content of an element, to use as part of the final result",
      parameters: { type: "object", properties: { selector: { type: "string" } }, required: ["selector"] },
    },
  },
  {
    type: "function",
    function: {
      name: "finish",
      description: "Stop: the goal is complete (or unrecoverably failed). Always call this to end the task.",
      parameters: {
        type: "object",
        properties: {
          success: { type: "boolean" },
          summary: { type: "string" },
          data: { type: "object" },
        },
        required: ["success", "summary"],
      },
    },
  },
];
