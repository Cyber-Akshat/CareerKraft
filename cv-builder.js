const { TextDecoder } = require('node:util');
const { setTimeout: delay } = require('node:timers/promises');
const { cvSourceGrounding } = require('./cv-analysis');
const { PARSER_INSTRUCTIONS, createCvParseContext, deterministicParsedCv, validateCvParserOutput } = require('./cv-parser');
const { REVIEWER_INSTRUCTIONS, validateCvSuggestions, safeCvRewriteCandidates } = require('./cv-suggestions');

// Only this helper can attest that the original CV was reconstructed entirely
// from source IDs. The route validates the same object again before saving it.
// A mutated result or externally supplied object must pass the legacy source
// checks instead; a model cannot manufacture this provenance.
const parsedBuilds = new WeakMap();

const MAX_CV_TEXT = 20000;
const MAX_PROVIDER_BYTES = 128 * 1024;
const FIELDS = ['name', 'headline', 'contact', 'profile', 'education', 'experience', 'projects', 'skills', 'certifications'];
const LIST_FIELDS = ['contact', 'education', 'experience', 'projects', 'skills', 'certifications'];
const SECTIONS = Object.fromEntries(FIELDS.map(key => [key, key[0].toUpperCase() + key.slice(1)]));
const TYPES = new Map([
  ['rewrite', null], ['improve_profile', 'profile'], ['strengthen_project', 'projects'],
  ['strengthen_experience', 'experience'], ['add_verified_skill', 'skills'], ['improve_skill_wording', 'skills'],
  ['improve_education', 'education'], ['improve_certification', 'certifications'], ['clarify_bullet', null],
  ['remove_vague_claim', null], ['improve_career_relevance', null]
]);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const literal = value => value.replace(/\s+/g, ' ').trim().toLowerCase();
const keyFor = value => value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
const validString = (value, max) => typeof value === 'string' && value.length <= max &&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const unbullet = value => value.replace(/^\s*(?:[•*\-–—]|\d+[.)])\s+/, '');
const QUALIFIED = /\b(?:no|not|never|without|only|hypothetical|example|sample|aspiring|wish|haven't|hasn't|isn't|wasn't)\b|:\s*$/i;
const SECTION_HEADINGS = new Map([
  ['profile', 'profile'], ['summary', 'profile'], ['professional summary', 'profile'],
  ['education', 'education'], ['experience', 'experience'], ['work experience', 'experience'],
  ['employment history', 'experience'], ['projects', 'projects'], ['selected projects', 'projects'],
  ['skills', 'skills'], ['technical skills', 'skills'], ['core skills', 'skills'],
  ['certifications', 'certifications'], ['certificates', 'certifications']
]);

function verifiedSkillMap(values) {
  const result = new Map();
  for (const value of Array.isArray(values) ? values : []) {
    if (!record(value) || !validString(value.name, 255)) continue;
    const count = Number(value.verifiedCount);
    const name = value.name.trim();
    if (name && Number.isInteger(count) && count > 0 && !result.has(keyFor(name))) {
      result.set(keyFor(name), { name, verifiedCount: count });
    }
  }
  return result;
}

function paragraphs(cvText) {
  return cvText.replace(/\r\n?/g, '\n').split(/\n[^\S\n]*\n/).map(value => value.trim()).filter(Boolean);
}

