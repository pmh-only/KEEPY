import styles from '../src/styles.css?inline';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { decryptMessage, restoreRoot, unb64 } from '../src/shared/crypto';
import { decodeKeyQR, encodeKeyQR } from '../src/shared/qr';
import { capsuleFileName } from '../src/shared/filenames';
import { decodeWords, encodeWords } from '../src/shared/words';
import type { Capsule } from '../src/shared/types';
import { syncViewport } from '../src/shared/viewport';

syncViewport();

const capsule: Capsule = JSON.parse(document.getElementById('capsule')!.textContent!);
const app = document.getElementById('app')!;
const style = document.createElement('style');
style.textContent = styles + `
  [hidden] { display: none !important; }
  .offline-input { width: 100%; height: 170px; max-height: 34dvh; min-height: 70px; resize: none; border: 1px solid #e3e8da; border-radius: 8px; outline: none; background: #f7f9f2; padding: 12px; font: 11px/1.8 ui-monospace, monospace; }
  .key-display { width: 100%; height: min(240px, 34dvh); display: flex; align-items: flex-start; justify-content: center; }
  .key-display canvas { max-width: 100%; max-height: 100%; width: auto; height: 100%; aspect-ratio: 1; object-fit: contain; }
  .key-display textarea { height: 100%; max-height: 100%; }
  .qr-actions, .scan-actions { display: flex; gap: 8px; margin-top: 12px; flex-shrink: 0; }
  .qr-actions .button, .scan-actions .button { flex: 1; padding: 8px; min-height: 38px; font-size: 10px; }
  .camera-frame { position: relative; width: 100%; height: 170px; max-height: 34dvh; min-height: 70px; overflow: hidden; border-radius: 8px; background: #263322; }
  .camera-frame video { width: 100%; height: 100%; object-fit: cover; }
  .camera-frame .icon-button { position: absolute; top: 6px; right: 6px; color: white; background: #263322aa; }
  .offline-count { color: #7a9365; font-size: 12px; margin: 0 0 18px; }
  .key-people { display: flex; flex-wrap: wrap; gap: 6px; list-style: none; padding: 0; margin: 16px 0 0; }
  .key-people li { font-size: 9px; color: #a7b19c; padding: 5px 8px; border-radius: 5px; background: #edf1e5; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .key-people li.collected { color: #6c8858; background: #e4edda; }
  .offline-meta { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .letter-switcher { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-shrink: 0; margin-bottom: 18px; }
  .letter-switcher h2 { font-size: 14px; font-weight: 500; margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .letter-switcher > div { display: flex; gap: 4px; }
  .message-view { flex: 1; min-height: 0; white-space: pre-wrap; overflow-wrap: anywhere; overflow: hidden; font-size: 14px; line-height: 28px; color: #637456; }
  .message-view.locked { color: #a1ae91; font-size: 12px; }
  .page-count { flex-shrink: 0; text-align: right; color: #a7b49a; font-size: 9px; margin: 14px 0 0; }
  #gate { gap: 16px; }
  #gate p { line-height: 1.9; margin: 0; }
  #gate .panel-note { font-size: 10px; }
  .own-qr-button { display: inline-flex; align-items: center; gap: 6px; padding: 9px 0 9px 10px; border: 0; background: transparent; font-size: 11px; color: #7d9569; }
  .own-qr-dialog { width: calc(100% - 48px); max-width: 360px; max-height: calc(100dvh - 48px); margin: auto; padding: 24px; border: 0; border-radius: 14px; background: #f5f5ef; color: inherit; }
  .own-qr-dialog::backdrop { background: #29352b66; }
  .own-qr-dialog[open] { animation: page-enter 200ms ease-out; }
  .own-qr-heading { display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px; }
  .own-qr-heading h2 { margin: 0; font-size: 16px; font-weight: 500; }
  .own-qr-dialog canvas { display: block; width: min(100%, 34dvh); height: auto; aspect-ratio: 1; margin-inline: auto; }
  .own-qr-dialog .panel-note { text-align: center; margin-block: 14px; }
  @media (max-height: 620px) {
    .offline-input { height: 125px; }
    .camera-frame { height: 125px; }
    .key-people { gap: 4px; margin-top: 12px; }
    .key-people li { padding: 3px 6px; font-size: 8px; }
    .offline-count { margin-bottom: 13px; }
    #key-people, #collect-panel > .panel-note { display: none; }
  }
`;
document.head.append(style);

