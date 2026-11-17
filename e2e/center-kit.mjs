// Where typed text sits on the paper (D-42), measured on the rendered page in units of the paper's width so the same
// numbers hold on a phone, a laptop and a projector. A face is read from its own text; a textarea cannot be, so a hidden
// copy with the same box, font and padding stands in for it, and a screenshot of the real thing checks the copy.
import { leadOf, rowsAvailable } from '../web/src/textFit.ts';
import { check } from './kit.mjs';

// `ref` is where the first line of text sits when it is not moved down at all, which is where the ruled lines were drawn
// for it. Every position is read against it, so the font's own rounding of ascent and descent cancels out.
export const GEOMETRY = `(el) => {
  const field = 'value' in el;
  const host = el.closest(field ? '.paper' : '.pface');
  const box = host.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const layoutW = host.offsetWidth;
  const stuff = [];

  const copy = (content, lead) => {
    let node;
    if (field) {
      node = document.createElement('div');
      node.style.cssText = el.style.cssText;
      Object.assign(node.style, {
        position: 'absolute', inset: '0', boxSizing: 'border-box', padding: 'var(--tf-pad)', visibility: 'hidden', overflow: 'hidden',
        fontFamily: cs.fontFamily, textAlign: cs.textAlign, whiteSpace: cs.whiteSpace, overflowWrap: cs.overflowWrap, wordBreak: cs.wordBreak,
      });
    } else {
      node = el.cloneNode(false);
      node.style.visibility = 'hidden';
    }
    if (!lead) node.style.paddingTop = 'var(--tf-top)';
    node.textContent = content;
    el.parentElement.append(node);
    stuff.push(node);
    return node;
  };

  const charsOf = (node) => {
    const textNode = node.firstChild;
    const range = document.createRange();
    const found = [];
    let index = 0;
    for (const ch of node.textContent) {
      if (ch.trim() !== '') {
        range.setStart(textNode, index);
        range.setEnd(textNode, index + ch.length);
        const r = range.getClientRects()[0];
        if (r) found.push({ l: (r.left - box.left) / box.width, r: (r.right - box.left) / box.width, cy: ((r.top + r.bottom) / 2 - box.top) / box.width });
      }
      index += ch.length;
    }
    return found;
  };

  const probe = document.createElement('i');
  probe.style.cssText = (field ? el.style.cssText : '') + ';position:absolute;visibility:hidden;width:0;height:var(--tf-top)';
  el.parentElement.append(probe);
  stuff.push(probe);
  const tfTop = probe.getBoundingClientRect().height / box.width;
  const pitch = parseFloat(cs.lineHeight) / layoutW;

  const live = field ? copy(el.value || el.placeholder, true) : el;
  const chars = charsOf(live).sort((a, b) => a.cy - b.cy);
  const lines = [];
  for (const c of chars) {
    const last = lines.at(-1);
    if (last && c.cy - last.first < pitch * 0.5) {
      last.left = Math.min(last.left, c.l);
      last.right = Math.max(last.right, c.r);
      last.sum += c.cy;
      last.n += 1;
    } else {
      lines.push({ first: c.cy, left: c.l, right: c.r, sum: c.cy, n: 1 });
    }
  }
  const ref = charsOf(copy('가', false))[0];

  const ruled = field ? el : el.parentElement;
  const printed = !field && getComputedStyle(ruled).backgroundImage === 'none';
  const rulesStart = printed ? parseFloat(getComputedStyle(ruled, '::before').top) : parseFloat(getComputedStyle(ruled).backgroundPositionY);
  const out = {
    height: box.height / box.width,
    widthPx: box.width,
    pitch,
    tfTop,
    padTop: parseFloat(cs.paddingTop) / layoutW,
    padBottom: parseFloat(cs.paddingBottom) / layoutW,
    rulesStart: rulesStart / layoutW,
    overflow: el.scrollHeight - el.clientHeight,
    refCy: ref.cy,
    lines: lines.map((l) => ({ left: l.left, right: l.right, cy: l.sum / l.n })),
  };
  stuff.forEach((s) => s.remove());
  return out;
}`;

