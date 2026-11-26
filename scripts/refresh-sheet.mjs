import { readFile, writeFile } from 'node:fs/promises';
import { config } from '../site/config.js';
import { fetchSpreadsheet, validateSnapshot } from '../site/assets/sheets.js';
import { mergeSongCatalog, tracksFromSnapshot } from '../site/assets/song-catalog.js';

const snapshotPath = new URL('../site/data/songlists.json', import.meta.url);
const catalogPath = new URL('../site/data/song-catalog.json', import.meta.url);
const readJson = path => readFile(path, 'utf8').then(JSON.parse).catch(error => {
  if (error.code !== 'ENOENT') throw error;
  return null;
});
const [saved, previous] = await Promise.all([readJson(catalogPath), readJson(snapshotPath)]);
let published;
if (!saved && process.env.SONGBANK_PUBLISHED_SNAPSHOT) {
  try {
    const response = await fetch(process.env.SONGBANK_PUBLISHED_SNAPSHOT, {
      signal: AbortSignal.timeout(8000),
    });
    if (response.ok) published = validateSnapshot(await response.json());
  } catch {
    console.warn('Could not read the previous Pages snapshot. Using the bundled songlist.');
  }
}
const catalog = mergeSongCatalog(saved, tracksFromSnapshot(previous), tracksFromSnapshot(published));
const saveCatalog = tracks => writeFile(catalogPath, JSON.stringify(tracks, null, 2) + '\n');
await saveCatalog(catalog);
const snapshot = await fetchSpreadsheet(config);
await saveCatalog(mergeSongCatalog(catalog, tracksFromSnapshot(snapshot)));
await writeFile(snapshotPath, JSON.stringify(snapshot, null, 2) + '\n');
const nonempty = snapshot.setlists.filter(setlist => setlist.tracks.length);
const entries = nonempty.reduce((total, setlist) => total + setlist.tracks.length, 0);
console.log('Imported ' + entries + ' song entries across ' + nonempty.length + ' dated setlists.');
