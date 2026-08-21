'use strict';

const AutoHD = globalThis.AutoHD || {
  DEFAULT_QUALITY: 'hd1080',
  DATASET_KEY: 'autohdQuality',
  EVENT_NAME: 'autohd-youtube-quality',
  QUALITY_LEVELS: [
    { id: 'highres', height: 4320 },
    { id: 'hd2160', height: 2160 },
    { id: 'hd1440', height: 1440 },
    { id: 'hd1080', height: 1080 },
    { id: 'hd720', height: 720 },
    { id: 'large', height: 480 },
    { id: 'medium', height: 360 },
    { id: 'small', height: 240 },
    { id: 'tiny', height: 144 }
  ],
  heightFromId(id) {
    if (!id || id === 'highest' || id === 'auto') {
      return 0;
    }
    const exact = this.QUALITY_LEVELS.find((level) => level.id === id);
    if (exact) {
      return exact.height;
    }
    const prefix = this.QUALITY_LEVELS.find((level) => id.startsWith(level.id));
    return prefix ? prefix.height : 0;
  },
  heightFromLabel(label) {
    const match = String(label || '').match(/(\d{3,4})\s*p/i);
    return match ? Number(match[1]) : 0;
  },
  isOptionId(id) {
    return (
      id === 'highest' ||
      this.QUALITY_LEVELS.some((level) => level.id === id)
    );
  },
  pickQuality(preferred, available) {
    const ranked = (available || [])
      .filter((item) => item && item.id && item.id !== 'auto' && item.playable !== false)
      .map((item) => ({
        id: item.id,
        height: Number(item.height) || this.heightFromLabel(item.label) || this.heightFromId(item.id)
      }))
      .filter((item) => item.height > 0)
      .sort((a, b) => b.height - a.height);
    if (!ranked.length) {
      return null;
    }
    if (!preferred || preferred === 'highest') {
      return ranked[0].id;
    }
    const target = this.heightFromId(preferred);
    if (!target) {
      return ranked[0].id;
    }
    const fit = ranked.find((item) => item.height <= target);
    return (fit || ranked[ranked.length - 1]).id;
  }
};

