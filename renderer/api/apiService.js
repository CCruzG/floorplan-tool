/**
 * apiService.js
 *
 * Handles communication between the Electron renderer and the BuildWeave
 * Flask optimisation server (default: http://localhost:5001).
 *
 * Public API
 * ----------
 * checkHealth()             → Promise<boolean>
 * runOptimisation(fp, opts) → Promise<{ ok, data?, error? }>
 */

const API_BASE = 'http://127.0.0.1:5001';

// ── coordinate helpers ───────────────────────────────────────────────────────

// ── instance builder ─────────────────────────────────────────────────────────

/**
 * Convert a FloorPlan.toJSON() snapshot into the BuildWeave instance format.
 *
 * BuildWeave instance shape (minimum required):
 * {
 *   "boundary": [ { "start": [x, y, 0], "end": [x, y, 0], "open": true }, ... ],
 *   "core":     [ { "Pt_0": [x, y, 0], "Pt_1": ..., ... }, ... ]   // optional
 * }
 *
 * Coordinates must be in millimetres.
 *
 * @param {object} planJson - result of FloorPlan.toJSON()
 * @param {object} units    - { length: 'm'|'mm'|..., pxPerUnit: number }
 * @returns {object} BuildWeave instance JSON
 */
export function floorplanToInstance(planJson, units) {
  const { length: unitLength = 'm' } = units || {};

  const instance = {};

  // ── FloorPlan.toJSON() outputs schema 2.0.0. Coordinates are in plan units.
  // Convert all coordinates to mm using the plan unit (length field).
  const mmPerUnit = { mm: 1, cm: 10, m: 1000, 'in': 25.4, ft: 304.8 }[unitLength] ?? 1000;
  const toMm = v => v * mmPerUnit;

  // ── boundary (schema 2.0.0) ───────────────────────────────────────────────────
  const rawBoundary = planJson.boundary ?? {};
  instance.boundary = {
    closed: rawBoundary.closed ?? true,
    edges: (rawBoundary.edges ?? []).map(e => ({
      id: e.id,
      start:      { x: toMm(e.start.x), y: toMm(e.start.y) },
      end:        { x: toMm(e.end.x),   y: toMm(e.end.y) },
      translucent: e.translucent ?? false,
      openings:   e.openings ?? [],
    })),
  };

  // ── core (schema 2.0.0) ──────────────────────────────────────────────────────
  const rawCore = planJson.core ?? {};
  // BuildWeave expects core as a list of polygons, each { edges: [...] }
  instance.core = rawCore.edges?.length
    ? [{
        edges: (rawCore.edges).map(e => ({
          id: e.id,
          start:      { x: toMm(e.start.x), y: toMm(e.start.y) },
          end:        { x: toMm(e.end.x),   y: toMm(e.end.y) },
          translucent: e.translucent ?? false,
        })),
      }]
    : [];

  // ── grid_points (schema 2.0.0) ──────────────────────────────────────────────
  // Pass through to server; server builds points/edges/discretizedSize from these.
  instance.grid_points = (planJson.grid_points ?? []).map(p => ({
    id: p.id,
    x: toMm(p.x),
    y: toMm(p.y),
    column:     p.column     ?? true,
    mechanical: p.mechanical ?? true,
    entryPoint: p.entryPoint ?? false,
  }));

  // ── exclusion areas ───────────────────────────────────────────────────────
  if (Array.isArray(planJson.Exclusion_Areas) && planJson.Exclusion_Areas.length) {
    instance.exclusion_areas = planJson.Exclusion_Areas.map(area => ({
      vertices: (area.vertices ?? []).map(([x, y]) => [toMm(x), toMm(y), 0]),
      label: area.label ?? 'exclusion',
    }));
  }

  // ── entrances ─────────────────────────────────────────────────────────────
  if (Array.isArray(planJson.entrances) && planJson.entrances.length) {
    instance.entrances = planJson.entrances.map(ent => {
      const pos = ent.position;
      const x = Array.isArray(pos) ? pos[0] : pos.x;
      const y = Array.isArray(pos) ? pos[1] : pos.y;
      return { position: [toMm(x), toMm(y), 0], width: ent.width ?? 900 };
    });
  }

  // ── required wrapper fields (new in feat/gui_input) ──────────────────────
  // load_data() asserts these keys exist before merging structural/mechanical data.
  if (!instance.structural_components) instance.structural_components = {};
  if (!instance.mechanical_components) instance.mechanical_components = {};

  return instance;
}

