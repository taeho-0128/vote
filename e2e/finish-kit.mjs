// Plumbing for the step 6 walk: the layout audit that runs inside a page, the size sweep that applies it at every width,
// contact sheets that put one state's screenshots side by side, and PDF reading through the tools on this machine.
import { execFile } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import { OUT, check, settle } from './kit.mjs';
import { closeVote, composeVote } from './results-kit.mjs';

const run = promisify(execFile);

export const WIDTHS = [320, 360, 390, 430, 768, 1024, 1280, 1440, 1920];
export const LANDSCAPE_PHONE = { width: 844, height: 390 };
export const DISPLAY_SIZES = [
  { width: 1920, height: 1080 },
  { width: 1280, height: 720 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
];

const heightOf = (width) => (width <= 430 ? 844 : width === 768 ? 1024 : width === 1024 ? 768 : width >= 1920 ? 1080 : 800);
export const OPERATOR_SIZES = [...WIDTHS.map((width) => ({ width, height: heightOf(width) })), LANDSCAPE_PHONE];

const TOUCH_MAX_WIDTH = 1024;

// Runs inside the page. Finds what a person would call broken without needing to see it: a page wider than the window,
// a control off the screen or too small to hit, text cut off by its own box, and text that is hard to read.
export function auditInPage({ touch, contrast }) {
  const issues = [];
  const vw = window.innerWidth;
  const label = (el) => {
    const id = el.getAttribute('data-testid');
    const text = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 24);
    return `${el.tagName.toLowerCase()}${id ? `[${id}]` : el.className && typeof el.className === 'string' ? `.${el.className.split(' ')[0]}` : ''}${text ? ` "${text}"` : ''}`;
  };
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    for (let node = el; node; node = node.parentElement) {
      const cs = getComputedStyle(node);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    }
    return !el.closest('[inert], [hidden], .sr-only, .print-report');
  };

  if (document.documentElement.scrollWidth > vw) {
    issues.push(`page is ${document.documentElement.scrollWidth}px wide in a ${vw}px window`);
  }

  const controls = document.querySelectorAll(
    'a[href], button, input:not([type=hidden]), textarea, select, summary, [role=switch], [role=button], [tabindex]:not([tabindex="-1"])',
  );
  for (const el of controls) {
    if (!shown(el) || el.disabled) continue;
    const r = el.getBoundingClientRect();
    if (r.right > vw + 1 || r.left < -1) issues.push(`${label(el)} sticks out of the window (${Math.round(r.left)}..${Math.round(r.right)})`);
    if (!touch) continue;
    const cs = getComputedStyle(el);
    if (el.tagName === 'A' && cs.display === 'inline') continue;
    const target = el.matches('input[type=radio], input[type=checkbox]') ? (el.closest('label') ?? el) : el;
    const t = target.getBoundingClientRect();
    if (t.width < 43.5 || t.height < 43.5) issues.push(`${label(el)} is ${Math.round(t.width)}x${Math.round(t.height)}, under 44`);
  }

  const ALLOWED_CLIP = '.pface, .rstage, .unfold, .scene, .qr, .d-chips, .ink-wrap, canvas, svg';
  for (const el of document.querySelectorAll('body *')) {
    if (!shown(el) || el.closest(ALLOWED_CLIP)) continue;
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() !== '');
    if (!hasText) continue;
    const cs = getComputedStyle(el);
    const clips = (axis) => cs[axis] === 'hidden' || cs[axis] === 'clip';
    if (clips('overflowX') && el.scrollWidth > el.clientWidth + 1 && cs.textOverflow !== 'ellipsis') {
      issues.push(`${label(el)} cuts its text off sideways (${el.scrollWidth} > ${el.clientWidth})`);
    }
    const clamped = cs.webkitLineClamp && cs.webkitLineClamp !== 'none';
    if (clips('overflowY') && el.scrollHeight > el.clientHeight + 1 && !clamped) {
      issues.push(`${label(el)} cuts its text off at the bottom (${el.scrollHeight} > ${el.clientHeight})`);
    }
  }

  for (const el of document.querySelectorAll('body *')) {
    if (!shown(el) || el.closest(ALLOWED_CLIP) || el.closest('.sr-only')) continue;
    const cs = getComputedStyle(el);
    if (cs.textOverflow === 'ellipsis' || (cs.webkitLineClamp && cs.webkitLineClamp !== 'none')) continue;
    const box = el.getBoundingClientRect();
    for (const node of el.childNodes) {
      if (node.nodeType !== 3 || node.textContent.trim() === '') continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const t = range.getBoundingClientRect();
      if (t.width > 0 && (t.left < box.left - 1.5 || t.right > box.right + 1.5)) {
        issues.push(`${label(el)} has text sticking out of its box (${Math.round(t.left)}..${Math.round(t.right)} vs ${Math.round(box.left)}..${Math.round(box.right)})`);
        break;
      }
    }
  }

  if (!contrast) return issues;
  const parse = (value) => {
    const m = /rgba?\(([^)]+)\)/.exec(value);
    if (!m) return null;
    const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r, g, b, a };
  };
  const blend = (top, under) => ({
    r: top.r * top.a + under.r * (1 - top.a),
    g: top.g * top.a + under.g * (1 - top.a),
    b: top.b * top.a + under.b * (1 - top.a),
    a: 1,
  });
  const lum = ({ r, g, b }) => {
    const f = (c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const backdrop = (el) => {
    const layers = [];
    for (let node = el; node; node = node.parentElement) {
      const cs = getComputedStyle(node);
      if (cs.backgroundImage !== 'none') return null;
      const bg = parse(cs.backgroundColor);
      if (bg && bg.a > 0) {
        layers.push(bg);
        if (bg.a === 1) break;
      }
    }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    for (const layer of layers.reverse()) base = blend(layer, base);
    return base;
  };
  const seen = new Set();
  for (const el of document.querySelectorAll('body *')) {
    if (!shown(el) || el.closest('.pface, [disabled], :disabled, .rstage, .fold-stage')) continue;
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() !== '');
    if (!hasText) continue;
    let faded = false;
    for (let node = el; node; node = node.parentElement) if (Number(getComputedStyle(node).opacity) < 1) faded = true;
    if (faded) continue;
    const cs = getComputedStyle(el);
    const fg = parse(cs.color);
    const bg = backdrop(el);
    if (!fg || !bg) continue;
    const text = blend(fg, bg);
    const [hi, lo] = [lum(text), lum(bg)].sort((a, b) => b - a);
    const ratio = (hi + 0.05) / (lo + 0.05);
    const size = parseFloat(cs.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
    const need = large ? 3 : 4.5;
    const key = `${cs.color}|${cs.backgroundColor}|${size}`;
    if (ratio < need && !seen.has(key)) {
      seen.add(key);
      issues.push(`${label(el)} reads at ${ratio.toFixed(2)}:1, needs ${need} (${cs.color} on rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)}), ${size}px)`);
    }
  }
  return issues;
}

// Tabs through the page and reports every stop that shows no focus mark.
export async function focusAudit(page, limit = 40) {
  await page.evaluate(() => document.activeElement?.blur());
  const missing = [];
  for (let step = 0; step < limit; step++) {
    await page.keyboard.press('Tab');
    const verdict = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return { done: true };
      const marked = (node) => {
        if (!node) return false;
        const cs = getComputedStyle(node);
        return (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || /rgba?\([^)]*\)\s+0px 0px/.test(cs.boxShadow);
      };
      const label = el.getAttribute('data-testid') ?? el.tagName.toLowerCase();
      const ok = marked(el) || marked(el.nextElementSibling) || marked(el.closest('summary')) || marked(el.parentElement?.querySelector(':scope > span'));
      return { done: false, ok, label, first: el.getAttribute('data-first') };
    });
    if (verdict.done) break;
    if (!verdict.ok) missing.push(verdict.label);
  }
  return missing;
}

