// renderer/models/promptRenderer.js
import { floorplanPromptTemplate } from './promptTemplate.js';

export function renderPrompt(fp) {
  const requirements = JSON.stringify(fp.requirements, null, 2);
  const floorplanJson = JSON.stringify(fp.toJSON(), null, 2);

  return floorplanPromptTemplate
    .replace('{{schema_version}}', fp.schema_version)
    .replace('{{units.length}}', fp.units.length)
    .replace('{{requirements}}', requirements)
    .replace('{{floorplan_json}}', floorplanJson)
    .replace('{{requirements_keys}}', JSON.stringify(Object.keys(fp.requirements)));
}
