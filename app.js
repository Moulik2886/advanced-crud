let customers = [];
let selected = new Set();
let page = 1;
let pageSize = 8;
let sortKey = 'joined';
let sortDirection = -1;
let toastTimer;
let eventStream;
let reconnectTimer;
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers }
  });
  const body = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(body?.error || `Request failed (${response.status})`);
  return body;
}
function initials(name) { return name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase(); }
function esc(value = '') { return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
function statusClass(status) { return status === 'Active' ? 'status-active' : status === 'At risk' ? 'status-risk' : 'status-inactive'; }
function formatDate(date) {
  if (!date) return '—';
  const parsed = new Date(`${date}T12:00:00`);
  return Number.isNaN(+parsed) ? '—' : new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(parsed);
}
function filtered() {
  const query = $('#search-input').value.trim().toLowerCase();
  const status = $('#status-filter').value;
  const plan = $('#plan-filter').value;
  return customers.filter(customer =>
    (!query || [customer.name, customer.email, customer.company, customer.role, customer.plan, customer.status].some(value => (value || '').toLowerCase().includes(query))) &&
    (status === 'all' || customer.status === status) && (plan === 'all' || customer.plan === plan)
  ).sort((a, b) => {
    const left = (a[sortKey] || '').toLowerCase(), right = (b[sortKey] || '').toLowerCase();
    return (left < right ? -1 : left > right ? 1 : 0) * sortDirection;
  });
}
function render() {
  const data = filtered();
  const pages = Math.max(1, Math.ceil(data.length / pageSize));
  if (page > pages) page = pages;
  const start = (page - 1) * pageSize;
  const visible = data.slice(start, start + pageSize);
  $('#customer-rows').innerHTML = visible.map(customer => `<tr>
    <td><input class="row-check" type="checkbox" data-select="${esc(customer.id)}" ${selected.has(customer.id) ? 'checked' : ''} aria-label="Select ${esc(customer.name)}" /></td>
    <td><div class="customer-cell"><div class="customer-avatar" style="background:${/^#[0-9a-f]{6}$/i.test(customer.color || '') ? customer.color : '#eee9ff'};color:#55506d">${esc(customer.initials || initials(customer.name))}</div><div><div class="customer-name">${esc(customer.name)}</div><div class="customer-email">${esc(customer.email)}</div></div></div></td>
    <td><span class="status-badge ${statusClass(customer.status)}"><i></i>${esc(customer.status)}</span></td>
    <td><div class="company-name">${esc(customer.company)}</div><div class="company-sector">${esc(customer.sector || customer.role || '—')}</div></td>
    <td><span class="plan-badge">${esc(customer.plan)}</span></td><td><span class="joined-date">${formatDate(customer.joined)}</span></td>
    <td><div class="row-actions"><button class="row-action" data-edit="${esc(customer.id)}" aria-label="Edit ${esc(customer.name)}" title="Edit">✎</button><button class="row-action delete" data-delete="${esc(customer.id)}" aria-label="Delete ${esc(customer.name)}" title="Delete">⌫</button></div></td>
  </tr>`).join('');
  $('#empty-state').classList.toggle('hidden', data.length > 0);
  $('.table-scroll').classList.toggle('hidden', data.length === 0);
  $('.table-footer').classList.toggle('hidden', data.length === 0);
  $('#table-count').textContent = customers.length;
  $('#nav-count').textContent = customers.length;
  $('#stat-total').textContent = customers.length;
  $('#stat-active').textContent = customers.filter(customer => customer.status === 'Active').length;
  $('#stat-active-share').textContent = `${customers.length ? Math.round(customers.filter(customer => customer.status === 'Active').length / customers.length * 100) : 0}%`;
  $('#stat-risk').textContent = customers.filter(customer => customer.status === 'At risk').length;
  const currentMonth = new Date().toISOString().slice(0, 7);
  $('#stat-new').textContent = customers.filter(customer => customer.joined?.startsWith(currentMonth)).length;
  $('#page-summary').textContent = `Showing ${data.length ? start + 1 : 0}–${Math.min(start + pageSize, data.length)} of ${data.length} customers`;
  $('#page-number').textContent = `${page} / ${pages}`;
  $('#prev-page').disabled = page <= 1;
  $('#next-page').disabled = page >= pages;
  $('#select-all').checked = visible.length > 0 && visible.every(customer => selected.has(customer.id));
  $('#select-all').indeterminate = visible.some(customer => selected.has(customer.id)) && !$('#select-all').checked;
  $('#bulk-bar').classList.toggle('hidden', selected.size === 0);
  $('#selected-count').textContent = selected.size;
}
function notify(message) {
  const toast = $('#toast'); toast.textContent = message; toast.classList.add('visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('visible'), 2600);
}
function openModal(customer) {
  $('#customer-form').reset(); $('#customer-id').value = customer?.id || '';
  $('#modal-title').textContent = customer ? 'Edit customer' : 'Add a customer';
  $('.modal-heading p').textContent = customer ? 'Update this customer’s information.' : 'Fill in the details below to add someone new.';
  $('#form-name').value = customer?.name || ''; $('#form-email').value = customer?.email || '';
  $('#form-company').value = customer?.company || ''; $('#form-role').value = customer?.role || '';
  $('#form-plan').value = customer?.plan || 'Starter'; $('#form-status').value = customer?.status || 'Active';
  $('#customer-modal').classList.remove('hidden'); setTimeout(() => $('#form-name').focus(), 50);
}
function closeModal() { $('#customer-modal').classList.add('hidden'); }
function download(name, type, content) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url);
}
function csvCell(value) { return `"${String(value ?? '').replace(/"/g, '""')}"`; }
function exportData() {
  const rows = [['Name', 'Email', 'Company', 'Role', 'Plan', 'Status', 'Joined'], ...customers.map(c => [c.name, c.email, c.company, c.role, c.plan, c.status, c.joined])];
  download('orbit-customers.csv', 'text/csv;charset=utf-8', rows.map(row => row.map(csvCell).join(',')).join('\n'));
  notify('Customer data exported');
}
function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim());
  return lines.map(line => {
    const fields = []; let field = '', quoted = false;
    for (let index = 0; index < line.length; index++) {
      const char = line[index];
      if (char === '"' && quoted && line[index + 1] === '"') { field += '"'; index++; }
      else if (char === '"') quoted = !quoted;
      else if (char === ',' && !quoted) { fields.push(field); field = ''; }
      else field += char;
    }
    fields.push(field); return fields;
  });
}
async function importFile(file) {
  try {
    const text = await file.text(); let rows;
    if (file.name.toLowerCase().endsWith('.json')) {
      const parsed = JSON.parse(text); rows = Array.isArray(parsed) ? parsed : parsed.customers;
      if (!Array.isArray(rows)) throw new Error('JSON must contain an array of customers');
    } else {
      const parsed = parseCsv(text), headers = parsed.shift().map(header => header.trim().toLowerCase());
      rows = parsed.map(row => Object.fromEntries(headers.map((header, index) => [header, row[index] || ''])));
    }
    const result = await api('/customers/import', { method: 'POST', body: JSON.stringify({ customers: rows }) });
    page = 1; notify(`${result.imported} customer${result.imported === 1 ? '' : 's'} imported`);
  } catch (error) { notify(`Import failed: ${error.message}`); }
  finally { $('#import-file').value = ''; }
}
function connectLiveUpdates() {
  if (eventStream) eventStream.close();
  eventStream = new EventSource('/api/events');
  eventStream.addEventListener('snapshot', event => {
    const incoming = JSON.parse(event.data);
    customers = incoming;
    const ids = new Set(customers.map(customer => customer.id));
    selected = new Set([...selected].filter(id => ids.has(id)));
    render();
  });
  eventStream.onopen = () => { $('#live-indicator').textContent = 'Live'; $('#live-dot').classList.add('connected'); };
  eventStream.onerror = () => {
    $('#live-indicator').textContent = 'Reconnecting'; $('#live-dot').classList.remove('connected');
    eventStream.close(); clearTimeout(reconnectTimer); reconnectTimer = setTimeout(connectLiveUpdates, 1800);
  };
}

