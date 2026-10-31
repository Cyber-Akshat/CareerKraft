const FIELDS = ['name', 'headline', 'contact', 'profile', 'education', 'experience', 'projects', 'skills', 'certifications'];
const LIST_FIELDS = new Set(['contact', 'education', 'experience', 'projects', 'skills', 'certifications']);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validText = (value, max) => typeof value === 'string' && value.length <= max &&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const normalise = value => value.trim()
  .replace(/^(?:[•*]|[-–—](?!\s*[+\-−]?\s*\d)|\d+[.)])\s+/u, '')
  .replace(/\s+/g, ' ').toLowerCase();

function cvReviewError(message, status = 409) {
  return Object.assign(new Error(message), { cvReviewInputError: true, status });
}

function parseStoredCv(value) {
  const cv = typeof value === 'string' ? JSON.parse(value) : value;
  if (!record(cv) || Object.keys(cv).length !== FIELDS.length) throw new Error('Invalid stored CV.');
  const output = {};
  for (const field of FIELDS) {
    if (LIST_FIELDS.has(field)) {
      if (!Array.isArray(cv[field]) || cv[field].length > 50 ||
          !cv[field].every(text => validText(text, field === 'contact' ? 2000 : 20000))) throw new Error('Invalid stored CV section.');
      output[field] = cv[field].slice();
    } else {
      if (!validText(cv[field], field === 'profile' ? 20000 : 255)) throw new Error('Invalid stored CV field.');
      output[field] = cv[field];
    }
  }
  return output;
}

function resolveCvReviewText(suggestion, status, finalText) {
  if (status === 'rejected') return suggestion.original_text || '';
  const field = typeof suggestion.section_name === 'string' ? suggestion.section_name.trim().toLowerCase() : '';
  if (!FIELDS.includes(field)) throw cvReviewError('This suggestion could not be matched to a CV section.');
  const max = ['name', 'headline'].includes(field) ? 255 : 2000;
  if (!validText(finalText, max) || !finalText.trim()) {
    throw cvReviewError(`Final CV text must contain between 1 and ${max} characters.`, 400);
  }
  const text = finalText.trim();
  if (status === 'accepted') {
    if (!validText(suggestion.suggested_text, max) || !suggestion.suggested_text.trim()) throw new Error('Invalid stored suggestion.');
    if (text !== suggestion.suggested_text.trim()) {
      throw cvReviewError('Use Edit to change Lumia\'s suggested wording.', 400);
    }
    return suggestion.suggested_text.trim();
  }
  return text;
}

function applyCvReviewChange(currentCv, suggestion, finalText) {
  const cv = parseStoredCv(currentCv);
  const field = suggestion.section_name.trim().toLowerCase();
  if (!FIELDS.includes(field)) throw cvReviewError('This suggestion could not be matched to a CV section.');
  const original = suggestion.original_text || '';
  if (!original) {
    if (LIST_FIELDS.has(field)) {
      if (cv[field].some(text => normalise(text) === normalise(finalText))) throw cvReviewError('This text is already in your CV.');
      if (cv[field].length >= 50) throw cvReviewError('This section already has too many entries.');
      cv[field].push(finalText);
    } else {
      if (cv[field].trim()) throw cvReviewError('This section has changed. Please reload the CV Builder.');
      cv[field] = finalText;
    }
  } else if (LIST_FIELDS.has(field)) {
    const matches = cv[field].flatMap((text, index) => normalise(text) === normalise(original) ? [index] : []);
    if (matches.length !== 1) throw cvReviewError('The original text could not be matched uniquely. Please reload the CV Builder.');
    cv[field][matches[0]] = finalText;
  } else {
    if (normalise(cv[field]) !== normalise(original)) throw cvReviewError('The original text has changed. Please reload the CV Builder.');
    cv[field] = finalText;
  }
  return cv;
}

function cvSuggestionResponse(row) {
  const evidence = typeof row.evidence_json === 'string' ? JSON.parse(row.evidence_json) : row.evidence_json;
  return {
    id: Number(row.id), sectionName: row.section_name, suggestionType: row.suggestion_type,
    originalText: row.original_text || '', suggestedText: row.suggested_text, reason: row.reason,
    evidence: Array.isArray(evidence) ? evidence.filter(text => typeof text === 'string').slice(0, 10) : [],
    status: row.status, finalText: row.final_text, sortOrder: Number(row.sort_order)
  };
}

module.exports = { cvReviewError, parseStoredCv, resolveCvReviewText, applyCvReviewChange, cvSuggestionResponse };
