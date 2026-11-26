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

export function songId(title) {
  return foldText(title);
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

function oneEditApart(a, b) {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  if (a.length > b.length) [a, b] = [b, a];
  let i = 0;
  while (i < a.length && a[i] === b[i]) i += 1;
  if (a.length !== b.length) return a.slice(i) === b.slice(i + 1);
  return a.slice(i + 1) === b.slice(i + 1) ||
    (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
}

function isTitleTypo(a, b) {
  if (Math.min(a.length, b.length) < 8 || a === b) return false;
  if (a.replaceAll(' ', '') === b.replaceAll(' ', '')) return true;

  const words = a.split(' ');
  const other = b.split(' ');
  if (words.length !== other.length) return false;

  const differences = words.map((word, index) => index)
    .filter(index => words[index] !== other[index]);
  if (differences.length !== 1) return false;

  const i = differences[0];
  const shorter = Math.min(words[i].length, other[i].length);
  const sameLength = words[i].length === other[i].length;
  const minimum = words.length === 1 ? 8 : sameLength ? 5 : 4;
  return shorter >= minimum && oneEditApart(words[i], other[i]);
}

export function findSongId(title, catalog) {
  const key = songId(title);
  const candidates = [...catalog.values()];
  const exact = candidates.find(song => song.titleKeys.has(key) || songId(song.title) === key);
  if (exact) return exact.id;
  const similar = candidates.filter(song => isTitleTypo(song.id, key));
  return similar.length === 1 ? similar[0].id : undefined;
}

function combineArtists(credits) {
  const names = credits.flatMap(credit =>
    credit.split(/\s*[,;]\s*|\s+(?:\/|\+|feat\.?|ft\.?|featuring)\s+/i));
  const keyOf = name => artistKey(name).replace(/^maverick city music$/, 'maverick city');
  const preferred = new Map([
    ['maverick city', 'Maverick City'],
    ['elevation worship', 'Elevation Worship'],
  ]);
  const known = new Set([...preferred.keys(), ...names.map(keyOf)]);
  const entries = new Map();

  for (const name of names.flatMap(name => {
    const parts = name.split(/\s+(?:&|and)\s+/i);
    return parts.every(part => known.has(keyOf(part))) ? parts : [name];
  })) {
    const key = keyOf(name);
    if (!key || entries.has(key)) continue;
    const nearby = [...entries.keys()].find(other =>
      Math.min(other.length, key.length) >= 8 && oneEditApart(other, key));
    if (!nearby || preferred.has(key)) {
      entries.set(nearby ?? key, preferred.get(key) ?? name.trim());
    }
  }

  return [...entries.values()].join(', ');
}

export function buildCatalog(snapshot, edits, today) {
  const setlists = snapshot?.setlists ?? [];
  const titles = new Map();
  const catalog = new Map();
  const byTitle = new Map();

  function recordTitle(title, playCount) {
    const key = songId(title);
    if (!titles.has(key)) titles.set(key, { title, playCount: 0 });
    titles.get(key).playCount += playCount;
  }

  for (const { tracks } of setlists) {
    for (const track of tracks) recordTitle(track.title, 1);
  }
  for (const edit of edits) recordTitle(edit.sourceTitle, 0);

  const variants = [...titles].sort(([keyA, a], [keyB, b]) =>
    b.playCount - a.playCount || keyB.length - keyA.length || keyA.localeCompare(keyB));
  for (const [key, { title }] of variants) {
    const candidates = [...catalog.values()].filter(song => isTitleTypo(song.id, key));
    const song = candidates.length === 1 ? candidates[0] : {
      id: key, sourceTitle: title, sourceYoutube: '', titleKeys: new Set(),
      dates: new Set(), credits: [], changes: {}, manual: false,
    };
    catalog.set(song.id, song);
    song.titleKeys.add(key);
    byTitle.set(key, song);
  }

  const timestamp = edit => edit.updatedAt?.toMillis?.() ?? 0;
  const orderedEdits = [...edits].sort((a, b) =>
    timestamp(a) - timestamp(b) || a.id.localeCompare(b.id));
  const legacyKey = (title, artist) => songId(title) + '~' + artistKey(artist);
  const legacyArtistEdits = new Map();
  for (const edit of orderedEdits) {
    if (edit.id.includes('~') && Object.hasOwn(edit, 'artist')) {
      legacyArtistEdits.set(legacyKey(edit.sourceTitle, edit.sourceArtist), edit.artist);
    }
  }

  const weeks = setlists.map(({ date, tracks }) => ({
    date,
    tracks: tracks.map(track => {
      const song = byTitle.get(songId(track.title));
      const artist = legacyArtistEdits.get(legacyKey(track.title, track.artist)) ?? track.artist;
      song.dates.add(date);
      song.credits.push(artist);
      if (track.youtube) song.sourceYoutube = track.youtube;
      return { id: song.id, artist, youtube: track.youtube };
    }),
  }));

  for (const edit of orderedEdits) {
    const song = byTitle.get(songId(edit.sourceTitle));
    const legacy = edit.id.includes('~');
    if (legacy || edit.manual || !song.dates.size) {
      song.credits.push((legacy ? edit.artist : null) ?? edit.sourceArtist);
    }
    if (edit.manual && !song.dates.size) song.manual = true;
    for (const field of ['title', 'artist', 'tempo', 'group', 'youtube']) {
      if ((field !== 'artist' || !legacy) && Object.hasOwn(edit, field)) {
        song.changes[field] = edit[field];
      }
    }
  }

  for (const song of catalog.values()) {
    const dates = [...song.dates].sort();
    song.pastDates = dates.filter(date => date <= today).reverse();
    song.upcomingDates = dates.filter(date => date > today);
    song.lastPlayed = song.pastDates[0] ?? '';
    song.sourceArtist = combineArtists(song.credits);
    song.title = song.changes.title ?? song.sourceTitle;
    song.artist = song.changes.artist ?? song.sourceArtist;
    song.tempo = song.changes.tempo ?? '';
    song.groupChoice = song.changes.group ?? 'auto';
    song.group = song.groupChoice === 'auto' ? inferGroup(song.artist) : song.groupChoice;
    song.youtube = song.changes.youtube ?? song.sourceYoutube;
  }

  return { catalog, weeks };
}

export function filterCatalog(catalog, filters, today) {
  const terms = foldText(filters.query).split(' ').filter(Boolean);
  const cutoff = twoMonthsBefore(today);
  const result = [...catalog.values()].filter(song => {
    const searchable = foldText([song.title, song.artist, song.sourceTitle, song.sourceArtist, ...song.titleKeys].join(' '));
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
