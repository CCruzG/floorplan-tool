// renderer/models/floorPlanSchema.js
export const floorPlanSchema = {
  type: "object",
  required: ["schema_version", "units", "wall_graph", "entrances", "areas", "requirements"],
  properties: {
    schema_version: { type: "string" },
    units: {
      type: "object",
      required: ["length"],
      properties: {
        length: { type: "string", enum: ["mm", "cm", "m"] }
      }
    },
    wall_graph: {
      type: "object",
      required: ["nodes", "edges"],
      properties: {
        nodes: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "x", "y"],
            properties: {
              id: { type: "string" },
              x: { type: "number" },
              y: { type: "number" }
            },
            additionalProperties: false
          }
        },
        edges: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "v1", "v2", "locked"],
            properties: {
              id: { type: "string" },
              v1: { type: "string" }, // node ID
              v2: { type: "string" }, // node ID
              locked: { type: "boolean" }
            },
            additionalProperties: false
          }
        }
      },
      additionalProperties: false
    },
    entrances: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "position", "edgeRef", "width"],
        properties: {
          id: { type: "string" },
          edgeRef: { type: "string" }, // edge ID
          width: { type: "number" },
          position: {
            type: "object",
            required: ["x", "y"],
            properties: {
              x: { type: "number" },
              y: { type: "number" }
            },
            additionalProperties: false
          }
        },
        additionalProperties: false
      }
    },
    areas: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "label", "vertices"],
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          vertices: {
            type: "array",
            items: { type: "string" } // node IDs
          }
        },
        additionalProperties: false
      }
    },
    requirements: {
      type: "object",
      additionalProperties: true
    }
  },
  additionalProperties: false
};