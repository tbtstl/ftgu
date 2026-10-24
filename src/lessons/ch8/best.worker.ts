// Finds the best 8.6 portfolio for a design off the main thread, reporting progress as it goes.

import type { CapstoneDesign } from './capstone';
import { bestSearch } from './strategy';

interface Request {
  key: string;
  design: CapstoneDesign;
}

self.onmessage = (e: MessageEvent<Request>) => {
  const { key, design } = e.data;
  const s = bestSearch(design);
  self.postMessage({ key, type: 'progress', tried: 0, total: s.total });
  while (!s.step()) self.postMessage({ key, type: 'progress', tried: s.tried, total: s.total });
  self.postMessage({ key, type: 'done', best: s.best, tried: s.tried, total: s.total, valid: s.valid });
};
