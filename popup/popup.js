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
                save();
            });
            toDropdown.appendChild(li);
        });
        toDropdown.hidden = false;
    };

    // A typo like "EUE" would get no rate from the API, so reject it up front.
    const supported = typeof Intl.supportedValuesOf === 'function' ? new Set(Intl.supportedValuesOf('currency')) : null;
    const isKnownCurrency = code =>
        /^[A-Z]{3}$/.test(code) && (!!CURRENCIES[code] || !supported || supported.has(code));

    toCurrencyInput.addEventListener('input', () => {
        toCurrencyInput.setCustomValidity('');
        const q = toCurrencyInput.value.trim().toUpperCase();
        // A complete, known code takes effect as soon as it's typed.
        if (isKnownCurrency(q)) scheduleSave();
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
            save();
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
        'targetCurrency', 'fromCurrency', 'conversionEnabled', 'hoverEnabled', 'stripTrailingCode',
        'formatting', ...LEGACY_FORMAT_KEYS,
    ]);
    toCurrencyInput.value    = (stored.targetCurrency === 'ILS' || stored.targetCurrency === 'ISL') ? '' : (stored.targetCurrency || '');
    fromCurrencySelect.value = (stored.fromCurrency   === 'ILS' || stored.fromCurrency   === 'ISL') ? '' : (stored.fromCurrency   || '');
    conversionToggle.checked = stored.conversionEnabled !== false;
    document.getElementById('hover-enabled').checked   = stored.hoverEnabled !== false;
    document.getElementById('strip-trailing').checked  = !!stored.stripTrailingCode;

    // Separator mutual exclusion: whichever symbol is chosen for one, disable it in the other
    const decSelect  = document.getElementById('dec-sep');
    const thouSelect = document.getElementById('thou-sep');
    const blockConflicts = (chosen, other) => {
        other.querySelectorAll('option').forEach(opt => {
            const conflict = !!(chosen.value && opt.value === chosen.value);
            if (conflict && other.value === opt.value) other.value = '';
            opt.disabled = conflict;
        });
    };
    decSelect.addEventListener('change', () => blockConflicts(decSelect, thouSelect));
    thouSelect.addEventListener('change', () => blockConflicts(thouSelect, decSelect));

    // Two formatting sets, Converted and Original; the More settings fields show one at a
    // time. Opens on the set that's in use right now (Original when conversion is off).
    const formatting  = readFormatting(stored);
    // Each side is named after its currency ("JOD prices" / "UAH prices") so it's clear
    // which prices it styles. The converted side falls back to "Converted" while there's no
    // valid target yet, or when the target is the store currency itself.
    const syncFormatSetLabels = () => {
        const from = fromCurrencySelect.value;
        const to   = toCurrencyInput.value.trim().toUpperCase();
        document.getElementById('format-set-converted').textContent =
            isKnownCurrency(to) && to !== from ? `${to} prices` : 'Converted';
        document.getElementById('format-set-original').textContent =
            from ? `${from} prices` : 'Store currency';
    };
    syncFormatSetLabels();
    fromCurrencySelect.addEventListener('change', syncFormatSetLabels);
    toCurrencyInput.addEventListener('input', syncFormatSetLabels);
    let editingSet = conversionToggle.checked ? 'converted' : 'original';

    const showFormatSet = name => {
        const set = formatting[name];
        document.getElementById('custom-symbol').value = set.customSymbol;
        document.querySelector(`input[name="sym-pos"][value="${set.symbolPosition}"]`).checked = true;
        document.getElementById('sym-space').checked = set.symbolSpace;
        decSelect.value  = set.decimalSep;
        thouSelect.value = set.thousandsSep;
        document.getElementById('hide-zero-decimals').checked = set.hideZeroDecimals;
        blockConflicts(decSelect, thouSelect);
        blockConflicts(thouSelect, decSelect);
        document.querySelector(`input[name="format-set"][value="${name}"]`).checked = true;
    };
    const readFormatSet = () => ({
        customSymbol:     document.getElementById('custom-symbol').value.trim(),
        symbolPosition:   document.querySelector('input[name="sym-pos"]:checked')?.value || '',
        symbolSpace:      document.getElementById('sym-space').checked,
        decimalSep:       decSelect.value,
        thousandsSep:     thouSelect.value,
        hideZeroDecimals: document.getElementById('hide-zero-decimals').checked,
    });
    document.querySelectorAll('input[name="format-set"]').forEach(r => r.addEventListener('change', () => {
        editingSet = r.value;
        showFormatSet(editingSet);
    }));
    showFormatSet(editingSet);

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

    // Page navigation
    document.getElementById('more-btn').addEventListener('click', () => {
        document.getElementById('page-main').hidden = true;
        document.getElementById('page-more').hidden = false;
    });
    document.getElementById('back-btn').addEventListener('click', () => {
        document.getElementById('page-more').hidden = true;
        document.getElementById('page-main').hidden = false;
    });

    // No Save button: every change is stored right away, and the content scripts in open
    // Steam tabs pick it up through storage.onChanged and re-convert without a reload.
    const readSettings = () => {
        const fromCode = fromCurrencySelect.value || null;
        const settings = {
            conversionEnabled: conversionToggle.checked,
            hoverEnabled:      document.getElementById('hover-enabled').checked,
            // The checkbox is hidden for non-USD stores; don't persist a stale tick.
            stripTrailingCode: document.getElementById('strip-trailing').checked && fromCode === 'USD',
        };
        formatting[editingSet] = readFormatSet();
        settings.formatting = { converted: { ...formatting.converted }, original: { ...formatting.original } };
        if (fromCode) settings.fromCurrency = fromCode;
        // An unfinished or unknown code isn't saved — the last valid one stays in effect.
        const toCode = toCurrencyInput.value.trim().toUpperCase();
        if (isKnownCurrency(toCode)) settings.targetCurrency = toCode;
        return settings;
    };

    // A floppy disk flashes in the corner after each save (red if it failed — sync
    // storage can refuse writes, e.g. its per-minute write limit).
    const indicator = document.querySelector('.save-indicator');
    const showSaveResult = ok => {
        indicator.classList.toggle('error', !ok);
        indicator.querySelector('.save-text').textContent = ok ? 'Saved' : "Couldn't save";
        // Restart the flash when saves come quickly one after another.
        indicator.classList.remove('visible');
        void indicator.offsetWidth;
        indicator.classList.add('visible');
    };
    indicator.addEventListener('animationend', () => indicator.classList.remove('visible'));

    let saveTimer;
    const save = () => {
        clearTimeout(saveTimer);
        chrome.storage.sync.set(readSettings())
            .then(() => {
                // Once the new layout is saved, the pre-1.2 flat formatting keys are obsolete.
                if (LEGACY_FORMAT_KEYS.some(k => k in stored)) {
                    LEGACY_FORMAT_KEYS.forEach(k => delete stored[k]);
                    return chrome.storage.sync.remove(LEGACY_FORMAT_KEYS);
                }
            })
            .then(() => showSaveResult(true), () => showSaveResult(false));
    };
    // Typing waits for a pause, so a half-typed custom symbol doesn't re-convert every tab per key.
    const scheduleSave = () => {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(save, 400);
    };

    // Checkboxes, radios and selects save at once. These listeners are added after the
    // separator handlers above, so they save the values those handlers just adjusted.
    // Switching between the Converted/Original sets only changes the view, so it doesn't save.
    document.querySelectorAll('input[type="checkbox"], input[type="radio"]:not([name="format-set"]), select').forEach(el => {
        el.addEventListener('change', save);
    });
    document.getElementById('custom-symbol').addEventListener('input', scheduleSave);

    // Leaving the field with an unknown code: say so. The last valid code stays in effect.
    toCurrencyInput.addEventListener('change', () => {
        const toCode = toCurrencyInput.value.trim().toUpperCase();
        if (!toCode) return;
        if (isKnownCurrency(toCode)) {
            toCurrencyInput.value = toCode;
            save();
            return;
        }
        toCurrencyInput.setCustomValidity(`"${toCode}" is not a recognised currency code.`);
        toCurrencyInput.reportValidity();
    });
});
