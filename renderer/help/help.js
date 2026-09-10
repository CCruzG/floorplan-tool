// renderer/help/help.js
// In-app Help & How-To modal.
//
// The manual content lives in guide.md — edit that file to change the manual.
// Each `## ` heading there becomes a section in the table of contents. This
// module just parses guide.md into sections and wires the toolbar "?" button.

import { mdToSections } from './markdown.js';
import guideMd from './guide.md?raw';

export function initHelp() {
  const btn = document.getElementById('helpBtn');
  const modal = document.getElementById('helpModal');
  const closeBtn = document.getElementById('closeHelpModalBtn');
  const toc = document.getElementById('helpToc');
  const content = document.getElementById('helpContent');
  if (!btn || !modal || !closeBtn || !toc || !content) return;

  const sections = mdToSections(guideMd);
  content.innerHTML = sections
    .map((s) => `<section id="help-${s.id}"><h3>${s.title}</h3>${s.html}</section>`)
    .join('');
  toc.innerHTML = sections
    .map((s, i) => `<a href="#" data-target="help-${s.id}"${i === 0 ? ' class="active"' : ''}>${s.title}</a>`)
    .join('');

  const links = Array.from(toc.querySelectorAll('a'));
  links.forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById(a.dataset.target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      links.forEach((x) => x.classList.remove('active'));
      a.classList.add('active');
    });
  });

  const open = () => { modal.style.display = 'flex'; };
  const close = () => { modal.style.display = 'none'; };
  btn.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.style.display !== 'none') close();
  });
}
