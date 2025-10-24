const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
  try {
    const modPath = pathToFileURL(path.resolve(__dirname, '..', 'renderer', 'models', 'FloorPlan.js')).href;
    const mod = await import(modPath);
    const { FloorPlan } = mod;

    // Create a floorplan and add a coordinate-based area
    const fp = new FloorPlan('test');
    // area defined by coordinates, independent of wall nodes
    fp.areas.push({ id: 'a_test', label: 'test-area', vertices: [[10, 10], [20, 10], [20, 20]] });

    const json = fp.toJSON();
    // roundtrip
    const fp2 = FloorPlan.fromJSON(json);

    // ensure areas survived and are present
    assert(Array.isArray(json.areas) && json.areas.length > 0, 'serialized areas missing');
    assert(fp2.areas && fp2.areas.length > 0, 'deserialized areas missing');

    // ensure vertices preserved as coordinates or ids
    const v0 = fp2.areas[0].vertices[0];
    assert(Array.isArray(v0) && v0.length >= 2, 'vertex was not preserved as coordinates or node id');

    console.log('Serialization check passed.');
    process.exit(0);
  } catch (err) {
    console.error('Serialization check failed:', err);
    process.exit(2);
  }
})();
