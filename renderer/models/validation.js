// import * as schemaModule from "./floorPlanSchema.js";
// const floorPlanSchema = schemaModule.floorPlanSchema;

// import { Validator } from "jsonschema";
// Lightweight runtime validator for the floorplan JSON structure.
// We avoid importing external JSON-schema libs in the renderer to keep
// the renderer bundle simple and avoid module resolution issues.
export function validateFloorPlan(plan) {
  const errors = [];
  function push(msg) { errors.push(msg); }

  if (!plan || typeof plan !== 'object') {
    return { ok: false, errors: ['Plan must be an object'] };
  }

  const required = ['schema_version', 'units', 'wall_graph', 'entrances', 'areas', 'requirements'];
  required.forEach(k => { if (!(k in plan)) push(`Missing required property: ${k}`); });

  // units.length must be one of mm|cm|m
  if (plan.units) {
    if (typeof plan.units !== 'object') push('units must be an object');
    else if (!['mm', 'cm', 'm'].includes(plan.units.length)) push("units.length must be one of 'mm','cm','m'");
  }

  // wall_graph nodes/edges
  if (plan.wall_graph) {
    if (!Array.isArray(plan.wall_graph.nodes)) push('wall_graph.nodes must be an array');
    else {
      plan.wall_graph.nodes.forEach((n, i) => {
        if (!n || typeof n !== 'object') push(`wall_graph.nodes[${i}] must be an object`);
        else {
          if (typeof n.id !== 'string') push(`wall_graph.nodes[${i}].id must be a string`);
          if (typeof n.x !== 'number') push(`wall_graph.nodes[${i}].x must be a number`);
          if (typeof n.y !== 'number') push(`wall_graph.nodes[${i}].y must be a number`);
        }
      });
    }
    if (!Array.isArray(plan.wall_graph.edges)) push('wall_graph.edges must be an array');
    else {
      plan.wall_graph.edges.forEach((e, i) => {
        if (!e || typeof e !== 'object') push(`wall_graph.edges[${i}] must be an object`);
        else {
          if (typeof e.id !== 'string') push(`wall_graph.edges[${i}].id must be a string`);
          if (typeof e.v1 !== 'string') push(`wall_graph.edges[${i}].v1 must be a string (node id)`);
          if (typeof e.v2 !== 'string') push(`wall_graph.edges[${i}].v2 must be a string (node id)`);
          if (typeof e.locked !== 'boolean') push(`wall_graph.edges[${i}].locked must be boolean`);
        }
      });
    }
  }

  // entrances
  if (plan.entrances) {
    if (!Array.isArray(plan.entrances)) push('entrances must be an array');
    else plan.entrances.forEach((ent, i) => {
      if (!ent || typeof ent !== 'object') push(`entrances[${i}] must be an object`);
      else {
        if (typeof ent.id !== 'string') push(`entrances[${i}].id must be a string`);
        if (typeof ent.edgeRef !== 'string') push(`entrances[${i}].edgeRef must be a string`);
        if (typeof ent.width !== 'number') push(`entrances[${i}].width must be a number`);
        if (!ent.position || typeof ent.position !== 'object') push(`entrances[${i}].position must be an object with x,y`);
        else {
          if (typeof ent.position.x !== 'number') push(`entrances[${i}].position.x must be a number`);
          if (typeof ent.position.y !== 'number') push(`entrances[${i}].position.y must be a number`);
        }
      }
    });
  }

  // areas
  if (plan.areas) {
    if (!Array.isArray(plan.areas)) push('areas must be an array');
    else plan.areas.forEach((a, i) => {
      if (!a || typeof a !== 'object') push(`areas[${i}] must be an object`);
      else {
        if (typeof a.id !== 'string') push(`areas[${i}].id must be a string`);
        if (typeof a.label !== 'string') push(`areas[${i}].label must be a string`);
        if (!Array.isArray(a.vertices)) push(`areas[${i}].vertices must be an array`);
        else a.vertices.forEach((v, j) => { if (typeof v !== 'string') push(`areas[${i}].vertices[${j}] must be a node id string`); });
      }
    });
  }

  // requirements must be an object
  if ('requirements' in plan && (typeof plan.requirements !== 'object' || Array.isArray(plan.requirements))) push('requirements must be an object');

  return errors.length ? { ok: false, errors } : { ok: true, errors: [] };
}
