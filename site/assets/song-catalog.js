import { foldText } from './catalog.js';

export function tracksFromSnapshot(snapshot) {
  return Array.isArray(snapshot?.setlists) ?
    snapshot.setlists.flatMap(set => Array.isArray(set?.tracks) ? set.tracks : []) : [];
}

export function mergeSongCatalog(...collections) {
  const tracks = new Map();
  for (const collection of collections) {
    if (!Array.isArray(collection)) continue;
    for (const track of collection) {
      if (typeof track?.title !== 'string' || typeof track.artist !== 'string' ||
          typeof track.youtube !== 'string') continue;
      const title = foldText(track.title);
      if (!title) continue;
      const key = title + '~' + foldText(track.artist);
      const existing = tracks.get(key);
      if (!existing || (!existing.youtube && track.youtube)) {
        tracks.set(key, {
          title: existing?.title ?? track.title,
          artist: existing?.artist ?? track.artist,
          youtube: track.youtube,
        });
      }
    }
  }
  return [...tracks.values()];
}