const icons = {
  sprout: '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22v-9M8 22h8M12 17C5 17 3 13 3 8c6 0 9 3 9 9ZM12 13c0-7 4-10 10-10 0 6-3 10-10 10Z"/></svg>',
  back: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m12 19-7-7 7-7M5 12h14"/></svg>',
  next: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m12 5 7 7-7 7M5 12h14"/></svg>',
  qr: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="3" width="6" height="6" rx="1"/><rect x="3" y="15" width="6" height="6" rx="1"/><path d="M15 15h3v3h3M15 21h3M21 15v-3M3 12h3M12 3v3M12 12h3M12 18v3"/></svg>',
};

app.innerHTML = `<div id="root"><div class="app-frame">
  <header class="app-header"><span class="logo">${icons.sprout}keepy<span>.</span></span><button id="show-own-qr" class="own-qr-button" aria-haspopup="dialog">${icons.qr} 내 QR</button></header>
  <main class="screen">
    <div class="step-progress" aria-label="진행 단계"><span></span><span></span><span></span><small id="step-count"></small></div>
    <div class="screen-title"><h1 id="title"></h1><p id="meta" class="offline-meta"></p></div>
    <div id="notice" class="notice-banner" role="status" hidden><span id="notice-text"></span><button id="dismiss" class="icon-button" aria-label="알림 닫기">×</button></div>
    <section id="gate" class="screen-panel centered" hidden><div class="capsule-symbol">${icons.sprout}</div><p id="gate-message"></p><p class="panel-note">날짜 제한은 우회할 수 있으나 최소 개봉 인원이 동의해야만 열 수 있습니다.</p></section>
    <section id="share-panel" class="screen-panel" hidden>
      <label id="key-label" for="own-keys">나의 열쇠 QR</label>
      <div class="key-display"><canvas id="key-qr" role="img" aria-label="내 열쇠 QR"></canvas><textarea id="own-keys" class="offline-input" readonly aria-label="내 열쇠 단어" hidden></textarea></div>
      <div class="qr-actions"><button id="copy" class="button secondary">열쇠 복사</button><button id="save-qr" class="button secondary">QR 저장</button><button id="toggle-words" class="button secondary">단어로 보기</button></div>
      <p class="panel-note">QR 하나에 내 열쇠가 모두 담겨요. 신뢰하는 참여자에게만 보여 주세요.</p>
    </section>
    <section id="collect-panel" class="screen-panel" hidden>
      <p id="count" class="offline-count"></p><label for="keys">친구에게 받은 열쇠</label>
      <textarea id="keys" class="offline-input" placeholder="QR로 추가하거나, 받은 단어를 붙여 넣으세요." autocomplete="off" spellcheck="false"></textarea>
      <div id="camera-frame" class="camera-frame" hidden><video id="camera" playsinline muted autoplay aria-label="열쇠 QR 스캔 카메라"></video><button id="stop-camera" class="icon-button" aria-label="카메라 닫기">×</button></div>
      <div class="scan-actions"><button id="scan-qr" class="button secondary">카메라로 읽기</button><button id="load-qr" class="button secondary">QR 사진 불러오기</button></div><input id="qr-image" type="file" accept="image/*" hidden>
      <ul id="key-people" class="key-people" aria-label="모인 열쇠"></ul>
      <p class="panel-note">내 열쇠는 자동으로 포함돼요. 추가 열쇠는 나중에도 넣을 수 있어요.</p>
    </section>
    <section id="read-panel" class="screen-panel" hidden>
      <div class="letter-switcher"><h2 id="author"></h2><div><button id="previous-letter" class="icon-button" aria-label="이전 편지">‹</button><button id="next-letter" class="icon-button" aria-label="다음 편지">›</button></div></div>
      <div id="messages" class="message-view" aria-live="polite"></div><p id="page-count" class="page-count"></p>
    </section>
    <div id="share-actions" class="screen-bottom" hidden><button id="collect" class="button primary wide">다음: 열쇠 모으기 ${icons.next}</button><p class="bottom-note">인터넷 없이도 이 파일에서 열 수 있습니다.</p></div>
    <div id="collect-actions" class="screen-bottom" hidden><div class="step-actions"><button id="back-share" class="button back-button" aria-label="이전 단계">${icons.back}</button><button id="open" class="button primary wide">열쇠 추가하고 열기 ${icons.next}</button></div><p class="bottom-note">작성자 보호 편지는 해당 작성자의 추가 열쇠도 필요해요.</p></div>
    <div id="read-actions" class="screen-bottom" hidden><div class="step-actions"><button id="back-read" class="button back-button" aria-label="이전 페이지 또는 열쇠 모으기">${icons.back}</button><button id="read-next" class="button primary wide"><span id="read-next-label"></span>${icons.next}</button></div><p class="bottom-note">파일과 열쇠를 잃으면 다시 받을 수 없습니다.</p></div>
  </main>
  <dialog id="own-qr-dialog" class="own-qr-dialog" aria-labelledby="own-qr-title"><div class="own-qr-heading"><h2 id="own-qr-title">내 QR</h2><button id="close-own-qr" class="icon-button" aria-label="내 QR 닫기">×</button></div><canvas id="own-qr-preview" role="img" aria-label="내 열쇠 QR"></canvas><p class="panel-note">개봉에 필요한 내 열쇠입니다.<br>신뢰하는 참여자에게만 공유하세요.</p><button id="save-own-qr" class="button secondary wide">QR 저장</button></dialog>
</div></div>`;

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id)! as T;
const name = (id: string) => capsule.people.find(person => person.id === id)?.name ?? '알 수 없는 참여자';
const shares = new Map<string, Uint8Array>();
const authors = new Map<string, Uint8Array>();
type Step = 'share' | 'collect' | 'read';
type Letter = { author: string; text: string; locked: boolean };
let step: Step = 'share';
let initialized = false;
let lastLocked: boolean | undefined;
let letters: Letter[] = [];
let letterIndex = 0;
let pageStarts = [0];
let pageIndex = 0;
let nextStart = 0;
let characters: string[] = [];
let cameraStream: MediaStream | undefined;
let cameraFrame = 0;
let cameraGeneration = 0;

