const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
  try {
    const modUrl = name => pathToFileURL(path.resolve(__dirname, '..', 'renderer', name)).href;
    const { FloorPlan } = await import(modUrl('models/FloorPlan.js'));
    const { floorplanToInstance } = await import(modUrl('api/apiService.js'));

    // ── FloorPlan roundtrip (schema 2.0.0) ────────────────────────────────────
    const fp = new FloorPlan('test');
    const json = fp.toJSON();
    const fp2 = FloorPlan.fromJSON(json);
    assert(typeof json.schema_version === 'string', 'missing schema_version');
    assert(fp2 instanceof FloorPlan, 'roundtrip did not produce a FloorPlan');

    // ── mechanical serialisation (reverse-solve input) ────────────────────────
    // The structural solver can only run mechanical→structural if the frontend
    // puts the existing duct plan — ducts AND the VAV boxes nested per riser —
    // onto instance.mechanical_components.duct_plan. toJSON() nests the plan under
    // mechanical_components.duct_plan (there is no top-level Duct_Plan in 2.0.0),
    // so floorplanToInstance must read it from there or the solver sees nothing.
    const fpm = new FloorPlan('mech');
    fpm.Duct_Plan = [
      { entryPoint: 'pt_0', ducts: [[0, 1, 3.2], [1, 1, 2.4]], vav: [[0, 45.0], [1, 30.0]] },
    ];
    const mechJson = fpm.toJSON();
    assert(Array.isArray(mechJson.mechanical_components?.duct_plan)
      && mechJson.mechanical_components.duct_plan.length > 0,
      'Duct_Plan dropped by FloorPlan.toJSON()');

    const inst = floorplanToInstance(mechJson, { length: 'm' });
    const plan = inst.mechanical_components && inst.mechanical_components.duct_plan;
    assert(Array.isArray(plan) && plan.length > 0,
      'mechanical_components.duct_plan is empty — solver would not see the ducts');
    assert(Array.isArray(plan[0].vav) && plan[0].vav.length > 0,
      'VAV boxes not carried on the duct plan — solver would not see the VAVs');

    // Guard: with no duct plan, nothing spurious is sent (structural→HVAC run).
    const empty = floorplanToInstance(new FloorPlan('empty').toJSON(), { length: 'm' });
    assert(empty.mechanical_components && empty.mechanical_components.duct_plan === undefined,
      'empty plan should not attach a duct_plan');

    // ── real saved plans (optional) ───────────────────────────────────────────
    // Run against ../../examples if present (real duct runs, not synthetic).
    // Those files live outside the repo, so skip silently when absent.
    const examplesDir = path.resolve(__dirname, '..', '..', 'examples');
    if (fs.existsSync(examplesDir)) {
      let checked = 0;
      for (const f of fs.readdirSync(examplesDir).filter(n => n.endsWith('.json'))) {
        const raw = JSON.parse(fs.readFileSync(path.join(examplesDir, f), 'utf8'));
        const savedRisers = raw.mechanical_components?.duct_plan?.length ?? 0;
        if (!savedRisers) continue;  // only assert on plans that have a duct run
        // App path: Open (fromJSON) → Optimise (toJSON) → instance.
        const loaded = FloorPlan.fromJSON(raw);
        const sent = floorplanToInstance(loaded.toJSON(), raw.units || { length: 'm' })
          .mechanical_components?.duct_plan ?? [];
        assert.strictEqual(sent.length, savedRisers,
          `${f}: ${savedRisers} risers saved but ${sent.length} reached the instance`);
        assert(sent.every(r => Array.isArray(r.vav) && r.vav.length > 0),
          `${f}: a riser lost its VAV boxes on the way to the instance`);
        checked++;
      }
      if (checked) console.log(`Real-plan check passed (${checked} plan(s) with duct runs).`);
    }

    // ── deleteSegment: a boundary wall opens the loop; its endpoints survive ───
    const fpd = new FloorPlan('del');
    const a = fpd.addNode(0, 0), b = fpd.addNode(100, 0), c = fpd.addNode(50, 80);
    fpd.addEdge(a, b); fpd.addEdge(b, c); fpd.addEdge(c, a);
    for (const e of fpd.wall_graph.edges) e.wallType = 'boundary';
    fpd.boundaryClosed = true;
    fpd.boundaryArea = { id: 'boundary_0', label: 'boundary', vertices: [a, b, c] };
    fpd.deleteSegment(0);                       // remove edge a–b
    assert.strictEqual(fpd.wall_graph.edges.length, 2, 'deleteSegment should drop one edge');
    assert.strictEqual(fpd.wall_graph.nodes.length, 3, 'boundary endpoints should survive (still used by neighbours)');
    assert.strictEqual(fpd.boundaryClosed, false, 'deleting a boundary wall should open the loop');
    assert.strictEqual(fpd.boundaryArea, null, 'stale boundaryArea should be cleared');

    // a non-boundary wall between otherwise-unused nodes takes its nodes with it
    const p1 = fpd.addNode(200, 200), p2 = fpd.addNode(300, 200);
    const pe = fpd.addEdge(p1, p2);
    fpd.wall_graph.edges.find(e => e.id === pe).wallType = 'partition';
    const nBefore = fpd.wall_graph.nodes.length;
    fpd.deleteSegment(fpd.wall_graph.edges.findIndex(e => e.id === pe));
    assert.strictEqual(fpd.wall_graph.nodes.length, nBefore - 2, 'orphaned partition nodes should be removed');
    console.log('deleteSegment check passed.');

    console.log('Serialization check passed.');
    process.exit(0);
  } catch (err) {
    console.error('Serialization check failed:', err);
    process.exit(2);
  }
})();
