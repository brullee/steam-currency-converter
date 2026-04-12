document.addEventListener('DOMContentLoaded', async () => {
    const toCurrencyInput     = document.getElementById('to-currency');
    const fromCurrencySelect  = document.getElementById('from-currency');
    const toDatalist          = document.getElementById('to-currency-list');
    const conversionToggle    = document.getElementById('conversion-enabled');
    const settingsPanel       = document.getElementById('settings');

    // Populate TO datalist and FROM dropdown with all known Steam currencies
    for (const [code, meta] of Object.entries(CURRENCIES)) {
        const option = document.createElement('option');
        option.value = code;
        option.label = `${meta.symbol}  ${code}`;
        toDatalist.appendChild(option);

        const selectOption = document.createElement('option');
        selectOption.value = code;
        selectOption.textContent = `${code}  ${meta.symbol}`;
        fromCurrencySelect.appendChild(selectOption);
    }

    // Load saved settings
    const stored = await chrome.storage.sync.get(['targetCurrency', 'fromCurrency', 'stripTrailingCode', 'conversionEnabled']);
    toCurrencyInput.value    = stored.targetCurrency  || 'JOD';
    fromCurrencySelect.value = stored.fromCurrency    || '';
    document.getElementById('strip-trailing').checked = !!stored.stripTrailingCode;
    conversionToggle.checked = stored.conversionEnabled !== false; // default on

    // Dim settings when conversion is off
    const syncPanel = () => settingsPanel.classList.toggle('disabled', !conversionToggle.checked);
    syncPanel();
    conversionToggle.addEventListener('change', syncPanel);

    document.getElementById('save').addEventListener('click', async () => {
        const toCode          = toCurrencyInput.value.trim().toUpperCase();
        const fromCode        = fromCurrencySelect.value || null;
        const stripTrailing   = document.getElementById('strip-trailing').checked;
        const conversionEnabled = conversionToggle.checked;
        if (!toCode) return;

        await chrome.storage.sync.set({ targetCurrency: toCode, fromCurrency: fromCode, stripTrailingCode: stripTrailing, conversionEnabled });

        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id) chrome.tabs.reload(tab.id);

        const fromLabel = fromCode ? `${fromCode} → ` : '';
        document.getElementById('status').textContent = conversionEnabled
            ? `Saved — ${fromLabel}${toCode}`
            : 'Saved — conversion off';
        setTimeout(() => window.close(), 600);
    });
});