export const geometryOf = (locator) => locator.evaluate((el, source) => new Function(`return (${source})`)()(el), GEOMETRY);

const near = (value, target, tolerance) => Math.abs(value - target) <= tolerance;
const fmt = (n) => Number(n.toFixed(3));

// Where the block sits, as fractions of the paper's width and of a ruled line. A row is a few pixels on a small paper, so
// the tolerances are a pixel and a half expressed in rows or in widths.
export function measure(g) {
  const { pitch, tfTop, padBottom, lines, height, refCy, widthPx } = g;
  const px = 1.5 / widthPx;
  const areaTop = tfTop;
  const areaBottom = height - padBottom;
  const slots = lines.map((l) => (l.cy - refCy) / pitch);
  const blockTop = tfTop + slots[0] * pitch;
  const blockBottom = blockTop + lines.length * pitch;
  const wholeLeft = Math.min(...lines.map((l) => l.left));
  const wholeRight = Math.max(...lines.map((l) => l.right));
  return {
    px,
    areaTop,
    areaBottom,
    blockTop,
    blockBottom,
    slots,
    vertical: ((blockTop + blockBottom) / 2 - (areaTop + areaBottom) / 2) / pitch,
    sideways: Math.max(...lines.map((l) => Math.abs((l.left + l.right) / 2 - 0.5))),
    wholeOff: Math.abs((wholeLeft + wholeRight) / 2 - 0.5),
    offGrid: Math.max(...slots.map((u) => Math.abs(u - Math.round(u)))),
    offGridLimit: px / pitch,
    consecutive: slots.every((u, i) => i === 0 || near(u - slots[i - 1], 1, px / pitch)),
    inside: blockTop >= areaTop - px && blockBottom <= areaBottom + px,
    rulesStill: near(g.rulesStart, tfTop, px),
  };
}

// Pass the page's geometry and the model's side: the pitch it picked, whether the paper is signed, and the rows it counted.
// The lead is now set from the rows the browser drew, so the middle is judged to half a ruled line, which is what
// flooring to whole rows can cost, plus half of the strip that the area has below its last whole row. Nothing is added for
// the model's estimate any more.
export function judge(tag, g, { pitch, signed, rows }) {
  const m = measure(g);
  const drawn = g.lines.length;
  const expectedLead = leadOf(drawn, pitch, signed);
  const strip = (m.areaBottom - m.areaTop) / g.pitch - rowsAvailable(pitch, signed);
  const allowed = 0.5 + strip / 2 + m.px / g.pitch + 0.02;
  check(`${tag}: every line is centered across the paper`, m.sideways <= 0.02, `worst line is ${fmt(m.sideways)} of the width off`);
  check(`${tag}: the text block is centered across the paper`, m.wholeOff <= 0.02, `${fmt(m.wholeOff)} of the width off`);
  check(`${tag}: the block sits within ${fmt(allowed)} ruled lines (half a row plus half the strip under the last row) of the middle of its area`, Math.abs(m.vertical) <= allowed, `${fmt(m.vertical)} lines off (area ${fmt(m.areaTop)}..${fmt(m.areaBottom)}, block ${fmt(m.blockTop)}..${fmt(m.blockBottom)})`);
  check(`${tag}: it never sits below the middle, so the last line has room`, m.vertical <= m.px / g.pitch, `${fmt(m.vertical)}`);
  check(`${tag}: every line moves a whole number of rows from where top-aligned text sat, so the baselines stay on the rules`, m.offGrid <= m.offGridLimit && m.consecutive, `off ${fmt(m.offGrid)} rows, slots ${m.slots.map(fmt).join(' ')}`);
  check(`${tag}: the ruled lines start where they always did`, m.rulesStill, `${fmt(g.rulesStart)} vs ${fmt(g.tfTop)}`);
  check(`${tag}: the block is inside the area, clear of the margins and the signature`, m.inside, `block ${fmt(m.blockTop)}..${fmt(m.blockBottom)} in ${fmt(m.areaTop)}..${fmt(m.areaBottom)}`);
  check(`${tag}: the box does not scroll`, g.overflow <= 0, `${g.overflow}`);
  check(`${tag}: the first line sits ${expectedLead} rows down, the lead for the ${drawn} rows drawn`, near(m.slots[0], expectedLead, m.offGridLimit), `${fmt(m.slots[0])} vs ${expectedLead}`);
  check(`${tag}: the model never counts fewer rows than the browser draws`, drawn <= rows, `${drawn} drawn, ${rows} modeled`);
  return m;
}

