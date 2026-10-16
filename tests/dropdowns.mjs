import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ channel: 'chromium', headless: true });
const page = await browser.newPage();
try {
  await page.setContent('<form><div class="shopee-form-item"><label class="shopee-form-item__label"><div class="label"><span>First Name</span></div></label><input placeholder="As in NRIC/Passport"></div><button type="submit">Submit</button></form>');
  await page.evaluate(() => {
    window.componentState = {}; window.submitted = false;
    document.querySelector('form').onsubmit = e => { e.preventDefault(); window.submitted = true; };
    function add({ id, label, options, initial = [], multiple = false, virtual = false, disabled = false }) {
      const item = document.createElement('div'); item.className = 'shopee-form-item';
      item.innerHTML = `<label for="${id}" class="shopee-form-item__label"><div class="label"><span>${label}</span><i class="star">*</i></div></label><div id="${id}" class="shopee-select ${virtual ? 'shopee-virtual-select' : ''} ${disabled ? 'disabled' : ''}"><div tabindex="0" class="shopee-selector"><div class="placeholder">Select</div></div><div class="shopee-popper" style="display:none"><div class="shopee-select__filter"><input placeholder="Select"></div><div class="shopee-select__options"></div></div></div>`;
      document.querySelector('form').append(item);
      const root = item.querySelector('.shopee-select'), trigger = root.querySelector('.shopee-selector'), filter = root.querySelector('input'), menu = root.querySelector('.shopee-popper');
      let selected = [...initial]; window.componentState[id] = selected;
      function renderOptions() {
        const choices = options.filter(value => value.toLowerCase().includes(filter.value.toLowerCase()));
        root.querySelector('.shopee-select__options').replaceChildren(...(virtual && !filter.value ? choices.slice(0, 1) : choices).map(value => {
          const option = document.createElement('div'); option.className = `shopee-option ${multiple ? 'multiple' : ''} ${selected.includes(value) ? 'selected' : ''}`; option.textContent = value;
          option.onclick = () => { selected = multiple ? selected.includes(value) ? selected.filter(x => x !== value) : [...selected, value] : [value]; update(); if (!multiple) { root.classList.remove('is-show'); setTimeout(() => { if (!root.classList.contains('is-show')) menu.style.display = 'none'; }, 150); } };
          return option;
        }));
      }
      function update() {
        window.componentState[id] = [...selected];
        trigger.classList.toggle('multiple', multiple && selected.length > 0);
        trigger.replaceChildren();
        if (!selected.length) { const placeholder = document.createElement('div'); placeholder.className = 'placeholder'; placeholder.textContent = multiple ? 'Select up to 8 skills' : 'Select'; trigger.append(placeholder); }
        else if (!multiple) { const inner = document.createElement('div'); inner.className = 'shopee-selector__inner'; inner.textContent = selected[0]; trigger.append(inner); }
        else for (const value of selected) { const tag = document.createElement('div'); tag.className = 'shopee-selector--tag'; const text = document.createElement('span'); text.className = 'text'; text.textContent = value; const remove = document.createElement('i'); remove.className = 'delete-icon'; remove.textContent = '×'; remove.onclick = e => { e.stopPropagation(); selected = selected.filter(x => x !== value); update(); }; tag.append(text, remove); trigger.append(tag); }
        renderOptions();
      }
      trigger.onclick = () => { if (!disabled) { const opening = !root.classList.contains('is-show'); root.classList.toggle('is-show', opening); menu.style.display = opening ? 'block' : 'none'; renderOptions(); } };
      filter.oninput = renderOptions; update();
    }
    add({ id: 'degree', label: 'Education Level', options: ["Bachelor's Degree", "Master's Degree"], initial: ["Master's Degree"] });
    add({ id: 'school', label: 'School', options: ['Aalto University', 'National University of Singapore (NUS)'], virtual: true });
    add({ id: 'skills', label: 'Skills', options: ['Java', 'Python', 'SQL'], initial: ['Java'], multiple: true, virtual: true });
    add({ id: 'disabled', label: 'Disabled dropdown', options: ['Must not change'], disabled: true });
  });
  await page.addScriptTag({ path: 'build/content.js' });
  const scan = await page.evaluate(() => window.__jobHuntFill.scan());
  assert.equal(scan.fields.length, 4, 'one native input and three custom controls, no hidden search boxes or disabled control');
  assert.equal(scan.fields[0].label, 'First Name');
  const find = label => scan.fields.find(f => f.label === label);
  assert.equal(find('School').options.length, 1, 'virtual list exposes only initial options');
  assert.equal(find('School').optionsIncomplete, true);
  assert.equal(find('Skills').multiple, true);
  const fill = (pairs, overwrite = false) => page.evaluate(payload => window.__jobHuntFill.fill(payload), { answers: pairs.map(([label, value]) => ({ id: find(label).id, value })), overwrite, speed: 'instant' });
  const preserved = await fill([['Education Level', "Bachelor's Degree"]]);
  assert.equal(preserved.skipped, 1);
  const report = await fill([['Education Level', "Bachelor's Degree"], ['School', 'National University of Singapore'], ['Skills', 'Python\nSQL']], true);
  assert.equal(report.filled, 3); assert.deepEqual(report.errors, []);
  assert.deepEqual(await page.evaluate(() => window.componentState), { degree: ["Bachelor's Degree"], school: ['National University of Singapore (NUS)'], skills: ['Python', 'SQL'], disabled: [] });
  assert.equal(await page.locator('.shopee-popper:visible').count(), 0, 'menus close and filter text is cleared');
  const undo = await page.evaluate(() => window.__jobHuntFill.undo());
  assert.equal(undo.restored, 2); assert.equal(undo.errors.length, 1);
  assert.match(undo.errors[0], /no clear action/);
  assert.deepEqual(await page.evaluate(() => window.componentState.degree), ["Master's Degree"]);
  assert.deepEqual(await page.evaluate(() => window.componentState.skills), ['Java']);
  const invalid = await fill([['Skills', 'SQL\nNonexistent option']], true);
  assert.equal(invalid.filled, 0); assert.equal(invalid.errors.length, 1);
  assert.deepEqual(await page.evaluate(() => window.componentState.skills), ['Java'], 'invalid multi choice never removes the previous selection');
  assert.equal((await page.evaluate(() => window.__jobHuntFill.undo())).restored, 0, 'failed unchanged fills do not create undo records');
  assert.equal(await page.evaluate(() => window.submitted), false);
  console.log('PASS: Shopee-shaped single, searchable virtual and multiple dropdowns; Vue-style component state, external labels, no duplicate search fields, preservation, acronym matching, invalid-choice safety, undo with honest clear limitations.');
} finally { await browser.close(); }
