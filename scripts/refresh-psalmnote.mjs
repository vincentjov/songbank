import { readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { load } from 'cheerio';
import robotsParser from 'robots-parser';
import { foldText } from '../site/assets/catalog.js';
import { artistCredits, artistNames, psalmnoteKey } from '../site/assets/psalmnote.js';

const origin = 'https://www.psalmnote.com';
const userAgent = 'WorshipSongBank';
const cachePath = 'site/data/psalmnote.json';
const entries = {
  'breakthrough|gms live': { tempo: 'upbeat' },
  'i thank god|maverick city music': { tempo: 'upbeat' },
  ...JSON.parse(await readFile(cachePath, 'utf8').catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return '{}';
  })),
};

const snapshot = JSON.parse(await readFile('site/data/songlists.json', 'utf8'));
const credits = new Map();
for (const { tracks } of snapshot.setlists) {
  for (const { title, artist } of tracks) {
    for (const credit of artistCredits(artist)) {
      credits.set(psalmnoteKey(title, credit), [title, credit]);
    }
  }
}

const slug = value => foldText(value).replaceAll(' ', '-');
const request = url => fetch(url, {
  headers: { 'User-Agent': userAgent },
  signal: AbortSignal.timeout(8000),
  redirect: 'manual',
});

function field($, label) {
  const markers = $('body *').filter((_, node) => $(node).text().trim() === label);
  for (const node of markers.toArray().reverse()) {
    const value = $(node).next().text().trim();
    if (value) return value;
  }
  return '';
}

try {
  const robotsUrl = origin + '/robots.txt';
  const policy = await request(robotsUrl);
  if (!policy.ok && policy.status !== 404) {
    throw new Error('Psalmnote robots.txt returned HTTP ' + policy.status);
  }
  const robots = robotsParser(robotsUrl, policy.ok ? await policy.text() : '');
  let remaining = 240;

  for (const [key, [title, artist]] of credits) {
    if (entries[key]?.tempo || entries[key]?.retryAfter > Date.now()) continue;

    const urls = new Set(artistNames(artist)
      .map(name => origin + '/song/' + slug(title) + '-chords-' + slug(name)));

    for (const url of urls) {
      if (!remaining || robots.isAllowed(url, userAgent) === false) continue;
      remaining -= 1;
      await delay(600);

      const response = await request(url);
      const { status } = response;
      if (status === 404 || status === 410 || (status >= 300 && status < 400)) continue;
      if (!response.ok) throw new Error('Psalmnote returned HTTP ' + status);

      const $ = load(await response.text());
      const pageTitle = $('h1').first().text().trim();
      if (psalmnoteKey(pageTitle, field($, 'Artist')) !== key) continue;

      const type = field($, 'Song type').toLowerCase().split(/\s/)[0];
      if (type === 'upbeat' || type === 'slowbeat') {
        entries[key] = { tempo: type, url };
        break;
      }
    }

    if (!entries[key]?.tempo && remaining) {
      entries[key] = { retryAfter: Date.now() + 7 * 86400000 };
    }
    if (!remaining) break;
  }
} catch (error) {
  console.warn('Psalmnote lookup paused: ' + error.message);
}

await writeFile(cachePath, JSON.stringify(entries, null, 2) + '\n');
console.log('Psalmnote tags available:', Object.values(entries).filter(entry => entry.tempo).length);
