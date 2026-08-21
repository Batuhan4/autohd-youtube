const ext = globalThis.browser ?? globalThis.chrome;
const AutoHD = globalThis.AutoHD;
const form = document.getElementById('qualities');
const enabledInput = document.getElementById('enabled');
const switchLabel = document.querySelector('.switch-label');
const storage = ext?.storage?.sync;

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

function setEnabledUi(enabled) {
  enabledInput.checked = enabled;
  switchLabel.textContent = enabled ? 'On' : 'Off';
  document.body.classList.toggle('is-off', !enabled);
  form.setAttribute('aria-disabled', enabled ? 'false' : 'true');
  for (const input of form.querySelectorAll('input')) {
    input.disabled = !enabled;
  }
}

form.addEventListener('change', async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || !AutoHD.isOptionId(target.value) || !storage) {
    return;
  }
  try {
    await storage.set({ [AutoHD.STORAGE_KEY]: target.value });
  } catch {
    // Sync storage can be unavailable if the profile is locked.
  }
});

enabledInput.addEventListener('change', async () => {
  const enabled = enabledInput.checked;
  setEnabledUi(enabled);
  if (!storage) {
    return;
  }
  try {
    await storage.set({ [AutoHD.ENABLED_KEY]: enabled });
  } catch {
    // Ignore.
  }
});

if (storage) {
  try {
    const result = await storage.get({
      [AutoHD.STORAGE_KEY]: AutoHD.DEFAULT_QUALITY,
      [AutoHD.ENABLED_KEY]: AutoHD.DEFAULT_ENABLED
    });
    selectQuality(result[AutoHD.STORAGE_KEY]);
    setEnabledUi(AutoHD.isEnabledValue(result[AutoHD.ENABLED_KEY]));
  } catch {
    selectQuality(AutoHD.DEFAULT_QUALITY);
    setEnabledUi(AutoHD.DEFAULT_ENABLED);
  }
} else {
  selectQuality(AutoHD.DEFAULT_QUALITY);
  setEnabledUi(AutoHD.DEFAULT_ENABLED);
}
