import { asImageWorkflowError } from "../util/errors.mjs";

const SCHEDULER_IDLE_MS = 25;

export function isRetryable(error) {
  if (error?.code === "TIMEOUT" || error?.code === "NETWORK_ERROR") return true;
  return [408, 409, 425, 429, 500, 502, 503, 504, 524].includes(error?.status);
}

export function isWorkerFatal(error) {
  return [401, 403].includes(error?.status) || /api key|authentication|unauthorized/i.test(error?.message || "");
}

export async function runWorkerQueue(workers, tasks, options) {
  const enabledWorkers = workers.filter((worker) => worker.enabled !== false && worker.apiKey);
  const sessions = enabledWorkers.map((worker) => ({ worker, busy: false, disabledUntil: 0, fatal: false, used: false, stats: { assigned: 0, success: 0, failed: 0, retries: 0, cooldowns: 0, fatalErrors: 0, lastError: null } }));
  const states = tasks.map((payload, index) => ({ index, payload, attempts: 0, retries: 0, done: false, running: false, readyAt: 0, result: null }));
  const total = states.length;
  const concurrency = Math.max(1, Math.min(Number(options.concurrency) || 1, enabledWorkers.length || 1, total || 1));
  const maxRetries = Number(options.maxRetries ?? 3);
  let retryCount = 0;
  let peakConcurrency = 0;
  let active = 0;
  let exhaustedReason = null;
  const groupWorkers = new Map();
  const runningGroups = new Set();

  if (enabledWorkers.length === 0) {
    return buildReport(states, sessions, { retryCount, peakConcurrency, exhaustedReason: "没有可用 Worker。" });
  }

  function availableSession(state) {
    const now = Date.now();
    return sessions.find((session) => !session.busy && !session.fatal && session.disabledUntil <= now) || null;
  }

  function takeWork() {
    const now = Date.now();
    for (const state of states) {
      if (state.done || state.running || state.readyAt > now) continue;
      const groupKey = state.payload.groupKey;
      if (groupKey && runningGroups.has(groupKey)) continue;
      const preferred = groupKey ? groupWorkers.get(groupKey) : null;
      const session = preferred && !preferred.busy && !preferred.fatal && preferred.disabledUntil <= now ? preferred : availableSession(state);
      if (!session) return null;
      if (groupKey) groupWorkers.set(groupKey, session);
      return { state, session };
    }
    return null;
  }

  async function dispatcher() {
    while (true) {
      if (states.every((state) => state.done)) return;
      const assignment = takeWork();
      if (!assignment) {
        const potential = sessions.some((session) => !session.fatal);
        if (!potential && !states.some((state) => state.running)) {
          exhaustedReason ||= "所有 Worker 都不可用。";
          return;
        }
        await sleep(SCHEDULER_IDLE_MS);
        continue;
      }
      const { state, session } = assignment;
      const groupKey = state.payload.groupKey;
      state.running = true;
      session.busy = true;
      session.used = true;
      session.stats.assigned += 1;
      state.attempts += 1;
      active += 1;
      peakConcurrency = Math.max(peakConcurrency, active);
      if (groupKey) runningGroups.add(groupKey);
      options.onTaskStart?.(state.payload, { index: state.index, total, worker: session.worker, attempt: state.attempts });
      let result;
      try {
        result = await options.runTask(session.worker, state.payload, { index: state.index, total, attempt: state.attempts });
      } catch (error) {
        result = { ok: false, error: asImageWorkflowError(error) };
      }
      active -= 1;
      state.running = false;
      session.busy = false;
      if (groupKey) runningGroups.delete(groupKey);
      if (result?.ok) {
        session.stats.success += 1;
        state.done = true;
        state.result = { ...result, workerId: session.worker.id, workerName: session.worker.name, attempts: state.attempts, retries: state.retries };
        options.onTaskComplete?.(state.payload, state.result, { index: state.index, total, worker: session.worker });
        continue;
      }
      const error = asImageWorkflowError(result?.error || new Error("未知请求错误"));
      session.stats.failed += 1;
      session.stats.lastError = error.message;
      const workerFatal = isWorkerFatal(error);
      const retryable = isRetryable(error);
      if (workerFatal) {
        session.fatal = true;
        session.stats.fatalErrors += 1;
        if (groupKey) groupWorkers.delete(groupKey);
      } else if (retryable && options.adaptive !== false) {
        session.disabledUntil = Date.now() + (error.retryAfterMs || options.cooldownMs || 60000);
        session.stats.cooldowns += 1;
      }
      const canRetry = (retryable || workerFatal) && state.retries < maxRetries && sessions.some((candidate) => !candidate.fatal);
      if (canRetry) {
        state.retries += 1;
        retryCount += 1;
        session.stats.retries += 1;
        state.readyAt = Date.now() + (options.adaptive === false ? error.retryAfterMs || options.retryDelayMs || 15000 : 0);
        continue;
      }
      state.done = true;
      state.result = { ok: false, error: error.message, code: error.code, status: error.status, workerId: session.worker.id, workerName: session.worker.name, attempts: state.attempts, retries: state.retries };
      options.onTaskComplete?.(state.payload, state.result, { index: state.index, total, worker: session.worker });
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => dispatcher()));
  for (const state of states) {
    if (!state.done) state.result = { ok: false, error: exhaustedReason || "任务未启动", skipped: true };
  }
  return buildReport(states, sessions, { retryCount, peakConcurrency, exhaustedReason });
}

function buildReport(states, sessions, extra) {
  const results = states.map((state) => state.result || { ok: false, error: extra.exhaustedReason || "任务未启动", skipped: true });
  const success = results.filter((item) => item.ok).length;
  return {
    total: results.length,
    success,
    failed: results.length - success,
    results,
    retryCount: extra.retryCount,
    peakConcurrency: extra.peakConcurrency,
    exhaustedReason: extra.exhaustedReason,
    workerStats: sessions.map((session) => ({ id: session.worker.id, name: session.worker.name, ...session.stats })),
    exitCode: success === results.length ? 0 : 1,
  };
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
