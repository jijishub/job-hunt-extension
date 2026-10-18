// Serialized by chrome.scripting.executeScript. Keep helpers inside this function.
// Reads the current document. LinkedIn capture may expand only its description
// button and wait for the selected pane. Never follows Apply or calls an API.
export async function extractPosting(options = {}) {
  const version = 'posting-pilot-v6';
  const maxText = 120000;
  const warnings = [];
  const promotionalContent = '.jobs-premium-applicant-insights, .job-details-how-you-match, [data-testid="premium-upsell"], [data-ad], .ad-banner-container';
  const excludedContent = '.jobs-description__footer, ' + promotionalContent;
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
        if (!structured && node.isConnected && (getComputedStyle(node).display === 'none' || getComputedStyle(node).visibility === 'hidden')) return '';
        if (node.matches(excludedContent)) return '';
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
  const host = location.hostname.toLowerCase();
  const isLinkedIn = (host === 'linkedin.com' || host.endsWith('.linkedin.com')) && location.pathname.startsWith('/jobs/');
  const jobId = value => {
    try { const url = new URL(value, location.href); return /(^|\.)linkedin\.com$/i.test(url.hostname) ? url.pathname.match(/\/jobs\/view\/(?:[^/?#]*-)?(\d+)(?:[/?#]|$)/)?.[1] || url.searchParams.get('currentJobId')?.match(/^\d+$/)?.[0] || null : null; }
    catch { return null; }
  };
  const visible = node => {
    if (!node || node.closest('[hidden], [aria-hidden="true"]')) return false;
    for (let n = node; n; n = n.parentElement) if (getComputedStyle(n).display === 'none' || getComputedStyle(n).visibility === 'hidden') return false;
    return true;
  };
  const paneSelector = '.jobs-search__job-details--container, .jobs-search__job-details, .scaffold-layout__detail, .jobs-details, .job-view-layout, [data-testid="job-details"], [role="region"][aria-label="Job details" i]';
  const descriptionSelector = '.jobs-description__content .jobs-box__html-content, .jobs-description-content__text, #job-details, .jobs-description__content, .description__text .show-more-less-html__markup, .description__text, [data-testid="job-description"]';
  const titleSelector = '.job-details-jobs-unified-top-card__job-title, .jobs-unified-top-card__job-title, .topcard__title, .top-card-layout__title';
  const headingsSelector = 'h1,h2,h3,h4,h5,h6,[role="heading"]';
  const neighborContent = '.jobs-search-results-list, .jobs-search-results__list, .jobs-similar-jobs, .jobs-recommendations, [data-testid="job-recommendations"]';
  const usable = node => visible(node) && !node.closest(promotionalContent + ', ' + neighborContent);
  const aboutHeading = node => /^about\s+(?:the\s+)?job\s*:?$/i.test(clean(node.textContent));
  function semanticDescription(root) {
    const headings = [...(root?.querySelectorAll(headingsSelector) || [])].filter(node => usable(node) && aboutHeading(node));
    if (headings.length !== 1) return { about: null, body: null };
    const about = headings[0];
    for (let node = about.parentElement, depth = 0; node && node !== root && depth < 7; node = node.parentElement, depth++) {
      if (node.querySelector(neighborContent) || [...node.querySelectorAll(headingsSelector)].some(n => !aboutHeading(n) && /^(?:use ai|people you|similar jobs|recommended jobs|job search smarter)/i.test(clean(n.textContent)))) break;
      const body = node.querySelector('[data-testid="expandable-text-box"], [data-testid="job-description"], .jobs-box__html-content');
      if (body && usable(body)) return { about, body };
      // Require an actual description card, never the entire main/results pane.
      if (node.querySelector('p,ul,ol') && textOf(node).replace(clean(about.textContent), '').trim()) return { about, body: node };
    }
    return { about, body: null };
  }
  function locatorFor(node) {
    if (!node) return null;
    if (node.id && document.querySelectorAll('#' + CSS.escape(node.id)).length === 1) return '#' + CSS.escape(node.id);
    const parts = [];
    for (let n = node; n && n !== document.documentElement; n = n.parentElement) parts.unshift(n.tagName.toLowerCase() + ':nth-child(' + ([...n.parentElement.children].indexOf(n) + 1) + ')');
    return 'html > ' + parts.join(' > ');
  }
  const factSelector = 'span,button,p,div,li';
  function factValues(node) {
    return [...(node?.querySelectorAll(factSelector) || [])].filter(n => usable(n) && !n.closest('nav,aside') && !n.querySelector(factSelector))
      .map(n => clean(n.textContent).replace(/^[✓✔☑\s]+/, '').replace(/[‐‑–]/g, '-'));
  }
  const hasHeaderFacts = node => factValues(node).some(value => model(value) || jobType(value));
  const safeHeader = (node, about) => !node.contains(about) && !node.querySelector(neighborContent + ', ' + promotionalContent) &&
    ![...node.querySelectorAll(headingsSelector)].some(n => /^(?:use ai|people you|similar jobs|recommended jobs|job search smarter)/i.test(clean(n.textContent)));
  function headerFor(heading, root, about) {
    let companyCard = null;
    for (let node = heading?.parentElement; node && node !== root; node = node.parentElement) {
      if (!safeHeader(node, about)) break;
      if (hasHeaderFacts(node)) return node;
      if (!companyCard && [...node.querySelectorAll('a[href*="/company/"]')].some(usable)) companyCard = node;
    }
    if (heading) return companyCard || heading.parentElement;
    // A visible title may use an unrecognized element. Locate its metadata card
    // independently, bounded before About the job and outside other cards.
    if (!about) return null;
    const cards = [...(root?.querySelectorAll('section,article,header,div') || [])].filter(node => usable(node) &&
      !!(node.compareDocumentPosition(about) & Node.DOCUMENT_POSITION_FOLLOWING) && safeHeader(node, about) && hasHeaderFacts(node));
    const outermost = cards.filter(node => !cards.some(other => other !== node && other.contains(node)));
    return outermost.length === 1 ? outermost[0] : null;
  }
  function linkedInContext() {
    const roots = [...document.querySelectorAll(paneSelector)].filter(visible);
    const expectedId = jobId(location.href);
    const identified = [...document.querySelectorAll('[data-job-id], [data-current-job-id]')].find(node => usable(node) && (node.getAttribute('data-job-id') || node.getAttribute('data-current-job-id')) === expectedId &&
      (node.querySelector(descriptionSelector) || [...node.querySelectorAll(headingsSelector)].some(aboutHeading)));
    const root = roots[0] || identified || (location.pathname.includes('/jobs/view/') ? document.querySelector('main, [role="main"]') : null);
    const semantic = semanticDescription(root);
    let heading = [...(root?.querySelectorAll(titleSelector) || [])].find(usable);
    if (!heading) {
      const possible = [...(root?.querySelectorAll(headingsSelector) || [])].filter(node => usable(node) && !aboutHeading(node) &&
        (!semantic.about || !!(node.compareDocumentPosition(semantic.about) & Node.DOCUMENT_POSITION_FOLLOWING)) &&
        !/^(?:use ai|people you|similar jobs|recommended jobs|job search smarter|jobs|search results|premium)/i.test(clean(node.textContent)) && !node.closest('a[href*="/company/"]'));
      heading = possible.find(node => [...(headerFor(node, root, semantic.about)?.querySelectorAll('a[href*="/company/"]') || [])].some(a => usable(a) && clean(a.textContent) !== clean(node.textContent))) ||
        possible.find(node => node.matches('h1'));
      // A company link may live in a separate card. Accept one unambiguous
      // primary heading before About the job; never choose among competing titles.
      if (!heading && semantic.about) {
        const primary = possible.filter(node => node.matches('h2,[role="heading"]') && !node.closest('nav,aside,button') &&
          !node.querySelector(headingsSelector) && clean(node.textContent) && clean(node.textContent).length <= 500 &&
          (!node.hasAttribute('aria-level') || ['1','2'].includes(node.getAttribute('aria-level'))));
        if (primary.length === 1) heading = primary[0];
      }
    }
    const header = headerFor(heading, root, semantic.about);
    const link = heading?.matches('a[href]') ? heading : heading?.querySelector('a[href*="/jobs/view/"]');
    const rootId = root?.getAttribute('data-job-id') || root?.getAttribute('data-current-job-id') || root?.getAttribute('data-entity-urn')?.match(/jobPosting:(\d+)/)?.[1];
    const headerId = jobId(link?.href) || rootId || null, urlId = jobId(location.href);
    const bodies = descriptionSelector.split(',').flatMap(selector => [...(root?.querySelectorAll(selector.trim()) || [])]);
    const body = bodies.find(usable) || semantic.body || bodies[0];
    const bodyId = body?.closest('[data-job-id], [data-job-description-id]')?.getAttribute('data-job-description-id') || body?.closest('[data-job-id]')?.getAttribute('data-job-id');
    return { root, heading, header: header && !header.contains(body) ? header : null, body, about: semantic.about, id: urlId || headerId, headerId, urlId,
      descriptionId: body?.getAttribute('data-job-description-id') || body?.getAttribute('data-job-id'),
      mismatch: !!((urlId && headerId && urlId !== headerId) || (bodyId && (urlId || headerId) && bodyId !== (urlId || headerId))),
      text: textOf(body), rawText: body?.textContent || '', title: clean(heading?.textContent || '') };
  }
  let linkedIn = null, expansionAttempted = false, descriptionCollapsed = false;
  if (isLinkedIn) {
    const deadline = Date.now() + Math.min(6000, Math.max(400, Number(options?.waitMs) || 4500));
    let initialId = null, stable = '', stableSince = 0, ready = false, lastContext = null, lastReason = 'layout_unrecognized';
    const prior = globalThis.__jobHuntLastLinkedInCapture;
    const rejectedBodies = new Set();
    function moreButton(context) {
      const container = context.body?.closest('.jobs-description, .jobs-description__container, .description__text') || context.body;
      return [...(container?.querySelectorAll('button.show-more-less-html__button--more, button.jobs-description__footer-button, button[aria-expanded="false"]') || [])].find(button => {
        const label = clean(button.getAttribute('aria-label') || button.textContent);
        const explicitDescription = /^(?:click to see more description|(?:show|see) more (?:of (?:the )?)?(?:job )?description)$/i.test(label);
        const controlledBody = !!context.body?.id && (button.getAttribute('aria-controls') || '').split(/\s+/).includes(context.body.id);
        const recognized = button.matches('.show-more-less-html__button--more, .jobs-description__footer-button') || controlledBody || explicitDescription;
        return recognized && !button.closest(promotionalContent) && visible(button) && !button.disabled && button.getAttribute('aria-expanded') !== 'true' && (!button.form || button.type !== 'submit') &&
          (explicitDescription || /^(?:show more|see more|…\s*more|\.{3}\s*more)$/i.test(label));
      });
    }
    function collapsed(context) {
      const body = context.body;
      return !!moreButton(context) || !!body && (body.scrollHeight > body.clientHeight + 2 && ['hidden', 'clip'].includes(getComputedStyle(body).overflowY) || Number.parseInt(getComputedStyle(body).webkitLineClamp) > 0);
    }
    do {
      const context = linkedInContext();
      if (context.id && !initialId) initialId = context.id;
      if (initialId && context.id && context.id !== initialId) {
        warn(warnings, 'selection_changed', 'The selected LinkedIn job changed during capture. Capture the intended selection again.');
        return { extractor_version: version, page_url: location.href, captured_at: new Date().toISOString(), candidates: [], warnings };
      }
      const loading = !context.text.trim() || /^(?:loading(?:\s+(?:job|description|details))*|please wait)[.\s…]*$/i.test(context.text.trim()) ||
        !!context.body?.closest('[aria-busy="true"]') || [...(context.root?.querySelectorAll('.jobs-details__loading-state') || [])].some(visible);
      // A new header/URL is not proof that an asynchronously reused body changed.
      // Retain only a comparison signature; never serve a cached description.
      const previousBody = prior && prior.id !== context.id && prior.text === context.text;
      lastContext = context;
      lastReason = context.mismatch ? 'identity_mismatch' : !context.root || !context.body ? 'layout_unrecognized' : loading ? 'description_loading' : previousBody || rejectedBodies.has(context.text) ? 'previous_selection_text' : 'description_changing';
      if (context.mismatch && context.text.trim() && rejectedBodies.size < 10) rejectedBodies.add(context.text);
      const button = !expansionAttempted && context.id && !context.mismatch && moreButton(context);
      if (button) { expansionAttempted = true; button.click(); stable = ''; stableSince = 0; }
      else if (context.id && context.root && context.body && usable(context.body) && !context.mismatch && !loading && !previousBody && !rejectedBodies.has(context.text)) {
          const signature = [context.id, context.title, context.header?.textContent || '', context.text].join('\u0000');
          if (signature !== stable) { stable = signature; stableSince = Date.now(); }
          // Some layouts expose no ID on the body itself. Give header/body
          // updates a longer quiet interval rather than accepting the header's
          // first render as proof of description readiness.
          const quietMs = context.descriptionId === context.id ? 350 : 1000;
          if (Date.now() - stableSince >= quietMs) { linkedIn = context; descriptionCollapsed = collapsed(context); ready = true; break; }
      } else { stable = ''; stableSince = 0; }
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    if (!ready) {
      const messages = {
        layout_unrecognized: 'LinkedIn may already be fully loaded, but the selected job title or description region was not recognized in this layout. Locate About the job, then capture again. Copy the capture diagnostics if it still fails; waiting alone will not fix an unsupported layout.',
        identity_mismatch: 'The page and selected job panel report different job IDs. Capture again once the intended job and its description agree; no previous description was reused.',
        description_loading: 'The selected description is empty, contains a loading placeholder, or is explicitly marked busy. Wait for that description to appear, then capture again.',
        previous_selection_text: 'This panel still contains the previously captured job description under a different job ID. No previous description was reused. Wait for the intended description to replace it and capture again.',
        description_changing: 'The selected description kept changing during capture. Capture again when that text is stable; no previous description was reused.',
      };
      warn(warnings, 'selected_description_unavailable', messages[lastReason]);
      const context = lastContext;
      return { extractor_version: version, page_url: location.href, captured_at: new Date().toISOString(), candidates: [], warnings,
        diagnostics: { extractor_version: version, platform: 'LINKEDIN', reason: lastReason, page: location.origin + location.pathname, job_id: context?.id || null,
          root_found: !!context?.root, title_found: !!context?.heading, description_found: !!context?.body, about_job_found: !!context?.about,
          description_characters: context?.text.length || 0, header_job_id: context?.headerId || null, url_job_id: context?.urlId || null } };
    }
  }
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
      if (linkedIn) {
        const identifier = typeof value.identifier === 'string' ? value.identifier : value.identifier?.value;
        const id = jobId(value.url) || String(identifier || '').match(/^(?:urn:li:jobPosting:)?(\d+)$/)?.[1];
        if (id !== linkedIn.id) return;
      }
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
  // On LinkedIn, page-wide JSON-LD may belong to a neighboring/recommended job.
  let adapter = null, region = null, title = null, company = null, place = null, workplace = null, employment = null, renderedQualifications = null;
  if (linkedIn) {
    adapter = 'linkedin-dom'; region = linkedIn.body; title = linkedIn.title;
    company = [...linkedIn.root.querySelectorAll('.job-details-jobs-unified-top-card__company-name, .jobs-unified-top-card__company-name, .topcard__org-name-link')].find(usable)?.textContent || [...(linkedIn.header?.querySelectorAll('a[href*="/company/"]') || [])].find(a => usable(a) && clean(a.textContent))?.textContent;
    place = linkedIn.root.querySelector('.job-details-jobs-unified-top-card__primary-description-container .tvm__text--low-emphasis, .job-details-jobs-unified-top-card__tertiary-description-container .tvm__text--low-emphasis, .jobs-unified-top-card__bullet, .topcard__flavor--bullet')?.textContent?.split('·')[0];
    if (!place) place = [...(linkedIn.header?.querySelectorAll('[data-testid="job-location"], p, span, div') || [])].filter(n => usable(n) && !n.querySelector('p,button,a,h1,h2,h3,[role="heading"]') && !n.closest('button,a') &&
      (!n.querySelector('span,div') || /·.*(?:ago|applicant|clicked|reposted)/i.test(clean(n.textContent))))
      .filter(n => n.matches('[data-testid="job-location"]') || clean(n.textContent).includes(',') || /·.*(?:ago|applicant|clicked|reposted)/i.test(clean(n.textContent)))
      .map(n => clean(n.textContent).split('·')[0].trim()).find(text => text && text !== clean(company) && text !== title && !/applicant|clicked|apply|response|ago|premium/i.test(text));
    const facts = [...linkedIn.root.querySelectorAll('.job-details-jobs-unified-top-card__job-insight, .job-details-jobs-unified-top-card__job-insight-view-model, .jobs-unified-top-card__job-insight, .description__job-criteria-item'),
      ...[...(linkedIn.header?.querySelectorAll('span,button') || [])].filter(node => usable(node) && !node.querySelector('span,button'))].filter(usable);
    const values = [...factValues(linkedIn.header), ...facts.flatMap(node => [clean(node.textContent), ...node.textContent.split(/[\n·]/).map(clean), ...[...node.querySelectorAll('span')].filter(n => !n.querySelector('span')).map(n => clean(n.textContent))])];
    const models = [...new Set(values.map(model).filter(Boolean))], types = [...new Set(values.map(jobType).filter(Boolean))];
    workplace = models.length === 1 ? models[0] : null;
    employment = types.length === 1 ? types[0] : null;
  } else if (host === 'cgi.njoyn.com' && [...new URLSearchParams(location.search)].some(([k,v]) => k.toLowerCase() === 'page' && v.toLowerCase() === 'jobdetails')) {
    adapter = 'cgi-njoyn-dom'; region = document.querySelector('#njoynPageContainer .job-desc .job-posting-content, .job-desc .job-posting-content');
    const header = region?.closest('.job-desc')?.querySelector('header');
    title = header?.querySelector('h1')?.textContent;
    company = document.querySelector('img[alt="CGI"]')?.alt || (/CGI\.com/i.test(document.title) ? 'CGI' : null);
    const labelled = label => [...(header?.querySelectorAll('div') || [])].find(n => label.test(n.querySelector('.bolder')?.textContent || ''))?.querySelector('.bolder + span')?.textContent;
    place = labelled(/^Main location:/i); employment = jobType(clean(labelled(/^Employment Type:/i)));
    workplace = model(clean(labelled(/^(?:Workplace|Work model|Remote work):/i)));
    const qualificationRow = [...(region?.querySelectorAll('.job-info-row') || [])].find(n => /required qualifications/i.test(n.querySelector('h2')?.textContent || ''));
    if (qualificationRow) renderedQualifications = textOf(qualificationRow).split('\n').map(s => s.match(/^\s*[-•*]\s*(.+)$/)?.[1]).filter(Boolean);
  } else if (['job-boards.greenhouse.io', 'boards.greenhouse.io'].includes(host) && /\/jobs\/[^/]+/.test(location.pathname)) {
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
    const match = candidates.length === 1 && (linkedIn || !title || !candidates[0].posting.role_title || clean(title).toLowerCase() === clean(candidates[0].posting.role_title).toLowerCase()) ? candidates[0] : null;
    const target = match || { posting: blank(), provenance: {}, adapter, source: { structured_text: '', structured_data: null, structured_url: null, requisition_id: null, salary_period: null }, warnings: [] };
    if (!match) candidates.push(target);
    target.adapter = adapter;
    target.source.rendered_text = rendered;
    function dom(key, value, locator) {
      const data = typeof value === 'string' ? clean(value) : value;
      if (!data) return;
      if (key !== 'description' && target.posting[key] && (!Array.isArray(target.posting[key]) || target.posting[key].length) && JSON.stringify(target.posting[key]) !== JSON.stringify(data)) warn(target.warnings, 'conflicting_sources', `Rendered and structured ${key.replaceAll('_', ' ')} differ. Check both sources.`, { field: key, variant_ids: ['rendered', 'structured'] });
      target.posting[key] = data;
      target.provenance[key] = { method: 'dom', locator };
    }
    dom('role_title', title, adapter === 'lever-dom' ? '.posting-headline h2' : adapter === 'linkedin-dom' ? locatorFor(linkedIn.heading) : adapter === 'cgi-njoyn-dom' ? '.job-desc > header h1' : 'h1');
    dom('company_name', company, adapter === 'lever-dom' ? '.main-header-logo img[alt]' : adapter === 'linkedin-dom' ? 'selected pane company name' : 'document.title / #header .company-name');
    dom('location', place, adapter === 'lever-dom' ? '.posting-categories .location' : adapter === 'linkedin-dom' ? 'selected pane top card location' : adapter === 'cgi-njoyn-dom' ? '.job-desc header: Main location' : '.job__location / #header .location');
    dom('work_model', workplace, adapter === 'linkedin-dom' ? 'selected pane explicit job insight' : adapter === 'cgi-njoyn-dom' ? '.job-desc header: explicit work model' : '.posting-categories .workplaceTypes');
    dom('job_type', employment, adapter === 'linkedin-dom' ? 'selected pane explicit employment type' : '.job-desc header: Employment Type');
    if (renderedQualifications?.length) dom('qualifications', renderedQualifications, '.job-posting-content: Required qualifications list');
    // Preserve both versions on disagreement rather than silently discarding facts.
    if (match && target.posting.description && clean(target.posting.description).replace(/\s+/g, ' ') !== rendered.replace(/\s+/g, ' ')) warn(target.warnings, 'conflicting_sources', 'Structured and rendered descriptions differ. Both source versions are preserved; review for omitted requirements.', { field: 'description', variant_ids: ['rendered', 'structured'] });
    dom('description', rendered, adapter === 'greenhouse-dom' ? '.job__description / #content' : adapter === 'lever-dom' ? '.content .section-wrapper (posting body)' : adapter === 'cgi-njoyn-dom' ? '.job-desc .job-posting-content (all job-info-row sections)' : adapter === 'linkedin-dom' ? locatorFor(linkedIn.body) : 'job description region');
    if (adapter === 'greenhouse-dom') target.posting.job_platform = 'GREENHOUSE';
    if (adapter === 'lever-dom') target.posting.job_platform = 'LEVER';
    if (adapter === 'linkedin-dom') {
      target.posting.job_platform = 'LINKEDIN'; target.posting.job_url = `https://www.linkedin.com/jobs/view/${linkedIn.id}/`;
      target.source.requisition_id = linkedIn.id;
      target.provenance.job_url = { method: 'dom', locator: 'selected LinkedIn job ID / top card permalink' };
      if (descriptionCollapsed) warn(target.warnings, 'collapsed_content', expansionAttempted ? 'The selected description is still collapsed or clipped after an expansion attempt. Expand it manually, compare all requirements and capture again.' : 'The selected description is clipped and no usable description expansion control was available. Expand it manually, compare all requirements and capture again.', { field: 'description' });
    }
    if (adapter === 'cgi-njoyn-dom') {
      target.source.structured_identifier = target.source.requisition_id;
      target.source.requisition_id = [...new URLSearchParams(location.search)].find(([k]) => k.toLowerCase() === 'jobid')?.[1] || null;
    }
    if (target.posting.job_platform) target.provenance.job_platform = { method: 'url', locator: 'location.hostname' };
    if (adapter !== 'linkedin-dom') target.provenance.job_url = { method: 'browser', locator: 'location.href' };
    if (adapter === 'generic-dom') warn(target.warnings, 'unverified_layout', 'Generic description region: this layout has not been validated.');
    if (['linkedin-dom', 'cgi-njoyn-dom'].includes(adapter)) warn(target.warnings, 'unverified_layout', 'This adapter has limited verified samples and requires explicit layout review. Compare the intended job title, employer, location and all available posting sections with the selected page before confirming review.');
    const hiddenPostingContent = [...region.querySelectorAll('details:not([open]), [aria-expanded="false"], [hidden]')].some(node => !node.closest(excludedContent) && !node.matches('button, input, textarea, select'));
    if (hiddenPostingContent && !target.warnings.some(w => w.code === 'collapsed_content')) warn(target.warnings, 'collapsed_content', 'The description contains collapsed or hidden content. Expand it on the page and capture again.', { field: 'description' });
  }
  if (document.querySelector('iframe') && (!['linkedin-dom', 'cgi-njoyn-dom'].includes(adapter) || region?.querySelector('iframe'))) warn(warnings, 'frames_not_read', 'Embedded frames were not read. Requirements in a frame may be missing.');
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
  if (linkedIn) globalThis.__jobHuntLastLinkedInCapture = { id: linkedIn.id, text: linkedIn.text };
  return { extractor_version: version, page_url: location.href, page_title: document.title, captured_at: new Date().toISOString(), candidates,
    ...(linkedIn ? { selection: { platform: 'LINKEDIN', job_id: linkedIn.id, canonical_url: `https://www.linkedin.com/jobs/view/${linkedIn.id}/` },
      selection_guard: { description_text: linkedIn.rawText, title: linkedIn.title, pane_selector: paneSelector, description_selector: descriptionSelector, title_selector: titleSelector,
        title_missing: !linkedIn.heading,
        header_locator: locatorFor(linkedIn.header), header_text: linkedIn.header?.textContent || null,
        root_locator: locatorFor(linkedIn.root), title_locator: locatorFor(linkedIn.heading), description_locator: locatorFor(linkedIn.body) } } : {}),
    warnings: [...new Map(warnings.map(w => [JSON.stringify(w), w])).values()] };
}
