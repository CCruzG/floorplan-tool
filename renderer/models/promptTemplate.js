
export const floorplanPromptTemplate = `
Task: Refine the floor plan while preserving locked edges and boundary continuity.

Context:
- Schema version: {{schema_version}}
- Units: {{units.length}} ({{units_json}})
- Requirements: {{requirements}}
- Requirements: {{requirements}}
-- Natural language summary: {{requirements_text}}
-- Natural language summary: {{requirements_text}}
-- Feasibility: {{feasibility_summary}}
-- Feasibility details: {{feasibility_json}}

Current plan (JSON):
{{floorplan_json}}

Constraints:
- Do not modify edges with "locked": true.
- Maintain a closed boundary; no self-intersections.
- Snap vertices to multiples of 50mm.
- Preserve entrances; width may be adjusted ±150mm to meet requirements.

Output:
Return ONLY valid JSON matching this schema:
{
  "schema_version": "{{schema_version}}",
  "units": { "length": "m", "pxPerUnit": 1 },
  "wall_graph": {
    "nodes": [ { "id": "n_0", "x": 0.0, "y": 0.0 }, ... ],
    "edges": [ { "id": "e_0", "v1": "n_0", "v2": "n_1", "locked": false }, ... ]
  },
  "entrances": [ { "id": "entr_0", "edgeRef": "e_0", "position": { "x": 0.0, "y": 0.0 }, "width": 900 } ],
  "areas": [ { "id": "a_0", "label": "boundary", "vertices": [ "n_0", "n_1", "n_2" ] } ],
  "requirements": {{requirements_keys}}
}

Strict rules for the LLM output:
- Return JSON ONLY. Do not include any surrounding prose, explanation, or markdown.
- Include a top-level 'units' object with 'length' set to one of: "mm", "cm", "m" and a numeric 'pxPerUnit' giving pixels per unit.
- Coordinates must be given in the same units declared in 'units' (do not mix units).
- Every edge object must include 'id', 'v1', 'v2' and a boolean 'locked'.
- Every entrance item must include 'id', 'edgeRef' (the edge id it attaches to), 'position' with numeric 'x' and 'y', and numeric 'width' in the same units.
- Areas.vertices must be an array of node id strings (not raw coordinates) when the wall graph nodes are provided with ids.
- If you modify coordinates, preserve topology: node ids can be reused but their coordinates must reflect the updated positions consistently across 'wall_graph' and 'areas'.

If you cannot provide a fully schema-compliant JSON, return an empty JSON object so the app can report a validation error instead of a malformed payload.
`;
