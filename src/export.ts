import viewer from '../.generated/viewer.js?raw';
import type { Capsule } from './shared/types';
import { capsuleFileName } from './shared/filenames';

export function createOfflineHtml(capsule: Capsule) {
  const data = JSON.stringify(capsule).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
  return `<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src blob: data:; media-src blob:; connect-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'"><meta name="referrer" content="no-referrer"><title>KEEPY · 우리의 타임캡슐</title></head><body><div id="app"></div><script id="capsule" type="application/json">${data}</script><script>${viewer.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
}

export function downloadCapsule(capsule: Capsule) {
  const url = URL.createObjectURL(new Blob([createOfflineHtml(capsule)], { type: 'text/html;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = capsuleFileName(capsule);
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
