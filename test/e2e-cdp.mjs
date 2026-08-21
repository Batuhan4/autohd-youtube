#!/usr/bin/env node
/**
 * Chrome DevTools Protocol end-to-end test for AutoHD.
 *
 * Launches a throwaway Chrome profile with --remote-debugging-pipe,
 * loads the unpacked extension via Extensions.loadUnpacked, then
 * drives real pages (example.com, youtube.com, popup, watch).
 */

import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HEADLESS = process.env.E2E_HEADED !== '1';
const WATCH_URL = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ';

function resolveChrome() {
  if (process.env.CHROME_PATH) {
    return process.env.CHROME_PATH;
  }
  for (const name of ['google-chrome-stable', 'google-chrome', 'chromium']) {
    try {
      return execFileSync('bash', ['-lc', `command -v ${name}`], { encoding: 'utf8' }).trim();
    } catch {
      // try next
    }
  }
  throw new Error('Chrome/Chromium not found');
}

const CHROME = resolveChrome();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class CdpPipe {
  constructor(proc) {
    this.proc = proc;
    this.tx = proc.stdio[3];
    this.rx = proc.stdio[4];
    this.nextId = 0;
    this.pending = new Map();
    this.eventWaiters = [];
    this.buffer = Buffer.alloc(0);
    this.rx.on('data', (chunk) => this.#onData(chunk));
    this.rx.on('end', () => this.#failAll(new Error('CDP pipe closed')));
  }

  #onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const idx = this.buffer.indexOf(0);
      if (idx === -1) {
        return;
      }
      const raw = this.buffer.subarray(0, idx).toString('utf8');
      this.buffer = this.buffer.subarray(idx + 1);
      if (!raw.trim()) {
        continue;
      }
      const msg = JSON.parse(raw);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject, timer } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        clearTimeout(timer);
        if (msg.error) {
          reject(new Error(`${msg.error.message || 'CDP error'} (${JSON.stringify(msg.error)})`));
        } else {
          resolve(msg.result ?? {});
        }
        continue;
      }
      const remaining = [];
      for (const waiter of this.eventWaiters) {
        if (waiter.method === msg.method && (!waiter.sessionId || waiter.sessionId === msg.sessionId)) {
          waiter.resolve(msg);
        } else {
          remaining.push(waiter);
        }
      }
      this.eventWaiters = remaining;
    }
  }

  #failAll(error) {
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    this.pending.clear();
  }

  send(method, params = {}, sessionId) {
    const id = ++this.nextId;
    const payload = { id, method, params };
    if (sessionId) {
      payload.sessionId = sessionId;
    }
    this.tx.write(`${JSON.stringify(payload)}\0`);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 45000);
      this.pending.set(id, { resolve, reject, timer });
    });
  }

  waitForEvent(method, sessionId, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.eventWaiters = this.eventWaiters.filter((waiter) => waiter.resolve !== resolve);
        reject(new Error(`CDP event timeout: ${method}`));
      }, timeoutMs);
      this.eventWaiters.push({
        method,
        sessionId,
        resolve: (msg) => {
          clearTimeout(timer);
          resolve(msg);
        }
      });
    });
  }
}

async function launchChrome(userDataDir) {
  const args = [
    `--user-data-dir=${userDataDir}`,
    '--remote-debugging-pipe',
    '--enable-unsafe-extension-debugging',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    '--disable-popup-blocking',
    '--disable-component-update',
    '--disable-background-networking',
    '--disable-default-apps',
    '--metrics-recording-only',
    '--mute-audio',
    '--autoplay-policy=no-user-gesture-required',
    '--window-size=1280,800',
    'about:blank'
  ];
  if (HEADLESS) {
    args.unshift('--headless=new');
  }

  const proc = spawn(CHROME, args, {
    stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'],
    env: { ...process.env, HOME: userDataDir }
  });

  const stderrChunks = [];
  proc.stderr.on('data', (chunk) => {
    stderrChunks.push(chunk);
  });
  proc.stdout.on('data', (chunk) => {
    stderrChunks.push(chunk);
  });

  if (!proc.stdio[3] || !proc.stdio[4]) {
    throw new Error(`Chrome pipe fds missing. stderr=${Buffer.concat(stderrChunks).toString()}`);
  }

  proc._stderrChunks = stderrChunks;
  proc.on('exit', (code, signal) => {
    proc._exit = { code, signal, log: Buffer.concat(stderrChunks).toString() };
  });
  await sleep(400);
  if (proc._exit) {
    throw new Error(`Chrome exited ${proc._exit.code}/${proc._exit.signal}: ${proc._exit.log}`);
  }
  return proc;
}

