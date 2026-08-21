'use strict';

function publish(quality) {
  const next = AutoHD.isOptionId(quality) ? quality : AutoHD.DEFAULT_QUALITY;
  document.documentElement.dataset[AutoHD.DATASET_KEY] = next;
  document.dispatchEvent(new CustomEvent(AutoHD.EVENT_NAME, { detail: { quality: next } }));
}

publish(AutoHD.DEFAULT_QUALITY);

chrome.storage.sync.get({ [AutoHD.STORAGE_KEY]: AutoHD.DEFAULT_QUALITY }, (result) => {
  if (chrome.runtime.lastError) {
    return;
  }
  publish(result[AutoHD.STORAGE_KEY]);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') {
    return;
  }
  const change = changes[AutoHD.STORAGE_KEY];
  if (!change) {
    return;
  }
  publish(change.newValue);
});
