// Styled dropdowns for the popup's <select> elements, the same in Chrome and Firefox.
//
// A native <select> opens an OS menu that can't be styled. Each select here keeps
// doing all the real work (its value, its options, its change event, which popup.js
// saves on) and is only hidden; a button shows the current choice and opens a list
// drawn by the popup itself. Nothing here knows about settings.
(() => {
    const nativeValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    let open = null;     // the dropdown whose list is showing

    function enhance(select) {
        const wrap = select.closest('.select-wrapper');
        select.classList.add('cs-native');
        select.tabIndex = -1;
        select.setAttribute('aria-hidden', 'true');

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'cs-button';
        button.setAttribute('aria-haspopup', 'listbox');
        button.setAttribute('aria-expanded', 'false');
        const label = document.querySelector(`label[for="${select.id}"]`);
        if (label) {
            label.id ||= `${select.id}-label`;
            button.setAttribute('aria-labelledby', `${label.id} ${select.id}-button`);
            // The label points at the hidden select; send its clicks to the button.
            label.addEventListener('click', e => { e.preventDefault(); button.focus(); });
        }
        button.id = `${select.id}-button`;
        const text = document.createElement('span');
        text.className = 'cs-text';
        button.append(text);

        const list = document.createElement('ul');
        list.className = 'cs-list';
        list.setAttribute('role', 'listbox');
        list.hidden = true;
        wrap.append(button, list);

        let active = -1;   // highlighted option index

        const update = () => { text.textContent = select.selectedOptions[0]?.textContent ?? ''; };

        // popup.js sets values directly (loading settings, switching formatting sets);
        // keep the button in step without it having to know about this file.
        Object.defineProperty(select, 'value', {
            configurable: true,
            get() { return nativeValue.get.call(this); },
            set(v) { nativeValue.set.call(this, v); update(); },
        });
        select.addEventListener('change', update);
        new MutationObserver(update).observe(select, { childList: true, subtree: true, attributes: true });

        const items = () => [...list.children];
        const enabled = i => !select.options[i]?.disabled;

        const highlight = i => {
            active = i;
            items().forEach((li, j) => li.classList.toggle('cs-active', j === i));
            items()[i]?.scrollIntoView({ block: 'nearest' });
        };

        const render = () => {
            list.textContent = '';
            [...select.options].forEach((opt, i) => {
                const li = document.createElement('li');
                li.setAttribute('role', 'option');
                li.textContent = opt.textContent;
                li.setAttribute('aria-selected', String(i === select.selectedIndex));
                if (opt.disabled) li.setAttribute('aria-disabled', 'true');
                li.addEventListener('mousedown', e => e.preventDefault());   // keep focus on the button
                li.addEventListener('mousemove', () => { if (enabled(i) && active !== i) highlight(i); });
                li.addEventListener('click', () => { if (enabled(i)) choose(i); });
                list.append(li);
            });
        };

        const show = () => {
            if (open && open !== api) open.hide();
            render();
            list.hidden = false;
            button.setAttribute('aria-expanded', 'true');
            wrap.classList.add('cs-open');
            open = api;
            highlight(select.selectedIndex >= 0 && enabled(select.selectedIndex) ? select.selectedIndex : next(-1, 1));
        };

        const hide = () => {
            list.hidden = true;
            button.setAttribute('aria-expanded', 'false');
            wrap.classList.remove('cs-open');
            if (open === api) open = null;
        };

        const choose = i => {
            hide();
            if (i === select.selectedIndex) return;
            nativeValue.set.call(select, select.options[i].value);
            update();
            select.dispatchEvent(new Event('change', { bubbles: true }));
        };

        // Next selectable option from i in direction dir (wraps at the ends).
        const next = (i, dir) => {
            const n = select.options.length;
            for (let k = 1; k <= n; k++) {
                const j = ((i + dir * k) % n + n) % n;
                if (enabled(j)) return j;
            }
            return -1;
        };

        button.addEventListener('click', () => (list.hidden ? show() : hide()));
        button.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== button) hide(); }, 0));
        button.addEventListener('keydown', e => {
            const isOpen = !list.hidden;
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                if (!isOpen) { show(); return; }
                highlight(next(active, e.key === 'ArrowDown' ? 1 : -1));
            } else if (e.key === 'Home' || e.key === 'End') {
                if (!isOpen) return;
                e.preventDefault();
                highlight(e.key === 'Home' ? next(-1, 1) : next(select.options.length, -1));
            } else if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                if (isOpen && active >= 0) choose(active); else show();
            } else if (e.key === 'Escape' || e.key === 'Tab') {
                if (isOpen) { if (e.key === 'Escape') e.preventDefault(); hide(); }
            } else if (e.key.length === 1 && /\S/.test(e.key)) {
                // Type-ahead: jump to the next option starting with that letter.
                const ch = e.key.toLowerCase();
                const opts = [...select.options];
                const from = isOpen ? active : select.selectedIndex;
                for (let k = 1; k <= opts.length; k++) {
                    const j = (from + k) % opts.length;
                    if (enabled(j) && opts[j].textContent.trim().toLowerCase().startsWith(ch)) {
                        if (isOpen) highlight(j); else choose(j);
                        break;
                    }
                }
            }
        });

        const api = { hide };
        update();
    }

    // Clicking anywhere else closes the open list.
    document.addEventListener('mousedown', e => {
        if (open && !e.target.closest('.select-wrapper.cs-open')) open.hide();
    });

    document.querySelectorAll('.select-wrapper select').forEach(enhance);
})();
