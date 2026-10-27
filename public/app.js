'use strict';

/* Detector Audit Bench — vanilla JS, no build step.
 * All data comes from the shared /api contract. No scores or documents
 * are fabricated in the browser: unconfigured integrations surface the
 * server's 503 error verbatim, and the demo button only appears when
 * GET /api/demo-corpus actually exists.
 */

const state = {
  runs: [],
  currentRunId: '',
  detail: null, // { run, documents: [], results: [] }
  report: null, // report aggregate or null
  selectedDocumentId: '',
  demoDocuments: null,
};

const $ = (id) => document.getElementById(id);

const els = {
  health: $('health-status'),
  runSelect: $('run-select'),
  createRunForm: $('create-run-form'),
  newRunName: $('new-run-name'),
  refreshRunsBtn: $('refresh-runs-btn'),
  globalError: $('global-error'),
  globalStatus: $('global-status'),
  addDocForm: $('add-doc-form'),
  docTitle: $('doc-title'),
  docEra: $('doc-era'),
  docSource: $('doc-source'),
  docSlice: $('doc-slice'),
  docLabel: $('doc-label'),
  docText: $('doc-text'),
  docWordCount: $('doc-word-count'),
  docValidation: $('doc-validation'),
  addDocBtn: $('add-doc-btn'),
  demoBtn: $('demo-btn'),
  demoStatus: $('demo-status'),
  generateBtn: $('generate-btn'),
  scoreBtn: $('score-btn'),
  refreshReportBtn: $('refresh-report-btn'),
  actionStatus: $('action-status'),
  docList: $('doc-list'),
  docListEmpty: $('doc-list-empty'),
  docCount: $('doc-count'),
  reportEmpty: $('report-empty'),
  sumDocuments: $('sum-documents'),
  sumScored: $('sum-scored'),
  sumPredictions: $('sum-predictions'),
  sumFp1000: $('sum-fp1000'),
  sumRecall: $('sum-recall'),
  slicesEmpty: $('slices-empty'),
  sliceTables: $('slice-tables'),
  resultsEmpty: $('results-empty'),
  resultsTable: $('results-table'),
  resultsBody: $('results-body'),
};

// ---------- helpers ----------

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function wordCount(text) {
  const trimmed = String(text || '').trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function formatNumber(value) {
  if (value == null || value === '' || Number.isNaN(Number(value))) return '—';
  const n = Number(value);
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '');
}

function formatFraction(value) {
  if (value == null || value === '' || Number.isNaN(Number(value))) return '—';
  const n = Number(value);
  // Fractions arrive as 0..1; render as a percentage.
  return `${(n <= 1 ? n * 100 : n).toFixed(1)}%`;
}

function formatRecall(value) {
  if (value == null) return '— (no AI documents)';
  if (Number.isNaN(Number(value))) return '—';
  const n = Number(value);
  return `${(n <= 1 ? n * 100 : n).toFixed(1)}%`;
}

class ApiError extends Error {
  constructor(status, message, payload) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

async function api(path, options) {
  const opts = options || {};
  let response;
  try {
    response = await fetch(path, {
      method: opts.method || 'GET',
      headers: opts.body != null ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body != null ? JSON.stringify(opts.body) : undefined,
    });
  } catch (err) {
    throw new ApiError(0, `Network error calling ${path}: ${err.message}`);
  }
  const text = await response.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = null; }
  }
  if (!response.ok) {
    const serverError =
      (payload && (payload.error || payload.message)) ||
      (payload && Array.isArray(payload.errors) && payload.errors.join('; ')) ||
      text ||
      response.statusText;
    throw new ApiError(response.status, String(serverError), payload);
  }
  return payload;
}

function showError(message) {
  els.globalError.textContent = message;
  els.globalError.hidden = false;
}
function clearError() {
  els.globalError.textContent = '';
  els.globalError.hidden = true;
}
function showStatus(message) {
  els.globalStatus.textContent = message;
  els.globalStatus.hidden = !message;
}
function setActionStatus(message, kind) {
  els.actionStatus.textContent = message || '';
  els.actionStatus.className = `action-status${kind ? ` ${kind}` : ''}`;
}

// 503s are configuration problems (missing detector / Meta keys). Surface
// them loudly and name the missing configuration, never silently retry.
function reportApiError(err, context) {
  if (err instanceof ApiError && err.status === 503) {
    showError(`${context}: not configured on the server (503). ${err.message}`);
    setActionStatus(`${context}: not configured (503) — ${err.message}`, 'error');
  } else if (err instanceof ApiError && err.payload && Array.isArray(err.payload.errors)) {
    showError(`${context}: ${err.payload.errors.join('; ')}`);
    setActionStatus(`${context} failed: ${err.payload.errors.join('; ')}`, 'error');
  } else {
    showError(`${context}: ${err.message || String(err)}`);
    setActionStatus(`${context} failed: ${err.message || String(err)}`, 'error');
  }
}

