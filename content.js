'use strict';

const ext = globalThis.browser ?? globalThis.chrome;

function publish(quality) {
  const next = AutoHD.isOptionId(quality) ? quality : AutoHD.DEFAULT_QUALITY;
  document.documentElement.dataset[AutoHD.DATASET_KEY] = next;
  document.dispatchEvent(new CustomEvent(AutoHD.EVENT_NAME, { detail: { quality: next } }));
}

publish(AutoHD.DEFAULT_QUALITY);

async function hydrate() {
  if (!ext?.storage?.sync) {
    return;
  }
  try {
    const result = await ext.storage.sync.get({
      [AutoHD.STORAGE_KEY]: AutoHD.DEFAULT_QUALITY
    });
    publish(result[AutoHD.STORAGE_KEY]);
  } catch {
    publish(AutoHD.DEFAULT_QUALITY);
  }
}

hydrate();

ext?.storage?.onChanged.addListener((changes, area) => {
  if (area !== 'sync') {
    return;
  }
  const change = changes[AutoHD.STORAGE_KEY];
  if (!change) {
    return;
  }
  publish(change.newValue);
});
