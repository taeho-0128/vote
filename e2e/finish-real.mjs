import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = fileURLToPath(new URL('./out/', import.meta.url));
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withServer(port, env, fn) {
  const server = spawn(process.execPath, ['--import', 'tsx', 'server/main.ts'], { env: { ...process.env, PORT: String(port), ...env }, stdio: 'ignore' });
  try {
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(`http://localhost:${port}/healthz`)).ok) break; } catch {}
      await sleep(250);
    }
    await fn(`http://localhost:${port}`);
  } finally {
    server.kill();
  }
}

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const errors = [];

try {
  await withServer(3105, {}, async (BASE) => {
    const hostCtx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
    const host = await hostCtx.newPage();
    host.on('pageerror', (e) => errors.push(`host: ${e.message}`));
    await host.goto(BASE);
    await host.getByTestId('home-create-room').click();
    await host.waitForURL(/\/host\/\d{4}$/);
    const code = (await host.getByTestId('room-code').innerText()).trim();

    const nicks = ['하늘', '민준', '서연'];
    const phones = [];
    for (const nick of nicks) {
      const page = await (await browser.newContext(phone)).newPage();
      page.on('pageerror', (e) => errors.push(`${nick}: ${e.message}`));
      await page.goto(`${BASE}/r/${code}?nick=${encodeURIComponent(nick)}`);
      await page.getByTestId('my-nickname').waitFor();
      phones.push(page);
    }
    await host.waitForFunction(() => document.querySelectorAll('[data-testid="roster-item"]').length === 3);

    const runVote = async (title, kind, anonymity, texts) => {
      await host.getByTestId('open-composer').click();
      await host.getByTestId('vote-title').fill(title);
      await host.getByTestId(kind === 'free' ? 'paper-freeform' : 'paper-choice').click();
      await host.getByTestId(anonymity === 'anon' ? 'anon-anonymous' : 'anon-named').click();
      if (kind === 'choice') {
        const opts = ['김치찜', '돈가스', '비빔밥'];
        for (let i = 0; i < opts.length; i++) {
          if (i >= 2) await host.getByTestId('option-add').click();
          await host.getByTestId(`option-input-${i}`).fill(opts[i]);
        }
      }
      await host.getByTestId('start-vote').click();
      await host.getByTestId('submitted-count').waitFor();
      for (let i = 0; i < 3; i++) {
        if (kind === 'free') {
          await phones[i].getByTestId('mode-type').click();
          await phones[i].getByTestId('ballot-text').fill(texts[i]);
        } else {
          await phones[i].getByTestId(`ballot-option-${texts[i]}`).click();
        }
        await phones[i].getByTestId('ballot-submit').click();
        await phones[i].getByTestId('ballot-confirm').click();
        await phones[i].getByTestId('ballot-submitted').waitFor({ timeout: 10000 });
      }
      await host.getByTestId('close-vote').click();
      if (await host.getByTestId('confirm-close').count()) await host.getByTestId('confirm-close').click();
      await host.getByTestId('results-stage').waitFor();
    };
    const download = async () => {
      const [dl] = await Promise.all([host.waitForEvent('download'), host.getByTestId('export-csv').click()]);
      const buf = readFileSync(await dl.path());
      return { buf, text: buf.toString('utf8'), name: dl.suggestedFilename() };
    };

    await runVote('이번 달 MVP는?', 'free', 'anon', ['알파, "최고"요', '=1+1 수식 아님', '브라보\n줄바꿈']);
    const anon = await download();
    check('the CSV starts with a UTF-8 BOM', anon.buf[0] === 0xef && anon.buf[1] === 0xbb && anon.buf[2] === 0xbf);
    check('the CSV uses CRLF line endings', /\r\n/.test(anon.text) && !/[^\r]\n(?![^"]*"[,\r])/.test(anon.text.replace(/"[^"]*"/g, '""')));
    check('the CSV carries the title, and the filename is readable Korean', anon.text.includes('이번 달 MVP는?') && /\.csv$/.test(anon.name), anon.name);
    check('quoting survives commas, quotes, and line breaks in a ballot', anon.text.includes('"알파, ""최고""요"') && anon.text.includes('"브라보\n줄바꿈"'));
    check('a spreadsheet formula in a ballot is neutralized', !/(^|,)=1\+1/.test(anon.text) && anon.text.includes("'=1+1"));
    const leaked = nicks.filter((n) => anon.text.includes(n));
    check('anonymous vote: no nickname anywhere in the file', leaked.length === 0, JSON.stringify(leaked));
    await host.screenshot({ path: `${OUT}/finish-real-results-1280.png` });

    await host.getByTestId('dismiss-vote').click();
    await sleep(600);
    check('dismissing a vote that was already exported does not ask', (await host.getByTestId('export-confirm').count()) === 0);
    await host.getByTestId('open-composer').waitFor();

    await host.getByTestId('open-composer').click();
    await host.getByTestId('vote-title').fill('두 번째 투표');
    await host.getByTestId('paper-freeform').click();
    await host.getByTestId('anon-anonymous').click();
    await host.getByTestId('start-vote').click();
    await host.getByTestId('submitted-count').waitFor();
    for (let i = 0; i < 3; i++) {
      await phones[i].getByTestId('mode-type').click();
      await phones[i].getByTestId('ballot-text').fill(`내용${i}`);
      await phones[i].getByTestId('ballot-submit').click();
      await phones[i].getByTestId('ballot-confirm').click();
      await phones[i].getByTestId('ballot-submitted').waitFor({ timeout: 10000 });
    }
    await host.getByTestId('close-vote').click();
    if (await host.getByTestId('confirm-close').count()) await host.getByTestId('confirm-close').click();
    await host.getByTestId('results-stage').waitFor();
    await host.getByTestId('dismiss-vote').click();
    await host.getByTestId('export-confirm').waitFor({ timeout: 5000 });
    check('dismissing an unexported vote with ballots asks first', true);
    await host.screenshot({ path: `${OUT}/finish-real-dismiss-confirm-1280.png` });
    await host.getByTestId('export-confirm-skip').click();
    await host.getByTestId('open-composer').waitFor();
  });
} catch (e) {
  check('first server section completed', false, String(e).split('\n')[0]);
}

try {
  await withServer(3106, {}, async (BASE) => {
    const host = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true })).newPage();
    host.on('pageerror', (e) => errors.push(`host2: ${e.message}`));
    await host.goto(BASE);
    await host.getByTestId('home-create-room').click();
    await host.waitForURL(/\/host\/\d{4}$/);
    const code = (await host.getByTestId('room-code').innerText()).trim();
    const page = await (await browser.newContext(phone)).newPage();
    await page.goto(`${BASE}/r/${code}?nick=${encodeURIComponent('하늘')}`);
    await page.getByTestId('my-nickname').waitFor();
    await host.getByTestId('open-composer').click();
    await host.getByTestId('vote-title').fill('오늘 점심은?');
    await host.getByTestId('paper-choice').click();
    await host.getByTestId('anon-named').click();
    const opts = ['김치찜', '돈가스', '비빔밥'];
    for (let i = 0; i < opts.length; i++) {
      if (i >= 2) await host.getByTestId('option-add').click();
      await host.getByTestId(`option-input-${i}`).fill(opts[i]);
    }
    await host.getByTestId('start-vote').click();
    await page.getByTestId('ballot-option-1').click();
    await page.getByTestId('ballot-submit').click();
    await page.getByTestId('ballot-confirm').click();
    await page.getByTestId('ballot-submitted').waitFor({ timeout: 10000 });
    await host.getByTestId('close-vote').click();
    if (await host.getByTestId('confirm-close').count()) await host.getByTestId('confirm-close').click();
    await host.getByTestId('results-stage').waitFor();
    const [dl] = await Promise.all([host.waitForEvent('download'), host.getByTestId('export-csv').click()]);
    const text = readFileSync(await dl.path()).toString('utf8');
    check('named vote: the author appears, and the option table is there', text.includes('하늘') && text.includes('돈가스') && /득표|표/.test(text));
    await host.getByTestId('dismiss-vote').click();
    check('after exporting, dismissing does not ask again', (await host.getByTestId('export-confirm').count()) === 0);

    for (let i = 0; i < 9; i++) {
      const p = await (await browser.newContext(phone)).newPage();
      await p.goto(`${BASE}/r/${9000 + i}?nick=x`);
      if (i === 8) {
        const msg = await p.getByTestId('rate-limit-message').waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
        check('the 9th wrong code is throttled with a plain message', msg);
        if (msg) await p.screenshot({ path: `${OUT}/finish-real-ratelimit-390.png` });
      } else {
        await p.waitForFunction(() => document.body.innerText.length > 0);
        await sleep(300);
      }
    }
    const good = await (await browser.newContext(phone)).newPage();
    await good.goto(`${BASE}/r/${code}?nick=${encodeURIComponent('유나')}`);
    const stillLocked = await good.getByTestId('rate-limit-message').waitFor({ timeout: 4000 }).then(() => true).catch(() => false);
    check('a locked address is refused even with a correct code', stillLocked);
  });
} catch (e) {
  check('second server section completed', false, String(e).split('\n')[0]);
}

