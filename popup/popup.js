document.addEventListener('DOMContentLoaded', async () => {
    const toCurrencyInput    = document.getElementById('to-currency');
    const fromCurrencySelect = document.getElementById('from-currency');
    const toDropdown         = document.getElementById('to-currency-dropdown');
    const conversionToggle   = document.getElementById('conversion-enabled');

    // Build currency list and populate FROM select
    const allCurrencies = [];
    for (const [code, meta] of Object.entries(CURRENCIES)) {
        allCurrencies.push({ code, label: `${code}  ${meta.symbol}` });

        if (meta.toOnly) continue;
        const selectOption = document.createElement('option');
        selectOption.value = code;
        selectOption.textContent = `${code}  ${meta.symbol}`;
        fromCurrencySelect.appendChild(selectOption);
    }

    // Custom combobox for TO currency
    let activeIdx = -1;

    const renderDropdown = items => {
        toDropdown.innerHTML = '';
        activeIdx = -1;
        if (!items.length) { toDropdown.hidden = true; return; }
        items.forEach(({ code, label }) => {
            const li = document.createElement('li');
            li.textContent = label;
            li.dataset.code = code;
            li.addEventListener('mousedown', e => {
                e.preventDefault(); // keep focus on input
                toCurrencyInput.value = code;
                toDropdown.hidden = true;
            });
            toDropdown.appendChild(li);
        });
        toDropdown.hidden = false;
    };

    toCurrencyInput.addEventListener('input', () => {
        const q = toCurrencyInput.value.trim().toUpperCase();
        if (!q) { toDropdown.hidden = true; return; }
        const matches = allCurrencies
            .filter(({ code, label }) => code.startsWith(q) || label.toUpperCase().includes(q))
            .slice(0, 20);
        renderDropdown(matches);
    });

    toCurrencyInput.addEventListener('keydown', e => {
        const items = toDropdown.querySelectorAll('li');
        if (toDropdown.hidden || !items.length) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            activeIdx = Math.min(activeIdx + 1, items.length - 1);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            activeIdx = Math.max(activeIdx - 1, 0);
        } else if (e.key === 'Enter' && activeIdx >= 0) {
            e.preventDefault();
            toCurrencyInput.value = items[activeIdx].dataset.code;
            toDropdown.hidden = true;
            return;
        } else if (e.key === 'Escape') {
            toDropdown.hidden = true;
            return;
        } else { return; }
        items.forEach((li, i) => li.setAttribute('aria-selected', i === activeIdx ? 'true' : 'false'));
        items[activeIdx]?.scrollIntoView({ block: 'nearest' });
    });

    toCurrencyInput.addEventListener('blur', () => {
        setTimeout(() => { toDropdown.hidden = true; }, 150);
    });

    // Load saved settings
    const stored = await chrome.storage.sync.get([
        'targetCurrency', 'fromCurrency', 'conversionEnabled',
        'hoverEnabled', 'stripTrailingCode', 'customSymbol', 'symbolPosition', 'symbolSpace', 'applyFormatting',
        'decimalSep', 'thousandsSep', 'hideZeroDecimals',
    ]);
    toCurrencyInput.value    = (stored.targetCurrency === 'ILS' || stored.targetCurrency === 'ISL') ? '' : (stored.targetCurrency || '');
    fromCurrencySelect.value = (stored.fromCurrency   === 'ILS' || stored.fromCurrency   === 'ISL') ? '' : (stored.fromCurrency   || '');
    conversionToggle.checked = stored.conversionEnabled !== false;
    document.getElementById('hover-enabled').checked   = stored.hoverEnabled !== false;
    document.getElementById('strip-trailing').checked  = !!stored.stripTrailingCode;
    document.getElementById('custom-symbol').value     = stored.customSymbol || '';
    document.getElementById('sym-space').checked       = !!stored.symbolSpace;
    const applyToVal = stored.applyFormatting || 'converted';
    const applyToEl  = document.querySelector(`input[name="apply-to"][value="${applyToVal}"]`);
    if (applyToEl) applyToEl.checked = true;
    const posValue = stored.symbolPosition || '';
    document.querySelector(`input[name="sym-pos"][value="${posValue}"]`).checked = true;
    const decSepEl = document.querySelector(`input[name="dec-sep"][value="${stored.decimalSep || ''}"]`);
    if (decSepEl) decSepEl.checked = true;
    document.getElementById('thou-sep').value = stored.thousandsSep || '';
    document.getElementById('hide-zero-decimals').checked = !!stored.hideZeroDecimals;

    // Separator mutual exclusion: whichever symbol is chosen for one, disable it in the other
    const thouSelect = document.getElementById('thou-sep');
    const onDecChange = () => {
        const decVal = document.querySelector('input[name="dec-sep"]:checked')?.value || '';
        thouSelect.querySelectorAll('option').forEach(opt => {
            const conflict = !!(decVal && opt.value === decVal);
            if (conflict && thouSelect.value === opt.value) thouSelect.value = '';
            opt.disabled = conflict;
        });
    };
    const onThouChange = () => {
        const thouVal = thouSelect.value;
        document.querySelectorAll('input[name="dec-sep"]').forEach(r => {
            const conflict = !!(thouVal && r.value === thouVal);
            if (conflict && r.checked) document.querySelector('input[name="dec-sep"][value=""]').checked = true;
            r.disabled = conflict;
        });
    };
    document.querySelectorAll('input[name="dec-sep"]').forEach(r => r.addEventListener('change', onDecChange));
    thouSelect.addEventListener('change', onThouChange);
    onDecChange();
    onThouChange();

    // Dim "to currency" group when conversion is off
    const toCurrencyGroup  = document.getElementById('to-currency-group');
    const stripTrailingLabel = document.querySelector('label.checkbox-label:has(#strip-trailing)');
    const syncPanel = () => toCurrencyGroup.classList.toggle('field-dimmed', !conversionToggle.checked);
    const syncStripTrail = () => {
        stripTrailingLabel.hidden = fromCurrencySelect.value !== 'USD';
    };
    syncPanel();
    syncStripTrail();
    conversionToggle.addEventListener('change', syncPanel);
    fromCurrencySelect.addEventListener('change', syncStripTrail);

    const saveAndRefresh = async data => {
        await chrome.storage.sync.set(data);
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id) chrome.tabs.reload(tab.id);
        setTimeout(() => window.close(), 600);
    };

    // Page navigation
    document.getElementById('more-btn').addEventListener('click', () => {
        document.getElementById('page-main').hidden = true;
        document.getElementById('page-more').hidden = false;
    });
    document.getElementById('back-btn').addEventListener('click', () => {
        document.getElementById('page-more').hidden = true;
        document.getElementById('page-main').hidden = false;
    });

    // Main save
    document.getElementById('save').addEventListener('click', () => {
        const toCode            = toCurrencyInput.value.trim().toUpperCase();
        const fromCode          = fromCurrencySelect.value || null;
        const conversionEnabled = conversionToggle.checked;
        const hoverEnabled      = document.getElementById('hover-enabled').checked;
        const stripTrailingCode = document.getElementById('strip-trailing').checked;
        if (!toCode || !fromCode) return;
        saveAndRefresh({ targetCurrency: toCode, fromCurrency: fromCode, conversionEnabled, hoverEnabled, stripTrailingCode });
    });

    // More settings save
    document.getElementById('save-more').addEventListener('click', () => {
        const customSymbol     = document.getElementById('custom-symbol').value.trim();
        const symbolPosition   = document.querySelector('input[name="sym-pos"]:checked').value;
        const symbolSpace      = document.getElementById('sym-space').checked;
        const applyFormatting  = document.querySelector('input[name="apply-to"]:checked')?.value || 'converted';
        const decimalSep       = document.querySelector('input[name="dec-sep"]:checked')?.value  || '';
        const thousandsSep     = document.getElementById('thou-sep').value;
        const hideZeroDecimals = document.getElementById('hide-zero-decimals').checked;
        saveAndRefresh({ customSymbol, symbolPosition, symbolSpace, applyFormatting, decimalSep, thousandsSep, hideZeroDecimals });
    });
});