function setBusy(button, busy, busyLabel) {
  button.disabled = busy;
  button.setAttribute('aria-busy', busy ? 'true' : 'false');
  if (busyLabel) {
    if (busy) {
      button.dataset.label = button.textContent;
      button.textContent = busyLabel;
    } else if (button.dataset.label) {
      button.textContent = button.dataset.label;
      delete button.dataset.label;
    }
  }
}

function currentDocuments() {
  return (state.detail && Array.isArray(state.detail.documents)) ? state.detail.documents : [];
}
function currentResults() {
  return (state.detail && Array.isArray(state.detail.results)) ? state.detail.results : [];
}

// ---------- runs ----------

async function loadRuns(preferredId) {
  const payload = await api('/api/runs');
  state.runs = payload && Array.isArray(payload.runs) ? payload.runs : [];
  const select = els.runSelect;
  select.innerHTML = '';
  if (!state.runs.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No runs yet';
    select.appendChild(opt);
  } else {
    for (const run of state.runs) {
      const opt = document.createElement('option');
      opt.value = String(run.id);
      opt.textContent = run.name ? `${run.name} (${run.id})` : String(run.id);
      select.appendChild(opt);
    }
  }
  const target = preferredId || state.currentRunId;
  if (target && state.runs.some((r) => String(r.id) === String(target))) {
    select.value = String(target);
  } else if (state.runs.length) {
    select.value = String(state.runs[0].id);
  }
  state.currentRunId = select.value || '';
}

async function loadRunDetail() {
  if (!state.currentRunId) {
    state.detail = null;
    state.report = null;
    render();
    return;
  }
  state.detail = await api(`/api/runs/${encodeURIComponent(state.currentRunId)}`);
  if (!state.selectedDocumentId ||
      !currentDocuments().some((d) => String(d.id) === String(state.selectedDocumentId))) {
    const firstHuman = currentDocuments().find((d) => !d.parent_id) || currentDocuments()[0];
    state.selectedDocumentId = firstHuman ? String(firstHuman.id) : '';
  }
  await loadReport(false);
  render();
}

async function loadReport(rerender = true) {
  if (!state.currentRunId) { state.report = null; return; }
  try {
    const payload = await api(`/api/runs/${encodeURIComponent(state.currentRunId)}/report`);
    // Contract: report fields at top level. Tolerate a {report:{...}} wrap.
    state.report = payload && payload.report && typeof payload.report === 'object' ? payload.report : payload;
  } catch (err) {
    // A missing/unavailable report is shown as an empty report, not fake data.
    state.report = null;
    if (err instanceof ApiError && err.status !== 404) throw err;
  }
  if (rerender) render();
}

async function refreshCurrentRun(context) {
  await loadRuns(state.currentRunId);
  await loadRunDetail();
  if (context) showStatus(context);
}

// ---------- rendering ----------

function renderDocuments() {
  const docs = currentDocuments();
  els.docCount.textContent = docs.length ? `(${docs.length})` : '';
  els.docListEmpty.hidden = docs.length > 0;
  els.docList.innerHTML = '';
  for (const doc of docs) {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `doc-item${String(doc.id) === String(state.selectedDocumentId) ? ' selected' : ''}`;
    button.setAttribute('aria-pressed', String(doc.id) === String(state.selectedDocumentId) ? 'true' : 'false');
    button.setAttribute('aria-label', `Select document ${doc.title || doc.id} for counterfactual generation`);
    const meta = [];
    if (doc.label) meta.push(`<span class="badge badge-${escapeHtml(doc.label)}">${escapeHtml(doc.label)}</span>`);
    meta.push(`<span>${words} words</span>`);
    if (words < 50) meta.push('<span class="badge badge-short">&lt;50 words — rejected</span>');
    if (doc.ai_pct != null) meta.push(`<span>AI ${formatNumber(doc.ai_pct)}%</span>`);
    if (doc.era) meta.push(`<span>Era: ${escapeHtml(doc.era)}</span>`);
    if (doc.source) meta.push(`<span>Source: ${escapeHtml(doc.source)}</span>`);
    if (doc.parent_id) meta.push('<span>counterfactual</span>');
    button.innerHTML = `<span class="doc-title">${escapeHtml(doc.title || '(untitled)')}</span><span class="doc-meta">${meta.join('')}</span>`;
    button.addEventListener('click', () => {
      state.selectedDocumentId = String(doc.id);
      renderDocuments();
    });
    li.appendChild(button);
    els.docList.appendChild(li);
  }
  els.generateBtn.disabled = !state.currentRunId || !state.selectedDocumentId;
}