$('#add-btn').addEventListener('click', () => openModal());
$('#close-modal').addEventListener('click', closeModal); $('#cancel-modal').addEventListener('click', closeModal);
$('#customer-modal').addEventListener('click', event => { if (event.target === $('#customer-modal')) closeModal(); });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeModal();
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('#search-input').focus(); }
});
$('#customer-form').addEventListener('submit', async event => {
  event.preventDefault();
  const id = $('#customer-id').value, name = $('#form-name').value.trim();
  const payload = { name, email: $('#form-email').value.trim(), company: $('#form-company').value.trim(), role: $('#form-role').value.trim(), plan: $('#form-plan').value, status: $('#form-status').value };
  try {
    await api(id ? `/customers/${encodeURIComponent(id)}` : '/customers', { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    page = 1; closeModal(); notify(id ? 'Customer updated' : 'Customer added');
  } catch (error) { notify(error.message); }
});
$('#customer-rows').addEventListener('click', async event => {
  const edit = event.target.closest('[data-edit]'), remove = event.target.closest('[data-delete]');
  if (edit) { const customer = customers.find(item => item.id === edit.dataset.edit); if (customer) openModal(customer); }
  if (remove) {
    const customer = customers.find(item => item.id === remove.dataset.delete);
    if (customer && confirm(`Delete ${customer.name}? This cannot be undone.`)) {
      try { await api(`/customers/${encodeURIComponent(customer.id)}`, { method: 'DELETE' }); selected.delete(customer.id); notify('Customer deleted'); }
      catch (error) { notify(error.message); }
    }
  }
});
$('#customer-rows').addEventListener('change', event => {
  const id = event.target.dataset.select; if (!id) return;
  event.target.checked ? selected.add(id) : selected.delete(id); render();
});
$('#select-all').addEventListener('change', event => {
  const visible = filtered().slice((page - 1) * pageSize, page * pageSize);
  visible.forEach(customer => event.target.checked ? selected.add(customer.id) : selected.delete(customer.id)); render();
});
$('#bulk-status').addEventListener('change', async event => {
  if (!event.target.value) return;
  try { await api('/customers/bulk/status', { method: 'PATCH', body: JSON.stringify({ ids: [...selected], status: event.target.value }) }); selected.clear(); notify('Customer statuses updated'); }
  catch (error) { notify(error.message); }
  event.target.value = '';
});
$('#bulk-delete').addEventListener('click', async () => {
  if (!selected.size || !confirm(`Delete ${selected.size} selected customer${selected.size === 1 ? '' : 's'}? This cannot be undone.`)) return;
  try { const result = await api('/customers/bulk', { method: 'DELETE', body: JSON.stringify({ ids: [...selected] }) }); selected.clear(); notify(`${result.deleted} customers deleted`); }
  catch (error) { notify(error.message); }
});
$('#clear-selection').addEventListener('click', () => { selected.clear(); render(); });
$('#search-input').addEventListener('input', () => { page = 1; render(); });
$('#status-filter').addEventListener('change', () => { page = 1; render(); });
$('#plan-filter').addEventListener('change', () => { page = 1; render(); });
$('#page-size').addEventListener('change', event => { pageSize = Number(event.target.value); page = 1; render(); });
$('#prev-page').addEventListener('click', () => { page--; render(); }); $('#next-page').addEventListener('click', () => { page++; render(); });
$$('[data-sort]').forEach(button => button.addEventListener('click', () => { sortDirection = sortKey === button.dataset.sort ? -sortDirection : 1; sortKey = button.dataset.sort; render(); }));
function resetFilters() { $('#search-input').value = ''; $('#status-filter').value = 'all'; $('#plan-filter').value = 'all'; page = 1; render(); }
$('#clear-filters').addEventListener('click', resetFilters); $('#empty-reset').addEventListener('click', resetFilters);
$('#focus-search').addEventListener('click', () => $('#search-input').focus()); $('#export-btn').addEventListener('click', exportData);
$('#import-nav').addEventListener('click', event => { event.preventDefault(); $('#import-file').click(); });
$('#import-file').addEventListener('change', event => { if (event.target.files[0]) importFile(event.target.files[0]); });
$('#guide-btn').addEventListener('click', () => notify('Customer data is saved on the server and updates live across open pages.'));
api('/customers').then(data => { customers = data; render(); connectLiveUpdates(); }).catch(error => {
  notify(`Could not connect to the backend: ${error.message}`); $('#live-indicator').textContent = 'Offline';
});