const shotPath = (name, size) => path.join(OUT, `finish-${name}-${size.width}x${size.height}.png`);

// Puts the page at each size, applies the audit and keeps a screenshot. One check per size, so a failure names the width.
export async function sweep(page, name, sizes, { fullPage = true, contrast = true, touchWidth = TOUCH_MAX_WIDTH, shots = true } = {}) {
  const files = [];
  for (const size of sizes) {
    await page.setViewportSize(size);
    await settle(page);
    const touch = size.width <= touchWidth || size.height <= 430;
    const issues = await page.evaluate(auditInPage, { touch, contrast });
    check(`${name} @${size.width}x${size.height}: no layout issues`, issues.length === 0, issues.slice(0, 6).join(' | '));
    if (shots) {
      await page.evaluate(() => window.scrollTo(0, 0));
      const file = shotPath(name, size);
      await page.screenshot({ path: file, fullPage });
      files.push(file);
    }
  }
  return files;
}

// Several screenshots side by side in one picture, so a state can be judged at every width at a glance.
export async function contactSheet(browser, name, files, { scale = 1, height = 900 } = {}) {
  if (files.length === 0) return null;
  const dir = path.join(OUT, '.sheets');
  mkdirSync(dir, { recursive: true });
  const html = path.join(dir, `${name}.html`);
  const figure = (file) =>
    `<figure><img src="${pathToFileURL(file).href}" style="height:auto;width:auto;zoom:${scale}"><figcaption>${path.basename(file, '.png').replace('finish-', '')}</figcaption></figure>`;
  writeFileSync(
    html,
    `<body style="margin:0;padding:8px;background:#777;display:flex;gap:10px;align-items:flex-start;font:12px sans-serif;color:#fff">${files.map(figure).join('')}<style>figure{margin:0;flex:none}</style></body>`,
  );
  const page = await browser.newPage({ viewport: { width: 2200, height } });
  await page.goto(pathToFileURL(html).href);
  await page.waitForTimeout(300);
  const out = path.join(OUT, `finish-sheet-${name}.png`);
  await page.screenshot({ path: out, fullPage: true });
  await page.close();
  rmSync(html, { force: true });
  return out;
}

// Plain text of each page of a PDF, through poppler's pdftotext, or pypdf when that is what the machine has.
export async function pdfPages(file) {
  try {
    const { stdout } = await run('pdftotext', ['-enc', 'UTF-8', '-layout', file, '-'], { maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' });
    const pages = stdout.split('\f');
    if (pages.at(-1)?.trim() === '') pages.pop();
    return pages;
  } catch {
    // fall through to python
  }
  const script = [
    'import sys, json',
    'from pypdf import PdfReader',
    'print(json.dumps([p.extract_text() or "" for p in PdfReader(sys.argv[1]).pages], ensure_ascii=True))',
  ].join('\n');
  try {
    const { stdout } = await run('python', ['-c', script, file], { maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' });
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

export const stubPrint = (page) =>
  page.evaluate(() => {
    window.__prints = 0;
    window.print = () => {
      window.__prints += 1;
    };
  });

export async function downloadOf(page, click) {
  const [download] = await Promise.all([page.waitForEvent('download'), click()]);
  return { name: download.suggestedFilename(), bytes: readFileSync(await download.path()) };
}

export async function startAndClose(host, room, { title, kind, anonymity, options, ballots }) {
  await composeVote(host, { title, kind, anonymity, options });
  for (const [nick, content] of Object.entries(ballots)) room.submitAs(nick, content);
  await closeVote(host);
}

