// renderer/help/markdown.js
// Minimal Markdown → sections renderer for the in-app manual (guide.md).
// Deliberately tiny: it supports only what the manual uses — `## ` section
// headings, paragraphs, `- ` bullet lists, `> ` tip callouts, `**bold**` and
// `` `code` ``. Not a general Markdown engine; if the manual ever needs tables,
// images or nested lists, reach for a real library instead of growing this.

function slug(t) {
  return t.toLowerCase().replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '');
}

function inline(s) {
  return s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+?)`/g, '<code>$1</code>');
}

// Parse Markdown into [{ id, title, html }], one entry per `## ` heading.
// Content before the first `## ` (e.g. an H1 title) is ignored.
export function mdToSections(md) {
  const sections = [];
  let cur = null;
  let para = [];
  let list = [];
  let tip = [];
  const flushPara = () => { if (para.length) { cur.html += `<p>${inline(para.join(' '))}</p>`; para = []; } };
  const flushList = () => { if (list.length) { cur.html += `<ul>${list.map((li) => `<li>${inline(li)}</li>`).join('')}</ul>`; list = []; } };
  const flushTip = () => { if (tip.length) { cur.html += `<div class="tip">${inline(tip.join(' '))}</div>`; tip = []; } };
  const flushAll = () => { flushPara(); flushList(); flushTip(); };

  for (const raw of md.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    const heading = line.match(/^##\s+(.*)$/);
    if (heading) {
      if (cur) { flushAll(); sections.push(cur); }
      cur = { id: slug(heading[1]), title: heading[1].trim(), html: '' };
      continue;
    }
    if (!cur) continue; // skip anything before the first `## ` section
    if (/^-\s+/.test(line)) { flushPara(); flushTip(); list.push(line.replace(/^-\s+/, '')); continue; }
    if (/^>\s?/.test(line)) { flushPara(); flushList(); tip.push(line.replace(/^>\s?/, '')); continue; }
    if (line.trim() === '') { flushAll(); continue; }
    flushList(); flushTip();
    para.push(line.trim());
  }
  if (cur) { flushAll(); sections.push(cur); }
  return sections;
}

// Self-check: `node renderer/help/markdown.js`. Skipped in the browser bundle
// (process is undefined there), so it costs nothing at runtime.
if (typeof process !== 'undefined' && process.argv && import.meta.url === `file://${process.argv[1]}`) {
  const s = mdToSections('# Title\n\n## First\n\nHello **world** and `code`.\n\n- one\n- two\n\n> a tip\n\n## Second\n\nBody.');
  console.assert(s.length === 2, 'expected two sections');
  console.assert(s[0].id === 'first', 'expected slugged id');
  console.assert(s[0].html.includes('<strong>world</strong>'), 'expected bold');
  console.assert(s[0].html.includes('<code>code</code>'), 'expected code');
  console.assert(s[0].html.includes('<ul><li>one</li><li>two</li></ul>'), 'expected list');
  console.assert(s[0].html.includes('<div class="tip">a tip</div>'), 'expected tip');
  console.assert(s[1].title === 'Second', 'expected second title');
  console.log('markdown.js self-check passed');
}
