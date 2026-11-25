import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiError } from './api';
import type { AppState, Arena, Asset, GenRequest, Job, Model, Pipeline, Task } from './types';

export type Page =
  | 'home'
  | 'image'
  | 'video'
  | 'edit'
  | 'avatar'
  | 'audio'
  | 'arena'
  | 'workflows'
  | 'characters'
  | 'library'
  | 'free'
  | 'connections';

export interface Handoff {
  image?: string;
  endImage?: string;
  video?: string;
  audio?: string;
  prompt?: string;
  tool?: string;
}

interface Toast {
  id: number;
  text: string;
  kind: 'ok' | 'err' | 'info';
}

interface Store {
  state: AppState | null;
  jobs: Job[];
  assets: Asset[];
  arenas: Arena[];
  pipelines: Pipeline[];
  page: Page;
  handoff: Handoff | null;
  needsAuth: boolean;
  go: (p: Page, h?: Handoff) => void;
  takeHandoff: () => Handoff | null;
  reload: () => Promise<void>;
  reloadAssets: () => Promise<void>;
  generate: (req: GenRequest) => Promise<Job | undefined>;
  toast: (text: string, kind?: Toast['kind']) => void;
  toasts: Toast[];
  modelsFor: (task: Task) => Model[];
  modelById: (id?: string) => Model | undefined;
  assetById: (id?: string) => Asset | undefined;
  setNeedsAuth: (v: boolean) => void;
  queueOpen: boolean;
  setQueueOpen: (v: boolean) => void;
}

const Ctx = createContext<Store | null>(null);

function pageFromHash(): Page {
  const h = location.hash.replace(/^#\/?/, '') as Page;
  const valid: Page[] = ['home', 'image', 'video', 'edit', 'avatar', 'audio', 'arena', 'workflows', 'characters', 'library', 'free', 'connections'];
  return valid.includes(h) ? h : 'home';
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [arenas, setArenas] = useState<Arena[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [page, setPage] = useState<Page>(pageFromHash());
  const [needsAuth, setNeedsAuth] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [queueOpen, setQueueOpen] = useState(false);
  const handoffRef = useRef<Handoff | null>(null);
  const [handoff, setHandoff] = useState<Handoff | null>(null);

  const toast = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'err' ? 7000 : 3500);
  }, []);

  const reload = useCallback(async () => {
    try {
      const s = await api<AppState>('/state');
      setState(s);
      setNeedsAuth(false);
    } catch (e) {
      if (e instanceof ApiError && e.auth) setNeedsAuth(true);
      else throw e;
    }
  }, []);

  const reloadAssets = useCallback(async () => {
    setAssets(await api<Asset[]>('/assets'));
  }, []);

  useEffect(() => {
    let es: EventSource | null = null;
    (async () => {
      try {
        await reload();
        const [j, a, ar, p] = await Promise.all([api<Job[]>('/jobs?limit=300'), api<Asset[]>('/assets'), api<Arena[]>('/arenas'), api<Pipeline[]>('/pipelines')]);
        setJobs(j);
        setAssets(a);
        setArenas(ar);
        setPipelines(p);
      } catch (e) {
        if (!(e instanceof ApiError && e.auth)) toast((e as Error).message, 'err');
        return;
      }
      es = new EventSource('/api/events');
      es.addEventListener('job', (ev) => {
        const job = JSON.parse((ev as MessageEvent).data) as Job;
        setJobs((list) => {
          const i = list.findIndex((x) => x.id === job.id);
          if (i === -1) return [job, ...list];
          const next = list.slice();
          next[i] = job;
          return next;
        });
      });
      es.addEventListener('asset', (ev) => {
        const a = JSON.parse((ev as MessageEvent).data) as Asset;
        setAssets((list) => (list.some((x) => x.id === a.id) ? list : [a, ...list]));
      });
      es.addEventListener('arena', (ev) => {
        const a = JSON.parse((ev as MessageEvent).data) as Arena;
        setArenas((list) => [a, ...list.filter((x) => x.id !== a.id)]);
      });
      es.addEventListener('pipeline', (ev) => {
        const p = JSON.parse((ev as MessageEvent).data) as Pipeline;
        setPipelines((list) => [p, ...list.filter((x) => x.id !== p.id)]);
      });
    })();
    const onHash = () => setPage(pageFromHash());
    window.addEventListener('hashchange', onHash);
    return () => {
      es?.close();
      window.removeEventListener('hashchange', onHash);
    };
  }, [needsAuth === false ? 0 : 1]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = useCallback((p: Page, h?: Handoff) => {
    handoffRef.current = h || null;
    setHandoff(h || null);
    if (location.hash !== `#/${p}`) location.hash = `#/${p}`;
    setPage(p);
    window.scrollTo({ top: 0 });
  }, []);

  const takeHandoff = useCallback(() => {
    const h = handoffRef.current;
    handoffRef.current = null;
    return h;
  }, []);

  const generate = useCallback(
    async (req: GenRequest) => {
      try {
        const job = await api<Job>('/generate', { body: req });
        setJobs((list) => (list.some((x) => x.id === job.id) ? list : [job, ...list]));
        return job;
      } catch (e) {
        toast((e as Error).message, 'err');
        return undefined;
      }
    },
    [toast],
  );

  const value = useMemo<Store>(
    () => ({
      state,
      jobs,
      assets,
      arenas,
      pipelines,
      page,
      handoff,
      needsAuth,
      go,
      takeHandoff,
      reload,
      reloadAssets,
      generate,
      toast,
      toasts,
      modelsFor: (task: Task) =>
        (state?.models || []).filter((m) => m.task === task).sort((a, b) => Number(b.available) - Number(a.available) || b.quality - a.quality),
      modelById: (id?: string) => (id ? state?.models.find((m) => m.id === id) : undefined),
      assetById: (id?: string) => (id ? assets.find((a) => a.id === id) : undefined),
      setNeedsAuth,
      queueOpen,
      setQueueOpen,
    }),
    [state, jobs, assets, arenas, pipelines, page, handoff, needsAuth, go, takeHandoff, reload, reloadAssets, generate, toast, toasts, queueOpen],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('StoreProvider fehlt');
  return s;
}