function contactLine(value) {
  return value.split(/\s*[|·•]\s*/).every(part => {
    const label = /^(e-?mail|phone|tel|mobile|website|linkedin|github|location|address|postcode|postal code|city)\s*:\s*/i.exec(part);
    const text = (label ? part.slice(label[0].length) : part).trim();
    if (!text) return false;
    if (/^[\w.+-]+@[\w.-]+\.[a-z]{2,}$/i.test(text) ||
      /^(?:https?:\/\/|www\.|linkedin\.com\/|github\.com\/)\S+$/i.test(text) ||
      /^[a-z\d](?:[a-z\d.-]*[a-z\d])?\.(?:com|org|net|dev|io|me|app|uk|edu)(?:\/[^\s]*)?$/i.test(text) ||
      (/^\+?[\d ()-]+$/.test(text) && text.replace(/\D/g, '').length >= 7) ||
      /^(?:GIR\s?0AA|[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})$/i.test(text)) return true;
    if (QUALIFIED.test(text)) return false;
    return /^[\p{L}\p{M}][\p{L}\p{M} .'-]{1,60},\s*[\p{L}\p{M}][\p{L}\p{M} .'-]{1,60}$/u.test(text) ||
      (label && /^(?:location|address|postcode|postal code|city)$/i.test(label[1]) &&
        /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} .,'’#()&/\-]{1,199}$/u.test(text));
  });
}

function compactHeader(lines) {
  if (!lines.length || !lines[0].trim() || QUALIFIED.test(lines[0])) return false;
  let index = 1;
  if (lines[index] && !contactLine(lines[index])) {
    // A headline has to be followed by actual contact details. Otherwise an
    // unfinished qualification could be mistaken for an independent headline.
    if (QUALIFIED.test(lines[index]) || !lines[index + 1]) return false;
    index++;
  }
  return lines.slice(index).every(contactLine);
}

function sourceBlocks(cvText) {
  return paragraphs(cvText).flatMap(paragraph => {
    const lines = paragraph.split('\n');
    const headings = lines.flatMap((line, index) => {
      const colon = line.indexOf(':');
      const label = colon < 0 ? line : line.slice(0, colon);
      const field = SECTION_HEADINGS.get(literal(label));
      return field ? [{ index, field, inlineText: colon < 0 ? '' : line.slice(colon + 1).trim() }] : [];
    });
    if (!headings.length) return [{ text: paragraph, field: null }];
    const prefix = lines.slice(0, headings[0].index).filter(line => line.trim());
    const bodies = headings.map((heading, index) => ({ field: heading.field,
      text: [heading.inlineText, ...lines.slice(heading.index + 1, headings[index + 1]?.index)]
        .filter(Boolean).join('\n').trim() }));
    // Do not split unknown preambles or qualified source across a heading.
    // Retaining the complete block is preferable to isolating a positive claim.
    if ((prefix.length && !compactHeader(prefix)) || bodies.slice(0, -1).some(block => QUALIFIED.test(block.text))) {
      return [{ text: paragraph, field: null }];
    }
    return [...(prefix.length ? [{ text: prefix.join('\n'), field: 'header' }] : []), ...bodies];
  });
}

function originalParagraph(value, field, cvText) {
  // An ambiguous layout can always retain the complete uploaded document as
  // one original block. This never accepts an AI summary or isolated claim.
  if (field === 'profile' && literal(value) === literal(cvText)) return true;
  // A literal copy is always safe, including a paragraph beginning with a
  // minus sign. The rewrite guard deliberately treats that syntax cautiously.
  const matches = text => literal(value) === literal(text) || cvSourceGrounding.paragraph(value, text);
  if (paragraphs(cvText).some(matches)) return true;
  const blocks = sourceBlocks(cvText);
  const allowed = block => !block.field || block.field === field;
  if (blocks.some(block => allowed(block) && matches(block.text))) return true;
  // A scalar profile can contain multiple source paragraphs. Permit only a
  // contiguous sequence of complete blocks; no omitted qualifiers or facts.
  const expected = literal(value);
  for (let start = 0; start < blocks.length; start++) {
    let retained = '';
    for (let end = start; end < blocks.length && allowed(blocks[end]); end++) {
      retained += (retained ? ' ' : '') + literal(blocks[end].text);
      if (retained === expected) return true;
      if (!expected.startsWith(retained)) break;
    }
  }
  return false;
}

