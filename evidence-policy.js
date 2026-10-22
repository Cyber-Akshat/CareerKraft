(function (root, factory) {
  const policy = factory();
  if (typeof module === 'object' && module.exports) module.exports = policy;
  else root.careerEvidencePolicy = policy;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const ALLOWED_EVIDENCE_EXTENSIONS = new Set([
    '.pdf', '.doc', '.docx', '.txt', '.rtf', '.md',
    '.xls', '.xlsx', '.csv', '.ods', '.json', '.xml',
    '.ppt', '.pptx', '.odp',
    '.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg',
    '.py', '.js', '.jsx', '.ts', '.tsx', '.html', '.css', '.java', '.c', '.cpp', '.h', '.hpp',
    '.cs', '.php', '.rb', '.go', '.rs', '.swift', '.kt', '.kts', '.dart', '.sh', '.sql',
    '.ipynb', '.yaml', '.yml', '.toml', '.ini',
    '.mp3', '.wav', '.m4a', '.ogg', '.mp4', '.mov', '.webm'
  ]);
  function isAllowedEvidenceFilename(value) {
    if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) return false;
    const filename = value.split(/[\\/]/).pop();
    const dot = filename.lastIndexOf('.');
    return dot > 0 && ALLOWED_EVIDENCE_EXTENSIONS.has(filename.slice(dot).toLowerCase());
  }
  return {
    ALLOWED_EVIDENCE_EXTENSIONS,
    SUPPORTED_EVIDENCE_ACCEPT: [...ALLOWED_EVIDENCE_EXTENSIONS].join(','),
    isAllowedEvidenceFilename
  };
});
