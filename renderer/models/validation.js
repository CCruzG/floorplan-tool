// import * as schemaModule from "./floorPlanSchema.js";
// const floorPlanSchema = schemaModule.floorPlanSchema;

// import { Validator } from "jsonschema";
import { floorPlanSchema } from "./floorPlanSchema.js";

// const v = new Validator()

export function validateFloorPlan(planJson) {
  const result = v.validate(planJson, floorPlanSchema);
  return result.valid
  ? { ok: true, errors: [] }
    : { ok: false, errors: result.errors.map(e => e.stack) };
}
