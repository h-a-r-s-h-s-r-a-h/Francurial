const REDACT_KEYS = new Set(["password", "email", "username", "credentials", "proxy"]);

export function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = REDACT_KEYS.has(k.toLowerCase()) ? "***redacted***" : redact(v);
    }
    return out;
  }
  return value;
}

function log(level, msg, meta) {
  const entry = { level, msg, ts: new Date().toISOString() };
  if (meta) entry.meta = redact(meta);
  console.log(JSON.stringify(entry));
}

export const logger = {
  info: (msg, meta) => log("info", msg, meta),
  warn: (msg, meta) => log("warn", msg, meta),
  error: (msg, meta) => log("error", msg, meta),
};
