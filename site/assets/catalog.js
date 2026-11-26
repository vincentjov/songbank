const ARTIST_ALIASES = new Map([
  ['aog worship', 'army of god worship'],
  ['army of god', 'army of god worship'],
  ['gms liv', 'gms live'],
  ['hillsong worship', 'hillsong'],
  ['planet shakers', 'planetshakers'],
]);

export function foldText(value = '') {
  return value.normalize('NFKD').toLowerCase().replace(/\p{M}/gu, '')
    .replace(/['’‘]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function artistKey(value) {
  const key = foldText(value).replace(/ version$/, '');
  return ARTIST_ALIASES.get(key) ?? key;
}

export function songId(title, artist) {
  return foldText(title) + '~' + artistKey(artist);
}

function inferGroup(artist) {
  const key = artistKey(artist);
  if (!key) return 'unknown';
  return /\b(?:gms|aog|army of god)\b/.test(key) ? 'gms' : 'non-gms';
}

export function todayInZone(timeZone, now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).map(({ type, value }) => [type, value]));
  return [parts.year, parts.month, parts.day].join('-');
}

const asDate = iso => new Date(iso + 'T00:00:00Z');
const asIso = date => date.toISOString().slice(0, 10);

function addDays(iso, days) {
  const date = asDate(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return asIso(date);
}

export function weekWindows(today) {
  const offset = (asDate(today).getUTCDay() + 6) % 7;
  const monday = addDays(today, -offset);
  return [0, 7].map(days => ({
    start: addDays(monday, days), end: addDays(monday, days + 6),
  }));
}

export function twoMonthsBefore(today) {
  const date = asDate(today);
  const originalDay = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - 2);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(originalDay, lastDay));
  return asIso(date);
}

export function buildCatalog(snapshot, edits, today) {
  const catalog = new Map();
  const credits = new Map();
  const setlists = snapshot?.setlists ?? [];

  function noteCredit(title, artist) {
    if (!artistKey(artist)) return;
    const key = foldText(title);
    if (!credits.has(key)) credits.set(key, new Set());
    credits.get(key).add(songId(title, artist));
  }

  for (const { tracks } of setlists) {
    for (const track of tracks) noteCredit(track.title, track.artist);
  }
  for (const edit of edits) noteCredit(edit.sourceTitle, edit.sourceArtist);

  function identify(title, artist) {
    const candidates = credits.get(foldText(title));
    if (!artistKey(artist) && candidates?.size === 1) return [...candidates][0];
    return songId(title, artist);
  }

  function baseSong(id, title, artist) {
    if (!catalog.has(id)) {
      catalog.set(id, { id, sourceTitle: title, sourceArtist: artist, sourceYoutube: '', dates: new Set(), manual: false });
    }
    return catalog.get(id);
  }

  const weeks = setlists.map(({ date, tracks }) => ({
    date,
    tracks: tracks.map(track => {
      const id = identify(track.title, track.artist);
      const song = baseSong(id, track.title, track.artist);
      if (track.artist) song.sourceArtist = track.artist;
      if (track.youtube) song.sourceYoutube = track.youtube;
      song.dates.add(date);
      return { id, youtube: track.youtube };
    }),
  }));

  const exactEdits = [];
  for (const edit of edits) {
    const id = edit.manual ? edit.id : identify(edit.sourceTitle, edit.sourceArtist);
    const song = baseSong(id, edit.sourceTitle, edit.sourceArtist);
    if (id === edit.id) {
      exactEdits.push([song, edit]);
    } else {
      song.changes = { ...song.changes, ...edit };
    }
  }
  for (const [song, edit] of exactEdits) {
    song.changes = { ...song.changes, ...edit };
    song.manual = edit.manual;
  }

  for (const song of catalog.values()) {
    const editsForSong = song.changes ?? {};
    const dates = [...song.dates].sort();
    song.pastDates = dates.filter(date => date <= today).reverse();
    song.upcomingDates = dates.filter(date => date > today);
    song.lastPlayed = song.pastDates[0] ?? '';
    song.title = editsForSong.title ?? song.sourceTitle;
    song.artist = editsForSong.artist ?? song.sourceArtist;
    song.tempo = editsForSong.tempo ?? '';
    song.groupChoice = editsForSong.group ?? 'auto';
    song.group = song.groupChoice === 'auto' ? inferGroup(song.artist) : song.groupChoice;
    song.youtube = editsForSong.youtube ?? song.sourceYoutube;
  }
  return { catalog, weeks };
}

export function filterCatalog(catalog, filters, today) {
  const terms = foldText(filters.query).split(' ').filter(Boolean);
  const cutoff = twoMonthsBefore(today);
  const result = [...catalog.values()].filter(song => {
    const searchable = foldText([song.title, song.artist, song.sourceTitle, song.sourceArtist].join(' '));
    return terms.every(term => searchable.includes(term)) &&
      (!filters.tempo || (song.tempo || 'untagged') === filters.tempo) &&
      (!filters.group || song.group === filters.group) &&
      (!filters.history || Boolean(song.lastPlayed) === (filters.history === 'played')) &&
      (!filters.age || (song.lastPlayed && song.lastPlayed <= cutoff));
  });
  const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
  return result.sort((a, b) => {
    const alphabetic = () => collator.compare(a.title, b.title) || collator.compare(a.artist, b.artist);
    if (filters.sort === 'title') return alphabetic();
    if (!a.lastPlayed || !b.lastPlayed) {
      return Number(!a.lastPlayed) - Number(!b.lastPlayed) || alphabetic();
    }
    const dates = a.lastPlayed.localeCompare(b.lastPlayed);
    return (filters.sort === 'oldest' ? dates : -dates) || alphabetic();
  });
}