function notify(message: string, error = false) {
  byId('notice-text').textContent = message;
  byId('notice').classList.toggle('error-banner', error);
  byId('notice').hidden = false;
}

function updateCount() {
  byId('count').textContent = `모인 개봉 열쇠 ${shares.size} / ${capsule.settings.threshold}개`;
  const people = byId('key-people');
  people.replaceChildren();
  for (const person of capsule.people) {
    const item = document.createElement('li');
    item.textContent = `${person.name}${shares.has(person.id) ? ' ✓' : ''}`;
    item.classList.toggle('collected', shares.has(person.id));
    people.append(item);
  }
}

function showStep(next: Step) {
  if (next !== 'collect') stopCamera();
  step = next;
  byId('notice').hidden = true;
  const order: Step[] = ['share', 'collect', 'read'];
  for (const item of order) {
    byId(`${item}-panel`).hidden = item !== next;
    byId(`${item}-actions`).hidden = item !== next;
  }
  const index = order.indexOf(next);
  document.querySelectorAll('.step-progress > span').forEach((element, i) => element.classList.toggle('active', i <= index));
  byId('step-count').textContent = `${index + 1} / 3`;
  byId('title').textContent = { share: '내 열쇠 공유', collect: '열쇠 모으기', read: '메시지 확인' }[next];
  byId('meta').textContent = next === 'share'
    ? `${name(capsule.self)}님의 캡슐 · ${capsule.settings.title}`
    : next === 'collect' ? `전체 ${capsule.people.length}명 중 ${capsule.settings.threshold}명의 열쇠가 필요합니다.` : capsule.settings.title;
  const heading = byId('title').parentElement!;
  heading.style.animation = 'none';
  requestAnimationFrame(() => { heading.style.animation = ''; });
  if (next === 'read') requestAnimationFrame(renderPage);
}

async function initialize() {
  if (initialized) return;
  shares.set(capsule.self, unb64(capsule.share));
  if (capsule.authorSecret) authors.set(capsule.self, unb64(capsule.authorSecret));
  const own = [await encodeWords('share', capsule.id, capsule.self, unb64(capsule.share))];
  if (capsule.authorSecret) own.push(await encodeWords('author', capsule.id, capsule.self, unb64(capsule.authorSecret)));
  byId<HTMLTextAreaElement>('own-keys').value = own.join('\n');
  await QRCode.toCanvas(byId<HTMLCanvasElement>('key-qr'), encodeKeyQR(capsule), {
    width: 480, margin: 4, errorCorrectionLevel: 'M',
    color: { dark: '#29352b', light: '#ffffff' },
  });
  initialized = true;
  updateCount();
}

