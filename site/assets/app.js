import { config } from '../config.js';
import { buildCatalog, filterCatalog, foldText, songId, todayInZone, weekWindows } from './catalog.js';
import { fetchSpreadsheet, validateSnapshot, youtubeVideo } from './sheets.js';
import { createStorage, readCache, writeCache } from './storage.js';

const $ = selector => document.querySelector(selector);
const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);

const icons = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  sync: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 8a7 7 0 0 1 11.6-2L20 9M4 15l2.3 3A7 7 0 0 0 17.9 16"/>',
  search: '<circle cx="10.8" cy="10.8" r="5.8"/><path d="m15 15 4.1 4.1"/>',
  filters: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2" fill="var(--white, #fff)"/><circle cx="15" cy="17" r="2" fill="var(--white, #fff)"/>',
  play: '<rect x="3.2" y="5.6" width="17.6" height="12.8" rx="3"/><path d="m10 9 5 3-5 3z" fill="currentColor" stroke="none"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  storage: '<ellipse cx="12" cy="6" rx="7" ry="2.7"/><path d="M5 6v12c0 1.5 3.1 2.7 7 2.7s7-1.2 7-2.7V6M5 12c0 1.5 3.1 2.7 7 2.7s7-1.2 7-2.7"/>',
};
const icon = name => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;

const dateShort = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' });
const dateLong = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const syncDate = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: config.timeZone });
const asDate = iso => new Date(iso + 'T00:00:00Z');
const when = (iso, format = dateShort) => `<time datetime="${iso}">${format.format(asDate(iso))}</time>`;
const plural = (count, noun) => count + ' ' + noun + (count === 1 ? '' : 's');
const tempoNames = { upbeat: 'Upbeat', slowbeat: 'Slowbeat', '': 'Unclassified' };
const groupNames = { gms: 'GMS', 'non-gms': 'Non GMS', unknown: 'Unclassified' };
const filterSelectors = { tempo: '#tempo-filter', group: '#group-filter', history: '#history-filter', age: '#age-filter' };
const pageSize = 14;

let snapshot;
try {
  snapshot = validateSnapshot(readCache('sheet', null));
} catch {
  snapshot = null;
}
let loading = !snapshot;
let importError = '';
let syncing = false;
let autoSync = readCache('auto-sync', true) !== false;
let lastAttempt = 0;
let today = todayInZone(config.timeZone);
let model = buildCatalog(snapshot, [], today);
let storageState = { status: 'connecting', edits: [] };
let page = 1;
let drawerState = null;
let returnFocus;
let toastTimer;

const drawer = $('#drawer');
const drawerContent = $('#drawer-content');

function openVideo(song, preferred = '') {
  const url = youtubeVideo(preferred) || youtubeVideo(song.youtube);
  return {
    url: url || 'https://www.youtube.com/results?search_query=' + encodeURIComponent([song.title, song.artist].filter(Boolean).join(' ')),
    direct: Boolean(url),
  };
}

function mediaLink(song) {
  const media = openVideo(song);
  const label = (media.direct ? 'Play ' : 'Find ') + song.title + ' on YouTube';
  return `<a class="icon-button media-button" href="${escapeHtml(media.url)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${icon(media.direct ? 'play' : 'search')}</a>`;
}

function tempoTag(tempo) {
  return `<span class="pill ${tempo ? 'pill-' + tempo : 'pill-muted'}">${tempoNames[tempo]}</span>`;
}

function groupTag(group) {
  return `<span class="pill ${group === 'gms' ? 'pill-gms' : 'pill-muted'}">${groupNames[group]}</span>`;
}

function renderWeeks() {
  $('#weekly-grid').innerHTML = weekWindows(today).map(({ start, end }, index) => {
    const heading = index === 0 ? 'This week' : 'Next week';
    const services = model.weeks.filter(set => set.date >= start && set.date <= end);
    const dated = services.length ? services : [{ date: end, tracks: [] }];
    const count = dated.reduce((sum, set) => sum + set.tracks.length, 0);
    return `<section class="set-card" aria-labelledby="week-${index}">
      <div class="set-heading">
        <h2 id="week-${index}">${heading}</h2>
        ${count ? `<span class="set-count">${plural(count, 'song')}</span>` : ''}
      </div>
      ${dated.map(({ date, tracks }) => `
        <div class="set-service">
          <h3>${when(date, dateLong)}</h3>
          ${tracks.length ? `<ol class="set-tracks">${tracks.map(({ id, youtube }, i) => {
            const song = model.catalog.get(id);
            const link = song.changes?.youtube ?? (youtube || song.youtube);
            return `<li class="set-track">
              <span class="track-order" aria-hidden="true">${i + 1}</span>
              <button type="button" class="song-title-button" data-action="details" data-id="${escapeHtml(id)}">
                <span class="track-title">${escapeHtml(song.title)}</span>
                ${song.artist ? `<span class="track-artist">${escapeHtml(song.artist)}</span>` : ''}
              </button>
              ${link ? mediaLink({ ...song, youtube: link }) : ''}
            </li>`;
          }).join('')}</ol>` : `<p class="set-empty">${loading ? 'Loading setlist…' : 'No setlist published for this date.'}</p>`}
        </div>`).join('')}
    </section>`;
  }).join('');
}