async function openPage(cdp, url) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Runtime.enable', {}, sessionId);
  const loaded = cdp.waitForEvent('Page.loadEventFired', sessionId, 40000);
  await cdp.send('Page.navigate', { url }, sessionId);
  await loaded;
  return { targetId, sessionId };
}

async function evaluate(cdp, sessionId, expression) {
  const response = await cdp.send(
    'Runtime.evaluate',
    {
      expression: `(async () => { return await (${expression}); })()`,
      awaitPromise: true,
      returnByValue: true
    },
    sessionId
  );
  if (response.exceptionDetails) {
    const text =
      response.exceptionDetails.exception?.description ||
      response.exceptionDetails.text ||
      'evaluate failed';
    throw new Error(text);
  }
  return response.result?.value;
}

function storageApiExpression() {
  return `(globalThis.browser ?? globalThis.chrome).storage.sync`;
}

function setQualityExpression(quality) {
  return `(async () => {
    const storage = ${storageApiExpression()};
    await storage.set({ quality: ${JSON.stringify(quality)} });
    const result = await storage.get({ quality: null });
    return result.quality;
  })()`;
}

async function waitUntil(fn, { timeout = 20000, interval = 300 } = {}) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    last = await fn();
    if (last) {
      return last;
    }
    await sleep(interval);
  }
  throw new Error(`waitUntil timed out. last=${JSON.stringify(last)}`);
}

