import { mergeSongCatalog, tracksFromSnapshot } from './song-catalog.js';

const prefix = 'worship-songbank:' + new URL('../', import.meta.url).pathname + ':';

export function readCache(name, fallback) {
  try {
    return JSON.parse(localStorage.getItem(prefix + name)) ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeCache(name, value) {
  try {
    localStorage.setItem(prefix + name, JSON.stringify(value));
  } catch {
    // A denied or full browser cache should not stop spreadsheet browsing.
  }
}

export function rememberSongs(...collections) {
  const saved = readCache('song-catalog', []);
  const merged = mergeSongCatalog(saved, ...collections);
  if (JSON.stringify(saved) !== JSON.stringify(merged)) writeCache('song-catalog', merged);
  return merged;
}

export function cacheSheet(snapshot, remembered) {
  const tracks = rememberSongs(remembered, tracksFromSnapshot(readCache('sheet', null)), tracksFromSnapshot(snapshot));
  writeCache('sheet', snapshot);
  return tracks;
}

export function createStorage(config, publish) {
  const { firebase, editorEmail } = config;
  if (!firebase) {
    publish({ status: 'unconfigured', edits: [] });
    return { save: async () => { throw new Error('Firebase editing needs to be set up first.'); } };
  }

  const cdn = 'https://www.gstatic.com/firebasejs/13.4.0/';
  let connection;
  let pendingSave = false;
  let edits = [];
  let status = 'connecting';
  let editing = false;

  function update(nextStatus = status) {
    status = nextStatus;
    publish({ status, edits, editing });
  }

  function updateEditor(user) {
    editing = Boolean(user?.email && user.email.toLowerCase() === editorEmail.toLowerCase());
    update();
  }

  update();

  void (async () => {
    try {
      const [{ initializeApp }, auth, db] = await Promise.all([
        import(cdn + 'firebase-app.js'),
        import(cdn + 'firebase-auth.js'),
        import(cdn + 'firebase-firestore.js'),
      ]);
      const app = initializeApp(firebase);
      const authentication = auth.initializeAuth(app, { persistence: auth.browserSessionPersistence });
      const database = db.getFirestore(app);
      connection = { auth, db, authentication, database };
      auth.onAuthStateChanged(authentication, updateEditor);

      db.onSnapshot(db.collection(database, 'songbankSongs'), { includeMetadataChanges: true }, snapshot => {
        if (snapshot.metadata.hasPendingWrites) return;
        edits = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
        update(snapshot.metadata.fromCache ? 'connecting' : 'connected');
      }, () => update('error'));
    } catch {
      update('error');
    }
  })();

  return {
    async unlock(password) {
      if (!connection) throw new Error('Team storage is still connecting.');
      const { auth, authentication } = connection;
      try {
        const { user } = await auth.signInWithEmailAndPassword(authentication, editorEmail, password);
        updateEditor(user);
      } catch (error) {
        const invalid = ['auth/invalid-credential', 'auth/wrong-password', 'auth/invalid-login-credentials'];
        if (invalid.includes(error.code)) throw new Error('The editor password was not accepted.');
        if (error.code === 'auth/too-many-requests') throw new Error('Too many attempts. Try again later.');
        throw new Error('Could not unlock editing. Check your connection and Firebase Authentication.');
      }
    },
    async lock() {
      if (pendingSave) throw new Error('Wait for the current save to finish.');
      const { auth, authentication } = connection;
      await auth.signOut(authentication);
      updateEditor(null);
    },
    async save({ id, sourceTitle, sourceArtist, manual }, fields, create) {
      if (!editing) throw new Error('Unlock editing before saving.');
      if (!connection) throw new Error('Firebase is still connecting. Try again shortly.');
      if (pendingSave) throw new Error('A save is already in progress.');
      pendingSave = true;
      const { db, database } = connection;
      try {
        const ref = db.doc(database, 'songbankSongs', id);
        const record = { sourceTitle, sourceArtist: sourceArtist.slice(0, 160), manual, ...fields, updatedAt: db.serverTimestamp() };

        await db.runTransaction(database, async transaction => {
          const existing = await transaction.get(ref);
          if (create && existing.exists()) throw new Error('This song is already in the song bank.');
          transaction.set(ref, record, { merge: true });
        });
      } catch (error) {
        const messages = {
          'auth/invalid-credential': 'The editor password was not accepted.',
          'auth/wrong-password': 'The editor password was not accepted.',
          'auth/user-not-found': 'The Firebase editor account could not be found.',
          'auth/too-many-requests': 'Too many password attempts. Try again later.',
          'auth/network-request-failed': 'Firebase could not be reached. Check your connection and try again.',
          'auth/operation-not-allowed': 'Email/password authentication needs to be enabled in Firebase.',
          'permission-denied': 'Firebase denied the save. Check the editor UID and published rules.',
          unavailable: 'Firebase could not be reached. Try again when you’re online.',
        };
        if (messages[error.code]) throw new Error(messages[error.code], { cause: error });
        if (!error.code) throw error;
        throw new Error('The song could not be saved. Try again shortly.', { cause: error });
      } finally {
        pendingSave = false;
      }
    },
  };
}