function autohdPlayerMain(AutoHD) {
  const MAX_APPLIES_PER_VIDEO = 24;
  const MENU_COOLDOWN_MS = 5000;
  const API_COOLDOWN_MS = 500;
  const applyCounts = new Map();
  let generation = 0;
  let lastHref = location.href;
  let debounceTimer = 0;
  let lastMenuAttempt = 0;
  let lastApiApply = 0;
  let menuTimer = 0;

  function preferredQuality() {
    const value = document.documentElement.dataset[AutoHD.DATASET_KEY];
    return AutoHD.isOptionId(value) ? value : AutoHD.DEFAULT_QUALITY;
  }

  function isPreviewPlayer(player) {
    if (!player) {
      return true;
    }
    if (player.id === 'inline-preview-player') {
      return true;
    }
    if (player.closest('#inline-preview-player, ytd-video-preview, .ytp-inline-preview-ui')) {
      return true;
    }
    return player.classList.contains('ytp-inline-preview-ui');
  }

  function isAdPlaying(player) {
    return player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting');
  }

  function isPlayerError(player) {
    if (player.classList.contains('ytp-error')) {
      return true;
    }
    const error = player.querySelector('.ytp-error-content-wrap, .ytp-error-content');
    return Boolean(error && isVisible(error));
  }

  function isVisible(element) {
    if (!element) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function playerState(player) {
    try {
      return player.getPlayerState?.() ?? -1;
    } catch {
      return -1;
    }
  }

  function isActivePlayback(player) {
    const state = playerState(player);
    return state === 1 || state === 2 || state === 3;
  }

  function players() {
    return [...document.querySelectorAll('.html5-video-player')].filter((player) => !isPreviewPlayer(player));
  }

  function videoKey(player) {
    try {
      return player.getVideoData?.()?.video_id || location.pathname;
    } catch {
      return location.pathname;
    }
  }

  function listAvailable(player) {
    try {
      if (typeof player.getAvailableQualityData === 'function') {
        const data = player.getAvailableQualityData() || [];
        if (data.length) {
          return data.map((item) => ({
            id: item.quality,
            label: item.qualityLabel,
            height: AutoHD.heightFromLabel(item.qualityLabel) || AutoHD.heightFromId(item.quality),
            playable: item.isPlayable !== false
          }));
        }
      }
      if (typeof player.getAvailableQualityLevels === 'function') {
        return (player.getAvailableQualityLevels() || []).map((id) => ({
          id,
          height: AutoHD.heightFromId(id),
          playable: true
        }));
      }
    } catch {
      // Player internals are not ready yet.
    }
    return [];
  }

  function setPlayerQuality(player, qualityId) {
    let applied = false;
    try {
      if (typeof player.setPlaybackQualityRange === 'function') {
        player.setPlaybackQualityRange(qualityId, qualityId);
        applied = true;
      }
    } catch {
      // Fall through to the older method.
    }
    try {
      if (typeof player.setPlaybackQuality === 'function') {
        player.setPlaybackQuality(qualityId);
        applied = true;
      }
    } catch {
      // Ignore.
    }
    return applied;
  }

  function hintYouTubeStorage(preferred) {
    const height = preferred === 'highest' ? 4320 : AutoHD.heightFromId(preferred);
    if (!height) {
      return;
    }
    try {
      localStorage.setItem(
        'yt-player-quality',
        JSON.stringify({
          data: JSON.stringify({ quality: height, previousQuality: height }),
          expiration: Date.now() + 1000 * 60 * 60 * 24 * 30,
          creation: Date.now()
        })
      );
    } catch {
      // Page storage can be unavailable.
    }
  }

  function settingsButton(player) {
    return player.querySelector('.ytp-settings-button');
  }

  function isMenuOpen(player) {
    const button = settingsButton(player);
    if (!button) {
      return false;
    }
    return button.getAttribute('aria-expanded') === 'true' || button.getAttribute('aria-pressed') === 'true';
  }

  function qualityButtons(player) {
    return [...player.querySelectorAll('.ytp-menuitem, .ytp-drop-down-menu-button')].filter(
      (element) => isVisible(element) && /^\s*\d{3,4}p/i.test(element.textContent || '')
    );
  }

  function actualQualityId(player) {
    try {
      const id = player.getPlaybackQuality?.();
      if (id && id !== 'unknown' && id !== 'auto') {
        return id;
      }
    } catch {
      // Ignore.
    }
    try {
      const height = AutoHD.heightFromLabel(player.getPlaybackQualityLabel?.());
      const match = AutoHD.QUALITY_LEVELS.find((level) => level.height === height);
      if (match) {
        return match.id;
      }
    } catch {
      // Ignore.
    }
    return '';
  }

  function closeMenu(player) {
    const back = player.querySelector('.ytp-panel-header button');
    if (back) {
      back.click();
      return;
    }
    settingsButton(player)?.click();
  }

  function clickMatchingQuality(player, preferred) {
    const buttons = qualityButtons(player);
    if (!buttons.length) {
      return false;
    }

    const items = buttons
      .map((element) => ({
        element,
        height: parseInt(element.textContent, 10) || AutoHD.heightFromLabel(element.textContent)
      }))
      .filter((item) => item.height > 0);

    if (!items.length) {
      return false;
    }

    let choice;
    if (preferred === 'highest') {
      choice = items[0];
    } else {
      const target = AutoHD.heightFromId(preferred);
      choice = items.find((item) => item.height <= target) || items[items.length - 1];
    }

    if (choice.element.getAttribute('aria-checked') !== 'true') {
      choice.element.click();
    } else {
      closeMenu(player);
    }
    return true;
  }

  function applyViaMenu(player, preferred) {
    if (isMenuOpen(player)) {
      return false;
    }
    const button = settingsButton(player);
    if (!button) {
      return false;
    }

    button.click();
    window.setTimeout(() => {
      if (clickMatchingQuality(player, preferred)) {
        return;
      }
      const items = [...player.querySelectorAll('.ytp-menuitem')];
      const qualityItem = items.find((item) => {
        const content = item.querySelector('.ytp-menuitem-content')?.textContent || '';
        return /\d{3,4}p/i.test(content) || /quality/i.test(item.textContent || '');
      });
      if (!qualityItem) {
        button.click();
        return;
      }
      qualityItem.click();
      window.setTimeout(() => {
        if (!clickMatchingQuality(player, preferred)) {
          closeMenu(player);
        }
      }, 60);
    }, 60);
    return true;
  }

  function scheduleMenuFallback(player, preferred, target) {
    window.clearTimeout(menuTimer);
    menuTimer = window.setTimeout(() => {
      if (isPreviewPlayer(player) || isAdPlaying(player) || isPlayerError(player) || isMenuOpen(player)) {
        return;
      }
      if (actualQualityId(player) === target) {
        return;
      }
      if (Date.now() - lastMenuAttempt < MENU_COOLDOWN_MS) {
        return;
      }
      lastMenuAttempt = Date.now();
      applyViaMenu(player, preferred);
    }, 900);
  }

  function applyToPlayer(player) {
    if (isPreviewPlayer(player) || isAdPlaying(player) || isPlayerError(player)) {
      return;
    }

    const preferred = preferredQuality();
    hintYouTubeStorage(preferred);

    const available = listAvailable(player);
    const target = AutoHD.pickQuality(preferred, available);
    if (!target) {
      return;
    }

    if (actualQualityId(player) === target) {
      return;
    }

    const key = videoKey(player);
    const count = applyCounts.get(key) || 0;
    const now = Date.now();
    if (now - lastApiApply >= API_COOLDOWN_MS && count < MAX_APPLIES_PER_VIDEO) {
      lastApiApply = now;
      if (isActivePlayback(player)) {
        applyCounts.set(key, count + 1);
      }
      setPlayerQuality(player, target);
    }

    if (isActivePlayback(player) && actualQualityId(player) !== target) {
      scheduleMenuFallback(player, preferred, target);
    }
  }

  function applyAll() {
    for (const player of players()) {
      bindPlayer(player);
      applyToPlayer(player);
    }
  }

  function schedule() {
    generation += 1;
    const token = generation;
    const delays = [0, 200, 700, 1600, 3200, 6000];
    for (const delay of delays) {
      window.setTimeout(() => {
        if (token !== generation) {
          return;
        }
        applyAll();
      }, delay);
    }
  }

  function onNavigation() {
    if (location.href === lastHref) {
      return;
    }
    lastHref = location.href;
    applyCounts.clear();
    lastMenuAttempt = 0;
    schedule();
  }

  function bindPlayer(player) {
    if (player.dataset.autohdBound === '1') {
      return;
    }
    player.dataset.autohdBound = '1';
    try {
      player.addEventListener('onStateChange', (state) => {
        if (state === 1 || state === 3) {
          applyToPlayer(player);
        }
      });
      player.addEventListener('onPlaybackQualityChange', () => {
        window.setTimeout(() => applyToPlayer(player), 400);
      });
    } catch {
      // Some player instances reject listeners until they finish setup.
    }
  }

  function onVideoEvent(event) {
    if (!(event.target instanceof HTMLVideoElement)) {
      return;
    }
    const player = event.target.closest('.html5-video-player');
    if (!player || isPreviewPlayer(player)) {
      return;
    }
    bindPlayer(player);
    applyToPlayer(player);
  }

  document.addEventListener('playing', onVideoEvent, true);
  document.addEventListener('canplay', onVideoEvent, true);
  document.addEventListener('loadeddata', onVideoEvent, true);
  document.addEventListener(AutoHD.EVENT_NAME, () => {
    applyCounts.clear();
    lastMenuAttempt = 0;
    schedule();
  });

  window.addEventListener('yt-navigate-finish', () => {
    lastHref = '';
    onNavigation();
  });
  window.addEventListener('yt-page-data-updated', schedule);

  function watchTitle() {
    const title = document.querySelector('title');
    if (title) {
      new MutationObserver(onNavigation).observe(title, { childList: true });
      return;
    }
    if (document.head) {
      new MutationObserver((_, observer) => {
        const nextTitle = document.querySelector('title');
        if (!nextTitle) {
          return;
        }
        observer.disconnect();
        new MutationObserver(onNavigation).observe(nextTitle, { childList: true });
      }).observe(document.head, { childList: true });
      return;
    }
    window.setTimeout(watchTitle, 50);
  }

  watchTitle();

  new MutationObserver(() => {
    applyCounts.clear();
    lastMenuAttempt = 0;
    schedule();
  }).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-autohd-quality']
  });

  new MutationObserver(() => {
    if (!players().some((player) => player.dataset.autohdBound !== '1')) {
      return;
    }
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(applyAll, 120);
  }).observe(document.documentElement, { childList: true, subtree: true });

  schedule();
}

document.documentElement.dataset.autohdBoot = 'started';
autohdPlayerMain(AutoHD);