function currentFilters() {
  return {
    ...Object.fromEntries(Object.entries(filterSelectors).map(([name, selector]) => [name, $(selector).value])),
    query: $('#search').value,
    sort: $('#sort').value,
  };
}

function renderBank() {
  const filters = currentFilters();
  const matches = filterCatalog(model.catalog, filters, today);
  const activeCount = Object.keys(filterSelectors).filter(name => filters[name]).length;
  const count = model.catalog.size;
  const pages = Math.max(1, Math.ceil(matches.length / pageSize));
  page = Math.min(page, pages);
  const start = (page - 1) * pageSize;
  const rows = matches.slice(start, start + pageSize);

  $('#bank-count').textContent = loading ? '' : plural(count, 'song');
  $('#filter-count').textContent = activeCount;
  $('#filter-count').hidden = !activeCount;
  $('#clear-filters').hidden = !activeCount;
  $('#song-table').hidden = !rows.length;
  $('#bank-empty').hidden = Boolean(rows.length);
  if (!rows.length) {
    let title = 'No songs match';
    let subtitle = 'Try a different search or clear the filters.';
    if (!count) {
      title = loading ? 'Loading songs…' : 'No songs available';
      subtitle = loading ? '' : 'Open Sheet sync to check the published songlist.';
    }
    $('#bank-empty').innerHTML = `<strong>${title}</strong>${subtitle ? `<p>${subtitle}</p>` : ''}`;
  }
  $('#song-table').innerHTML = `<li class="song-table-heading" aria-hidden="true">
    <span>Song</span><span>Tempo</span><span>Origin</span><span>Last played</span><span>YouTube</span>
  </li>` + rows.map(song => `<li class="song-row">
    <button type="button" class="song-title-button bank-song" data-action="details" data-id="${escapeHtml(song.id)}">
      <span class="track-title">${escapeHtml(song.title)}</span>
      <span class="track-artist">${escapeHtml(song.artist || 'Artist not listed')}</span>
    </button>
    <span class="song-tempo"><span class="sr-only">Tempo </span>${tempoTag(song.tempo)}</span>
    <span class="song-origin"><span class="sr-only">Origin </span>${groupTag(song.group)}</span>
    <span class="song-date">${song.lastPlayed ? `<span class="sr-only">Last played </span>${when(song.lastPlayed)}` : '<span class="pill pill-new">New song</span>'}</span>
    <span class="song-link">${mediaLink(song)}</span>
  </li>`).join('');

  $('#pagination').hidden = matches.length <= pageSize;
  $('#pagination').innerHTML = `<span>${start + 1}–${start + rows.length} of ${matches.length}</span>
    <div class="pagination-buttons">
      <button type="button" class="button button-outline" data-action="previous" ${page === 1 ? 'disabled' : ''}>Previous</button>
      <button type="button" class="button button-outline" data-action="next" ${page === pages ? 'disabled' : ''}>Next</button>
    </div>`;
  if (!loading) $('#results-status').textContent = plural(matches.length, 'song') + ' found';
}

function refreshModel() {
  model = buildCatalog(snapshot, storageState.edits, today);
  renderWeeks();
  renderBank();
}

function applySnapshot(value) {
  const changed = JSON.stringify(snapshot?.setlists) !== JSON.stringify(value.setlists);
  snapshot = value;
  loading = false;
  writeCache('sheet', value);
  if (changed) refreshModel();
  updateSyncPanel();
}

function updateSyncPanel() {
  if (drawerState?.kind !== 'sync') return;
  $('#sync-toggle').checked = autoSync;
  $('#sync-now').disabled = syncing;
  $('#sync-now').textContent = syncing ? 'Syncing…' : 'Sync now';
  $('#last-sync').textContent = snapshot ? syncDate.format(new Date(snapshot.fetchedAt)) : 'Waiting for first import';
  const status = $('#sync-status');
  status.classList.toggle('message-error', Boolean(importError));
  if (syncing) status.textContent = 'Reading the published year tabs…';
  else if (importError) status.textContent = snapshot ? 'Google Sheets could not be reached. Showing the last successful import.' : 'The published songlist could not be read. Try syncing again.';
  else status.textContent = '';
  status.hidden = !status.textContent;
}

