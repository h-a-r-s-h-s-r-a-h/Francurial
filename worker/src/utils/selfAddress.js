import os from "os";
import { env } from "../config/env.js";

/**
 * Resolves the address (ip:port) this worker registers with the gateway so
 * live-view WS connections can be proxied to the exact pod/container running
 * a given task. POD_IP (k8s downward API) wins; otherwise pick the first
 * non-internal IPv4 interface, which is what docker-compose containers get
 * on their bridge network.
 */
export function getSelfAddress() {
  const ip = env.podIp || firstNonInternalIPv4();
  if (!ip) {
    throw new Error("could not determine a routable IP for this worker (set POD_IP)");
  }
  return `${ip}:${env.workerInternalPort}`;
}

function firstNonInternalIPv4() {
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) {
        return entry.address;
      }
    }
  }
  return null;
}
