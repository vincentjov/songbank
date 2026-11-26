import { foldText } from './catalog.js';

const aliases = {
  'maverick city': ['Maverick City Music', 'Maverick City'],
  'maverick city music': ['Maverick City Music', 'Maverick City'],
  hillsong: ['Hillsong Worship', 'Hillsong'],
  'hillsong worship': ['Hillsong Worship', 'Hillsong'],
  'aog worship': ['Army of God Worship', 'Army of God', 'AOG Worship'],
  'army of god': ['Army of God Worship', 'Army of God', 'AOG Worship'],
  'army of god worship': ['Army of God Worship', 'Army of God', 'AOG Worship'],
};

export function artistCredits(text) {
  return text.split(/\s*[,;]\s*/).map(name => name.trim()).filter(Boolean);
}

export function artistNames(artist) {
  return aliases[foldText(artist)] ?? [artist];
}

export function psalmnoteKey(title, artist) {
  return foldText(title) + '|' + foldText(artistNames(artist)[0]);
}

export function applyPsalmnoteTempos(catalog, entries) {
  for (const song of catalog.values()) {
    if (song.tempo || song.changes?.tempo === '') continue;
    const matches = new Set(artistCredits(song.artist)
      .map(artist => entries[psalmnoteKey(song.sourceTitle, artist)]?.tempo)
      .filter(tempo => tempo === 'upbeat' || tempo === 'slowbeat'));
    if (matches.size === 1) song.tempo = matches.values().next().value;
  }
}