async function gate() {
  const locked = !!capsule.settings.opensAt && Date.now() < Date.parse(capsule.settings.opensAt);
  if (locked === lastLocked) return;
  lastLocked = locked;
  byId('gate').hidden = !locked;
  if (locked) {
    stopCamera();
    byId<HTMLDialogElement>('own-qr-dialog').close();
    for (const item of ['share', 'collect', 'read']) {
      byId(`${item}-panel`).hidden = true;
      byId(`${item}-actions`).hidden = true;
    }
    byId('notice').hidden = true;
    byId('title').textContent = '개봉 예정일 대기';
    byId('meta').textContent = capsule.settings.title;
    byId('step-count').textContent = '대기 중';
    byId('gate-message').textContent = `${new Date(capsule.settings.opensAt).toLocaleString('ko-KR')}에 열기로 약속했어요. 아직 열쇠는 숨겨 둘게요.`;
  } else {
    await initialize();
    showStep(step);
  }
}

function showLetter(index: number) {
  letterIndex = index;
  pageStarts = [0];
  pageIndex = 0;
  characters = Array.from(letters[index].text);
  requestAnimationFrame(renderPage);
}

function renderPage() {
  if (step !== 'read' || !letters.length || byId('read-panel').hidden) return;
  const letter = letters[letterIndex];
  const body = byId('messages');
  byId('author').textContent = `${name(letter.author)}님의 메시지`;
  byId<HTMLButtonElement>('previous-letter').disabled = letterIndex === 0;
  byId<HTMLButtonElement>('next-letter').disabled = letterIndex === letters.length - 1;
  body.classList.toggle('locked', letter.locked);
  const start = pageStarts[pageIndex];
  let low = 0;
  let high = characters.length - start;
  // Measure the actual space so long messages and explicit newlines also fit
  // on short phones. The page itself never has to grow to show a long letter.
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    body.textContent = characters.slice(start, start + middle).join('');
    if (body.scrollHeight <= body.clientHeight + 1) low = middle;
    else high = middle - 1;
  }
  nextStart = Math.min(characters.length, start + Math.max(1, low));
  body.textContent = characters.slice(start, nextStart).join('');
  byId('page-count').textContent = `편지 ${letterIndex + 1} / ${letters.length} · ${pageIndex + 1}쪽`;
  byId('read-next-label').textContent = nextStart < characters.length ? '다음 페이지' : letter.locked ? '작성자 열쇠 추가' : letterIndex < letters.length - 1 ? '다음 편지' : '열쇠 더 모으기';
}

byId('dismiss').onclick = () => { byId('notice').hidden = true; };
byId('show-own-qr').onclick = () => {
  if (lastLocked) { notify('개봉 예정일 전에는 내 QR을 볼 수 없습니다.'); return; }
  if (!initialized) { notify('QR을 준비 중입니다. 잠시 후 다시 시도하세요.'); return; }
  stopCamera();
  const source = byId<HTMLCanvasElement>('key-qr');
  const preview = byId<HTMLCanvasElement>('own-qr-preview');
  preview.width = source.width;
  preview.height = source.height;
  preview.getContext('2d')!.drawImage(source, 0, 0);
  byId('own-qr-dialog').querySelector('.panel-note')!.textContent = capsule.authorSecret
    ? '캡슐과 내 메시지를 여는 열쇠입니다. 신뢰하는 참여자에게만 공유하세요.'
    : '캡슐을 여는 내 열쇠입니다. 신뢰하는 참여자에게만 공유하세요.';
  byId<HTMLDialogElement>('own-qr-dialog').showModal();
};
byId('close-own-qr').onclick = () => byId<HTMLDialogElement>('own-qr-dialog').close();
byId('save-own-qr').onclick = () => byId<HTMLButtonElement>('save-qr').click();
byId('collect').onclick = () => showStep('collect');
byId('back-share').onclick = () => showStep('share');
byId('copy').onclick = async () => {
  const input = byId<HTMLTextAreaElement>('own-keys');
  try { await navigator.clipboard.writeText(input.value); notify('열쇠를 복사했어요. 함께 개봉할 사람에게 보내 주세요.'); }
  catch { showWords(true); input.focus(); input.select(); notify('단어를 선택했습니다. 직접 복사하세요.'); }
};

