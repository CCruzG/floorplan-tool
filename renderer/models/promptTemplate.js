
export const floorplanPromptTemplate = `
Task: Refine the floor plan while preserving locked edges and boundary continuity.

Context:
- Schema version: {{schema_version}}
- Units: {{units.length}}
- Requirements: {{requirements}}

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
  "wall_graph": { "nodes": [...], "edges": [...] },
  "entrances": [...],
  "areas": [...],
  "requirements": {{requirements_keys}}
}
`;