// The hook's count of drawn rows, asked again with the text moved to other places: it must not move, because the count
// is taken in a copy with no top padding. Runs the app's own `measureRows` in the page, through the dev server.
export async function countAgain(locator) {
  return locator.evaluate(async (el) => {
    const { measureRows } = await import('/src/useFittedStyle.ts');
    const text = 'value' in el ? el.value || el.placeholder : el.textContent;
    const was = el.style.paddingTop;
    const counts = [measureRows(el, text), measureRows(el, text)];
    for (const top of ['0px', '45cqw']) {
      el.style.paddingTop = top;
      counts.push(measureRows(el, text));
    }
    el.style.paddingTop = was;
    counts.push(measureRows(el, text));
    return counts;
  });
}

export function judgeCount(tag, g, counts) {
  check(`${tag}: the counted rows are the same on every pass and wherever the text is moved`, counts.every((c) => c === counts[0]), counts.join(' '));
  check(`${tag}: the counted rows are the rows drawn`, counts[0] === g.lines.length, `${counts[0]} vs ${g.lines.length}`);
}

// Dark pixels of a screenshot, found in a scratch page so no image library is needed. The ruled lines and the paper are
// light, the ink and the placeholder dark, and the paper's rounded corners are transparent. `limit` cuts the picture off
// above a signed paper's signature.
export async function inkOf(analyzer, png, limit) {
  return analyzer.evaluate(
    async ({ b64, limit: cut }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const g = canvas.getContext('2d');
      g.drawImage(img, 0, 0);
      const { data } = g.getImageData(0, 0, img.width, img.height);
      const rows = Math.min(img.height, cut ?? img.height);
      let left = Infinity;
      let right = -1;
      let top = Infinity;
      let bottom = -1;
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < img.width; x++) {
          const i = (y * img.width + x) * 4;
          if (data[i + 3] > 200 && 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] < 165) {
            left = Math.min(left, x);
            right = Math.max(right, x + 1);
            top = Math.min(top, y);
            bottom = Math.max(bottom, y + 1);
          }
        }
      }
      return { width: img.width, height: img.height, left, right, top, bottom };
    },
    { b64: png.toString('base64'), limit },
  );
}

// The pixels of the real textarea against the hidden copy's lines: same left and right edge, and the ink centered up and
// down about where the copy's lines are. Ink and line boxes differ a little, so the vertical match is loose and only has
// to prove the real box did not wrap differently.
export function judgeInk(tag, g, ink) {
  const found = ink.right >= 0;
  check(`${tag}: the real pixels show text`, found);
  if (!found) return;
  const pixelCenterX = (ink.left + ink.right) / 2 / ink.width;
  const pixelCenterY = (ink.top + ink.bottom) / 2 / ink.width;
  const m = measure(g);
  const lineCenterY = (m.blockTop + m.blockBottom) / 2;
  const copyLeft = Math.min(...g.lines.map((l) => l.left));
  const copyRight = Math.max(...g.lines.map((l) => l.right));
  check(`${tag}: the real ink is centered across the paper`, near(pixelCenterX, 0.5, 0.02), `${fmt(pixelCenterX)}`);
  check(`${tag}: the real ink spans what the copy's lines span`, near(ink.left / ink.width, copyLeft, 0.03) && near(ink.right / ink.width, copyRight, 0.03), `${fmt(ink.left / ink.width)}..${fmt(ink.right / ink.width)} vs ${fmt(copyLeft)}..${fmt(copyRight)}`);
  check(`${tag}: the real ink is centered up and down within a ruled line of the copy's block`, near(pixelCenterY, lineCenterY, g.pitch), `${fmt(pixelCenterY)} vs ${fmt(lineCenterY)} (pitch ${fmt(g.pitch)})`);
}
