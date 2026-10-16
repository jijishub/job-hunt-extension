(() => {
  if (window.__jobHuntFill) return;
  let fields = new Map(), originals = [], stopped = false, busy = false;
  const visible = el => !!(el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  const custom = el => el.matches('.shopee-select');
  const fieldVisible = el => visible(el) || (el.type === 'file' && !!el.closest('.shopee-upload') && visible(el.closest('.shopee-upload')));
  const normalize = value => String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
  const withoutAcronym = value => normalize(String(value).replace(/\s*\([A-Z][A-Z0-9.&-]{1,11}\)\s*$/, ''));
  const sameChoice = (a, b) => normalize(a) === normalize(b) || withoutAcronym(a) === withoutAcronym(b);
  const text = el => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
  function labelText(el) {
    if (!el) return '';
    const clone = el.cloneNode(true);
    clone.querySelectorAll('input,select,textarea,button').forEach(child => child.remove());
    return text(clone);
  }
  function roots(root = document) {
    const result = [root];
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) result.push(...roots(el.shadowRoot));
    return result;
  }
  function label(el) {
    const root = el.getRootNode();
    const labelled = (el.getAttribute('aria-labelledby') || '').split(' ').filter(Boolean).map(id => text(root.getElementById?.(id))).join(' ');
    const formItem = el.closest('.shopee-form-item');
    const itemLabel = formItem?.querySelector('.shopee-form-item__label');
    const siteLabel = text(itemLabel?.querySelector('.label > span') || itemLabel).replace(/\*$/, '').trim();
    const suffix = custom(el) && siteLabel === 'Contact Number' ? ' — country calling code' : '';
    return ((el.getAttribute('aria-label') || labelled || [...(el.labels || [])].map(labelText).join(' ') || labelText(el.closest('label')) || siteLabel || el.placeholder || el.name || el.id || 'Unlabelled field') + suffix).slice(0, 240);
  }
  function customValue(el) {
    const trigger = el.querySelector('.shopee-selector');
    if (!trigger || trigger.querySelector('.placeholder')) return '';
    const tags = [...trigger.querySelectorAll('.shopee-selector--tag .text')].map(text);
    return tags.length ? tags.join('\n') : text(trigger.querySelector('.shopee-selector__inner'));
  }
  const multiple = el => !!el.querySelector('.shopee-option.multiple, .shopee-selector.multiple') || /up to \d+/i.test(text(el.querySelector('.placeholder')));
  function scan() {
    if (busy) throw new Error('Stop filling before scanning again.');
    fields = new Map();
    const result = [];
    for (const root of roots()) for (const el of root.querySelectorAll('input,textarea,select')) {
      const type = (el.type || el.tagName).toLowerCase();
      if (el.closest('.shopee-select') || el.disabled || el.readOnly || !fieldVisible(el) || ['hidden', 'submit', 'button', 'reset', 'password', 'image', 'range', 'color'].includes(type)) continue;
      const id = `f${fields.size}`;
      fields.set(id, el);
      const group = el.closest('fieldset');
      const question = group?.querySelector('legend');
      result.push({ id, type, name: el.name, label: (question ? text(question) + ' — ' : '') + label(el), autocomplete: el.autocomplete,
        value: type === 'file' ? (el.files?.[0]?.name || '') : ['checkbox', 'radio'].includes(type) ? (el.checked ? 'true' : '') : el.value,
        required: el.required || el.getAttribute('aria-required') === 'true',
        options: el.tagName === 'SELECT' ? [...el.options].filter(o => !o.disabled && o.value).map(o => ({ value: o.value, label: o.label })).slice(0, 250) : undefined,
        accept: type === 'file' ? el.accept : undefined
      });
    }
    for (const root of roots()) for (const el of root.querySelectorAll('.shopee-select')) {
      if (!visible(el) || el.matches('.disabled, .is-disabled, [aria-disabled="true"]') || !el.querySelector('.shopee-selector')) continue;
      const id = `f${fields.size}`;
      fields.set(id, el);
      const item = el.closest('.shopee-form-item');
      const options = [...el.querySelectorAll('.shopee-option:not(.disabled):not(.is-disabled)')].map(o => ({ value: text(o), label: text(o) })).filter(o => o.value);
      const searchable = !!el.querySelector('.shopee-select__filter input');
      result.push({ id, type: 'custom-select', label: label(el), name: item?.querySelector('.shopee-form-item__label')?.getAttribute('for') || '',
        value: customValue(el), required: !!item?.querySelector('.star'), multiple: multiple(el),
        options: options.slice(0, 250), optionsIncomplete: searchable && (el.classList.contains('shopee-virtual-select') || options.length > 250), searchable });
    }
    return { fields: result.slice(0, 150), title: document.title, url: location.origin + location.pathname };
  }
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  function setValue(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  }
  async function waitFor(check, message, duration = 3000) {
    const end = Date.now() + duration;
    while (Date.now() < end) {
      if (stopped) throw new Error('Stopped.');
      const value = check();
      if (value) return value;
      await sleep(60);
    }
    throw new Error(message);
  }
  async function closeCustom(el) {
    const filter = el.querySelector('.shopee-select__filter input');
    const menu = el.querySelector('.shopee-popper');
    // The popper remains visible during its closing animation. is-show reflects
    // component state; clicking a visually closing trigger would reopen it.
    if (el.classList.contains('is-show')) {
      if (filter?.value) { setValue(filter, ''); await sleep(80); }
      el.querySelector('.shopee-selector').click();
    }
    for (let i = 0; i < 20 && visible(menu); i++) await sleep(40);
  }
  async function findCustomOption(el, wanted) {
    const trigger = el.querySelector('.shopee-selector');
    if (!el.classList.contains('is-show')) { trigger.click(); await sleep(120); }
    const optionMatch = () => {
      const options = [...el.querySelectorAll('.shopee-option')].filter(o => visible(o) && !o.matches('.disabled,.is-disabled,[aria-disabled="true"]'));
      const exact = options.find(o => normalize(text(o)) === normalize(wanted));
      if (exact) return exact;
      const aliases = options.filter(o => sameChoice(text(o), wanted));
      return aliases.length === 1 ? aliases[0] : null;
    };
    let option = optionMatch();
    if (!option) {
      const filter = el.querySelector('.shopee-select__filter input');
      if (!filter) throw new Error(`No matching option for “${wanted}”.`);
      filter.focus(); setValue(filter, wanted);
      option = await waitFor(optionMatch, `No exact matching option for “${wanted}”. Choose it manually.`);
    }
    return option;
  }
  async function chooseCustom(el, wanted) {
    const option = await findCustomOption(el, wanted);
    const actualLabel = text(option);
    if (!option.classList.contains('selected')) option.click();
    await waitFor(() => customValue(el).split('\n').some(value => normalize(value) === normalize(actualLabel)), `The site did not accept “${wanted}”.`);
  }
  async function setCustom(el, value) {
    const wanted = [...new Set(value.split('\n').map(v => v.trim()).filter(Boolean))];
    if (!multiple(el) && wanted.length > 1) throw new Error('This dropdown accepts one option.');
    const limit = Number(text(el.querySelector('.placeholder')).match(/up to (\d+)/i)?.[1] || 8);
    if (wanted.length > limit) throw new Error(`Choose no more than ${limit} options.`);
    try {
      if (multiple(el)) {
        // Validate every requested choice before removing any current selections.
        for (const choice of wanted) if (!customValue(el).split('\n').some(v => sameChoice(v, choice))) await findCustomOption(el, choice);
        // Use the site's own remove controls so Vue state stays consistent.
        for (const tag of [...el.querySelectorAll('.shopee-selector--tag')]) {
          if (!wanted.some(w => sameChoice(w, text(tag.querySelector('.text'))))) {
            const remove = tag.querySelector('.delete-icon');
            if (!remove) throw new Error('The site cannot remove an existing selection automatically.');
            remove.click(); await sleep(80);
          }
        }
      } else if (!wanted.length && customValue(el)) {
        // Some Shopee single selects do not expose a clear action.
        const clear = el.querySelector('.shopee-selector__clear-btn, .shopee-selector__clear');
        if (!clear) throw new Error('This site has no clear action for this dropdown. Clear it manually or reload the application.');
        clear.click(); await sleep(80);
      }
      for (const choice of wanted) {
        if (stopped) throw new Error('Stopped.');
        if (!customValue(el).split('\n').some(v => sameChoice(v, choice))) await chooseCustom(el, choice);
      }
    } finally { await closeCustom(el); }
  }
  async function fill({ answers, resume, speed, overwrite }) {
    if (busy) throw new Error('A fill is already running.');
    busy = true; stopped = false; originals = [];
    const report = { filled: 0, skipped: 0, errors: [], stopped: false };
    try {
      for (const answer of answers) {
        if (stopped) break;
        const el = fields.get(answer.id);
        if (!el?.isConnected || !fieldVisible(el) || el.disabled || el.readOnly) { report.skipped++; continue; }
        const type = el.type;
        const current = custom(el) ? customValue(el) : ['checkbox', 'radio'].includes(type) ? el.checked : type === 'file' ? el.files.length : el.value;
        // Consent, agreements, marketing and attestations always require a manual choice.
        if ((current && !overwrite) || /consent|agree|certif|attest|terms|privacy|subscribe/i.test(label(el))) { report.skipped++; continue; }
        try {
          const before = { el, value: custom(el) ? customValue(el) : el.value, checked: el.checked, files: type === 'file' ? [...el.files] : null };
          if (custom(el)) {
            originals.push(before);
            try { await setCustom(el, answer.value); }
            catch (e) { if (customValue(el) === before.value) originals.pop(); throw e; }
          } else if (type === 'file') {
            if (!resume?.base64 || !/resume|cv|curriculum/i.test(label(el))) { report.skipped++; continue; }
            const bytes = Uint8Array.from(atob(resume.base64), c => c.charCodeAt(0));
            const file = new File([bytes], resume.name, { type: resume.type });
            const accept = el.accept.split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
            if (accept.length && !accept.some(a => a.startsWith('.') ? file.name.toLowerCase().endsWith(a) : a.endsWith('/*') ? file.type.startsWith(a.slice(0, -1)) : file.type === a)) throw new Error('Selected resume type is not accepted by this upload.');
            const transfer = new DataTransfer(); transfer.items.add(file); originals.push(before); el.files = transfer.files;
            el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
          } else if (type === 'checkbox' || type === 'radio') {
            // These include legal, demographic, eligibility and custom site state. Leave manual.
            report.skipped++; continue;
          } else if (el.tagName === 'SELECT') {
            const wanted = answer.value.toLowerCase().trim();
            const option = [...el.options].find(o => !o.disabled && (o.value === answer.value || o.label.toLowerCase().trim() === wanted));
            if (!option) throw new Error('No matching option.');
            originals.push(before); setValue(el, option.value);
          } else {
            originals.push(before); el.focus();
            if (speed !== 'instant') {
              let value = '';
              setValue(el, '');
              for (const char of answer.value) { if (stopped) break; value += char; setValue(el, value); await sleep(speed === 'gentle' ? 35 : 8); }
            } else setValue(el, answer.value);
            el.blur();
          }
          report.filled++;
        } catch (e) { report.errors.push(`${label(el)}: ${e.message}`); }
      }
      report.stopped = stopped;
      return report;
    } finally { busy = false; }
  }
  async function undo() {
    if (busy) throw new Error('Stop filling before undoing.');
    busy = true; stopped = false;
    let count = 0; const errors = [], remaining = [];
    try { for (const item of [...originals].reverse()) {
      const { el } = item;
      if (!el.isConnected) continue;
      try {
      if (custom(el)) await setCustom(el, item.value);
      else if (item.files) { const transfer = new DataTransfer(); item.files.forEach(file => transfer.items.add(file)); el.files = transfer.files; el.dispatchEvent(new Event('change', { bubbles: true })); }
      else setValue(el, item.value);
      count++;
      } catch (e) { errors.push(`${label(el)}: ${e.message}`); remaining.unshift(item); }
    } } finally { originals = remaining; busy = false; }
    return { restored: count, errors };
  }
  window.__jobHuntFill = { scan, fill, undo, stop: () => { stopped = true; } };
})();
