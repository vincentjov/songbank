const PLACEHOLDER = /^(?:[-–—?]+|tbd|to be confirmed|no service|ikutin streaming surabaya \(songlist\))$/i;

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  const input = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (char === '"' && quoted && input[i + 1] === '"') {
      value += '"';
      i += 1;
    } else if (char === '"' && (quoted || !value)) {
      quoted = !quoted;
    } else if (!quoted && char === ',') {
      row.push(value.trim());
      value = '';
    } else if (!quoted && (char === '\n' || char === '\r')) {
      rows.push([...row, value.trim()]);
      row = [];
      value = '';
      if (char === '\r' && input[i + 1] === '\n') i += 1;
    } else {
      value += char;
    }
  }
  if (quoted) throw new Error('Google returned an incomplete CSV.');
  if (row.length || value) rows.push([...row, value.trim()]);
  return rows;
}

export function readDate(value) {
  const iso = value.match(/^(20\d{2})-(\d{1,2})-(\d{1,2})$/);
  const european = value.match(/^(\d{1,2})[./-](\d{1,2})[./-](20\d{2})\.?$/);
  if (!iso && !european) return '';
  const [year, month, day] = (iso ? iso.slice(1) : european.slice(1).reverse()).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
  return date.toISOString().slice(0, 10);
}

export function youtubeVideo(value) {
  try {
    const url = new URL(value.trim());
    if (!['https:', 'http:'].includes(url.protocol)) return '';
    const host = url.hostname.toLowerCase();
    let id;
    if (host === 'youtu.be') {
      id = url.pathname.split('/')[1];
    } else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(host)) {
      id = url.pathname === '/watch' ? url.searchParams.get('v') :
        url.pathname.match(/^\/(?:live|shorts|embed)\/([^/]+)\/?$/)?.[1];
    }
    return /^[A-Za-z0-9_-]{11}$/.test(id ?? '') ? 'https://www.youtube.com/watch?v=' + id : '';
  } catch {
    return '';
  }
}

function isDateLabel(value) {
  return ['date', 'dateno', 'datenr', 'datenumber'].includes(value.toLowerCase().replace(/[^a-z]/g, ''));
}

function parseTrack(value, link) {
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text || PLACEHOLDER.test(text) || /^https?:\/\//i.test(text)) return null;

  // Split on the last spaced dash, leaving hyphenated words and medley names intact.
  const separators = [...text.matchAll(/\s+[-–—]\s+/g)];
  const separator = separators.at(-1);
  const title = separator ? text.slice(0, separator.index).trim() : text;
  const artist = separator ? text.slice(separator.index + separator[0].length).trim() : '';
  if (!/[\p{L}\p{N}]/u.test(title)) return null;
  return { title, artist, youtube: youtubeVideo(link) };
}

export function parseYearTabs(csvFiles) {
  const setlists = new Map();
  for (const csv of csvFiles) {
    let blocks = [];
    for (const row of parseCsv(csv)) {
      const headers = [];
      for (let col = 1; col < row.length; col += 1) {
        if (!isDateLabel(row[col - 1])) continue;
        const date = readDate(row[col]);
        if (!date) continue;
        if (!setlists.has(date)) setlists.set(date, { date, tracks: [] });
        headers.push({ col, date, hasLinks: /^links?$/i.test(row[col + 1] ?? '') });
      }
      if (headers.length) {
        blocks = headers;
        continue;
      }
      if (!row.some(Boolean)) {
        blocks = [];
        continue;
      }
      for (const { col, date, hasLinks } of blocks) {
        if (!/^\d{1,2}\s*[.)]?$/.test(row[col - 1] ?? '')) continue;
        const track = parseTrack(row[col] ?? '', hasLinks ? row[col + 1] ?? '' : '');
        if (track) setlists.get(date).tracks.push({ ...track, number: Number.parseInt(row[col - 1], 10) });
      }
    }
  }
  return [...setlists.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function validateSnapshot(value) {
  if (value?.version !== 1 || !Number.isFinite(Date.parse(value.fetchedAt)) ||
      !Array.isArray(value.setlists) || !value.setlists.length ||
      !value.setlists.every(set => typeof set?.date === 'string' && readDate(set.date) === set.date &&
        Array.isArray(set.tracks) && set.tracks.every(track => typeof track?.title === 'string' &&
          /[\p{L}\p{N}]/u.test(track.title) && typeof track.artist === 'string' &&
          typeof track.youtube === 'string'))) {
    throw new Error('The songlist data could not be read.');
  }
  return value;
}

export function discoverYearTabs(html) {
  const entries = [...html.matchAll(/items\.push\(\{\s*name:\s*"(20\d{2})",[^}]*?\bgid:\s*"(\d+)"/g)];
  return Object.fromEntries(entries.map(([, year, gid]) => [year, gid]));
}

export async function fetchSpreadsheet(config, fetcher = fetch) {
  async function getText(url) {
    const response = await fetcher(url, {
      cache: 'no-store',
      credentials: 'omit',
      signal: AbortSignal.timeout(18000),
    });
    if (!response.ok) throw new Error('Google returned HTTP ' + response.status + '.');
    return response.text();
  }

  const published = new URL(config.publishedSheet);
  if (published.origin !== 'https://docs.google.com' || !/^\/spreadsheets\/d\/e\/[\w-]+\/pubhtml\/?$/.test(published.pathname)) {
    throw new Error('Use the published Google Sheets link ending in /pubhtml.');
  }
  const endpoint = new URL(published.pathname.replace(/\/pubhtml\/?$/, '/pub'), published);
  const discovered = await getText(published).then(discoverYearTabs).catch(() => ({}));
  const tabs = Object.entries(Object.keys(discovered).length ? discovered : config.yearTabs);
  if (!tabs.length) throw new Error('No published year tabs were found.');
  const csvFiles = await Promise.all(tabs.map(async ([year, gid]) => {
    const url = new URL(endpoint);
    url.search = new URLSearchParams({ gid, output: 'csv' });
    let csv;
    try {
      csv = await getText(url);
    } catch (error) {
      throw new Error('The ' + year + ' tab could not be read. ' + error.message, { cause: error });
    }
    if (/^\s*<(?:!doctype|html)/i.test(csv)) {
      throw new Error('The ' + year + ' tab did not return CSV data.');
    }
    return csv;
  }));

  const setlists = parseYearTabs(csvFiles);
  if (!setlists.some(set => set.tracks.length)) {
    throw new Error('No dated songs were found in the published year tabs.');
  }
  return validateSnapshot({ version: 1, fetchedAt: new Date().toISOString(), setlists });
}
