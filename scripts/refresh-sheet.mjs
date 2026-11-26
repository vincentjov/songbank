import { writeFile } from 'node:fs/promises';
import { config } from '../site/config.js';
import { fetchSpreadsheet } from '../site/assets/sheets.js';

const snapshot = await fetchSpreadsheet(config);
await writeFile(new URL('../site/data/songlists.json', import.meta.url), JSON.stringify(snapshot, null, 2) + '\n');
const nonempty = snapshot.setlists.filter(setlist => setlist.tracks.length);
const entries = nonempty.reduce((total, setlist) => total + setlist.tracks.length, 0);
console.log('Imported ' + entries + ' song entries across ' + nonempty.length + ' dated setlists.');
