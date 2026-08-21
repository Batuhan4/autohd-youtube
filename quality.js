'use strict';

const AutoHD = (() => {
  const STORAGE_KEY = 'quality';
  const ENABLED_KEY = 'enabled';
  const DEFAULT_QUALITY = 'auto';
  const DEFAULT_ENABLED = true;
  const DATASET_KEY = 'autohdQuality';
  const DATASET_ENABLED_KEY = 'autohdEnabled';
  const EVENT_NAME = 'autohd-youtube-quality';

  const QUALITY_LEVELS = [
    { id: 'highres', height: 4320 },
    { id: 'hd2160', height: 2160 },
    { id: 'hd1440', height: 1440 },
    { id: 'hd1080', height: 1080 },
    { id: 'hd720', height: 720 },
    { id: 'large', height: 480 },
    { id: 'medium', height: 360 },
    { id: 'small', height: 240 },
    { id: 'tiny', height: 144 }
  ];

  const OPTIONS = [
    { id: 'auto', label: 'Auto', hint: 'YouTube' },
    { id: 'highest', label: 'Highest', hint: 'Best available' },
    { id: 'hd2160', label: '2160p', hint: '4K' },
    { id: 'hd1440', label: '1440p', hint: '' },
    { id: 'hd1080', label: '1080p', hint: 'Full HD' },
    { id: 'hd720', label: '720p', hint: 'HD' },
    { id: 'large', label: '480p', hint: '' },
    { id: 'medium', label: '360p', hint: '' },
    { id: 'tiny', label: '144p', hint: '' },
    { id: 'lowest', label: 'Lowest', hint: 'Smallest' }
  ];

  function heightFromId(id) {
    if (!id || id === 'highest' || id === 'lowest' || id === 'auto') {
      return 0;
    }
    const exact = QUALITY_LEVELS.find((level) => level.id === id);
    if (exact) {
      return exact.height;
    }
    const prefix = QUALITY_LEVELS.find((level) => id.startsWith(level.id));
    return prefix ? prefix.height : 0;
  }

  function heightFromLabel(label) {
    if (!label) {
      return 0;
    }
    const match = String(label).match(/(\d{3,4})\s*p/i);
    return match ? Number(match[1]) : 0;
  }

  function normalizeAvailable(available) {
    if (!Array.isArray(available)) {
      return [];
    }

    return available
      .filter((item) => item && item.id && item.id !== 'auto' && item.playable !== false)
      .map((item) => ({
        id: item.id,
        height: Number(item.height) || heightFromLabel(item.label) || heightFromId(item.id)
      }))
      .filter((item) => item.height > 0)
      .sort((a, b) => b.height - a.height);
  }

  function shouldForce(preferred) {
    return isOptionId(preferred) && preferred !== 'auto';
  }

  function pickQuality(preferred, available) {
    if (preferred === 'auto') {
      return null;
    }

    const ranked = normalizeAvailable(available);
    if (!ranked.length) {
      return null;
    }
    if (!preferred || preferred === 'highest') {
      return ranked[0].id;
    }
    if (preferred === 'lowest') {
      return ranked[ranked.length - 1].id;
    }

    const target = heightFromId(preferred);
    if (!target) {
      return ranked[0].id;
    }

    const fit = ranked.find((item) => item.height <= target);
    return (fit || ranked[ranked.length - 1]).id;
  }

  function isOptionId(id) {
    return OPTIONS.some((option) => option.id === id);
  }

  function isEnabledValue(value) {
    return value !== false && value !== '0' && value !== 0;
  }

  return {
    STORAGE_KEY,
    ENABLED_KEY,
    DEFAULT_QUALITY,
    DEFAULT_ENABLED,
    DATASET_KEY,
    DATASET_ENABLED_KEY,
    EVENT_NAME,
    QUALITY_LEVELS,
    OPTIONS,
    heightFromId,
    heightFromLabel,
    shouldForce,
    pickQuality,
    isOptionId,
    isEnabledValue
  };
})();

globalThis.AutoHD = AutoHD;

if (
  typeof module === 'object' &&
  module &&
  module.exports &&
  typeof process === 'object' &&
  process.versions &&
  process.versions.node
) {
  module.exports = AutoHD;
}
