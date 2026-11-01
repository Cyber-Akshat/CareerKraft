// Run with `npm.cmd run test:browser`. Uses an installed Chrome or Edge.
// The server and account fixtures are isolated from real accounts and emails.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { createApp } = require('../server');

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const root = path.join(__dirname, '..');
const accessibilityOnly = process.env.BROWSER_AUDIT_SCOPE === 'accessibility';
const tourOnly = process.env.BROWSER_AUDIT_SCOPE === 'tour';
const cookiesOnly = process.env.BROWSER_AUDIT_SCOPE === 'cookies';
const loadingOnly = process.env.BROWSER_AUDIT_SCOPE === 'loading';
const cvTemplatesOnly = process.env.BROWSER_AUDIT_SCOPE === 'cv-templates';
const cvTemplateFixture = {
  buildId: 17,
  structuredCv: {
    name: 'Alex Morgan', headline: 'Computing student',
    contact: ['alex@example.test', 'github.com/alex-morgan'],
    profile: 'Computing student interested in cybersecurity and software development.',
    education: ['Digital T Level in Software Development, Example College, 2025–2027.'],
    experience: ['Documented student project requirements with classmates.'],
    projects: ['Built a dashboard using Python and Flask.'],
    skills: ['Python', 'Flask', 'Research'],
    certifications: ['Introduction to Cybersecurity course completion, 2025.']
  }
};
const artifacts = process.env.BROWSER_ARTIFACTS ? path.resolve(process.env.BROWSER_ARTIFACTS) : null;
if (artifacts) fs.mkdirSync(artifacts, { recursive: true });
const chrome = [process.env.BROWSER_PATH,
  path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].find(file => file && fs.existsSync(file));
assert.ok(chrome, 'Install Chrome/Edge or set BROWSER_PATH to its executable.');

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    let id = 0;
    const pending = new Map();
    const errors = [];
    socket.addEventListener('error', reject, { once: true });
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const request = pending.get(message.id);
        if (!request) return;
        clearTimeout(request.timeout);
        pending.delete(message.id);
        if (message.error) request.reject(new Error(message.error.message));
        else request.resolve(message.result);
      } else if (message.method === 'Runtime.exceptionThrown') {
        errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
      }
    });
    socket.addEventListener('open', () => resolve({
      errors,
      close: () => socket.close(),
      send(method, params = {}) {
        return new Promise((resolve, reject) => {
          const requestId = ++id;
          const timeout = setTimeout(() => {
            pending.delete(requestId);
            reject(new Error(`Browser command timed out: ${method}`));
          }, 15000);
          pending.set(requestId, { resolve, reject, timeout });
          socket.send(JSON.stringify({ id: requestId, method, params }));
        });
      }
    }), { once: true });
  });
}

function accountFixtures(fixture) {
  const scenario = new URLSearchParams(location.search).get('audit');
  if (scenario === 'cv-templates') {
    if (!sessionStorage.getItem('careerkraft-final-cv')) {
      sessionStorage.setItem('careerkraft-final-cv', JSON.stringify(fixture.cv));
    }
    if (!sessionStorage.getItem('careerkraft-cv-build')) {
      sessionStorage.setItem('careerkraft-cv-build', JSON.stringify({ ...fixture.cv, success: true,
        targetCareer: 'Software Developer', suggestions: [{ id: 101, status: 'accepted' }] }));
    }
  }
  const career = { id: 'software-developer', title: 'Software Developer', category: 'Technology',
    description: 'Build websites, apps and digital products by solving problems with code.', score: 88, reasons: ['Technology', 'Problem solving'] };
  const step = { id: 24, title: 'Explore software development', description: 'Learn about the role.', phaseNumber: 1,
    phaseTitle: 'Foundations', stepNumber: 1, estimatedMinutes: 20, activityType: 'learning', evidenceRequired: false,
    status: 'in_progress', career };
  const user = { id: 1, name: 'Alex Morgan', email: 'alex@example.com', dashboardTourSeen: scenario !== 'tour-first' };
  window.__auditTourSaves = [];
  const settings = { displayName: user.name, email: user.email, avatarUrl: null, avatarCharacter: null,
    hasPassword: true, googleLinked: false, googleConfigured: true, securityVerified: false,
    theme: null, reducedMotion: false, createdAt: 1704067200000 };
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, options) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (!url.pathname.startsWith('/api/')) return nativeFetch(input, options);
    await new Promise(resolve => setTimeout(resolve, 25));
    let data = {};
    const endpoint = url.pathname.slice(5);
    if (endpoint === 'session') data = { session: /auth|signup/.test(location.pathname) ? null : { user }, user };
    else if (scenario === 'loading') return new Promise(() => {});
    else if (fixture.fail || scenario === 'failed') return new Response(JSON.stringify({ error: 'Connection interrupted. Please try again.' }), { status: 503 });
    else if (endpoint === 'assessment') data = { assessment: { interests: ['technology'], subjects: ['computing'], strengths: ['analysis'], work_style: ['building'] }, matches: [career], selectedCareer: career };
    else if (endpoint === 'roadmap') data = { roadmap: { career, progress: 0, completedSteps: 0, totalSteps: 1, nextStep: step,
      phases: [{ phaseNumber: 1, title: 'Foundations', steps: [step] }] } };
    else if (endpoint === 'skills') data = { skills: [], summary: { totalSkills: 0, totalVerifications: 0 } };
    else if (endpoint === 'settings') data = { settings, stats: { completedActivities: 0, verifiedSkills: 0 } };
    else if (endpoint === 'settings/dashboard-tour') {
      window.__auditTourSaves.push(JSON.parse(options.body));
      data = { success: true, dashboardTourSeen: true };
    }
    else if (endpoint.endsWith('/content')) data = { content: fixture.module };
    else if (endpoint === 'roadmap/steps/24') data = { step };
    else if (endpoint.startsWith('lumia/')) data = { messages: [], conversation: { id: 1, messages: [] } };
    return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
}