async function syncSheet(manually = false) {
  if (syncing || (!manually && !autoSync)) return;
  lastAttempt = Date.now();
  syncing = true;
  importError = '';
  updateSyncPanel();
  try {
    const value = await fetchSpreadsheet(config);
    if (manually || autoSync) applySnapshot(value);
    if (manually) announce('Google Sheets import is up to date.');
  } catch (error) {
    importError = error.message;
    if (manually) announce('Could not sync with Google Sheets.');
  } finally {
    syncing = false;
    updateSyncPanel();
  }
}

const storageDescriptions = {
  unconfigured: 'Firebase setup is required to save songs. The spreadsheet and song bank are available to browse.',
  connecting: 'Connecting to the shared song bank…',
  connected: 'Songs and changes are shared across devices.',
  error: 'Firebase could not load shared edits. Check the project configuration and Firestore rules.',
};

function renderStorageStatus() {
  const labels = {
    unconfigured: 'Editing setup',
    connecting: 'Connecting to team storage',
    connected: 'Team storage',
    error: 'Team storage unavailable',
  };
  $('#storage-status').textContent = labels[storageState.status];
  if (drawerState?.kind === 'team') {
    $('#storage-description').textContent = storageDescriptions[storageState.status];
  }
  if (drawerState?.kind === 'form') {
    $('#storage-notice').textContent = storageState.status === 'connected' ? '' : storageDescriptions[storageState.status];
    $('#storage-notice').hidden = storageState.status === 'connected';
    $('#save-song').disabled = storageState.status !== 'connected' || $('#song-form').dataset.saving === 'true';
  }
}

const storage = createStorage(config, next => {
  const changed = JSON.stringify(next.edits) !== JSON.stringify(storageState.edits);
  storageState = next;
  if (changed) refreshModel();
  renderStorageStatus();
});

function announce(message) {
  clearTimeout(toastTimer);
  const toast = $('#toast');
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 3700);
}

function drawerLayout(title, body) {
  return `<div class="drawer-heading">
    <h2 id="drawer-title" tabindex="-1">${title}</h2>
    <button type="button" class="icon-button close-button" data-action="close" aria-label="Close panel">${icon('close')}</button>
  </div>${body}`;
}

function detailsContent(song) {
  const video = openVideo(song);
  const past = song.pastDates.map(date => `<li>${when(date)}</li>`).join('');
  const scheduled = song.upcomingDates.map(date => `<li>${when(date)}</li>`).join('');
  return drawerLayout(escapeHtml(song.title), `<p class="drawer-subtitle">${escapeHtml(song.artist || 'Artist not listed')}</p>
    <dl class="detail-grid">
      <div><dt>Tempo</dt><dd>${tempoTag(song.tempo)}</dd></div>
      <div><dt>Origin</dt><dd>${groupTag(song.group)}</dd></div>
      <div><dt>Last played</dt><dd>${song.lastPlayed ? when(song.lastPlayed) : 'New song'}</dd></div>
      <div><dt>Played</dt><dd>${song.pastDates.length} ${song.pastDates.length === 1 ? 'time' : 'times'}</dd></div>
    </dl>
    <div class="drawer-actions">
      <a class="button button-primary" href="${escapeHtml(video.url)}" target="_blank" rel="noopener noreferrer">${icon(video.direct ? 'play' : 'search')}${video.direct ? 'Watch on YouTube' : 'Find on YouTube'}</a>
      <button type="button" class="button button-outline" data-action="edit" data-id="${escapeHtml(song.id)}">Edit song</button>
    </div>
    ${scheduled ? `<section class="history-section"><h3>Upcoming setlists</h3><ul>${scheduled}</ul></section>` : ''}
    ${past ? `<section class="history-section"><h3>Play history</h3><ul>${past}</ul></section>` : ''}`);
}

