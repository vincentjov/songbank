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
  publish({ status: 'connecting', edits });

  void (async () => {
    try {
      const [{ initializeApp }, auth, db] = await Promise.all([
        import(cdn + 'firebase-app.js'),
        import(cdn + 'firebase-auth.js'),
        import(cdn + 'firebase-firestore.js'),
      ]);
      const app = initializeApp(firebase);
      const authentication = auth.initializeAuth(app, { persistence: auth.inMemoryPersistence });
      const database = db.getFirestore(app);
      connection = { auth, db, authentication, database };

      db.onSnapshot(db.collection(database, 'songbankSongs'), { includeMetadataChanges: true }, snapshot => {
        if (snapshot.metadata.hasPendingWrites) return;
        edits = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
        publish({ status: snapshot.metadata.fromCache ? 'connecting' : 'connected', edits });
      }, () => publish({ status: 'error', edits }));
    } catch {
      publish({ status: 'error', edits });
    }
  })();

  return {
    async save({ id, sourceTitle, sourceArtist, manual }, fields, password, create) {
      if (!connection) throw new Error('Firebase is still connecting. Try again shortly.');
      if (pendingSave) throw new Error('A save is already in progress.');
      pendingSave = true;
      const { auth, db, authentication, database } = connection;
      let authenticated = false;
      try {
        await auth.signInWithEmailAndPassword(authentication, editorEmail, password);
        authenticated = true;
        const ref = db.doc(database, 'songbankSongs', id);
        const record = { sourceTitle, sourceArtist, manual, ...fields, updatedAt: db.serverTimestamp() };

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
        try {
          if (authenticated) await auth.signOut(authentication);
        } finally {
          pendingSave = false;
        }
      }
    },
  };
}
