// Serialized by chrome.scripting.executeScript. Keep helpers inside this function.
// Reads the current document only. Never clicks, follows links, or calls an API.
export function extractPosting() {
  const version = 'posting-pilot-v2';
  const maxText = 120000;
  const warnings = [];
  const warn = (list, code, message, extra = {}) => list.push({ code, message, ...extra });
  const clean = value => String(value ?? '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const clip = value => {
    const text = clean(value);
    if (text.length > maxText) warn(warnings, 'source_truncated', 'Source text exceeded 120,000 characters and was truncated. Review against the page.');
    return text.slice(0, maxText);
  };
  // Text walker keeps paragraph/bullet boundaries and excludes application values.
  function textOf(root, structured = false) {
    if (!root) return '';
    function walk(node) {
      if (node.nodeType === 3) return node.textContent;
      if (node.nodeType !== 1 && node.nodeType !== 11) return '';
      if (node.nodeType === 1) {
        if (node.matches('script,style,noscript,template,form,input,textarea,select,button,nav,footer,iframe,svg')) return '';
        if (node.hidden || node.getAttribute('aria-hidden') === 'true') return '';
        if (!structured && node.isConnected && getComputedStyle(node).display === 'none') return '';
      }
      const body = [...node.childNodes].map(walk).join('');
      if (node.nodeType === 11) return body;
      if (node.tagName === 'BR') return '\n';
      if (node.tagName === 'LI') return '\n- ' + body.trim() + '\n';
      return /^(P|DIV|SECTION|ARTICLE|H[1-6]|UL|OL|TABLE|TR)$/.test(node.tagName) ? '\n' + body + '\n' : body;
    }
    return clip(walk(root));
  }
  function htmlText(value) {
    if (typeof value !== 'string') return '';
    const template = document.createElement('template');
    template.innerHTML = value;
    return textOf(template.content, true);
  }
  const scalar = value => typeof value === 'string' ? htmlText(value) : null;
  const asArray = value => value == null ? [] : Array.isArray(value) ? value : [value];
  const model = value => ({ remote: 'REMOTE', hybrid: 'HYBRID', onsite: 'ON_SITE' })[String(value || '').toLowerCase().replace(/[\s_-]/g, '')] || null;
  const jobType = value => ({ FULL_TIME: 'FULL_TIME', PART_TIME: 'PART_TIME', CONTRACT: 'CONTRACT', INTERNSHIP: 'INTERNSHIP' })[String(value || '').toUpperCase().replace(/[ -]/g, '_')] || null;
  const blank = () => ({ role_title: null, company_name: null, description: '', qualifications: [], location: null,
    work_model: null, job_type: null, salary_min: null, salary_max: null, salary_currency: null, salary_period: null,
    job_url: location.href, seniority_level: null, job_platform: null, first_response_at: null });
  const candidates = [];
  let invalidJson = false;
  let visited = 0;
  function collect(value, locator, depth = 0) {
    if (!value || typeof value !== 'object') return;
    if (depth > 12 || ++visited > 2000) { warn(warnings, 'extraction_limit_reached', 'Structured-data traversal limit reached. Some postings may be missing.'); return; }
    if (Array.isArray(value)) { value.forEach((item, i) => collect(item, `${locator}[${i}]`, depth + 1)); return; }
    if (asArray(value['@type']).includes('JobPosting')) {
      if (candidates.length >= 20) { warn(warnings, 'extraction_limit_reached', 'More than 20 postings found; only the first 20 were captured.'); return; }
      const posting = blank(), provenance = {};
      function set(key, data, path) { if (data != null && data !== '') { posting[key] = data; provenance[key] = { method: 'jsonld', locator: `${locator}.${path}` }; } }
      set('role_title', scalar(value.title), 'title');
      set('company_name', scalar(value.hiringOrganization?.name), 'hiringOrganization.name');
      set('description', htmlText(value.description), 'description');
      const qualifications = asArray(value.qualifications).filter(item => typeof item === 'string').map(htmlText).filter(Boolean);
      if (qualifications.length) set('qualifications', qualifications, 'qualifications');
      const addresses = asArray(value.jobLocation).map(item => item?.address).filter(Boolean);
      set('location', addresses.map(address => [...new Set([address.addressLocality, address.addressRegion, typeof address.addressCountry === 'string' ? address.addressCountry : address.addressCountry?.name].filter(item => typeof item === 'string' && item.trim()))].join(', ')).filter(Boolean).join('; '), 'jobLocation');
      if (value.jobLocationType === 'TELECOMMUTE') set('work_model', 'REMOTE', 'jobLocationType');
      if (asArray(value.employmentType).length === 1) set('job_type', jobType(asArray(value.employmentType)[0]), 'employmentType');
      const salary = value.baseSalary;
      const amount = salary?.value;
      const number = n => typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
      set('salary_min', number(typeof amount === 'number' ? amount : amount?.minValue ?? amount?.value), 'baseSalary.value');
      set('salary_max', number(typeof amount === 'number' ? amount : amount?.maxValue ?? amount?.value), 'baseSalary.value');
      if (typeof salary?.currency === 'string' && /^[A-Za-z]{3}$/.test(salary.currency)) set('salary_currency', salary.currency.toUpperCase(), 'baseSalary.currency');
      set('salary_period', scalar(amount?.unitText), 'baseSalary.value.unitText');
      provenance.job_url = { method: 'browser', locator: 'location.href' };
      const structuredText = [posting.description, qualifications.join('\n')].filter(Boolean).join('\n\n');
      candidates.push({ posting, provenance, adapter: 'generic-jsonld', source: { structured_text: structuredText, rendered_text: '',
        // Preserve only selected posting facts, never arbitrary owner/candidate fields.
        structured_data: JSON.stringify({ title: posting.role_title, company: posting.company_name, description: posting.description,
          qualifications: posting.qualifications, location: posting.location, employmentType: asArray(value.employmentType).filter(t => typeof t === 'string').map(t => t.slice(0, 200)),
          salary_min: posting.salary_min, salary_max: posting.salary_max, salary_currency: posting.salary_currency, salary_period: posting.salary_period }),
        structured_url: typeof value.url === 'string' ? value.url.slice(0, 4000) : null,
        requisition_id: scalar(typeof value.identifier === 'string' ? value.identifier : value.identifier?.value),
        salary_period: posting.salary_period }, warnings: [] });
      if (value.employmentType && !posting.job_type) warn(candidates.at(-1).warnings, 'unsupported_employment_type', 'Employment type is ambiguous or unsupported; job type was left blank.', { field: 'job_type' });
      if (value.qualifications && asArray(value.qualifications).some(q => typeof q !== 'string')) warn(candidates.at(-1).warnings, 'unsupported_qualifications', 'Non-text structured qualifications were not mapped. Check requirements against the page.', { field: 'qualifications' });
    }
    // JobPosting commonly appears in @graph or a top-level array. Do not recursively
    // treat arbitrary embedded page/application objects as job facts.
    if (value['@graph']) collect(value['@graph'], `${locator}.@graph`, depth + 1);
    if (value.mainEntity) collect(value.mainEntity, `${locator}.mainEntity`, depth + 1);
  }
  const scripts = [...document.querySelectorAll('script[type="application/ld+json"]')];
  if (scripts.length > 20) warn(warnings, 'extraction_limit_reached', 'Only the first 20 structured-data blocks were inspected.');
  scripts.slice(0, 20).forEach((script, i) => {
    if (script.textContent.length > 250000) { warn(warnings, 'structured_block_skipped', 'An oversized structured-data block was skipped.'); return; }
    try { collect(JSON.parse(script.textContent), `script[application/ld+json][${i}]`); } catch { invalidJson = true; }
  });
  if (invalidJson) warn(warnings, 'malformed_structured_data', 'Malformed structured data was skipped.');
  const host = location.hostname.toLowerCase();
  let adapter = null, region = null, title = null, company = null, place = null, workplace = null;
  if (['job-boards.greenhouse.io', 'boards.greenhouse.io'].includes(host) && /\/jobs\/[^/]+/.test(location.pathname)) {
    adapter = 'greenhouse-dom'; region = document.querySelector('.job__description, #content');
    title = document.querySelector('h1')?.textContent;
    // This is a company label from the document title, never the board slug.
    company = document.title.match(/^Job Application for .+ at (.+)$/)?.[1] || document.querySelector('#header .company-name')?.textContent;
    place = document.querySelector('.job__location, #header .location')?.textContent;
  } else if (host === 'jobs.lever.co' && location.pathname.split('/').filter(Boolean).length === 2) {
    adapter = 'lever-dom';
    region = document.querySelector('.posting-page .content .section-wrapper:not(.accent-section):not(.main-header), .content .section-wrapper:not(.accent-section):not(.main-header)');
    title = document.querySelector('.posting-headline h2')?.textContent;
    company = document.querySelector('.main-header-logo img')?.getAttribute('alt')?.replace(/ logo$/i, '');
    place = document.querySelector('.posting-categories .location')?.textContent;
    workplace = model(document.querySelector('.posting-categories .workplaceTypes')?.textContent);
  }
  if (!region && !adapter) {
    region = document.querySelector('[data-testid="job-description"], [itemprop="description"], #job-description, .job-description');
    if (region) { adapter = 'generic-dom'; title = document.querySelector('h1')?.textContent; }
  }
  const rendered = textOf(region);
  if (region && rendered) {
    const match = candidates.length === 1 && (!title || !candidates[0].posting.role_title || clean(title).toLowerCase() === clean(candidates[0].posting.role_title).toLowerCase()) ? candidates[0] : null;
    const target = match || { posting: blank(), provenance: {}, adapter, source: { structured_text: '', structured_data: null, structured_url: null, requisition_id: null, salary_period: null }, warnings: [] };
    if (!match) candidates.push(target);
    target.adapter = adapter;
    target.source.rendered_text = rendered;
    function dom(key, value, locator) {
      const data = typeof value === 'string' ? clean(value) : value;
      if (!data) return;
      if (key !== 'description' && target.posting[key] && target.posting[key] !== data) warn(target.warnings, 'conflicting_sources', `Rendered and structured ${key.replaceAll('_', ' ')} differ. Check both sources.`, { field: key, variant_ids: ['rendered', 'structured'] });
      target.posting[key] = data;
      target.provenance[key] = { method: 'dom', locator };
    }
    dom('role_title', title, adapter === 'lever-dom' ? '.posting-headline h2' : 'h1');
    dom('company_name', company, adapter === 'lever-dom' ? '.main-header-logo img[alt]' : 'document.title / #header .company-name');
    dom('location', place, adapter === 'lever-dom' ? '.posting-categories .location' : '.job__location / #header .location');
    dom('work_model', workplace, '.posting-categories .workplaceTypes');
    // Preserve both versions on disagreement rather than silently discarding facts.
    if (match && target.posting.description && clean(target.posting.description) !== rendered) warn(target.warnings, 'conflicting_sources', 'Structured and rendered descriptions differ. Both source versions are preserved; review for omitted requirements.', { field: 'description', variant_ids: ['rendered', 'structured'] });
    dom('description', rendered, adapter === 'greenhouse-dom' ? '.job__description / #content' : adapter === 'lever-dom' ? '.content .section-wrapper (posting body)' : 'job description region');
    if (adapter === 'greenhouse-dom') target.posting.job_platform = 'GREENHOUSE';
    if (adapter === 'lever-dom') target.posting.job_platform = 'LEVER';
    if (target.posting.job_platform) target.provenance.job_platform = { method: 'url', locator: 'location.hostname' };
    target.provenance.job_url = { method: 'browser', locator: 'location.href' };
    if (adapter === 'generic-dom') warn(target.warnings, 'unverified_layout', 'Generic description region: this layout has not been validated.');
    if (region.querySelector('details:not([open]), [aria-expanded="false"], [hidden]')) warn(target.warnings, 'collapsed_content', 'The description contains collapsed or hidden content. Expand it on the page and capture again.', { field: 'description' });
  }
  if (document.querySelector('iframe')) warn(warnings, 'frames_not_read', 'Embedded frames were not read. Requirements in a frame may be missing.');
  if (!candidates.length) warn(warnings, 'missing_requirements', 'No posting description found. Open the full posting rather than an application form or results list.');
  for (const candidate of candidates) {
    candidate.adapter_version = '1';
    candidate.source.employer_key = ['greenhouse-dom', 'lever-dom'].includes(candidate.adapter)
      ? `${host}/${location.pathname.split('/').filter(Boolean)[0]}` : null;
    if (!candidate.source.rendered_text) warn(candidate.warnings, 'structured_only', 'Only structured data was captured; completeness has not been checked against rendered requirements.');
    for (const warning of candidate.warnings) if (warning.variant_ids) warning.variant_ids = warning.variant_ids.filter(id => candidate.source[`${id}_text`]);
    if (candidate.adapter === 'greenhouse-dom') candidate.source.requisition_id ||= location.pathname.match(/\/jobs\/([^/]+)/)?.[1] || null;
    if (candidate.adapter === 'lever-dom') candidate.source.requisition_id ||= location.pathname.split('/').filter(Boolean)[1];
  }
  return { extractor_version: version, page_url: location.href, page_title: document.title, captured_at: new Date().toISOString(), candidates,
    warnings: [...new Map(warnings.map(w => [JSON.stringify(w), w])).values()] };
}
