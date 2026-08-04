import axios from "axios";
import { env } from "../config/env.js";

const client = axios.create({
  baseURL: env.gatewayInternalUrl,
  timeout: 15_000,
  headers: { "X-Internal-Secret": env.internalSharedSecret },
});

export async function claimTask(taskId, workerAddr) {
  const { data } = await client.post(`/internal/tasks/${taskId}/claim`, { worker_addr: workerAddr });
  return data;
}

export async function updateStatus(taskId, patch) {
  await client.post(`/internal/tasks/${taskId}/status`, patch);
}

export async function appendAudit(taskId, stepIndex, type, payload = {}) {
  await client.post(`/internal/tasks/${taskId}/audit`, { step_index: stepIndex, type, payload });
}
