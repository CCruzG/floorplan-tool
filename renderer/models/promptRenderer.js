// renderer/models/promptRenderer.js
import { floorplanPromptTemplate } from './promptTemplate.js';

export function renderPrompt(fp) {
  const requirements = JSON.stringify(fp.requirements, null, 2);
  const floorplanJson = JSON.stringify(fp.toJSON(), null, 2);
  // Build a concise human-readable requirements summary to guide the AI.
  const req = fp.requirements || {};
  const parts = [];
  if (typeof req.bedrooms === 'number') parts.push(`${req.bedrooms} bedroom(s)`);
  if (typeof req.bathrooms === 'number') parts.push(`${req.bathrooms} bathroom(s)`);
  if (req.openKitchen) parts.push('open-plan kitchen');
  if (req.balcony) parts.push('balcony desired');
  if (req.style) parts.push(`style: ${req.style}`);
  if (req.notes) parts.push(`notes: ${req.notes}`);
  const requirementsText = parts.length ? parts.join('; ') : 'No specific requirements provided.';

  // Evaluate feasibility and produce a short summary
  let feasibilitySummary = 'No feasibility data available.';
  let feasibilityReport = {};
  try {
    // try commonjs require (Node/Electron environment)
    // eslint-disable-next-line global-require
    const evaluator = require('./requirementsEvaluator.js');
    const report = evaluator.evaluateRequirements(fp);
    feasibilityReport = report || {};
    feasibilitySummary = report.summary + ' Suggestions: ' + (report.suggestions || []).slice(0,3).join('; ');
  } catch (err) {
    // ignore if evaluator not available
  }

  return floorplanPromptTemplate
    .replace('{{schema_version}}', fp.schema_version)
    .replace('{{units.length}}', fp.units.length)
    .replace('{{units_json}}', JSON.stringify(fp.units || {}))
    .replace('{{requirements}}', requirements)
    .replace('{{requirements_text}}', requirementsText)
    .replace('{{feasibility_summary}}', feasibilitySummary)
    .replace('{{feasibility_json}}', JSON.stringify(feasibilityReport || {}))
    .replace('{{floorplan_json}}', floorplanJson)
    .replace('{{requirements_keys}}', JSON.stringify(fp.requirements || {}));
}