function showWords(show: boolean) {
  byId('own-keys').hidden = !show;
  byId('key-qr').hidden = show;
  byId('key-label').textContent = show ? '내 열쇠 단어' : '내 열쇠 QR';
  byId('toggle-words').textContent = show ? 'QR로 보기' : '단어로 보기';
}
byId('toggle-words').onclick = () => showWords(byId('own-keys').hidden === true);
byId('save-qr').onclick = () => {
  byId<HTMLCanvasElement>('key-qr').toBlob(blob => {
    if (!blob) { notify('QR 이미지를 저장하지 못했습니다.', true); return; }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = capsuleFileName(capsule, 'qr');
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  });
};

async function receiveQR(value: string) {
  stopCamera();
  try {
    const words = await decodeKeyQR(value, capsule);
    byId<HTMLTextAreaElement>('keys').value = words;
    byId<HTMLButtonElement>('open').click();
  } catch (error) { notify(error instanceof Error ? error.message : 'QR을 읽지 못했습니다.', true); }
}

function decodeImage(source: CanvasImageSource, width: number, height: number) {
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, 1600 / Math.max(width, height));
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('이 기기에서는 사진을 읽을 수 없습니다.');
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  return jsQR(image.data, image.width, image.height, { inversionAttempts: 'attemptBoth' })?.data;
}

byId('load-qr').onclick = () => { stopCamera(); byId<HTMLInputElement>('qr-image').click(); };
byId('qr-image').onchange = async () => {
  const input = byId<HTMLInputElement>('qr-image');
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  if (file.size > 20 * 1024 * 1024) { notify('20MB 이하의 QR 이미지를 선택해 주세요.', true); return; }
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('사진을 열지 못했습니다. 다른 사진을 선택하세요.'));
      image.src = url;
    });
    const value = decodeImage(image, image.naturalWidth, image.naturalHeight);
    if (!value) throw new Error('QR을 찾지 못했습니다. QR이 크게 나온 선명한 이미지를 선택해 주세요.');
    await receiveQR(value);
  } catch (error) { notify(error instanceof Error ? error.message : 'QR 이미지를 읽지 못했습니다.', true); }
  finally { URL.revokeObjectURL(url); }
};

function stopCamera() {
  cameraGeneration++;
  cancelAnimationFrame(cameraFrame);
  cameraStream?.getTracks().forEach(track => track.stop());
  cameraStream = undefined;
  byId<HTMLVideoElement>('camera').srcObject = null;
  byId('camera-frame').hidden = true;
  byId('keys').hidden = false;
  byId<HTMLButtonElement>('scan-qr').disabled = false;
}

byId('scan-qr').onclick = async () => {
  stopCamera();
  const generation = cameraGeneration;
  byId<HTMLButtonElement>('scan-qr').disabled = true;
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera unavailable');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 960 }, height: { ideal: 720 } } });
    if (generation !== cameraGeneration || step !== 'collect' || document.hidden) { stream.getTracks().forEach(track => track.stop()); return; }
    cameraStream = stream;
    const video = byId<HTMLVideoElement>('camera');
    video.srcObject = stream;
    byId('keys').hidden = true;
    byId('camera-frame').hidden = false;
    await video.play();
    if (generation !== cameraGeneration) return;
    let previousScan = 0;
    const scan = (time: number) => {
      if (generation !== cameraGeneration) return;
      if (time - previousScan > 250 && video.readyState >= 2) {
        previousScan = time;
        try {
          const value = decodeImage(video, video.videoWidth, video.videoHeight);
          if (value) { void receiveQR(value); return; }
        } catch { stopCamera(); notify('카메라를 읽지 못했습니다. QR 이미지를 불러와 주세요.', true); return; }
      }
      cameraFrame = requestAnimationFrame(scan);
    };
    cameraFrame = requestAnimationFrame(scan);
  } catch {
    if (generation !== cameraGeneration) return;
    stopCamera();
    notify('카메라를 사용할 수 없어요. 권한을 허용하거나 QR 이미지를 불러와 주세요.', true);
  }
};
byId('stop-camera').onclick = stopCamera;
window.addEventListener('pagehide', stopCamera);
document.addEventListener('visibilitychange', () => { if (document.hidden) stopCamera(); });

