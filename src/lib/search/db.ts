import { base } from '$app/paths';

export type { Entry, SearchOpts } from './worker';

export class SearchDB {
  private worker: Worker;
  private ready: Promise<void>;

  constructor() {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.ready = new Promise((resolve, reject) => {
      const handleMessage = (ev: MessageEvent) => {
        if (ev.data?.type === 'init:ok') {
          this.worker.removeEventListener('message', handleMessage);
          resolve();
        } else if (ev.data?.type === 'error') {
          this.worker.removeEventListener('message', handleMessage);
          reject(new Error(ev.data.message));
        }
      };
      this.worker.addEventListener('message', handleMessage);
      this.worker.postMessage({ type: 'init', basePath: base });
    });
  }

  async init() { 
    await this.ready; 
  }

  async search(q: string, opts?: import('./worker').SearchOpts): Promise<import('./worker').Entry[]> {
    await this.ready;
    return new Promise((resolve, reject) => {
      const listener = (ev: MessageEvent) => {
        const d = ev.data;
        if (d?.type === 'search:ok') {
          this.worker.removeEventListener('message', listener);
          resolve(d.results);
        } else if (d?.type === 'error') {
          this.worker.removeEventListener('message', listener);
          reject(new Error(d.message));
        }
      };
      this.worker.addEventListener('message', listener);
      this.worker.postMessage({ type: 'search', q, opts });
    });
  }

  async getEntry(idOrKey: string | number): Promise<import('./worker').Entry | null> {
    await this.ready;
    return new Promise((resolve, reject) => {
      const listener = (ev: MessageEvent) => {
        const d = ev.data;
        if (d?.type === 'get:ok') {
          this.worker.removeEventListener('message', listener);
          resolve(d.entry);
        } else if (d?.type === 'error') {
          this.worker.removeEventListener('message', listener);
          reject(new Error(d.message));
        }
      };
      this.worker.addEventListener('message', listener);
      this.worker.postMessage({ type: 'get', idOrKey });
    });
  }

  destroy() {
    this.worker.terminate();
  }
}