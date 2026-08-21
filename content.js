'use strict';

const ext = globalThis.browser ?? globalThis.chrome;

const state = {
  quality: AutoHD.DEFAULT_QUALITY,
  enabled: AutoHD.DEFAULT_ENABLED
};

function publish() {
  const quality = AutoHD.isOptionId(state.quality) ? state.quality : AutoHD.DEFAULT_QUALITY;
  const enabled = AutoHD.isEnabledValue(state.enabled);
  document.documentElement.dataset[AutoHD.DATASET_KEY] = quality;
  document.documentElement.dataset[AutoHD.DATASET_ENABLED_KEY] = enabled ? '1' : '0';
  document.dispatchEvent(
    new CustomEvent(AutoHD.EVENT_NAME, { detail: { quality, enabled } })
  );
}

publish();

async function hydrate() {
  if (!ext?.storage?.sync) {
    return;
  }
  try {
    const result = await ext.storage.sync.get({
      [AutoHD.STORAGE_KEY]: AutoHD.DEFAULT_QUALITY,
      [AutoHD.ENABLED_KEY]: AutoHD.DEFAULT_ENABLED
    });
    state.quality = result[AutoHD.STORAGE_KEY];
    state.enabled = result[AutoHD.ENABLED_KEY];
    publish();
  } catch {
    publish();
  }
}

hydrate();

ext?.storage?.onChanged.addListener((changes, area) => {
  if (area !== 'sync') {
    return;
  }
  let changed = false;
  if (Object.hasOwn(changes, AutoHD.STORAGE_KEY)) {
    state.quality = changes[AutoHD.STORAGE_KEY].newValue;
    changed = true;
  }
  if (Object.hasOwn(changes, AutoHD.ENABLED_KEY)) {
    state.enabled = changes[AutoHD.ENABLED_KEY].newValue;
    changed = true;
  }
  if (changed) {
    publish();
  }
});
