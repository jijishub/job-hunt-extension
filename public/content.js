(() => {
  if (window.__jobHuntFill) return;
  let fields = new Map(), originals = [], stopped = false, busy = false;
  const visible = el => !!(el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
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
    return (el.getAttribute('aria-label') || labelled || [...(el.labels || [])].map(labelText).join(' ') || labelText(el.closest('label')) || el.placeholder || el.name || el.id || 'Unlabelled field').slice(0, 240);
  }
  function scan() {
    if (busy) throw new Error('Stop filling before scanning again.');
    fields = new Map();
    const result = [];
    for (const root of roots()) for (const el of root.querySelectorAll('input,textarea,select')) {
      const type = (el.type || el.tagName).toLowerCase();
      if (el.disabled || el.readOnly || !visible(el) || ['hidden', 'submit', 'button', 'reset', 'password', 'image', 'range', 'color'].includes(type)) continue;
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
    return { fields: result.slice(0, 150), title: document.title, url: location.origin + location.pathname };
  }
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  function setValue(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  }
  async function fill({ answers, resume, speed, overwrite }) {
    if (busy) throw new Error('A fill is already running.');
    busy = true; stopped = false; originals = [];
    const report = { filled: 0, skipped: 0, errors: [], stopped: false };
    try {
      for (const answer of answers) {
        if (stopped) break;
        const el = fields.get(answer.id);
        if (!el?.isConnected || !visible(el) || el.disabled || el.readOnly) { report.skipped++; continue; }
        const type = el.type;
        const current = ['checkbox', 'radio'].includes(type) ? el.checked : type === 'file' ? el.files.length : el.value;
        // Consent, agreements, marketing and attestations always require a manual choice.
        if ((current && !overwrite) || /consent|agree|certif|attest|terms|privacy|subscribe/i.test(label(el))) { report.skipped++; continue; }
        try {
          const before = { el, value: el.value, checked: el.checked, files: type === 'file' ? [...el.files] : null };
          if (type === 'file') {
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
  function undo() {
    if (busy) throw new Error('Stop filling before undoing.');
    let count = 0;
    for (const item of originals.reverse()) {
      const { el } = item;
      if (!el.isConnected) continue;
      if (item.files) { const transfer = new DataTransfer(); item.files.forEach(file => transfer.items.add(file)); el.files = transfer.files; el.dispatchEvent(new Event('change', { bubbles: true })); }
      else setValue(el, item.value);
      count++;
    }
    originals = []; return count;
  }
  window.__jobHuntFill = { scan, fill, undo, stop: () => { stopped = true; } };
})();
