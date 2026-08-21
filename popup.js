'use strict';

const form = document.getElementById('qualities');

for (const option of AutoHD.OPTIONS) {
  const inputId = `quality-${option.id}`;
  const label = document.createElement('label');
  label.htmlFor = inputId;

  const input = document.createElement('input');
  input.type = 'radio';
  input.name = 'quality';
  input.id = inputId;
  input.value = option.id;

  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = option.label;

  label.append(input, name);

  if (option.hint) {
    const hint = document.createElement('span');
    hint.className = 'hint';
    hint.textContent = option.hint;
    label.append(hint);
  }

  form.append(label);
}

function selectQuality(quality) {
  const value = AutoHD.isOptionId(quality) ? quality : AutoHD.DEFAULT_QUALITY;
  const input = form.querySelector(`input[value="${value}"]`);
  if (input) {
    input.checked = true;
  }
}

const storage = globalThis.chrome?.storage?.sync;

form.addEventListener('change', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || !AutoHD.isOptionId(target.value)) {
    return;
  }
  storage?.set({ [AutoHD.STORAGE_KEY]: target.value });
});

if (storage) {
  storage.get({ [AutoHD.STORAGE_KEY]: AutoHD.DEFAULT_QUALITY }, (result) => {
    if (chrome.runtime.lastError) {
      selectQuality(AutoHD.DEFAULT_QUALITY);
      return;
    }
    selectQuality(result[AutoHD.STORAGE_KEY]);
  });
} else {
  selectQuality(AutoHD.DEFAULT_QUALITY);
}