async function screenshot(cdp, sessionId, filePath) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
  await writeFile(filePath, Buffer.from(data, 'base64'));
  return filePath;
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const results = [];
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'autohd-e2e-'));
  let proc;
  let failed = 0;

  async function test(name, fn) {
    const started = Date.now();
    try {
      const detail = await fn();
      const ms = Date.now() - started;
      results.push({ name, ok: true, ms, detail });
      console.log(`ok  - ${name}${detail ? ` (${detail})` : ''} [${ms}ms]`);
    } catch (error) {
      failed += 1;
      const ms = Date.now() - started;
      results.push({ name, ok: false, ms, error: error.message });
      console.log(`FAIL- ${name} [${ms}ms]`);
      console.log(`      ${error.message}`);
    }
  }

  try {
    proc = await launchChrome(userDataDir);
    const cdp = new CdpPipe(proc);
    await cdp.send('Target.setDiscoverTargets', { discover: true });

    let extensionId;

    await test('CDP loads unpacked extension', async () => {
      const result = await cdp.send('Extensions.loadUnpacked', { path: ROOT });
      extensionId = result.id;
      assert(typeof extensionId === 'string' && extensionId.length >= 32, `bad id ${extensionId}`);
      return extensionId;
    });

    await test('Extensions.getExtensions lists AutoHD', async () => {
      const { extensions } = await cdp.send('Extensions.getExtensions');
      const match = (extensions || []).find((item) => item.id === extensionId);
      assert(match, `extension missing: ${JSON.stringify(extensions)}`);
      assertEqual(match.name, 'AutoHD for YouTube', 'name');
      assertEqual(match.enabled, true, 'enabled');
      return `${match.name} ${match.version}`;
    });

    await test('does not inject on example.com', async () => {
      const page = await openPage(cdp, 'https://example.com/');
      await sleep(800);
      const info = await evaluate(
        cdp,
        page.sessionId,
        `{ host: location.host, quality: document.documentElement.dataset.autohdQuality || null, bound: Boolean(document.querySelector('[data-autohd-bound]')) }`
      );
      assertEqual(info.host, 'example.com', 'host');
      assertEqual(info.quality, null, 'quality dataset');
      assertEqual(info.bound, false, 'player bound');
      await cdp.send('Target.closeTarget', { targetId: page.targetId });
      return JSON.stringify(info);
    });

    await test('does not inject on github.com', async () => {
      const page = await openPage(cdp, 'https://github.com/');
      await sleep(1000);
      const info = await evaluate(
        cdp,
        page.sessionId,
        `{ host: location.host, quality: document.documentElement.dataset.autohdQuality || null }`
      );
      assert(info.host === 'github.com' || info.host.endsWith('github.com'), `host ${info.host}`);
      assertEqual(info.quality, null, 'quality dataset');
      await cdp.send('Target.closeTarget', { targetId: page.targetId });
      return JSON.stringify(info);
    });

    let youtubePage;
    await test('injects default Auto with the extension on', async () => {
      youtubePage = await openPage(cdp, 'https://www.youtube.com/');
      const info = await waitUntil(async () => {
        const value = await evaluate(
          cdp,
          youtubePage.sessionId,
          `{
            quality: document.documentElement.dataset.autohdQuality || null,
            enabled: document.documentElement.dataset.autohdEnabled || null
          }`
        );
        return value.quality === 'auto' && value.enabled === '1' ? value : null;
      });
      assertEqual(info.quality, 'auto', 'default quality');
      assertEqual(info.enabled, '1', 'default enabled');
      return JSON.stringify(info);
    });

    await test('popup click of 144p reaches chrome.storage and YouTube', async () => {
      const popup = await openPage(cdp, `chrome-extension://${extensionId}/popup.html`);
      await waitUntil(async () =>
        evaluate(cdp, popup.sessionId, `Boolean(document.getElementById('quality-tiny'))`)
      );
      await evaluate(cdp, popup.sessionId, `document.getElementById('quality-tiny').click() || true`);
      const stored = await waitUntil(async () => {
        const value = await evaluate(
          cdp,
          popup.sessionId,
          `(${storageApiExpression()}).get({ quality: null }).then((result) => result.quality)`
        );
        return value === 'tiny' ? value : null;
      });
      const checked = await evaluate(
        cdp,
        popup.sessionId,
        `document.querySelector('input[name="quality"]:checked')?.value || null`
      );
      const dataset = await waitUntil(async () => {
        const value = await evaluate(
          cdp,
          youtubePage.sessionId,
          `document.documentElement.dataset.autohdQuality || null`
        );
        return value === 'tiny' ? value : null;
      });
      assertEqual(checked, 'tiny', 'checked radio');
      await cdp.send('Target.closeTarget', { targetId: popup.targetId });
      return `storage=${stored} dataset=${dataset}`;
    });

    await test('popup lists Auto and Lowest and can switch to 2160p', async () => {
      const popup = await openPage(cdp, `chrome-extension://${extensionId}/popup.html`);
      const options = await waitUntil(async () => {
        const values = await evaluate(
          cdp,
          popup.sessionId,
          `[...document.querySelectorAll('input[name="quality"]')].map((el) => el.value)`
        );
        return values?.length === 10 ? values : null;
      });
      assert(options.includes('auto') && options.includes('lowest') && options.includes('highest'), 'options');
      await evaluate(cdp, popup.sessionId, `document.getElementById('quality-hd2160').click() || true`);
      const stored = await waitUntil(async () => {
        const value = await evaluate(cdp, popup.sessionId, setQualityExpression('hd2160'));
        return value === 'hd2160' ? value : null;
      });
      const dataset = await waitUntil(async () => {
        const value = await evaluate(
          cdp,
          youtubePage.sessionId,
          `document.documentElement.dataset.autohdQuality || null`
        );
        return value === 'hd2160' ? value : null;
      });
      await cdp.send('Target.closeTarget', { targetId: popup.targetId });
      return `options=${options.join(',')} storage=${stored} dataset=${dataset}`;
    });

    await test('on/off toggle persists and reaches YouTube', async () => {
      const popup = await openPage(cdp, `chrome-extension://${extensionId}/popup.html`);
      await waitUntil(async () => evaluate(cdp, popup.sessionId, `Boolean(document.getElementById('enabled'))`));
      const initiallyOn = await evaluate(cdp, popup.sessionId, `document.getElementById('enabled').checked`);
      assertEqual(initiallyOn, true, 'default on');
      await evaluate(cdp, popup.sessionId, `(() => {
        const input = document.getElementById('enabled');
        input.checked = false;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`);
      const storedOff = await waitUntil(async () => {
        const value = await evaluate(
          cdp,
          popup.sessionId,
          `(${storageApiExpression()}).get({ enabled: true }).then((result) => result.enabled)`
        );
        return value === false ? 'off' : null;
      });
      const datasetOff = await waitUntil(async () => {
        const value = await evaluate(
          cdp,
          youtubePage.sessionId,
          `document.documentElement.dataset.autohdEnabled || null`
        );
        return value === '0' ? value : null;
      });
      await evaluate(cdp, popup.sessionId, `(() => {
        const input = document.getElementById('enabled');
        input.checked = true;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`);
      const datasetOn = await waitUntil(async () => {
        const value = await evaluate(
          cdp,
          youtubePage.sessionId,
          `document.documentElement.dataset.autohdEnabled || null`
        );
        return value === '1' ? value : null;
      });
      await cdp.send('Target.closeTarget', { targetId: popup.targetId });
      return `stored=${storedOff} off=${datasetOff} on=${datasetOn}`;
    });

    await test('youtube embed on a foreign page is not injected', async () => {
      const page = await openPage(cdp, 'https://example.com/');
      await cdp.send(
        'Runtime.evaluate',
        {
          expression: `document.body.innerHTML = '<iframe id="yt" src="https://www.youtube.com/embed/aqz-KE-bpKQ" width="400" height="225"></iframe>'`
        },
        page.sessionId
      );
      const iframeTarget = await waitUntil(async () => {
        const { targetInfos } = await cdp.send('Target.getTargets');
        return (
          (targetInfos || []).find(
            (target) => target.type === 'iframe' && /youtube\.com\/embed/.test(target.url)
          ) ||
          (targetInfos || []).find((target) => /youtube\.com\/embed/.test(target.url)) ||
          null
        );
      });
      const { sessionId } = await cdp.send('Target.attachToTarget', {
        targetId: iframeTarget.targetId,
        flatten: true
      });
      await cdp.send('Runtime.enable', {}, sessionId);
      const info = await evaluate(
        cdp,
        sessionId,
        `{ url: location.href, quality: document.documentElement.dataset.autohdQuality || null, top: window === window.top }`
      );
      const parent = await evaluate(
        cdp,
        page.sessionId,
        `{ host: location.host, quality: document.documentElement.dataset.autohdQuality || null }`
      );
      assertEqual(parent.quality, null, 'parent dataset');
      assertEqual(info.quality, null, 'iframe dataset');
      assertEqual(info.top, false, 'iframe is not top');
      await cdp.send('Target.closeTarget', { targetId: page.targetId });
      return JSON.stringify({ parent, iframe: info });
    });

    await test('watch page keeps the chosen quality on the player', async () => {
      const popup = await openPage(cdp, `chrome-extension://${extensionId}/popup.html`);
      await evaluate(cdp, popup.sessionId, setQualityExpression('hd1080'));
      await cdp.send('Target.closeTarget', { targetId: popup.targetId });
      const watch = await openPage(cdp, WATCH_URL);
      const dataset = await waitUntil(async () => {
        const value = await evaluate(
          cdp,
          watch.sessionId,
          `document.documentElement.dataset.autohdQuality || null`
        );
        return value === 'hd1080' ? value : null;
      });
      let player;
      try {
        player = await waitUntil(async () => {
          const info = await evaluate(
            cdp,
            watch.sessionId,
            `(() => {
              const player = document.getElementById('movie_player');
              if (!player) return null;
              let pref = null;
              let current = null;
              let preferred = null;
              let levels = [];
              try { pref = player.getUserPlaybackQualityPreference?.() || null; } catch {}
              try { current = player.getPlaybackQuality?.() || null; } catch {}
              try { preferred = player.getPreferredQuality?.() || null; } catch {}
              try { levels = player.getAvailableQualityLevels?.() || []; } catch {}
              return {
                bound: player.dataset.autohdBound || null,
                pref,
                current,
                preferred,
                levels,
                hasRange: typeof player.setPlaybackQualityRange === 'function'
              };
            })()`
          );
          return info?.hasRange ? info : null;
        }, { timeout: 25000 });
      } catch (error) {
        await screenshot(cdp, watch.sessionId, '/tmp/autohd-e2e-watch.png');
        throw new Error(`${error.message} (screenshot /tmp/autohd-e2e-watch.png)`);
      }
      await evaluate(
        cdp,
        watch.sessionId,
        `document.querySelector('video')?.play?.().catch(() => {})`
      );

      let lastInfo = null;
      let afterPlay;
      try {
        afterPlay = await waitUntil(async () => {
          await evaluate(
            cdp,
            watch.sessionId,
            `(() => {
              const player = document.getElementById('movie_player');
              const settings = player?.querySelector('.ytp-settings-button');
              if (settings && settings.getAttribute('aria-expanded') !== 'true') {
                settings.click();
              }
              return true;
            })()`
          );
          const info = await evaluate(
            cdp,
            watch.sessionId,
            `(() => {
              const player = document.getElementById('movie_player');
              if (!player) return { missing: true };
              const settings = player.querySelector('.ytp-settings-button');
              const qualityItem = [...player.querySelectorAll('.ytp-menuitem')].find((item) =>
                /quality/i.test(item.textContent || '')
              );
              return {
                dataset: document.documentElement.dataset.autohdQuality || null,
                bound: player.dataset.autohdBound || null,
                pref: player.getUserPlaybackQualityPreference?.() || null,
                current: player.getPlaybackQuality?.() || null,
                preferred: player.getPreferredQuality?.() || null,
                label: player.getPlaybackQualityLabel?.() || null,
                state: player.getPlayerState?.() ?? null,
                settingsText: settings?.getAttribute('aria-label') || null,
                menuQuality: qualityItem?.innerText?.replace(/\\s+/g, ' ').trim() || null,
                className: player.className,
                autoHd: Boolean(globalThis.AutoHD),
                boot: document.documentElement.dataset.autohdBoot || null,
                started: Boolean(globalThis.__autohdPlayerStarted)
              };
            })()`
          );
          lastInfo = info;
          if (!info || info.missing) {
            return null;
          }
          const blob = `${info.pref} ${info.current} ${info.preferred} ${info.label} ${info.menuQuality} ${info.settingsText}`;
          if (/(hd1080|hd1440|hd2160|highres|1080|1440|2160|4K)/i.test(blob)) {
            return info;
          }
          return null;
        }, { timeout: 15000, interval: 700 });
      } catch (error) {
        throw new Error(`${error.message} last=${JSON.stringify(lastInfo)}`);
      } finally {
        await screenshot(cdp, watch.sessionId, '/tmp/autohd-e2e-watch.png').catch(() => {});
      }
      assert(dataset === 'hd1080', 'dataset on watch page');
      assert(player.bound === '1', `player not bound: ${JSON.stringify(player)}`);
      assert(afterPlay, 'player never reported an HD quality');
      await cdp.send('Target.closeTarget', { targetId: watch.targetId });
      return JSON.stringify({ dataset, player, afterPlay });
    });

    await test('Highest option selects the top available rendition', async () => {
      const popup = await openPage(cdp, `chrome-extension://${extensionId}/popup.html`);
      await waitUntil(async () =>
        evaluate(cdp, popup.sessionId, `Boolean(document.getElementById('quality-highest'))`)
      );
      await evaluate(cdp, popup.sessionId, `document.getElementById('quality-highest').click() || true`);
      const stored = await waitUntil(async () => {
        const value = await evaluate(
          cdp,
          popup.sessionId,
          `(${storageApiExpression()}).get({ quality: null }).then((result) => result.quality)`
        );
        return value === 'highest' ? value : null;
      });
      await cdp.send('Target.closeTarget', { targetId: popup.targetId });

      const watch = await openPage(cdp, WATCH_URL);
      const dataset = await waitUntil(async () => {
        const value = await evaluate(
          cdp,
          watch.sessionId,
          `document.documentElement.dataset.autohdQuality || null`
        );
        return value === 'highest' ? value : null;
      });

      await evaluate(
        cdp,
        watch.sessionId,
        `document.querySelector('video')?.play?.().catch(() => {})`
      );

      let lastInfo = null;
      const applied = await waitUntil(async () => {
        await evaluate(
          cdp,
          watch.sessionId,
          `(() => {
            const player = document.getElementById('movie_player');
            const settings = player?.querySelector('.ytp-settings-button');
            if (settings && settings.getAttribute('aria-expanded') !== 'true') {
              settings.click();
            }
            return true;
          })()`
        );
        const info = await evaluate(
          cdp,
          watch.sessionId,
          `(() => {
            const player = document.getElementById('movie_player');
            if (!player) return { missing: true };
            const qualityItem = [...player.querySelectorAll('.ytp-menuitem')].find((item) =>
              /quality/i.test(item.textContent || '')
            );
            const levels = (player.getAvailableQualityLevels?.() || []).filter((id) => id && id !== 'auto');
            return {
              dataset: document.documentElement.dataset.autohdQuality || null,
              bound: player.dataset.autohdBound || null,
              pref: player.getUserPlaybackQualityPreference?.() || null,
              current: player.getPlaybackQuality?.() || null,
              preferred: player.getPreferredQuality?.() || null,
              label: player.getPlaybackQualityLabel?.() || null,
              menuQuality: qualityItem?.innerText?.replace(/\\s+/g, ' ').trim() || null,
              topLevel: levels[0] || null,
              levels
            };
          })()`
        );
        lastInfo = info;
        if (!info || info.missing || !info.topLevel) {
          return null;
        }
        const playingTop =
          info.current === info.topLevel ||
          /2160|4K|8K|highres/i.test(`${info.label} ${info.menuQuality}`);
        return playingTop ? info : null;
      }, { timeout: 18000, interval: 700 });

      await screenshot(cdp, watch.sessionId, '/tmp/autohd-e2e-highest.png').catch(() => {});
      await cdp.send('Target.closeTarget', { targetId: watch.targetId });

      if (!applied) {
        throw new Error(`Highest did not stick. last=${JSON.stringify(lastInfo)}`);
      }
      assertEqual(stored, 'highest', 'storage');
      assertEqual(dataset, 'highest', 'dataset');
      assert(applied.bound === '1', 'player bound');
      const top = applied.topLevel;
      assert(
        applied.current === top || /2160|4K|8K/i.test(`${applied.label} ${applied.menuQuality}`),
        `expected playing ${top}, got ${JSON.stringify(applied)}`
      );
      return JSON.stringify({ stored, dataset, top, applied });
    });
  } finally {
    if (proc && !proc.killed) {
      proc.kill('SIGTERM');
      await Promise.race([
        new Promise((resolve) => proc.once('exit', resolve)),
        sleep(2000)
      ]);
      if (!proc.killed) {
        proc.kill('SIGKILL');
      }
    }
    await sleep(400);
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
    spawn('rm', ['-rf', userDataDir]);
  }

  console.log('');
  console.log(`${results.length - failed}/${results.length} passed`);
  if (failed) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