try {
  await withServer(3107, { ROOM_TTL_MS: '8000', SWEEP_INTERVAL_MS: '500' }, async (BASE) => {
    const host = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    host.on('pageerror', (e) => errors.push(`host3: ${e.message}`));
    await host.goto(BASE);
    await host.getByTestId('home-create-room').click();
    await host.waitForURL(/\/host\/\d{4}$/);
    const code = (await host.getByTestId('room-code').innerText()).trim();
    const page = await (await browser.newContext(phone)).newPage();
    await page.goto(`${BASE}/r/${code}?nick=${encodeURIComponent('하늘')}`);
    await page.getByTestId('my-nickname').waitFor();
    await host.getByTestId('expiry-banner').waitFor({ timeout: 5000 });
    check('the expiry warning shows when the room is about to close', true, (await host.getByTestId('expiry-banner').innerText()).replace(/\s+/g, ' ').trim().slice(0, 60));
    await host.screenshot({ path: `${OUT}/finish-real-expiry-1280.png` });
    await host.getByTestId('keep-alive').click();
    await sleep(1500);
    await host.getByTestId('room-expired').waitFor({ timeout: 14000 });
    check('the host sees the closed-room screen once the time runs out', true);
    await page.getByTestId('room-expired').waitFor({ timeout: 6000 });
    check('a participant sees it too and does not keep reconnecting', true);
    await sleep(2500);
    const reconnecting = await page.getByTestId('connection-banner').count();
    check('no reconnect banner after expiry', reconnecting === 0);
    await page.screenshot({ path: `${OUT}/finish-real-expired-390.png` });
  });
} catch (e) {
  check('third server section completed', false, String(e).split('\n')[0]);
}

check('no page errors', errors.length === 0, errors.join(' ; '));
await browser.close();
console.log(results.every(Boolean) ? 'ALL PASSED' : 'SOME FAILED');
process.exit(results.every(Boolean) ? 0 : 1);