function formContent(song) {
  return drawerLayout(song ? 'Edit song' : 'Add song', `<form id="song-form" class="song-form">
    <label>Song title <span class="required-label">Required</span>
      <input id="song-title" name="title" type="text" required maxlength="200" value="${escapeHtml(song?.title)}">
    </label>
    <label>Artist
      <input name="artist" type="text" maxlength="160" value="${escapeHtml(song?.artist)}">
    </label>
    <div class="form-grid">
      <label>Tempo
        <select class="select" name="tempo">
          ${Object.entries(tempoNames).reverse().map(([key, name]) => `<option value="${key}" ${key === (song?.tempo ?? '') ? 'selected' : ''}>${name}</option>`).join('')}
        </select>
      </label>
      <label>Origin
        <select class="select" name="group">
          ${Object.entries({ auto: 'From artist', gms: 'GMS', 'non-gms': 'Non GMS' }).map(([key, name]) => `<option value="${key}" ${key === (song?.groupChoice ?? 'auto') ? 'selected' : ''}>${name}</option>`).join('')}
        </select>
      </label>
    </div>
    <label>YouTube video link
      <input name="youtube" type="url" inputmode="url" maxlength="500" placeholder="https://youtu.be/…" value="${escapeHtml(song?.youtube)}">
    </label>
    <label class="password-field">Editor password <span class="required-label">Required</span>
      <input name="password" type="password" autocomplete="off" required maxlength="200">
    </label>
    <p class="form-notice" id="storage-notice" hidden></p>
    <p class="message-error" id="form-error" role="alert" hidden></p>
    <div class="drawer-actions">
      <button type="submit" id="save-song" class="button button-primary">Save song</button>
      <button type="button" class="button button-outline" data-action="close">Cancel</button>
    </div>
  </form>`);
}

function openDrawer(kind, id) {
  const song = id && model.catalog.get(id);
  if ((kind === 'details' || id) && !song) return;
  if (!drawer.open) returnFocus = document.activeElement;
  drawerState = { kind, song };
  if (kind === 'details') drawerContent.innerHTML = detailsContent(song);
  if (kind === 'form') {
    drawerContent.innerHTML = formContent(song);
    renderStorageStatus();
  }
  if (kind === 'sync') {
    drawerContent.innerHTML = drawerLayout('Sheet sync', `<p class="drawer-subtitle">Songlist Europe on Google Sheets</p>
      <div class="sync-setting">
        <div><label for="sync-toggle">Auto-sync</label><p>Check on open and every 15 minutes while this page is visible.</p></div>
        <input id="sync-toggle" class="switch" type="checkbox" role="switch">
      </div>
      <div class="sync-date"><span>Last successful import</span><strong id="last-sync"></strong></div>
      <p class="form-notice" id="sync-status" role="status" hidden></p>
      <div class="drawer-actions">
        <button type="button" id="sync-now" class="button button-primary" data-action="sync-now">Sync now</button>
        <a class="button button-outline" href="${escapeHtml(config.publishedSheet)}" target="_blank" rel="noopener noreferrer">Open Google Sheet</a>
      </div>`);
    updateSyncPanel();
  }
  if (kind === 'team') {
    drawerContent.innerHTML = drawerLayout('Team storage', `<p class="drawer-subtitle" id="storage-description">${storageDescriptions[storageState.status]}</p>
      <p class="form-notice">Adding a song or changing its details requires the editor password.</p>`);
  }
  if (!drawer.open) drawer.showModal();
  drawer.scrollTop = 0;
  (kind === 'form' ? $('#song-title') : $('#drawer-title')).focus({ preventScroll: true });
}

function closeDrawer() {
  if (!drawer.open || drawer.classList.contains('closing')) return;
  drawer.classList.add('closing');
  const close = () => {
    drawer.close();
    drawer.classList.remove('closing');
    drawerState = null;
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    else $('#bank-title').focus({ preventScroll: true });
  };
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) close();
  else setTimeout(close, 170);
}