function renderReport() {
  const report = state.report;
  const docs = currentDocuments();
  const results = currentResults();

  const hasReport = report && typeof report === 'object';
  els.reportEmpty.hidden = Boolean(state.currentRunId);
  els.sumDocuments.textContent = hasReport && report.total_documents != null
    ? formatNumber(report.total_documents) : formatNumber(docs.length || null);
  els.sumScored.textContent = hasReport && report.scored_documents != null
    ? formatNumber(report.scored_documents) : (results.length ? formatNumber(results.length) : '—');

  if (hasReport && report.by_prediction && typeof report.by_prediction === 'object') {
    const parts = Object.entries(report.by_prediction).map(([k, v]) => `${k}: ${v}`);
    els.sumPredictions.textContent = parts.length ? parts.join(' · ') : '—';
  } else {
    els.sumPredictions.textContent = '—';
  }

  els.sumFp1000.textContent = hasReport ? formatNumber(report.false_positives_per_1000_humans) : '—';
  els.sumRecall.textContent = hasReport ? formatRecall(report.recall_at_1pct_fpr) : '—';

  renderSlices(hasReport ? report.slices : null);
  renderResultsTable(docs, results);
}

const SLICE_GROUPS = [
  ['era', 'By era'],
  ['source', 'By source'],
  ['slice', 'By slice'],
  ['length', 'By length'],
];

function sliceValue(slice, ...keys) {
  for (const key of keys) if (slice && slice[key] != null) return slice[key];
  return null;
}

function renderSlices(slices) {
  els.sliceTables.innerHTML = '';
  if (!slices || typeof slices !== 'object') { els.slicesEmpty.hidden = false; return; }
  let rendered = 0;
  for (const [key, title] of SLICE_GROUPS) {
    const rows = slices[key];
    if (!Array.isArray(rows) || !rows.length) continue;
    rendered += 1;
    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    const table = document.createElement('table');
    const head = '<thead><tr><th scope="col">Key</th><th scope="col">Total</th><th scope="col">Scored</th>' +
      '<th scope="col">Human</th><th scope="col">AI</th><th scope="col">False positives</th>' +
      '<th scope="col">FP / 1000 humans</th><th scope="col">Predictions</th></tr></thead>';
    const body = rows.map((slice) => {
      const predictions = slice && slice.by_prediction && typeof slice.by_prediction === 'object'
        ? Object.entries(slice.by_prediction).map(([k, v]) => `${k}: ${v}`).join(' · ')
        : '—';
      return '<tr>' +
        `<td>${escapeHtml(sliceValue(slice, 'key', 'name') ?? '—')}</td>` +
        `<td>${formatNumber(sliceValue(slice, 'total', 'count'))}</td>` +
        `<td>${formatNumber(sliceValue(slice, 'scored'))}</td>` +
        `<td>${formatNumber(sliceValue(slice, 'human', 'humans', 'human_count'))}</td>` +
        `<td>${formatNumber(sliceValue(slice, 'ai', 'ai_count'))}</td>` +
        `<td>${formatNumber(sliceValue(slice, 'false_positives', 'falsePositives', 'fp'))}</td>` +
        `<td>${formatNumber(sliceValue(slice, 'false_positives_per_1000_humans', 'fp_per_1000'))}</td>` +
        `<td>${escapeHtml(predictions)}</td></tr>`;
    }).join('');
    table.innerHTML = `<caption>${escapeHtml(title)}</caption>${head}<tbody>${body}</tbody>`;
    wrap.appendChild(table);
    els.sliceTables.appendChild(wrap);
  }
  els.slicesEmpty.hidden = rendered > 0;
}

