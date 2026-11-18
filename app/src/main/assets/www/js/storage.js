/* Musii – IndexedDB persistence for projects and audio samples */
(function (M) {
  'use strict';
  let dbp = null;

  function db() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error('no indexedDB')); return; }
      const req = indexedDB.open('musii', 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('projects')) d.createObjectStore('projects');
        if (!d.objectStoreNames.contains('samples')) d.createObjectStore('samples');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }

  function op(store, mode, fn) {
    return db().then((d) => new Promise((resolve, reject) => {
      const tx = d.transaction(store, mode);
      const st = tx.objectStore(store);
      const r = fn(st);
      tx.oncomplete = () => resolve(r && 'result' in r ? r.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    }));
  }

  M.Store = {
    saveProject: (key, project) => op('projects', 'readwrite', (s) => s.put({ key, savedAt: Date.now(), name: project.name, data: JSON.stringify(project) }, key)),
    loadProject: (key) => op('projects', 'readonly', (s) => s.get(key)).then((r) => (r ? JSON.parse(r.data) : null)),
    deleteProject: (key) => op('projects', 'readwrite', (s) => s.delete(key)),
    listProjects: () => db().then((d) => new Promise((resolve) => {
      const out = [];
      const tx = d.transaction('projects', 'readonly');
      const req = tx.objectStore('projects').openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (c) { if (c.key !== '__autosave__') out.push({ key: c.key, name: c.value.name, savedAt: c.value.savedAt }); c.continue(); }
        else resolve(out.sort((a, b) => b.savedAt - a.savedAt));
      };
      req.onerror = () => resolve(out);
    })),
    saveSample: (id, name, arrayBuffer) => op('samples', 'readwrite', (s) => s.put({ name, data: arrayBuffer }, id)),
    loadSample: (id) => op('samples', 'readonly', (s) => s.get(id)),
    hasSample: (id) => op('samples', 'readonly', (s) => s.count(id)).then((n) => n > 0)
  };

  /* ---------- decoded sample cache ---------- */
  const decoded = new Map();     // sampleId -> AudioBuffer
  const pending = new Map();     // sampleId -> Promise

  M.Samples = {
    get: (id) => decoded.get(id) || null,
    put: (id, buffer) => decoded.set(id, buffer),
    /** Loads and decodes a stored sample; resolves to AudioBuffer or null. */
    load(id, ctx) {
      if (!id) return Promise.resolve(null);
      if (decoded.has(id)) return Promise.resolve(decoded.get(id));
      if (pending.has(id)) return pending.get(id);
      const p = M.Store.loadSample(id).then((rec) => {
        if (!rec) return null;
        return ctx.decodeAudioData(rec.data.slice(0)).then((buf) => { decoded.set(id, buf); return buf; });
      }).catch(() => null).finally(() => pending.delete(id));
      pending.set(id, p);
      return p;
    },
    /** Stores raw file bytes and decodes them. Returns {id, buffer}. */
    async importBytes(name, arrayBuffer, ctx) {
      const buffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
      const id = 's_' + M.uid();
      await M.Store.saveSample(id, name, arrayBuffer);
      decoded.set(id, buffer);
      return { id, buffer };
    }
  };
})(window.M);
