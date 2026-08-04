export const env = {
  redisUrl: process.env.REDIS_URL || "redis://localhost:6379/0",
  gatewayInternalUrl: process.env.GATEWAY_INTERNAL_URL || "http://localhost:8000",
  internalSharedSecret: process.env.INTERNAL_SHARED_SECRET || "",
  workerInternalPort: parseInt(process.env.WORKER_INTERNAL_PORT || "9000", 10),
  podIp: process.env.POD_IP || null,

  openrouterKey: process.env.OPENROUTER_KEY || "",
  defaultModel: process.env.MODEL || "openai/gpt-5.4-nano",

  maxAgentSteps: parseInt(process.env.MAX_AGENT_STEPS || "40", 10),
  captchaSolveAttempts: parseInt(process.env.CAPTCHA_SOLVE_ATTEMPTS || "2", 10),
  concurrency: parseInt(process.env.WORKER_CONCURRENCY || "1", 10),
};