function renderResultsTable(docs, results) {
  const byDocumentId = new Map();
  for (const result of results) {
    if (result && result.document_id != null) byDocumentId.set(String(result.document_id), result);
  }
  // Results may themselves carry document fields if documents are absent.
  const rows = docs.length ? docs : results;
  els.resultsEmpty.hidden = rows.length > 0;
  els.resultsTable.hidden = rows.length === 0;
  els.resultsBody.innerHTML = '';
  for (const row of rows) {
    const doc = docs.length ? row : {};
    const result = docs.length ? byDocumentId.get(String(row.id)) : row;
    const words = doc.word_count != null ? doc.word_count : row.word_count;
    const eraSource = [doc.era || row.era, doc.source || row.source].filter(Boolean).join(' / ') || '—';
    const tr = document.createElement('tr');
    tr.innerHTML =
      `<td>${escapeHtml(doc.title || row.title || result?.title || '(untitled)')}</td>` +
      `<td>${escapeHtml(doc.label || row.label || '—')}</td>` +
      `<td>${doc.ai_pct != null || row.ai_pct != null ? `${formatNumber(doc.ai_pct ?? row.ai_pct)}%` : '—'}</td>` +
      `<td>${escapeHtml(eraSource)}</td>` +
      `<td>${formatNumber(words)}</td>` +
      `<td>${escapeHtml(result && result.prediction ? result.prediction : 'Not scored')}</td>` +
      `<td>${formatFraction(result ? result.fraction_ai : null)}</td>`;
    els.resultsBody.appendChild(tr);
  }
}

function render() {
  renderDocuments();
  renderReport();
}

// ---------- actions ----------

function updateWordCount() {
  const count = wordCount(els.docText.value);
  els.docWordCount.textContent = count < 50
    ? `${count} words — need at least 50 (${50 - count} more)`
    : `${count} words`;
  els.docWordCount.classList.toggle('too-short', count > 0 && count < 50);
  if (count >= 50) {
    els.docValidation.hidden = true;
    els.docValidation.textContent = '';
  }
}

function showDocValidation(message) {
  els.docValidation.textContent = message;
  els.docValidation.hidden = false;
}

// POST documents and surface per-document server rejections verbatim.
async function postDocuments(documents) {
  try {
    return await api(`/api/runs/${encodeURIComponent(state.currentRunId)}/documents`, {
      method: 'POST',
      body: { documents },
    });
  } catch (err) {
    if (err instanceof ApiError && err.payload &&
        (Array.isArray(err.payload.errors) || Array.isArray(err.payload.rejected))) {
      const list = err.payload.errors || err.payload.rejected;
      const text = list.map((e) => (typeof e === 'string' ? e : JSON.stringify(e))).join('; ');
      throw new ApiError(err.status, text, err.payload);
    }
    throw err;
  }
}

function insertedCount(payload, sent) {
  if (payload && Array.isArray(payload.documents)) return payload.documents.length;
  if (payload && typeof payload.inserted === 'number') return payload.inserted;
  if (payload && typeof payload.count === 'number') return payload.count;
  return sent;
}

async function onAddDocument(event) {
  event.preventDefault();
  clearError();
  if (!state.currentRunId) { showDocValidation('Create or select a run first.'); return; }
  const text = els.docText.value;
  const count = wordCount(text);
  if (count < 50) {
    showDocValidation(`Document is ${count} words — at least 50 words are required (${50 - count} more).`);
    els.docText.focus();
    return;
  }
  const doc = {
    title: els.docTitle.value.trim(),
    text,
    era: els.docEra.value.trim() || undefined,
    source: els.docSource.value.trim() || undefined,
    slice: els.docSlice.value.trim() || undefined,
    label: els.docLabel.value,
  };
  setBusy(els.addDocBtn, true, 'Adding…');
  try {
    const payload = await postDocuments([doc]);
    // Partial success: server may return inserted docs plus per-doc errors.
    if (payload && Array.isArray(payload.errors) && payload.errors.length) {
      showDocValidation(payload.errors.map((e) => (typeof e === 'string' ? e : JSON.stringify(e))).join('; '));
    }
    els.addDocForm.reset();
    els.docLabel.value = 'human';
    updateWordCount();
    await refreshCurrentRun(`Added ${insertedCount(payload, 1)} document(s) to the run.`);
  } catch (err) {
    showDocValidation(err.message || String(err));
    reportApiError(err, 'Add document');
  } finally {
    setBusy(els.addDocBtn, false);
  }
}

async function onGenerate() {
  clearError();
  if (!state.currentRunId) { showError('Create or select a run first.'); return; }
  if (!state.selectedDocumentId) { showError('Select a document in the list first.'); return; }
  setBusy(els.generateBtn, true, 'Generating…');
  setActionStatus('Generating matched AI and mixed-authorship counterfactuals with Meta… this may take a while.', 'working');
  try {
    await api(`/api/runs/${encodeURIComponent(state.currentRunId)}/generate`, {
      method: 'POST',
      body: { document_id: state.selectedDocumentId },
    });
    setActionStatus('Counterfactuals generated.', '');
    await refreshCurrentRun('Counterfactuals generated and added to the run.');
  } catch (err) {
    reportApiError(err, 'Generate counterfactuals');
  } finally {
    setBusy(els.generateBtn, false);
  }
}