function scalarSource(value, field, cvText, structuredCv) {
  if (originalParagraph(value, field, cvText)) return true;
  const header = sourceBlocks(cvText)[0]?.text.split('\n').map(line => line.trim()).filter(Boolean) || [];
  if (field === 'name') return literal(header[0] || '') === literal(value) ||
    literal((header[0] || '').replace(/^name:[ \t]*/i, '')) === literal(value);
  if (!compactHeader(header)) return false;
  const position = header.findIndex(line => literal(line) === literal(value));
  const retained = [structuredCv.name, structuredCv.headline, ...structuredCv.contact].map(literal);
  return position > 0 && (field === 'headline' ? position === 1 && !contactLine(value) : contactLine(value)) &&
    header.every(line => retained.includes(literal(line)));
}

function sourceSpan(value, cvText) {
  const needle = literal(value);
  const source = literal(cvText);
  if (!needle) return false;
  let start = source.indexOf(needle);
  while (start !== -1) {
    const before = source[start - 1] || '';
    const after = source[start + needle.length] || '';
    if (!/[\p{L}\p{N}+#]/u.test(before) && !/[\p{L}\p{N}+#]/u.test(after)) return true;
    start = source.indexOf(needle, start + 1);
  }
  return false;
}

function structuredOriginal(value, cvText) {
  if (!record(value) || Object.keys(value).length !== FIELDS.length ||
      !FIELDS.every(field => Object.hasOwn(value, field))) throw new Error('Invalid structured CV.');
  const output = {};
  for (const field of FIELDS) {
    if (LIST_FIELDS.includes(field)) {
      if (!Array.isArray(value[field]) || value[field].length > 50 ||
          !value[field].every(item => validString(item, field === 'contact' ? 2000 : MAX_CV_TEXT) && item.trim())) throw new Error('Invalid structured CV section.');
      output[field] = value[field].map(item => item.trim());
    } else {
      if (!validString(value[field], field === 'profile' ? MAX_CV_TEXT : 255)) throw new Error('Invalid structured CV field.');
      output[field] = value[field].trim();
    }
  }
  let facts = 0;
  for (const field of FIELDS) {
    const values = LIST_FIELDS.includes(field) ? output[field] : [output[field]];
    for (const text of values) {
      if (!text) continue;
      const grounded = ['name', 'headline', 'contact'].includes(field)
        ? scalarSource(text, field, cvText, output) : originalParagraph(text, field, cvText);
      if (!grounded) throw new Error('The structured CV contains unsupported facts.');
      facts++;
    }
  }
  if (!facts) throw new Error('The structured CV contains no source content.');
  const retained = FIELDS.flatMap(field => LIST_FIELDS.includes(field) ? output[field] : [output[field]])
    .map(text => literal(unbullet(text))).filter(Boolean).join('\n');
  for (const block of sourceBlocks(cvText)) {
    const text = literal(unbullet(block.text));
    if (!text) continue;
    // Independent contact lines may be separated from the name/headline. All
    // other source blocks must remain complete, in one original section entry.
    const headerLines = block.text.split('\n').map(line => line.trim()).filter(Boolean);
    const headerRetained = compactHeader(headerLines) && headerLines.every(line => {
      const name = line.replace(/^name:[ \t]*/i, '');
      return [line, name].some(part => retained.split('\n').includes(literal(part)));
    });
    if (!retained.includes(text) && !headerRetained) throw new Error('The structured CV omits original source content.');
  }
  return output;
}

function builderFailure(code, details = {}, message = 'Lumia CV builder failed.') {
  return Object.assign(new Error(message), { code, ...details });
}

function validateCvBuildOutput(raw, { cvText = '', verifiedSkills = [] } = {}) {
  if (!record(raw) || !record(raw.structuredCv) || !Array.isArray(raw.suggestions) ||
      typeof cvText !== 'string' || !cvText.trim() || cvText.length > MAX_CV_TEXT) throw new Error('Invalid CV build output.');
  const provenance = parsedBuilds.get(raw);
  if (provenance && provenance.cvText === cvText &&
      provenance.snapshot === JSON.stringify(raw.structuredCv)) {
    const { suggestions } = validateCvSuggestions(raw.suggestions, {
      structuredCv: raw.structuredCv, cvText, verifiedSkills, sourceEntries: provenance.entries
    });
    return { structuredCv: structuredClone(raw.structuredCv), suggestions };
  }
  const structuredCv = structuredOriginal(raw.structuredCv, cvText);
  const trusted = verifiedSkillMap(verifiedSkills);
  const suggestions = [];
  const seen = new Set();
  for (const item of raw.suggestions) {
    if (!record(item) || !validString(item.sectionName, 50) || !validString(item.suggestionType, 60) ||
        !validString(item.originalText, 2000) || !validString(item.suggestedText, 2000) ||
        !validString(item.reason, 1000) || !item.reason.trim() || !Array.isArray(item.evidence) ||
        !item.evidence.length || item.evidence.length > 10 ||
        !item.evidence.every(proof => validString(proof, 2000) && proof.trim())) continue;
    const field = item.sectionName.trim().toLowerCase();
    const suggestionType = item.suggestionType.trim().toLowerCase();
    if (!Object.hasOwn(SECTIONS, field) || !TYPES.has(suggestionType) ||
        (TYPES.get(suggestionType) && TYPES.get(suggestionType) !== field)) continue;
    const originalText = item.originalText.trim();
    let suggestedText = item.suggestedText.trim();
    const evidence = [];
    let supported = true;
    for (const proof of item.evidence) {
      const skill = trusted.get(keyFor(proof));
      if (skill) evidence.push(skill.name);
      else if (sourceSpan(proof, cvText)) evidence.push(proof.trim());
      else { supported = false; break; }
    }
    if (!supported) continue;
    if (suggestionType === 'add_verified_skill') {
      const skill = trusted.get(keyFor(suggestedText));
      if (originalText || !skill || cvSourceGrounding.skillAppears(skill.name, cvText) ||
          !evidence.some(proof => keyFor(proof) === keyFor(skill.name))) continue;
      suggestedText = skill.name;
    } else {
      const entries = LIST_FIELDS.includes(field) ? structuredCv[field] : [structuredCv[field]];
      const source = sourceBlocks(cvText).find(block => (!block.field || block.field === field) &&
        cvSourceGrounding.paragraph(originalText, block.text));
      if (!entries.some(text => literal(unbullet(text)) === literal(unbullet(originalText))) || !source ||
          !cvSourceGrounding.rewrite({ original: originalText, improved: suggestedText, reason: item.reason }, source.text)) continue;
    }
    const identity = JSON.stringify([field, suggestionType, literal(originalText), literal(suggestedText)]);
    if (seen.has(identity)) continue;
    seen.add(identity);
    suggestions.push({ sectionName: SECTIONS[field], suggestionType, originalText, suggestedText,
      reason: item.reason.trim(), evidence: [...new Set(evidence)] });
    if (suggestions.length === 20) break;
  }
  return { structuredCv, suggestions };
}

async function providerJSON(response, signal) {
  if (!response?.ok) {
    await response?.body?.cancel?.().catch(() => {});
    const status = response?.status;
    const details = Number.isInteger(status) && status >= 100 && status <= 599 ? { providerStatus: status } : {};
    const retryHeader = response?.headers?.get?.('retry-after');
    const retry = /^\d+(?:\.\d+)?$/.test(retryHeader || '') ? Number(retryHeader) :
      (Date.parse(retryHeader) - Date.now()) / 1000;
    if (Number.isFinite(retry) && retry > 0) details.retryAfterSeconds = Math.min(300, Math.max(1, Math.ceil(retry)));
    throw builderFailure(status === 429 ? 'CV_BUILD_RATE_LIMITED' : 'CV_BUILD_PROVIDER_HTTP', details);
  }
  if (Number(response.headers?.get?.('content-length')) > MAX_PROVIDER_BYTES || !response.body?.getReader) {
    await response.body?.cancel?.().catch(() => {});
    throw builderFailure('CV_BUILD_RESPONSE_TOO_LARGE');
  }
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_PROVIDER_BYTES) throw builderFailure('CV_BUILD_RESPONSE_TOO_LARGE');
      chunks.push(Buffer.from(value));
    }
    signal.throwIfAborted();
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
    catch { throw builderFailure('CV_BUILD_INVALID_JSON'); }
  } finally {
    signal.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function scanReviewContext(value) {
  if (!record(value)) return null;
  const score = number => Number.isInteger(number) && number >= 0 && number <= 100 ? number : 0;
  const feedback = (items, max) => (Array.isArray(items) ? items : [])
    .filter(text => validString(text, 1000) && text.trim()).slice(0, max).map(text => text.trim());
  return {
    overallScore: score(value.overallScore),
    scores: Object.fromEntries(['structure', 'clarity', 'evidence', 'relevance'].map(key => [key, score(value.scores?.[key])])),
    strengths: feedback(value.strengths, 3),
    priorityImprovements: feedback(value.priorityImprovements, 3),
    verifiedSkillsMissingFromCv: feedback(value.verifiedSkillsMissingFromCv, 5),
    careerAlignmentSummary: validString(value.careerAlignmentSummary, 1000) ? value.careerAlignmentSummary.trim() : ''
  };
}

function reviewWordingOptions(parsed) {
  const types = { profile: 'improve_profile', projects: 'strengthen_project', experience: 'strengthen_experience',
    education: 'improve_education', certifications: 'improve_certification', skills: 'improve_skill_wording' };
  return parsed.entries.flatMap(entry => safeCvRewriteCandidates(entry.text).slice(0, 1).map(suggestedText => ({
    id: `wording-${entry.id}`, sourceId: entry.id, sectionName: entry.sectionName,
    suggestionType: types[entry.field] || 'clarify_bullet', suggestedText
  }))).slice(0, 20);
}

function entryEvidence(entry) {
  // A bounded literal span is enough evidence because the full source entry
  // and candidate rewrite are checked separately. Never cut mid-word.
  return entry.text.length <= 2000 ? entry.text : entry.text.slice(0, 2000).replace(/\S+$/, '').trim();
}

function resolveWordingOptions(suggestions, parsed, options) {
  const populated = (raw, keys) => keys.map(key => raw[key]).find(value =>
    value !== undefined && value !== null &&
    (typeof value !== 'string' || value.trim()) && (!Array.isArray(value) || value.length));
  return suggestions.map(raw => {
    if (!record(raw) || raw.wordingOptionId == null ||
        (typeof raw.wordingOptionId === 'string' && !raw.wordingOptionId.trim())) return raw;
    const option = typeof raw.wordingOptionId === 'string' && options.find(item => item.id === raw.wordingOptionId.trim());
    const entry = option && parsed.entries.find(item => item.id === option.sourceId);
    if (!entry || (raw.sourceId && raw.sourceId !== entry.id)) return {};
    // The model selects a source-backed wording option; it cannot alter that
    // option's factual text or apply it to a different part of the document.
    return { sourceId: entry.id, sectionName: option.sectionName, suggestionType: option.suggestionType,
      originalText: entry.text, suggestedText: option.suggestedText,
      reason: populated(raw, ['reason', 'explanation', 'rationale']),
      evidence: populated(raw, ['evidence', 'supportingEvidence', 'supporting_evidence']) ?? [entryEvidence(entry)] };
  });
}

function reviewerSuggestions(review) {
  if (Array.isArray(review)) return review;
  if (!record(review)) return null;
  for (const key of ['suggestions', 'cvSuggestions', 'cv_suggestions', 'improvements']) {
    if (Array.isArray(review[key])) return review[key];
  }
  return null;
}

function sourceBackedSuggestions(parsed, wordingOptions, trustedSkills, validationContext) {
  const rewrites = wordingOptions.map(option => {
    const entry = parsed.entries.find(item => item.id === option.sourceId);
    return { sectionName: option.sectionName, sourceId: entry.id, suggestionType: option.suggestionType,
      originalText: entry.text, suggestedText: option.suggestedText,
      reason: 'Use concise CV wording while preserving the original details.', evidence: [entryEvidence(entry)] };
  });
  const skills = trustedSkills.map(skill => ({ sectionName: 'Skills', suggestionType: 'add_verified_skill',
    originalText: '', suggestedText: skill.name, reason: 'Include this CareerKraft verified skill in your skills section.',
    evidence: [skill.name] }));
  // These candidates originate in source text and trusted skill records, never
  // the rejected model response. Apply the same guards and approval flow.
  const result = validateCvSuggestions([...rewrites, ...skills], validationContext);
  const omitted = Math.max(0, result.suggestions.length - 10);
  if (omitted) {
    result.suggestions = result.suggestions.slice(0, 10);
    result.diagnostics.acceptedSuggestions -= omitted;
    result.diagnostics.rejectedSuggestions += omitted;
    result.diagnostics.rejectedByReason.limit = (result.diagnostics.rejectedByReason.limit || 0) + omitted;
  }
  return result;
}

async function generateCvBuildWithLumia({ cvText, targetCareer, verifiedSkills, scanAnalysis }, options = {}) {
  if (typeof cvText !== 'string' || !cvText.trim() || cvText.length > MAX_CV_TEXT) throw builderFailure('CV_BUILD_INPUT', {}, 'A readable CV is required.');
  const apiKey = options.apiKey ?? process.env.GROQ_API_KEY;
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw builderFailure('CV_BUILD_CONFIG', {}, 'GROQ_API_KEY is not configured.');
  const timeoutMs = options.timeoutMs ?? 60000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new Error('Invalid CV builder timeout.');
  const context = createCvParseContext(cvText);
  const baseline = deterministicParsedCv(context);
  const trustedSkills = [...verifiedSkillMap(verifiedSkills).values()];
  const diagnostic = value => {
    try { options.onDiagnostic?.(value); } catch { /* Diagnostics never affect a student's build. */ }
  };
  const reviewData = parsed => ({
    structuredCv: parsed.structuredCv,
    sourceEntries: parsed.entries.map(({ id, field, sectionName, index }) => ({ id, field, sectionName, index })),
    wordingOptions: reviewWordingOptions(parsed),
    targetCareer: typeof targetCareer === 'string' && targetCareer.trim() ? targetCareer.trim().slice(0, 255) : 'No target career selected',
    verifiedSkills: trustedSkills,
    scanAnalysis: scanReviewContext(scanAnalysis)
  });
  // The parser returns IDs rather than rewritten CV text. Its output budget
  // scales with the source count instead of reserving a full review's tokens.
  const parserTokens = Math.min(4096, Math.max(1024, 512 + context.units.length * 16));
  const requestBody = (instructions, data, maxTokens = 4096) => {
    const body = JSON.stringify({
      model: 'openai/gpt-oss-120b', temperature: 0.2, reasoning_effort: 'low',
      response_format: { type: 'json_object' }, max_completion_tokens: maxTokens,
      messages: [{ role: 'system', content: instructions }, { role: 'user', content: JSON.stringify(data) }]
    });
    if (Buffer.byteLength(body) > MAX_PROVIDER_BYTES) throw builderFailure('CV_BUILD_CONTEXT_TOO_LARGE', {}, 'The CV builder context is too large.');
    return body;
  };
  // Reject oversized trusted context before making either provider request.
  requestBody(REVIEWER_INSTRUCTIONS, reviewData(baseline));
  const parserBody = requestBody(PARSER_INSTRUCTIONS, { sources: context.units }, parserTokens);
  const controller = new AbortController();
  const expiresAt = Date.now() + timeoutMs;
  let timer;
  const deadline = new Promise((resolve, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(builderFailure('CV_BUILD_TIMEOUT', {}, 'Lumia CV builder timed out.')); }, timeoutMs);
  });
  const complete = async (body, providerStage) => {
    for (let attempt = 0; ; attempt++) {
      controller.signal.throwIfAborted();
      let response;
      try {
        response = await (options.fetch || globalThis.fetch)('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey.trim() },
          body, signal: controller.signal
        });
      } catch { throw builderFailure('CV_BUILD_PROVIDER_NETWORK', { providerStage }); }
      let data;
      try { data = await providerJSON(response, controller.signal); }
      catch (error) {
        error.providerStage = providerStage;
        if (error.code !== 'CV_BUILD_RATE_LIMITED') throw error;
        const waitMs = error.retryAfterSeconds * 1000;
        // Honour the provider's wait only once, leaving time to finish inference.
        // Longer waits go back to the browser as a cooldown rather than timing out.
        const willRetry = attempt === 0 && Number.isFinite(waitMs) && waitMs > 0 &&
          waitMs <= 45000 && waitMs + 5000 < expiresAt - Date.now();
        diagnostic({ stage: 'rate_limit', providerStage, retryAfterSeconds: error.retryAfterSeconds, willRetry });
        if (!willRetry) throw error;
        await delay(waitMs, undefined, { signal: controller.signal });
        continue;
      }
      const choice = data?.choices?.[0];
      const raw = choice?.message?.content;
      if (data?.error || data?.truncated === true || data?.incomplete === true || choice?.message?.refusal ||
          (choice?.finish_reason !== undefined && choice.finish_reason !== 'stop') ||
          typeof raw !== 'string' || !raw.trim() || raw.length > MAX_PROVIDER_BYTES) throw builderFailure('CV_BUILD_INCOMPLETE', { providerStage });
      try { return JSON.parse(raw); }
      catch { throw builderFailure('CV_BUILD_INVALID_JSON', { providerStage }); }
    }
  };
  try {
    return await Promise.race([deadline, (async () => {
      const parserOutput = await complete(parserBody, 'parser');
      let parsed;
      try {
        parsed = validateCvParserOutput(parserOutput, context);
        diagnostic({ stage: 'parser', sourceUnits: context.units.length });
      } catch {
        // Only the source classification failed. Keep complete source wording
        // under its detected headings, then still run the dedicated reviewer.
        parsed = baseline;
        diagnostic({ stage: 'fallback', sourceUnits: context.units.length });
      }
      const reviewerContext = reviewData(parsed);
      const review = await complete(requestBody(REVIEWER_INSTRUCTIONS, reviewerContext), 'reviewer');
      const rawSuggestions = reviewerSuggestions(review);
      const validationContext = {
        cvText, verifiedSkills: trustedSkills, structuredCv: parsed.structuredCv, sourceEntries: parsed.entries
      };
      let validated = validateCvSuggestions(resolveWordingOptions(rawSuggestions || [], parsed, reviewerContext.wordingOptions), validationContext);
      diagnostic({ stage: 'reviewer', ...validated.diagnostics });
      if (!validated.suggestions.length) {
        const recovered = sourceBackedSuggestions(parsed, reviewerContext.wordingOptions, trustedSkills, validationContext);
        diagnostic({ stage: 'recovery', ...recovered.diagnostics });
        if (recovered.suggestions.length) validated = recovered;
        // Do not turn unusable model output into a misleading successful empty
        // build. A genuine empty review is allowed only when recovery is empty too.
        else if (!rawSuggestions || rawSuggestions.length) {
          throw builderFailure('CV_BUILD_VALIDATION', { validationReason: rawSuggestions ? 'no_usable_suggestions' : 'schema' });
        }
      }
      const output = { structuredCv: parsed.structuredCv, suggestions: validated.suggestions };
      parsedBuilds.set(output, { cvText, snapshot: JSON.stringify(output.structuredCv), entries: structuredClone(parsed.entries) });
      return output;
    })()]);
  } catch (error) {
    if (controller.signal.aborted) throw builderFailure('CV_BUILD_TIMEOUT', {}, 'Lumia CV builder timed out.');
    if (/^CV_BUILD_/.test(error?.code)) throw error;
    throw builderFailure('CV_BUILD_FAILED');
  } finally { clearTimeout(timer); }
}

module.exports = { generateCvBuildWithLumia, validateCvBuildOutput };