async function saveSong(form) {
  if (form.dataset.saving === 'true') return;
  const errorText = $('#form-error');
  function fail(text) {
    errorText.textContent = text;
    errorText.hidden = false;
  }
  errorText.hidden = true;
  const values = new FormData(form);
  const clean = name => String(values.get(name) ?? '').trim();
  const title = clean('title');
  const artist = clean('artist');
  const rawLink = clean('youtube');
  const youtube = youtubeVideo(rawLink);
  if (!foldText(title)) return fail('Enter a song title with at least one letter or number.');
  if (rawLink && !youtube) return fail('Enter a YouTube video link.');
  const original = drawerState.song;
  const id = original?.id ?? songId(title, artist);
  if (!original && (model.catalog.has(id) ||
      (!artist && [...model.catalog.values()].some(song => foldText(song.title) === foldText(title))))) {
    return fail('A song with this title is already in the bank. Add an artist to distinguish another version, or edit the existing song.');
  }

  const fields = {};
  const formFields = { title, artist, tempo: clean('tempo'), group: clean('group'), youtube };
  if (original) {
    const current = { title: original.title, artist: original.artist, tempo: original.tempo, group: original.groupChoice, youtube: original.youtube };
    const source = { title: original.sourceTitle, artist: original.sourceArtist, youtube: original.sourceYoutube };
    for (const [name, value] of Object.entries(formFields)) {
      if (value !== current[name]) fields[name] = value === source[name] ? null : value;
    }
    if (!Object.keys(fields).length) return fail('Make a change before saving.');
  } else {
    Object.assign(fields, { tempo: formFields.tempo, group: formFields.group, youtube });
  }

  const saveButton = form.querySelector('[type="submit"]');
  form.dataset.saving = 'true';
  saveButton.disabled = true;
  saveButton.textContent = 'Saving…';
  form.elements.password.value = '';
  try {
    await storage.save(original ?? { id, sourceTitle: title, sourceArtist: artist, manual: true },
      fields, String(values.get('password') ?? ''), !original);
    if (drawerState?.kind === 'form' && form.isConnected) closeDrawer();
    announce(original ? 'Song updated.' : 'Song added to the bank.');
  } catch (error) {
    if (form.isConnected) fail(error.message);
    else announce(error.message);
  } finally {
    form.dataset.saving = 'false';
    saveButton.disabled = storageState.status !== 'connected';
    saveButton.textContent = 'Save song';
  }
}

function updateNav() {
  const location = window.location.hash === '#song-bank' ? '#song-bank' : '#overview';
  for (const link of document.querySelectorAll('.main-nav a')) {
    if (link.hash === location) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  }
}

document.querySelectorAll('[data-icon]').forEach(node => { node.innerHTML = icon(node.dataset.icon); });
$('#team-name').textContent = config.team;
document.title = 'Worship Song Bank · ' + config.team;
window.addEventListener('hashchange', updateNav);
updateNav();

function refilter() {
  page = 1;
  renderBank();
}

$('#search').addEventListener('input', refilter);
for (const selector of ['#sort', ...Object.values(filterSelectors)]) $(selector).addEventListener('change', refilter);
drawer.addEventListener('cancel', event => {
  event.preventDefault();
  closeDrawer();
});
drawer.addEventListener('click', event => {
  if (event.target === drawer) closeDrawer();
});
drawer.addEventListener('submit', event => {
  if (event.target.id !== 'song-form') return;
  event.preventDefault();
  void saveSong(event.target);
});
drawer.addEventListener('change', event => {
  if (event.target.id !== 'sync-toggle') return;
  autoSync = event.target.checked;
  writeCache('auto-sync', autoSync);
  if (autoSync) void syncSheet();
});
document.addEventListener('click', event => {
  const element = event.target.closest?.('[data-action]');
  if (!element) return;
  const { action, id } = element.dataset;
  switch (action) {
    case 'add': openDrawer('form'); break;
    case 'edit': openDrawer('form', id); break;
    case 'details': openDrawer('details', id); break;
    case 'sync-panel': openDrawer('sync'); break;
    case 'team-panel': openDrawer('team'); break;
    case 'close': closeDrawer(); break;
    case 'sync-now': void syncSheet(true); break;
    case 'filters': {
      const open = element.getAttribute('aria-expanded') === 'true';
      element.setAttribute('aria-expanded', String(!open));
      $('#filter-panel').classList.toggle('collapsed', open);
      $('#filter-panel-inner').inert = open;
      break;
    }
    case 'clear-filters':
      for (const selector of Object.values(filterSelectors)) $(selector).value = '';
      refilter();
      break;
    case 'previous':
    case 'next':
      page += action === 'next' ? 1 : -1;
      renderBank();
      $('#song-table').scrollIntoView({ block: 'start' });
      $('#song-table .song-title-button')?.focus({ preventScroll: true });
      break;
  }
});

function checkDateAndSync() {
  const localDate = todayInZone(config.timeZone);
  if (localDate !== today) {
    today = localDate;
    refreshModel();
  }
  if (!document.hidden && Date.now() - lastAttempt >= 15 * 60 * 1000) void syncSheet();
}

refreshModel();
void fetch(new URL('../data/songlists.json', import.meta.url))
  .then(response => {
    if (!response.ok) throw new Error('The initial songlist could not be loaded.');
    return response.json();
  })
  .then(validateSnapshot)
  .then(initial => {
    if (!snapshot || Date.parse(initial.fetchedAt) > Date.parse(snapshot.fetchedAt)) applySnapshot(initial);
  })
  .catch(() => {
    if (!snapshot) {
      loading = false;
      refreshModel();
    }
  });
void syncSheet();
window.setInterval(checkDateAndSync, 60_000);
document.addEventListener('visibilitychange', checkDateAndSync);
