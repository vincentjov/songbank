# Worship Song Bank

A minimalist song bank for the GMS Europe worship team. It opens directly for visitors. The shared editor password is required for each song addition or change.

## Use the song bank

- **Overview** shows this week and next week in Europe/Berlin time. Each card uses the published service date. An empty week shows the Sunday date.
- **Song bank** searches song titles and artists. Combine tempo, origin, played status, and last-played filters. Sort by recently played, longest since played, or title.
- **Song details** include last played, play history, upcoming setlists, and a YouTube video link where available. Find on YouTube opens a search for the song and artist when there is no saved link.
- **Add song** and **Edit song** let editors set the title, artist, tempo, origin, and YouTube link.
- **Sheet sync** reads the published yearly tabs directly. Auto-sync checks when the page opens and every 15 minutes while it is visible. Sync now requests a fresh import at any time. The site uses the most recent successful import if the sheet becomes unavailable.

The initial import includes the 2025, 2026, and 2027 tabs. Keep the Google Sheet published with automatic republishing enabled. Monthly additions in the same workbook appear on the next sync. Use a four-digit year for a new tab and keep the existing `Date /No.` and numbered-row layout.

Imported tempos start unclassified. GMS, GMS Live Kidz, AOG Worship, Army of God and Army of God Worship are inferred from available artist credits. Editors can override the classification. A dated set counts toward play history on its service date. “2 months ago or earlier” uses two calendar months, and “New song” means the sheet has no play on or before today.

The Sheet supplies the schedule and play dates. Firestore stores songs added on the site and edits to song metadata. Sheet imports preserve those edits.

## Preview locally

From the extracted project folder, run:

```sh
python -m http.server 8000 --directory site
```

Open `http://localhost:8000`. Browsing, searching, and Sheet sync work immediately. Turn on shared editing with the Firebase setup below.

## Enable password-protected editing

1. In the [Firebase Console](https://console.firebase.google.com/), create or select a Firebase project. Register a web app and copy the web configuration object into `site/config.js` as the value of `firebase`. Use the values shown in the web app configuration.
2. In **Authentication → Sign-in method**, enable **Email/Password**. In **Authentication → Users**, add one editor account with the address in `site/config.js` (default `editor@songbank.example`) and the shared editor password you chose. Enter the password in Firebase. Keep it out of project files and GitHub. Copy the account’s **User UID**.
3. Create a Cloud Firestore database. In **Firestore Database → Rules**, paste and publish the included `firestore.rules`. If using an existing project, merge the two song bank collections into its rules and preserve any unrelated rules.
4. In **Firestore Database → Data**, create the collection `songbankSettings`, with a document named `editor`. Add a string field named `uid` containing the editor account’s User UID. The `songbankSongs` collection appears on the first successful save.
5. In **Authentication → Settings → Authorized domains**, add your GitHub Pages host, such as `YOUR_ACCOUNT.github.io`. Add `localhost` if you want to test from there.

The password field verifies the one Firebase editor account for the current save. Visitors and team members use the site without creating accounts. Firestore rules allow public reads of the song catalog and restrict writes to the editor UID. The editor session stays in memory and ends after the save. The sheet and all song fields are visible to anyone who can open the site.

## Publish on GitHub Pages

1. Create a GitHub repository with `main` as its default branch. Extract this ZIP and commit the full project folder contents, including `.github/workflows/pages.yml`.
2. Open the repository’s **Settings → Pages**. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. In the **Actions** tab, run **Deploy song bank**. Later pushes to `main` deploy automatically. The successful run lists the Pages URL.

Only the `site/` directory is published by the workflow. Its local asset paths also work when Pages serves the project under a repository subpath.

## Refresh the bundled import

The site reads Google Sheets in the browser, so routine monthly updates do not require a redeploy. To rebuild the bundled snapshot that visitors see before the live import returns, run `npm run refresh-sheet` with Node.js 22 or newer and commit `site/data/songlists.json`.
