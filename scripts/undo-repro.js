const path = require('path');
const { pathToFileURL } = require('url');

async function main() {
  const modPath = pathToFileURL(path.resolve(__dirname, '..', 'renderer', 'state', 'store.js')).href;
  const mod = await import(modPath);
  const { FloorPlanStore } = mod;

  const fpModPath = pathToFileURL(path.resolve(__dirname, '..', 'renderer', 'models', 'FloorPlan.js')).href;
  const fpMod = await import(fpModPath);
  const { FloorPlan } = fpMod;

  function dump(fp) {
    console.log('nodes:', fp.wall_graph.nodes.map(n => n.id));
    console.log('edges:', fp.wall_graph.edges.map(e => ({ id: e.id, v1: e.v1, v2: e.v2 })));
  }

  const store = new FloorPlanStore();
  const fp = new FloorPlan('test');
  store.add(fp);

  console.log('Initial');
  dump(store.active);

  // Add vertex A
  store.active.addVertex(10, 10);
  store.update(store.active);
  console.log('\nAfter add 1');
  dump(store.active);

  // Add vertex B
  store.active.addVertex(20, 10);
  store.update(store.active);
  console.log('\nAfter add 2');
  dump(store.active);

  // Add vertex C
  store.active.addVertex(20, 20);
  store.update(store.active);
  console.log('\nAfter add 3');
  dump(store.active);

  // Undo (should remove last addition)
  console.log('\nPerform undo');
  store.undo();
  dump(store.active);

  // Add a new vertex after undo — should connect to last remaining node
  console.log('\nAdd vertex after undo');
  store.active.addVertex(30, 30);
  store.update(store.active);
  dump(store.active);

  // Print final state counts
  console.log('\nFinal counts:', store.active.wall_graph.nodes.length, 'nodes,', store.active.wall_graph.edges.length, 'edges');
}

main().catch(err => { console.error(err); process.exit(2); });