async function onScore() {
  clearError();
  if (!state.currentRunId) { showError('Create or select a run first.'); return; }
  if (!currentDocuments().length) { showError('Add at least one document before scoring.'); return; }
  setBusy(els.scoreBtn, true, 'Scoring…');
  setActionStatus('Scoring documents with the detector… this may take a while.', 'working');
  try {
    await api(`/api/runs/${encodeURIComponent(state.currentRunId)}/score`, { method: 'POST', body: {} });
    setActionStatus('Scoring complete.', '');
    await refreshCurrentRun('Scoring complete. Report updated.');
  } catch (err) {
    reportApiError(err, 'Score with detector');
  } finally {
    setBusy(els.scoreBtn, false);
  }
}

async function probeDemoCorpus() {
  // Demo data is optional and server-provided. Any failure hides the button.
  try {
    const payload = await api('/api/demo-corpus');
    const docs = Array.isArray(payload) ? payload
      : payload && Array.isArray(payload.documents) ? payload.documents
      : payload && Array.isArray(payload.corpus) ? payload.corpus
      : null;
    if (!docs || !docs.length) throw new Error('No demo corpus');
    state.demoDocuments = docs;
    els.demoBtn.hidden = false;
    els.demoStatus.textContent = `${docs.length} demo document(s) available from the server.`;
  } catch {
    state.demoDocuments = null;
    els.demoBtn.hidden = true;
    els.demoStatus.textContent = '';
  }
}

async function onLoadDemo() {
  clearError();
  if (!state.demoDocuments) return;
  if (!state.currentRunId) { showError('Create or select a run first, then load the demo corpus.'); return; }
  setBusy(els.demoBtn, true, 'Loading…');
  try {
    const documents = state.demoDocuments.map((d) => ({
      external_id: d.external_id || d.id || undefined,
      title: d.title || '',
      text: d.text || '',
      era: d.era || undefined,
      source: d.source || undefined,
      slice: d.slice || undefined,
      label: d.label || 'human',
    }));
    const payload = await postDocuments(documents);
    if (payload && Array.isArray(payload.errors) && payload.errors.length) {
      showError(`Demo corpus partially loaded: ${payload.errors.map((e) => (typeof e === 'string' ? e : JSON.stringify(e))).join('; ')}`);
    }
    await refreshCurrentRun(`Loaded ${insertedCount(payload, documents.length)} demo document(s).`);
  } catch (err) {
    reportApiError(err, 'Load demo corpus');
  } finally {
    setBusy(els.demoBtn, false);
  }
}

// ---------- wiring / init ----------

els.docText.addEventListener('input', updateWordCount);
els.addDocForm.addEventListener('submit', onAddDocument);
els.generateBtn.addEventListener('click', onGenerate);
els.scoreBtn.addEventListener('click', onScore);
els.demoBtn.addEventListener('click', onLoadDemo);
els.refreshRunsBtn.addEventListener('click', async () => {
  clearError();
  try { await loadRuns(); await loadRunDetail(); } catch (err) { reportApiError(err, 'Refresh runs'); }
});
els.refreshReportBtn.addEventListener('click', async () => {
  clearError();
  try { await loadRunDetail(); showStatus('Report refreshed.'); }
  catch (err) { reportApiError(err, 'Refresh report'); }
});
els.runSelect.addEventListener('change', async () => {
  clearError();
  state.currentRunId = els.runSelect.value;
  state.selectedDocumentId = '';
  try { await loadRunDetail(); } catch (err) { reportApiError(err, 'Load run'); }
});
els.createRunForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearError();
  const name = els.newRunName.value.trim();
  if (!name) return;
  try {
    const payload = await api('/api/runs', { method: 'POST', body: { name } });
    const run = payload && payload.run ? payload.run : payload;
    els.newRunName.value = '';
    await loadRuns(run && run.id);
    await loadRunDetail();
    showStatus(`Run “${name}” created.`);
  } catch (err) {
    reportApiError(err, 'Create run');
  }
});

async function init() {
  updateWordCount();
  render();
  try {
    const health = await api('/api/health');
    els.health.textContent = health && health.ok ? 'API: healthy' : 'API: responded';
    els.health.classList.add('ok');
  } catch (err) {
    els.health.textContent = `API: unreachable (${err.message})`;
    els.health.classList.add('bad');
  }
  try {
    await loadRuns();
    await loadRunDetail();
  } catch (err) {
    reportApiError(err, 'Load runs');
  }
  // Not awaited as a blocker for the rest of the UI, but always resolved:
  // failure simply keeps the demo button hidden.
  probeDemoCorpus();
}

init();