byId('open').onclick = async () => {
  const button = byId<HTMLButtonElement>('open');
  button.disabled = true;
  byId('notice').hidden = true;
  let root: Uint8Array | undefined;
  try {
    if (capsule.settings.opensAt && Date.now() < Date.parse(capsule.settings.opensAt)) throw new Error('아직 개봉 예정일 전입니다.');
    const input = byId<HTMLTextAreaElement>('keys');
    const parsed = await Promise.all(input.value.split(/\n+/).map(line => line.trim()).filter(Boolean).map(decodeWords));
    const nextShares = new Map(shares);
    const nextAuthors = new Map(authors);
    for (const key of parsed) {
      if (key.capsule !== capsule.id) throw new Error('다른 타임캡슐의 열쇠입니다.');
      if (!capsule.people.some(person => person.id === key.person)) throw new Error('이 방의 참여자가 아닌 사람의 열쇠입니다.');
      const map = key.type === 'share' ? nextShares : nextAuthors;
      const existing = map.get(key.person);
      if (existing && (existing.length !== key.payload.length || existing.some((byte, i) => byte !== key.payload[i]))) throw new Error(`${name(key.person)}님의 기존 열쇠와 다릅니다. 단어를 확인하세요.`);
      map.set(key.person, key.payload);
    }
    for (const [id, key] of nextShares) shares.set(id, key);
    for (const [id, key] of nextAuthors) authors.set(id, key);
    input.value = '';
    updateCount();
    root = await restoreRoot([...shares.values()], capsule.settings.threshold);
    const opened: Letter[] = [];
    for (const message of capsule.messages) {
      const locked = capsule.settings.requireAuthor && !authors.has(message.author);
      if (locked) opened.push({ author: message.author, locked, text: '아직 잠겨 있어요. 작성자의 추가 열쇠를 기다리고 있어요.' });
      else {
        try { opened.push({ author: message.author, locked: false, text: await decryptMessage(capsule, message, root, authors.get(message.author)) }); }
        catch { throw new Error('메시지를 열지 못했습니다. 열쇠가 다르거나 파일이 손상되었을 수 있습니다.'); }
      }
    }
    if (!opened.length) throw new Error('이 파일에 보관된 편지가 없습니다.');
    letters = opened;
    showStep('read');
    showLetter(0);
  } catch (error) {
    notify(error instanceof Error ? error.message : '파일을 열지 못했습니다.', true);
  } finally {
    root?.fill(0);
    button.disabled = false;
  }
};

byId('previous-letter').onclick = () => { if (letterIndex > 0) showLetter(letterIndex - 1); };
byId('next-letter').onclick = () => { if (letterIndex < letters.length - 1) showLetter(letterIndex + 1); };
byId('back-read').onclick = () => {
  if (pageIndex > 0) { pageIndex--; renderPage(); }
  else showStep('collect');
};
byId('read-next').onclick = () => {
  if (nextStart < characters.length) {
    pageStarts[++pageIndex] = nextStart;
    renderPage();
  } else if (letters[letterIndex].locked || letterIndex === letters.length - 1) showStep('collect');
  else showLetter(letterIndex + 1);
};
window.addEventListener('resize', () => { if (step === 'read' && letters.length) showLetter(letterIndex); });

function fatal(message: string) {
  byId('gate').hidden = false;
  byId('title').textContent = '파일을 열지 못했어요';
  byId('gate-message').textContent = message;
}

if (capsule.format !== 'keepy' || capsule.version !== 1) fatal('이 캡슐 파일은 열 수 없습니다. 원본 파일을 다시 확인하세요.');
else if (!crypto.subtle) fatal('이 기기에서는 캡슐을 열 수 없습니다. 다른 인터넷 앱에서 파일을 열어 보세요.');
else {
  void gate().catch(() => fatal('파일에 담긴 열쇠를 읽지 못했습니다.'));
  setInterval(() => { void gate().catch(() => fatal('파일을 열지 못했습니다.')); }, 1000);
}