// ── API calls ─────────────────────────────────────────────────────────────────

/**
 * Ping the server. Returns true if the server responds.
 * @returns {Promise<boolean>}
 */
export async function checkHealth() {
  try {
    const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Start an async optimisation job and return the job_id.
 *
 * @param {object} planJson  - result of FloorPlan.toJSON()
 * @param {object} units     - { length, pxPerUnit }
 * @param {object} [opts]
 * @param {string[]} [opts.phases]
 * @param {object}  [opts.config]
 * @returns {Promise<{ ok: boolean, job_id?: string, error?: string }>}
 */
export async function startOptimisation(planJson, units, opts = {}) {
  const instance = floorplanToInstance(planJson, units);

  const body = { instance };
  if (opts.phases) body.phases = opts.phases;
  if (opts.config)  body.config  = opts.config;

  try {
    const res = await fetch(`${API_BASE}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) return { ok: false, error: json.error ?? `HTTP ${res.status}` };
    return { ok: true, job_id: json.job_id };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Request cancellation of a running job.
 * The server will stop before the next phase starts.
 *
 * @param {string} jobId
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function cancelOptimisation(jobId) {
  try {
    const res = await fetch(`${API_BASE}/cancel/${jobId}`, {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
    });
    const json = await res.json();
    return json;
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Poll a job until it completes or errors.
 * Calls onPhase(phaseName, partialData) each time a new phase finishes.
 *
 * @param {string}      jobId
 * @param {Function}    onPhase   - (phase: string, partial: object) => void
 * @param {number}      [interval=2000] poll interval ms
 * @param {AbortSignal} [signal]  - abort to stop polling (treated as cancellation)
 * @returns {Promise<{ ok: boolean, data?: object, error?: string }>}
 */
export async function pollOptimisation(jobId, onPhase, interval = 2000, signal = null) {
  const seen = new Set();

  return new Promise((resolve) => {
    let timeoutHandle = null;

    const stop = (result) => {
      if (timeoutHandle !== null) clearTimeout(timeoutHandle);
      resolve(result);
    };

    if (signal) {
      signal.addEventListener('abort', () => stop({ ok: false, error: 'Cancelled' }), { once: true });
    }

    const tick = async () => {
      if (signal?.aborted) return;
      let json;
      try {
        const res = await fetch(`${API_BASE}/status/${jobId}`, { signal: AbortSignal.timeout(5000) });
        json = await res.json();
      } catch (err) {
        if (signal?.aborted) return;
        // transient network error — keep polling
        timeoutHandle = setTimeout(tick, interval);
        return;
      }

      // Deliver any newly completed phases
      for (const phase of (json.phases_done || [])) {
        if (!seen.has(phase)) {
          seen.add(phase);
          onPhase(phase, (json.partial || {})[phase] || {});
        }
      }

      if (json.status === 'done') {
        stop({ ok: true, data: json.result });
      } else if (json.status === 'error') {
        // Surface cancellation cleanly
        const cancelled = json.error === 'Cancelled by user';
        stop({ ok: false, error: json.error ?? 'Unknown error', cancelled });
      } else {
        timeoutHandle = setTimeout(tick, interval);
      }
    };
    setTimeout(tick, interval);
  });
}

/** @deprecated Use startOptimisation + pollOptimisation instead */
export async function runOptimisation(planJson, units, opts = {}) {
  const start = await startOptimisation(planJson, units, opts);
  if (!start.ok) return start;
  return pollOptimisation(start.job_id, () => {});
}
