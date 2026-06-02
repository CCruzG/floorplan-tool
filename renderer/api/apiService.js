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
 *   "cores":     [ { "Pt_0": [x, y, 0], "Pt_1": ..., ... }, ... ]   // optional
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
      translucent: e.translucent ?? true,
      openings:   e.openings ?? [],
    })),
  };

  // ── cores (schema 2.1.0) ─────────────────────────────────────────────────────
  // toJSON() now emits `cores` as an array of { closed, edges } objects (one per
  // disconnected core). Fall back to the legacy single-object { edges } shape.
  const rawCores = Array.isArray(planJson.cores)
    ? planJson.cores
    : (planJson.cores?.edges?.length ? [planJson.cores] : []);
  // BuildWeave expects cores as a list of polygons, each { edges: [...] }
  instance.cores = rawCores
    .filter(core => core?.edges?.length)
    .map(core => ({
      closed: core.closed ?? true,
      edges: core.edges.map(e => ({
        id: e.id,
        start:      { x: toMm(e.start.x), y: toMm(e.start.y) },
        end:        { x: toMm(e.end.x),   y: toMm(e.end.y) },
        translucent: e.translucent ?? false,
      })),
    }));

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

  // ── structural components (for reuse when skipping structural stage) ──────
  const rawColumns = Array.isArray(planJson.Columns) ? planJson.Columns : [];
  const columns = rawColumns
    .map((c) => {
      if (c && typeof c.x === 'number' && typeof c.y === 'number') {
        // Preserve the column footprint width (used by duct routing to keep
        // ducts out of columns). It shares the plan unit, like x/y.
        const col = { x: toMm(c.x), y: toMm(c.y) };
        if (Number.isFinite(c.width)) col.width = toMm(c.width);
        return col;
      }
      if (Array.isArray(c) && c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1])) {
        return { x: toMm(c[0]), y: toMm(c[1]) };
      }
      if (c && typeof c === 'object') {
        const polyPts = Object.keys(c)
          .filter(k => /^Pt_\d+$/.test(k))
          .sort((a, b) => parseInt(a.slice(3), 10) - parseInt(b.slice(3), 10))
          .map(k => c[k])
          .filter(v => Array.isArray(v) && Number.isFinite(v[0]) && Number.isFinite(v[1]));
        if (polyPts.length > 0) {
          const cx = polyPts.reduce((s, p) => s + p[0], 0) / polyPts.length;
          const cy = polyPts.reduce((s, p) => s + p[1], 0) / polyPts.length;
          return { x: toMm(cx), y: toMm(cy) };
        }
      }
      return null;
    })
    .filter(Boolean);

  const rawBeams = Array.isArray(planJson.Beams) ? planJson.Beams : [];
  const beams = rawBeams
    .map((b) => {
      if (b?.start && b?.end) {
        return {
          start: { x: toMm(b.start.x), y: toMm(b.start.y) },
          end: { x: toMm(b.end.x), y: toMm(b.end.y) },
        };
      }
      if (b && typeof b === 'object' && Array.isArray(b.Pt_0) && Array.isArray(b.Pt_1)) {
        return {
          start: { x: toMm(b.Pt_0[0]), y: toMm(b.Pt_0[1]) },
          end: { x: toMm(b.Pt_1[0]), y: toMm(b.Pt_1[1]) },
        };
      }
      return null;
    })
    .filter(Boolean);

  if (columns.length || beams.length) {
    instance.structural_components = {
      ...(instance.structural_components || {}),
      units: { length: 'mm' },
      columns,
      beams,
    };
  }

  // ── thermal zones (for reuse when skipping segmentation/zones stage) ──────
  const rawThermalZones = Array.isArray(planJson.thermal_zones) ? planJson.thermal_zones : [];
  if (rawThermalZones.length) {
    instance.thermal_zones = rawThermalZones.map(zone => ({
      ...zone,
      // Accept both backend keys and frontend aliases.
      thermal_region_geometry: ((zone.thermal_region_geometry || zone.subZones) || []).map(sub =>
        (sub || [])
          .map(pt => {
            if (!pt) return null;
            if (Number.isFinite(pt.x) && Number.isFinite(pt.y)) {
              return { x: pt.x, y: pt.y };
            }
            if (Array.isArray(pt) && Number.isFinite(pt[0]) && Number.isFinite(pt[1])) {
              return { x: pt[0], y: pt[1] };
            }
            return null;
          })
          .filter(Boolean)
      ),
      vav_control_zones: zone.vav_control_zones || zone.thermalControlZones || [],
    }));
  }

  // ── exclusion areas ───────────────────────────────────────────────────────
  // v2 toJSON() outputs 'exclusion_areas' (snake_case); fall back to PascalCase for legacy plans.
  const rawExclusionAreas = planJson.exclusion_areas ?? planJson.Exclusion_Areas;
  if (Array.isArray(rawExclusionAreas) && rawExclusionAreas.length) {
    instance.exclusion_areas = rawExclusionAreas.map(area => ({
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
 * Calls onUpdate(phase, data) whenever a phase key in `partial` has a new version,
 * whether the phase is still in progress or has just completed.
 *
 * @param {string}      jobId
 * @param {Function}    onUpdate  - (phase: string, data: object) => void
 * @param {number}      [interval=2000] poll interval ms
 * @param {AbortSignal} [signal]  - abort to stop polling (treated as cancellation)
 * @returns {Promise<{ ok: boolean, data?: object, error?: string }>}
 */
export async function pollOptimisation(jobId, onUpdate, interval = 2000, signal = null) {
  const versions = {};  // phase → last delivered version number

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

      // Deliver any phase whose partial data has a new version
      for (const [phase, val] of Object.entries(json.partial || {})) {
        if (typeof val?.v === 'number' && val.v !== versions[phase]) {
          versions[phase] = val.v;
          onUpdate(phase, val);
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
    // Poll once immediately so partial results are surfaced without initial delay.
    tick();
  });
}

/** @deprecated Use startOptimisation + pollOptimisation instead */
export async function runOptimisation(planJson, units, opts = {}) {
  const start = await startOptimisation(planJson, units, opts);
  if (!start.ok) return start;
  return pollOptimisation(start.job_id, () => {});
}