async function run() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'careerkraft-browser-'));
  const application = createApp({ database: ':memory:', sendMail: async () => {} });
  const server = application.app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let cdp;
  try {
    const portFile = path.join(profile, 'DevToolsActivePort');
    for (let i = 0; !fs.existsSync(portFile) && i < 150; i++) await pause(100);
    assert.ok(fs.existsSync(portFile), 'Browser failed to start.');
    const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
    const browserBase = `http://127.0.0.1:${port}`;
    const target = await (await fetch(browserBase + '/json/new?about:blank', { method: 'PUT' })).json();
    cdp = await connect(target.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    const fixture = { module: require('../tests/fixtures/module'), cv: cvTemplateFixture };
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(${accountFixtures})(${JSON.stringify(fixture)})` });
    const evaluate = async expression => {
      const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
      return result.result.value;
    };
    const measure = async (label, expectedWidth) => {
      const result = await evaluate(`(() => {
        const width = document.documentElement.clientWidth;
        return { width, scrollWidth: document.documentElement.scrollWidth,
          rootWidth: document.documentElement.getBoundingClientRect().width,
          overflowing: [...document.querySelectorAll('body *')].filter(el => {
            const style = getComputedStyle(el), rect = el.getBoundingClientRect();
            return style.visibility !== 'hidden' && rect.width && (rect.right > width + 1 || rect.left < -1);
          }).slice(0, 12).map(el => ({ tag: el.tagName, id: el.id, className: String(el.className),
            left: Math.round(el.getBoundingClientRect().left), right: Math.round(el.getBoundingClientRect().right) })) };
      })()`);
      assert.ok(result.width <= expectedWidth && result.width >= expectedWidth - 20, `${label}: viewport width ${result.width}`);
      assert.ok(result.scrollWidth <= result.width + 1, `${label}: ${JSON.stringify(result)}`);
      assert.deepEqual(cdp.errors, [], `${label}: browser script errors`);
      process.stdout.write(`PASS ${label}\n`);
    };
    const pages = fs.readdirSync(root).filter(file => file.endsWith('.html') && file !== 'dd8adc22-d472-4bce-94ad-d465f4689348.html');
    let count = 0;
    const waitFor = async (expression, message) => {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (await evaluate(expression)) return;
        await pause(40);
      }
      assert.fail(message);
    };
    const clickControl = async selector => {
      const point = await evaluate(`(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!element) return null;
        element.scrollIntoView({ behavior: 'instant', block: 'nearest' });
        const rect = element.getBoundingClientRect();
        const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
        return { x, y, reachable: element.contains(document.elementFromPoint(x, y)) };
      })()`);
      assert.ok(point?.reachable, `Control is reachable: ${selector}`);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
      await pause(50);
    };
    const auditCvTemplates = async () => {
      const templateIds = ['classic', 'modern', 'minimal', 'technical', 'academic', 'creative'];
      const sourceFields = Object.keys(cvTemplateFixture.structuredCv);
      const readCvText = () => evaluate(`Object.fromEntries(${JSON.stringify(sourceFields)}.map(field =>
        [field, document.getElementById('cv' + field[0].toUpperCase() + field.slice(1)).textContent]))`);
      await cdp.send('Page.navigate', { url: base + '/index.html' });
      await waitFor('document.readyState !== "loading"', 'Initial page establishes browser storage');
      for (const [width, theme] of [[1440, 'light'], [375, 'dark']]) {
        await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 768 });
        await evaluate(`localStorage.setItem('careerkraft-theme', ${JSON.stringify(theme)});
          localStorage.setItem('careerkraft-cookie-consent', JSON.stringify({ version: 1, choice: 'rejected', savedAt: Date.now() }))`);
        cdp.errors.length = 0;
        await cdp.send('Page.navigate', { url: base + '/cv-preview.html?build=17&audit=cv-templates' });
        await waitFor('document.querySelectorAll(\'input[name="cv-template"]\').length === 6 && !document.getElementById("cvDocument").hidden', 'Six template choices render with the final CV');
        await evaluate('document.fonts.ready');
        const originalText = await readCvText();
        assert.equal(originalText.name, cvTemplateFixture.structuredCv.name);
        assert.equal(await evaluate('document.documentElement.dataset.theme'), theme);
        for (const templateId of templateIds) {
          await evaluate(`document.getElementById('templateCategory').value = ${JSON.stringify(templateId)};
            document.getElementById('templateCategory').dispatchEvent(new Event('change', { bubbles: true }))`);
          assert.deepEqual(await evaluate(`[...document.querySelectorAll('.template-card')].filter(card => !card.hidden).map(card => card.dataset.category)`), [templateId], 'The category filter shows its matching template');
          await clickControl(`.template-card[data-category="${templateId}"]`);
          await waitFor(`document.getElementById('cvDocument').dataset.template === ${JSON.stringify(templateId)}`, 'The selected template applies to the real document');
          assert.equal(await evaluate('document.querySelector(\'input[name="cv-template"]:checked\').value'), templateId);
          assert.ok((await evaluate('document.getElementById("templateName").textContent')).toLowerCase().includes(templateId));
          assert.deepEqual(await readCvText(), originalText, 'Changing a template keeps every source field intact');
          assert.deepEqual(await evaluate('JSON.parse(sessionStorage.getItem("careerkraft-final-cv")).structuredCv'), cvTemplateFixture.structuredCv);
          const order = await evaluate('[...document.querySelectorAll("#cvDocument .cv-section")].map(section => section.id)');
          if (templateId === 'technical') {
            assert.ok(order.indexOf('skillsSection') < order.indexOf('educationSection'));
            assert.ok(order.indexOf('projectsSection') < order.indexOf('educationSection'));
          } else if (templateId === 'academic') {
            assert.ok(order.indexOf('educationSection') < order.indexOf('projectsSection'));
            assert.ok(order.indexOf('certificationsSection') < order.indexOf('projectsSection'));
          }
          await measure(`CV ${templateId} template at ${width}px (${theme})`, width);
          count++;
          await cdp.send('Page.reload');
          await waitFor(`document.getElementById('cvDocument')?.dataset.template === ${JSON.stringify(templateId)} && document.querySelector('input[name="cv-template"]:checked')?.value === ${JSON.stringify(templateId)}`, 'The selected template survives reload');
          assert.deepEqual(await readCvText(), originalText, 'Reload keeps the same CV content');
          await cdp.send('Emulation.setEmulatedMedia', { media: 'print' });
          const printState = await evaluate(`({ chooser: getComputedStyle(document.getElementById('templateChooser')).display,
            document: getComputedStyle(document.getElementById('cvDocument')).display,
            name: document.getElementById('cvName').textContent,
            text: document.getElementById('cvDocument').innerText,
            template: document.getElementById('cvDocument').dataset.template })`);
          assert.equal(printState.chooser, 'none', 'Printed CV excludes template controls');
          assert.notEqual(printState.document, 'none', 'Printed CV remains visible');
          assert.equal(printState.name, cvTemplateFixture.structuredCv.name);
          assert.equal(printState.template, templateId);
          for (const value of Object.values(cvTemplateFixture.structuredCv)) {
            for (const text of Array.isArray(value) ? value : [value]) assert.ok(printState.text.includes(text), 'Print includes every supplied CV fact');
          }
          if (artifacts && width === 1440) {
            const pdf = await cdp.send('Page.printToPDF', { preferCSSPageSize: true, printBackground: false, displayHeaderFooter: false });
            const buffer = Buffer.from(pdf.data, 'base64');
            fs.writeFileSync(path.join(artifacts, `cv-${templateId}.pdf`), buffer);
            const { PDFParse } = require('pdf-parse');
            const parser = new PDFParse({ data: Uint8Array.from(buffer), isEvalSupported: false });
            try {
              const result = await parser.getText();
              const text = result.text.replace(/\s+/g, ' ');
              for (const value of Object.values(cvTemplateFixture.structuredCv)) {
                for (const source of Array.isArray(value) ? value : [value]) {
                  assert.ok(text.includes(source.replace(/\s+/g, ' ')), `The ${templateId} PDF retains selectable source text: ${source}`);
                }
              }
              const lower = text.toLowerCase();
              if (templateId === 'technical') {
                assert.ok(lower.indexOf('skills') < lower.indexOf('education'));
                assert.ok(lower.indexOf('projects') < lower.indexOf('education'));
              } else if (templateId === 'academic') {
                assert.ok(lower.indexOf('education') < lower.indexOf('projects'));
                assert.ok(lower.indexOf('certifications') < lower.indexOf('projects'));
              }
              process.stdout.write(`PASS ${templateId} PDF selectable text and section order\n`);
            } finally { await parser.destroy(); }
          }
          await cdp.send('Emulation.setEmulatedMedia', { media: '' });
          if (artifacts && templateId === 'creative') {
            await evaluate(`document.getElementById('templateCategory').value = 'all';
              document.getElementById('templateCategory').dispatchEvent(new Event('change', { bubbles: true }));
              window.scrollTo({ top: 0, behavior: 'instant' })`);
            const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' });
            fs.writeFileSync(path.join(artifacts, `cv-templates-${width}.png`), Buffer.from(screenshot.data, 'base64'));
            if (width === 375) {
              await evaluate('document.getElementById("templateChooser").scrollIntoView({ behavior: "instant", block: "start" })');
              const cards = await cdp.send('Page.captureScreenshot', { format: 'png' });
              fs.writeFileSync(path.join(artifacts, 'cv-template-cards-375.png'), Buffer.from(cards.data, 'base64'));
            }
            await evaluate('document.getElementById("cvDocument").scrollIntoView({ behavior: "instant", block: "start" })');
            const documentScreenshot = await cdp.send('Page.captureScreenshot', { format: 'png' });
            fs.writeFileSync(path.join(artifacts, `cv-document-${width}.png`), Buffer.from(documentScreenshot.data, 'base64'));
          }
        }
      }
      await evaluate(`document.getElementById('templateCategory').value = 'all';
        document.getElementById('templateCategory').dispatchEvent(new Event('change', { bubbles: true }));
        document.querySelector('input[name="cv-template"][value="classic"]').focus()`);
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39 });
      await waitFor('document.querySelector(\'input[name="cv-template"]:checked\')?.value === "modern" && document.getElementById("cvDocument").dataset.template === "modern"', 'Native radio arrow-key selection applies the next template');
      assert.equal(await evaluate('document.activeElement.value'), 'modern');
      process.stdout.write('PASS CV template native radio keyboard navigation\n');

      const longCv = structuredClone(cvTemplateFixture);
      longCv.structuredCv.profile = Array.from({ length: 12 }, (_, index) =>
        `Research background paragraph ${index + 1}: Computing student exploring cybersecurity and software development through documented projects. Reviewed requirements, tested interfaces and recorded findings with classmates.`).join('\n\n');
      longCv.structuredCv.projects = Array.from({ length: 24 }, (_, index) =>
        `Project ${index + 1}: Built a Python and Flask dashboard to organise example research records. Documented the data model, implemented input validation and tested interface behaviour using sample data.`);
      longCv.structuredCv.education = Array.from({ length: 6 }, (_, index) =>
        `Education record ${index + 1}: Software Development coursework, Example College. Studied programming, databases, networking and documented development methods.`);
      longCv.structuredCv.certifications.push('Final qualification record LONG_CV_FINAL_SENTINEL_Z91.');
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
      await evaluate(`sessionStorage.setItem('careerkraft-final-cv', ${JSON.stringify(JSON.stringify(longCv))});
        sessionStorage.setItem('careerkraft-cv-build', ${JSON.stringify(JSON.stringify({ ...longCv, success: true, targetCareer: 'Software Developer', suggestions: [{ id: 101, status: 'accepted' }] }))})`);
      await cdp.send('Page.reload');
      await waitFor('document.getElementById("cvCertifications")?.textContent.includes("LONG_CV_FINAL_SENTINEL_Z91")', 'The complete long CV renders');
      await evaluate('document.querySelector(\'.template-card[data-category="minimal"]\').scrollIntoView({ behavior: "instant", block: "center" })');
      await clickControl('.template-card[data-category="minimal"]');
      await waitFor('document.getElementById("cvDocument").dataset.template === "minimal"', 'The long CV uses the whitespace-heavy Minimal template');
      await measure('Long Minimal CV at 1440px', 1440);
      count++;
      const longPdf = await cdp.send('Page.printToPDF', { preferCSSPageSize: true, printBackground: false, displayHeaderFooter: false });
      const longBuffer = Buffer.from(longPdf.data, 'base64');
      if (artifacts) fs.writeFileSync(path.join(artifacts, 'cv-minimal-long.pdf'), longBuffer);
      const { PDFParse } = require('pdf-parse');
      const longParser = new PDFParse({ data: Uint8Array.from(longBuffer), isEvalSupported: false });
      try {
        const result = await longParser.getText();
        assert.ok(result.total > 1, 'Long CVs should continue onto additional pages');
        const text = result.pages.map(page => page.text).join(' ').replace(/\s+/g, ' ');
        assert.ok(text.includes('LONG_CV_FINAL_SENTINEL_Z91'), 'The final CV content is not truncated');
        for (const value of Object.values(longCv.structuredCv)) {
          for (const source of Array.isArray(value) ? value : [value]) {
            assert.ok(text.includes(source.replace(/\s+/g, ' ')), `The long PDF retains all selectable source text: ${source.slice(0, 70)}`);
          }
        }
        process.stdout.write(`PASS long Minimal CV: ${result.total} PDF pages with complete selectable source text\n`);
      } finally { await longParser.destroy(); }
      process.stdout.write(`Verified ${count} CV template layouts, six categories, source preservation, section order, reload persistence, keyboard navigation and complete multi-page PDF export.\n`);
    };
    const auditAccountCookies = async () => {
      await cdp.send('Page.navigate', { url: base + '/index.html' });
      await waitFor('Boolean(window.careerAccessibility)', 'Accessibility preferences are ready for cookie checks');
      for (const [width, reading] of [[320, false], [768, false], [1440, false], [375, true]]) {
        await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
        await evaluate(`window.careerAccessibility.apply(${JSON.stringify({ dyslexiaFont: reading, fontSize: reading ? 'large' : 'default', contrast: reading ? 'high' : 'default', saturation: 'default', cursorSize: 'default' })});
          localStorage.setItem('careerkraft-theme', '${reading || width === 768 ? 'dark' : 'light'}');
          localStorage.setItem('careerkraft-cookie-consent', JSON.stringify({ version: 1, choice: 'accepted', savedAt: Date.now() }))`);
        cdp.errors.length = 0;
        await cdp.send('Page.navigate', { url: base + '/settings.html#cookies' });
        await waitFor('document.getElementById("settings-content")?.disabled === false && Boolean(window.careerCookies)', 'Account cookie settings load');
        await evaluate('document.fonts.ready');
        assert.equal(await evaluate('document.querySelector(\'[data-account-cookie-choice="accepted"]\').getAttribute("aria-pressed")'), 'true');
        for (const choice of ['rejected', 'accepted']) {
          await clickControl(`[data-account-cookie-choice="${choice}"]`);
          const state = await evaluate(`({ choice: window.careerCookies.getChoice(),
            saved: JSON.parse(localStorage.getItem('careerkraft-cookie-consent')).choice,
            status: document.getElementById('account-cookie-status').textContent,
            pressed: document.querySelector('[data-account-cookie-choice="${choice}"]').getAttribute('aria-pressed'),
            focused: document.activeElement.dataset.accountCookieChoice, bannerHidden: document.querySelector('.cookie-banner').hidden })`);
          assert.equal(state.choice, choice);
          assert.equal(state.saved, choice);
          assert.equal(state.pressed, 'true');
          assert.equal(state.focused, choice);
          assert.ok(state.status.includes(choice) && state.bannerHidden);
          await measure(`account ${choice} optional cookies at ${width}px${reading ? ' with reading preferences' : ''}`, width);
          count++;
        }
        await clickControl('footer .cookie-settings-button');
        await clickControl('.cookie-banner [data-cookie-choice="rejected"]');
        assert.equal(await evaluate('document.querySelector(\'[data-account-cookie-choice="rejected"]\').getAttribute("aria-pressed")'), 'true', 'The banner updates the account choice');
        if (artifacts) {
          await evaluate('document.getElementById("cookies").scrollIntoView({ behavior: "instant", block: "start" })');
          const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' });
          fs.writeFileSync(path.join(artifacts, `account-cookies-${width}.png`), Buffer.from(screenshot.data, 'base64'));
        }
        await cdp.send('Page.navigate', { url: base + '/dashboard.html' });
        await waitFor('Boolean(window.careerCookies) && document.readyState !== "loading"', 'Dashboard restores the cookie choice');
        assert.equal(await evaluate('window.careerCookies.getChoice()'), 'rejected');
        assert.equal(await evaluate('document.querySelector(".cookie-banner").hidden'), true);
      }
    };
    const auditTour = async () => {
      await cdp.send('Page.navigate', { url: base + '/index.html' });
      await waitFor('Boolean(window.careerAccessibility)', 'Accessibility initialization is available for tour checks');
      for (const [width, height, reading] of [[1440, 900, false], [320, 700, false], [768, 900, true], [375, 480, true]]) {
        await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 768 });
        const tourPreferences = { dyslexiaFont: reading, fontSize: reading ? 'large' : 'default', contrast: 'high', saturation: 'low', cursorSize: 'large' };
        await evaluate(`localStorage.removeItem('careerkraft-dashboard-tour:1'); localStorage.removeItem('careerkraft-cookie-consent');
          window.careerAccessibility.apply(${JSON.stringify(tourPreferences)});
          localStorage.setItem('careerkraft-theme', '${reading ? 'dark' : 'light'}')`);
        cdp.errors.length = 0;
        await cdp.send('Page.navigate', { url: base + '/dashboard.html?audit=tour-first' });
        await waitFor('document.getElementById("dashboard-tour-launch")?.disabled === false && Boolean(document.querySelector(".cookie-banner"))', 'First dashboard finishes loading before tour');
        assert.equal(await evaluate('Boolean(document.querySelector("#dashboard-tour[open]"))'), false, 'The tour waits for the cookie choice');
        await clickControl('.cookie-banner [data-cookie-choice="rejected"]');
        await waitFor('Boolean(document.querySelector("#dashboard-tour[open]"))', 'First dashboard opens its tour after cookie choice');
        await evaluate('document.fonts.ready');
        for (let step = 1; step <= 6; step++) {
          await pause(60);
          const geometry = await evaluate(`(() => {
            const card = document.querySelector('.dashboard-tour-card').getBoundingClientRect();
            const light = document.querySelector('#dashboard-tour-spotlight');
            const x = Number(light.getAttribute('x')), y = Number(light.getAttribute('y'));
            return { progress: document.querySelector('#dashboard-tour-progress').textContent,
              card: { left: card.left, top: card.top, right: card.right, bottom: card.bottom },
              light: { x, y, width: Number(light.getAttribute('width')), height: Number(light.getAttribute('height')) },
              mask: document.querySelector('#dashboard-tour-mask').getAttribute('d'),
              arrow: document.querySelector('#dashboard-tour-arrow').getAttribute('d'),
              focusInTour: document.querySelector('#dashboard-tour').contains(document.activeElement) };
          })()`);
          assert.equal(geometry.progress, `Step ${step} of 6`);
          assert.ok(geometry.card.left >= -1 && geometry.card.right <= width + 1 && geometry.card.top >= -1 && geometry.card.bottom <= height + 1, `Tour card stays in viewport: ${JSON.stringify(geometry)}`);
          assert.ok(geometry.light.x >= 0 && geometry.light.y >= 0 && geometry.light.width > 0 && geometry.light.height > 0);
          assert.ok(geometry.mask && geometry.arrow && geometry.focusInTour, 'The spotlight, arrow and keyboard focus are present');
          await measure(`dashboard tour step ${step} at ${width}x${height}${reading ? ' with reading preferences' : ''}`, width);
          count++;
          if (artifacts && (step === 1 || step === 3)) {
            const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' });
            fs.writeFileSync(path.join(artifacts, `dashboard-tour-${width}-step-${step}.png`), Buffer.from(screenshot.data, 'base64'));
          }
          await clickControl('#dashboard-tour-next');
        }
        assert.equal(await evaluate('Boolean(document.querySelector("#dashboard-tour[open]"))'), false);
        assert.deepEqual(await evaluate('window.__auditTourSaves'), [{ status: 'completed' }]);
        await cdp.send('Page.navigate', { url: base + '/dashboard.html?audit=tour-first' });
        await waitFor('document.getElementById("dashboard-tour-launch")?.disabled === false', 'Returning dashboard is ready');
        assert.equal(await evaluate('Boolean(document.querySelector("#dashboard-tour[open]"))'), false, 'A returning user is not interrupted again');
        await clickControl('#dashboard-tour-launch');
        await waitFor('Boolean(document.querySelector("#dashboard-tour[open]"))', 'The guide can be replayed');
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
        await waitFor('!document.querySelector("#dashboard-tour[open]")', 'Escape closes the guide');
        assert.equal(await evaluate('document.activeElement.id'), 'dashboard-tour-launch');
      }
    };
    if (loadingOnly) {
      const loadingAsset = await fetch(base + '/ripples.svg');
      assert.equal(loadingAsset.status, 200, 'The original loading SVG is publicly served');
      assert.match(await loadingAsset.text(), /<animate\b/, 'The delivered loading SVG retains its own animation');
      await cdp.send('Page.navigate', { url: base + '/index.html' });
      await waitFor('Boolean(window.careerAccessibility)', 'Accessibility preferences are ready for loading checks');
      await evaluate(`window.careerAccessibility.apply(window.careerAccessibility.defaults);
        localStorage.setItem('careerkraft-reduced-motion', 'false');
        localStorage.setItem('careerkraft-cookie-consent', JSON.stringify({ version: 1, choice: 'accepted', savedAt: Date.now() }))`);
      for (const width of [320, 1440]) {
        await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
        for (const theme of ['light', 'dark']) {
          await evaluate(`localStorage.setItem('careerkraft-theme', '${theme}')`);
          for (const page of ['dashboard.html', 'activity.html', 'career.html', 'settings.html']) {
            cdp.errors.length = 0;
            const query = page === 'activity.html' ? '&step=24' : page === 'career.html' ? '&career=software-developer' : '';
            await cdp.send('Page.navigate', { url: `${base}/${page}?audit=loading${query}` });
            await waitFor(`(() => {
              const loading = document.querySelector('.career-loading');
              const logo = loading?.querySelector('img');
              return loading && !loading.hidden && logo.complete && logo.naturalWidth > 0;
            })()`, `${page}: shared loading animation and ripple image are visible`);
            const state = await evaluate(`(() => {
              const loading = document.querySelector('.career-loading');
              const rect = loading.getBoundingClientRect();
              return { role: loading.getAttribute('role'), live: loading.getAttribute('aria-live'),
                pointerEvents: getComputedStyle(loading).pointerEvents,
                theme: document.documentElement.dataset.theme,
                imageAnimation: getComputedStyle(loading.querySelector('img')).animationName,
                imageVisible: getComputedStyle(loading.querySelector('img')).display !== 'none',
                fallbackVisible: getComputedStyle(loading.querySelector('.career-loading-static')).display !== 'none',
                imageSource: loading.querySelector('img').getAttribute('src'),
                imageAlt: loading.querySelector('img').alt,
                rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
                viewport: { width: document.documentElement.clientWidth, height: innerHeight } };
            })()`);
            assert.equal(state.role, 'status');
            assert.equal(state.live, 'polite');
            assert.equal(state.pointerEvents, 'none');
            assert.equal(state.theme, theme);
            assert.equal(state.imageSource, '/ripples.svg');
            assert.equal(state.imageAlt, '');
            assert.equal(state.imageAnimation, 'none', 'The supplied SVG runs its own animation');
            assert.equal(state.imageVisible, true);
            assert.equal(state.fallbackVisible, false);
            assert.ok(state.rect.left >= 0 && state.rect.top >= 0 && state.rect.right <= state.viewport.width && state.rect.bottom <= state.viewport.height,
              `${page}: loading status stays inside the viewport: ${JSON.stringify(state)}`);
            await measure(`${page} branded loading in ${theme} at ${width}px`, width);
            count++;
            if (page === 'dashboard.html' && width === 320 && theme === 'light') {
              const clip = await evaluate(`(() => {
                const rect = document.querySelector('.career-loading-mark').getBoundingClientRect();
                return { x: rect.left, y: rect.top, width: rect.width, height: rect.height, scale: 1 };
              })()`);
              const first = await cdp.send('Page.captureScreenshot', { format: 'png', clip });
              await pause(300);
              const second = await cdp.send('Page.captureScreenshot', { format: 'png', clip });
              assert.notEqual(first.data, second.data, 'The supplied SVG visibly animates between rendered frames');
              if (artifacts) {
                fs.writeFileSync(path.join(artifacts, 'loading-ripples-frame-1.png'), Buffer.from(first.data, 'base64'));
                fs.writeFileSync(path.join(artifacts, 'loading-ripples-frame-2.png'), Buffer.from(second.data, 'base64'));
              }
            }
            if (page === 'dashboard.html' && artifacts) {
              const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' });
              fs.writeFileSync(path.join(artifacts, `loading-dashboard-${theme}-${width}.png`), Buffer.from(screenshot.data, 'base64'));
            }
            await evaluate('document.documentElement.dataset.reducedMotion = "true"');
            assert.deepEqual(await evaluate(`['.career-loading-mark img', '.career-loading-static'].map(selector => getComputedStyle(document.querySelector(selector)).display !== 'none')`),
              [false, true], `${page}: saved reduced motion replaces the animated SVG with a static mark`);
            await evaluate('document.documentElement.dataset.reducedMotion = "false"');
            await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
            assert.deepEqual(await evaluate(`['.career-loading-mark img', '.career-loading-static'].map(selector => getComputedStyle(document.querySelector(selector)).display !== 'none')`),
              [false, true], `${page}: system reduced motion replaces the animated SVG with a static mark`);
            await cdp.send('Emulation.setEmulatedMedia', { features: [] });
            assert.deepEqual(await evaluate(`['.career-loading-mark img', '.career-loading-static'].map(selector => getComputedStyle(document.querySelector(selector)).display !== 'none')`), [true, false]);
            await evaluate('window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }))');
            assert.equal(await evaluate('document.querySelector(".career-loading").hidden'), true, 'Page hide clears the loading card');
            await evaluate('window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }))');
            await waitFor('document.querySelector(".career-loading")?.hidden === false', 'Page restore resynchronizes pending loading requests');
            assert.equal(await evaluate('document.querySelectorAll(".career-loading").length'), 1, 'Page restore retains one status indicator');
          }
        }
      }
      for (const width of [320, 1440]) {
        await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
        await cdp.send('Page.navigate', { url: base + '/settings.html' });
        await waitFor('document.getElementById("settings-content")?.disabled === false && Boolean(window.careerLoading)', 'Account settings are ready for modal loading checks');
        await waitFor('document.querySelector(".career-loading")?.hidden === true', 'Initial account loading is complete');
        for (const dialogId of ['character-dialog', 'delete-dialog']) {
          await evaluate(`(() => {
            const dialog = document.getElementById('${dialogId}');
            if ('${dialogId}' === 'delete-dialog') window.__finishModalLoading = window.careerLoading.begin('Saving your changes…');
            dialog.showModal();
            window.__modalLoadingFocus = document.activeElement;
            if ('${dialogId}' === 'character-dialog') window.__finishModalLoading = window.careerLoading.begin('Saving your changes…');
          })()`);
          await waitFor(`(() => {
            const loading = document.querySelector('.career-loading');
            return loading && !loading.hidden && loading.parentElement.id === '${dialogId}';
          })()`, 'Loading status joins the active native modal');
          const modalState = await evaluate(`(() => {
            const loading = document.querySelector('.career-loading');
            const rect = loading.getBoundingClientRect();
            loading.style.pointerEvents = 'auto';
            const visibleAtCenter = loading.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
            loading.style.removeProperty('pointer-events');
            return { visibleAtCenter, focusUnchanged: document.activeElement === window.__modalLoadingFocus,
              modal: loading.parentElement.matches(':modal'), pointerEvents: getComputedStyle(loading).pointerEvents };
          })()`);
          assert.deepEqual(modalState, { visibleAtCenter: true, focusUnchanged: true, modal: true, pointerEvents: 'none' }, 'Native dialogs keep the status visible without moving focus');
          await measure(`${dialogId} branded loading at ${width}px`, width);
          count++;
          if (artifacts) {
            const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' });
            fs.writeFileSync(path.join(artifacts, `loading-${dialogId}-${width}.png`), Buffer.from(screenshot.data, 'base64'));
          }
          if (dialogId === 'character-dialog') {
            await evaluate('window.__finishModalLoading()');
            await waitFor('document.querySelector(".career-loading").hidden', 'Completed modal work hides the loading status');
            await evaluate(`document.getElementById('${dialogId}').close()`);
          } else {
            await evaluate(`document.getElementById('${dialogId}').close()`);
            await waitFor('document.querySelector(".career-loading").parentElement === document.body', 'Closing the modal restores the pending status to the page');
            assert.equal(await evaluate('document.querySelector(".career-loading").hidden'), false);
            await evaluate('window.__finishModalLoading()');
            await waitFor('document.querySelector(".career-loading").hidden', 'Completed work hides the restored page status');
          }
          await waitFor('document.querySelector(".career-loading").parentElement === document.body', 'The closed modal returns its loading indicator to the page');
        }
      }
      process.stdout.write(`Verified ${count} loading layouts, original animated SVG delivery, nonblocking status, reduced motion, modal visibility and page lifecycle cleanup.\n`);
      return;
    }
    if (cvTemplatesOnly) {
      await auditCvTemplates();
      return;
    }
    if (cookiesOnly) {
      await auditAccountCookies();
      process.stdout.write(`Verified ${count} account cookie layouts, banner sync and dashboard persistence.\n`);
      return;
    }
    if (tourOnly) {
      await auditTour();
      process.stdout.write(`Verified ${count} dashboard tour layouts and first-visit, completion, replay and Escape behavior.\n`);
      return;
    }
    for (const width of accessibilityOnly ? [] : [320, 375, 390, 768, 1024, 1440]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
      for (const page of pages) {
        cdp.errors.length = 0;
        const query = page === 'career.html' ? '?career=software-developer' : page === 'activity.html' ? '?step=24'
          : page === 'onboarding.html' ? '?view=matches' : '';
        await cdp.send('Page.navigate', { url: `${base}/${page}${query}` });
        for (let i = 0; i < 60; i++) {
          await pause(50);
          if (await evaluate('document.readyState !== "loading"')) break;
        }
        await evaluate('Promise.race([document.fonts.ready.then(() => true), new Promise(resolve => setTimeout(resolve, 1500))])');
        await pause(150);
        await measure(`${page} at ${width}px`, width);
        count++;
        if (artifacts && width === 375) {
          const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' });
          fs.writeFileSync(path.join(artifacts, page.replace('.html', '.png')), Buffer.from(screenshot.data, 'base64'));
        }
        const actions = page === 'index.html' && width < 768 ? ['#menu-toggle']
          : page === 'career.html' ? ['#start-challenge-button']
          : page === 'settings.html' ? ['[data-editor="name-editor"]', '[data-editor="email-editor"]', '#password-edit-button', '#choose-character', '#cancel-character', '#open-delete', '#cancel-delete']
          : page === 'auth.html' ? ['#register-tab'] : [];
        for (const selector of actions) {
          const exists = await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return false; element.click(); return true; })()`);
          assert.ok(exists, `${page}: missing interaction ${selector}`);
          await pause(30);
          await measure(`${page} ${selector} at ${width}px`, width);
          count++;
        }
        if (page === 'onboarding.html') {
          await evaluate('document.querySelector("#retake-button").click()');
          for (let stepNumber = 1; stepNumber <= 4; stepNumber++) {
            await measure(`onboarding question ${stepNumber} at ${width}px`, width);
            count++;
            if (stepNumber < 4) await evaluate(`(() => { const screen = document.querySelector('[data-screen="${stepNumber}"]');
              const grid = screen.querySelector('[data-question]');
              [...grid.querySelectorAll('.choice-card')].slice(0, Number(grid.dataset.min)).forEach(card => card.click());
              screen.querySelector('[data-next]').click(); })()`);
          }
        }
        if (['activity.html', 'dashboard.html', 'career.html'].includes(page)) {
          const opened = await evaluate('(() => { const button = document.querySelector("#lumia-launcher"); if (!button) return false; button.click(); return true; })()');
          assert.ok(opened, `${page}: Lumia is available`);
          await pause(150);
          await measure(`${page} Lumia open at ${width}px`, width);
          count++;
        }
      }
    }
    for (const scenario of accessibilityOnly ? [] : ['loading', 'failed']) {
      for (const width of [320, 768]) {
        await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
        for (const page of ['dashboard.html', 'activity.html', 'career.html', 'settings.html']) {
          cdp.errors.length = 0;
          const query = page === 'activity.html' ? '&step=24' : page === 'career.html' ? '&career=software-developer' : '';
          await cdp.send('Page.navigate', { url: `${base}/${page}?audit=${scenario}${query}` });
          await pause(300);
          await evaluate('Promise.race([document.fonts.ready.then(() => true), new Promise(resolve => setTimeout(resolve, 1500))])');
          await measure(`${page} ${scenario} at ${width}px`, width);
          count++;
        }
      }
    }
    if (accessibilityOnly) {
      await cdp.send('Page.navigate', { url: base + '/index.html' });
      for (let attempt = 0; attempt < 60; attempt++) {
        await pause(50);
        if (await evaluate('document.readyState !== "loading"')) break;
      }
    }
    const textSizes = await evaluate(`(async () => {
      const api = window.careerAccessibility;
      const previous = api.read();
      const style = document.createElement('style');
      style.textContent = '.a11y-px { font-size: 20px; } .a11y-rem { font-size: 1.25rem; } .a11y-fluid { font-size: clamp(18px, 2vw, 24px); }';
      const container = document.createElement('div');
      container.hidden = true;
      container.innerHTML = '<span class="a11y-px">Text</span><span class="a11y-rem">Text</span><span class="a11y-fluid">Text</span>';
      document.head.append(style);
      document.body.append(container);
      await new Promise(resolve => setTimeout(resolve, 0));
      const sizes = () => [...container.children].map(element => parseFloat(getComputedStyle(element).fontSize));
      api.apply(api.defaults);
      const normal = sizes();
      api.apply({ ...api.defaults, fontSize: 'large' });
      const large = sizes();
      api.apply({ ...api.defaults, fontSize: 'small' });
      const small = sizes();
      api.apply({ ...api.defaults, contrast: 'high', saturation: 'grayscale' });
      const filter = getComputedStyle(document.documentElement).filter;
      container.remove(); style.remove(); api.apply(previous);
      return { normal, large, small, filter };
    })()`);
    textSizes.normal.forEach((normal, index) => {
      assert.ok(Math.abs(textSizes.large[index] / normal - 1.2) < .01, `Large text scales px/rem/clamp: ${JSON.stringify(textSizes)}`);
      assert.ok(Math.abs(textSizes.small[index] / normal - .9) < .01, `Small text scales px/rem/clamp: ${JSON.stringify(textSizes)}`);
    });
    assert.match(textSizes.filter, /contrast\(1\.35\).*saturate\(0\)/);

    for (const [label, preferences, theme] of [
      ['large-reading', { dyslexiaFont: true, fontSize: 'large', contrast: 'high', saturation: 'low', cursorSize: 'large' }, 'dark'],
      ['small-reading', { dyslexiaFont: false, fontSize: 'small', contrast: 'default', saturation: 'high', cursorSize: 'small' }, 'light']
    ]) {
      await evaluate(`window.careerAccessibility.apply(${JSON.stringify(preferences)}); localStorage.setItem('careerkraft-theme', ${JSON.stringify(theme)})`);
      for (const width of [320, 768, 1440]) {
        await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
        for (const page of pages) {
          cdp.errors.length = 0;
          const query = page === 'activity.html' ? '?step=24' : page === 'career.html' ? '?career=software-developer' : page === 'onboarding.html' ? '?view=matches' : '';
          await cdp.send('Page.navigate', { url: `${base}/${page}${query}` });
          for (let attempt = 0; attempt < 60; attempt++) {
            await pause(50);
            if (await evaluate('document.readyState !== "loading"')) break;
          }
          await evaluate('Promise.race([document.fonts.ready.then(() => true), new Promise(resolve => setTimeout(resolve, 1500))])');
          if (page === 'settings.html') {
            for (let attempt = 0; attempt < 100; attempt++) {
              if (await evaluate('document.getElementById("settings-content").disabled === false')) break;
              await pause(20);
            }
          }
          await measure(`${page} ${label} at ${width}px`, width);
          count++;
          const state = await evaluate(`(() => {
            const root = document.documentElement;
            const copy = document.querySelector('h1, main p, p');
            const font = getComputedStyle(copy || document.body).fontFamily;
            const cursor = getComputedStyle(document.body).cursor;
            const notice = document.querySelector('.cookie-banner');
            window.scrollTo({ top: 500, behavior: 'instant' });
            const rect = notice.getBoundingClientRect();
            return { size: root.dataset.fontSize, font, cursor, fontLoaded: document.fonts.check('16px OpenDyslexic'),
              dyslexiaChecked: document.getElementById('dyslexia-font')?.checked,
              hasFinePointer: matchMedia('(any-pointer: fine)').matches,
              noticeInViewport: notice.hidden || rect.top >= -1 && rect.bottom <= innerHeight + 1 };
          })()`);
          assert.equal(state.size, preferences.fontSize, `${page} restores its text-size preference`);
          if (page === 'settings.html') assert.equal(state.dyslexiaChecked, preferences.dyslexiaFont, 'The reading-font switch reflects the applied preference');
          if (preferences.dyslexiaFont) {
            assert.match(state.font, /OpenDyslexic/, `${page} applies the reading font`);
            assert.ok(state.fontLoaded, `${page} loads its local reading font`);
          }
          if (state.hasFinePointer) assert.ok(state.cursor.includes(`cursor-${preferences.cursorSize}.svg`), `${page} applies the selected cursor`);
          assert.ok(state.noticeInViewport, `${page}: visual filters keep the fixed cookie controls in the viewport`);
          if (page === 'settings.html' && artifacts && width === 768) {
            await evaluate(`document.querySelector('.cookie-banner [data-cookie-choice="rejected"]')?.click(); document.querySelector('.accessibility-options').scrollIntoView({ behavior: 'instant', block: 'start' })`);
            await pause(250);
            const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' });
            fs.writeFileSync(path.join(artifacts, `accessibility-${label}.png`), Buffer.from(screenshot.data, 'base64'));
          }
        }
      }
    }
    await auditTour();
    await auditAccountCookies();
    process.stdout.write(`Verified ${count} browser page and interaction layouts, plus accessibility preferences, dashboard tours and account cookie choices.\n`);
  } finally {
    cdp?.close();
    browser.kill();
    await new Promise(resolve => server.close(resolve));
    application.db.close();
    // Chrome may briefly retain file handles while its child processes exit.
    assert.equal(path.dirname(profile), path.resolve(os.tmpdir()));
    assert.ok(path.basename(profile).startsWith('careerkraft-browser-'));
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch {}
  }
}

run().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
