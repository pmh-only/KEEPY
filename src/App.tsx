import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Camera, Check, Copy, Download, Heart, ImagePlus, Link2, LoaderCircle, LockKeyhole, Mail, Plus, QrCode, ShieldCheck, Sprout, Users, X } from 'lucide-react';
import { Session } from './session';
import { createRoomCode, parseRoomCode } from './transport';
import { downloadCapsule } from './export';
import { defaults, type Member, type Settings } from './shared/types';

type Entry = { code: string; name: string; create: boolean };
const settingSteps = ['template', 'title', 'threshold', 'visibility', 'author', 'date'] as const;
type SettingStep = typeof settingSteps[number];
type Step = 'people' | SettingStep | 'write' | 'wait';
const steps: Step[] = ['people', ...settingSteps, 'write', 'wait'];
const stepNames = ['참여자', '빠른 설정', '캡슐 이름', '개봉 인원', '공개 범위', '작성자 참여', '개봉일', '메시지 작성', '봉인'];
const templates = [
  { id: 'friends' as const, icon: Users, title: '친구' },
  { id: 'couple' as const, icon: Heart, title: '커플' },
  { id: 'future' as const, icon: Sprout, title: '날짜 지정' },
];

function Logo() {
  return <a className="logo" href="/" aria-label="KEEPY 홈"><Sprout size={21} />keepy<span>.</span></a>;
}

function Frame({ children, onLeave, onHome, hideHeader = false }: { children: ReactNode; onLeave?: () => void; onHome?: () => void; hideHeader?: boolean }) {
  return <div className="app-frame">
    {!hideHeader && <header className="app-header"><Logo />{onHome ? <button className="home-link" onClick={onHome}><ArrowLeft size={13} /> 처음으로</button> : onLeave && <button className="icon-button" aria-label="방 나가기" onClick={onLeave}><X size={19} /></button>}</header>}
    {children}
  </div>;
}

function Home({ onEnter }: { onEnter: (entry: Entry) => void }) {
  const [invitation] = useState(() => {
    try { return parseRoomCode(location.hash.slice(1)).code; }
    catch { return ''; }
  });
  const [mode, setMode] = useState<'create' | 'join'>(invitation ? 'join' : 'create');
  const [step, setStep] = useState<'intro' | 'name' | 'code'>(invitation ? 'name' : 'intro');
  const [name, setName] = useState('');
  const [code, setCode] = useState(invitation);
  const [error, setError] = useState('');
  const [camera, setCamera] = useState(false);
  const [readingImage, setReadingImage] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);

  function acceptCode(value: string) {
    setCode(parseRoomCode(value).code);
    setError('');
    setCamera(false);
    setStep('name');
  }

  useEffect(() => {
    if (!camera || step !== 'code' || !videoRef.current) return;
    const controller = new AbortController();
    const video = videoRef.current;
    void import('./browser-qr').then(({ scanQR }) => scanQR(video, value => {
      try { acceptCode(value); }
      catch { setCamera(false); setError('KEEPY 방 초대 QR이 아닙니다.'); }
    }, controller.signal)).catch(() => {
      if (controller.signal.aborted) return;
      setCamera(false);
      setError('카메라 권한을 허용하거나 QR 이미지를 불러오세요.');
    });
    const stopWhenHidden = () => {
      if (document.hidden) { controller.abort(); setCamera(false); }
    };
    document.addEventListener('visibilitychange', stopWhenHidden);
    return () => { controller.abort(); document.removeEventListener('visibilitychange', stopWhenHidden); };
  }, [camera, step]);

  async function readImage(file: File) {
    setReadingImage(true);
    setError('');
    setCamera(false);
    try {
      const { readQRImage } = await import('./browser-qr');
      const value = await readQRImage(file);
      try { acceptCode(value); }
      catch { throw new Error('KEEPY 방 초대 QR이 아닙니다.'); }
    } catch (error) { setError(error instanceof Error ? error.message : 'QR을 읽지 못했습니다.'); }
    finally { setReadingImage(false); }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    try {
      if (step === 'code') { acceptCode(code); return; }
      if (!crypto.subtle) throw new Error('현재 주소에서는 이용할 수 없습니다. 접속 주소를 확인하세요.');
      if (!name.trim()) throw new Error('이름을 입력하세요.');
      const roomCode = mode === 'create' ? createRoomCode() : parseRoomCode(code).code;
      onEnter({ code: roomCode, name: name.trim(), create: mode === 'create' });
    } catch (error) { setError(error instanceof Error ? error.message : '입장하지 못했습니다.'); }
  }

  function start(next: 'create' | 'join') {
    setMode(next);
    setError('');
    setStep(next === 'join' ? 'code' : 'name');
  }

  function previous() {
    setError('');
    setCamera(false);
    setStep(step === 'name' && mode === 'join' ? 'code' : 'intro');
  }

  if (step === 'intro') return <Frame hideHeader><main key="intro" className="screen intro-screen">
    <div className="intro-content">
      <div className="intro-brand"><div className="intro-icon"><Sprout size={42} strokeWidth={1.5} /></div><h1>keepy<span>.</span></h1><p>여러 사람이 함께 여는 타임캡슐</p></div>
      <ul className="feature-list">
        <li><Users size={20} strokeWidth={1.5} /><div><strong>각자의 메시지 작성</strong><p>같은 방에서 각자 메시지를 작성합니다.</p></div></li>
        <li><LockKeyhole size={20} strokeWidth={1.5} /><div><strong>함께 개봉</strong><p>정해진 인원의 열쇠를 모으면 열 수 있습니다.</p></div></li>
        <li><Download size={20} strokeWidth={1.5} /><div><strong>파일로 보관</strong><p>내 기기에 보관하고, 인터넷 없이도 개봉합니다.</p></div></li>
      </ul>
    </div>
    <div className="screen-bottom intro-actions"><button className="button primary wide" onClick={() => start('create')}><Plus size={17} /> 방 만들기</button><button className="button secondary wide" onClick={() => start('join')}><Link2 size={17} /> 방 입장</button></div>
  </main></Frame>;

  return <Frame><main key={`${mode}-${step}`} className="screen home-screen">
    <div className="step-progress" aria-label="진행 단계"><span className="active" />{mode === 'join' && <span className={step === 'name' ? 'active' : ''} />}<small>{mode === 'join' && step === 'name' ? 2 : 1} / {mode === 'join' ? 2 : 1}</small></div>
    <div className="screen-title"><h1>{step === 'name' ? '당신의 이름' : '방 코드'}</h1><p>{step === 'name' ? '방에서 사용할 이름을 입력하세요.' : '방 코드를 입력하거나 초대 QR을 스캔하세요.'}</p></div>
    <form className="home-form" onSubmit={submit}>
      <div className="screen-panel entry-panel">
        {step === 'name'
          ? <><label className="sr-only" htmlFor="name">당신의 이름</label><input key="name" id="name" placeholder="이름 입력" maxLength={24} autoComplete="nickname" value={name} onChange={event => setName(event.target.value)} required /></>
          : <><label className="sr-only" htmlFor="room-code">방 코드</label>{camera
            ? <div className="qr-camera"><video ref={videoRef} playsInline muted autoPlay aria-label="초대 QR 스캔 카메라" /><button className="icon-button" type="button" aria-label="카메라 닫기" onClick={() => setCamera(false)}><X size={17} /></button></div>
            : <textarea key="code" id="room-code" className="invite-input" placeholder="방 코드 또는 초대 링크 입력" value={code} onChange={event => setCode(event.target.value)} required autoComplete="off" spellCheck={false} />}
            <div className="qr-tools"><button className="button secondary" type="button" disabled={camera || readingImage} onClick={() => { setError(''); setCamera(true); }}><Camera size={15} /> QR 스캔</button><button className="button secondary" type="button" disabled={readingImage} onClick={() => imageRef.current?.click()}><ImagePlus size={15} /> {readingImage ? '읽는 중…' : 'QR 이미지'}</button></div><input ref={imageRef} type="file" accept="image/*" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void readImage(file); }} />
          </>}
      </div>
      <div className="screen-bottom">{error && <p className="form-error" role="alert">{error}</p>}<div className="step-actions"><button className="button back-button" type="button" aria-label="이전 단계" disabled={readingImage} onClick={previous}><ArrowLeft size={18} /></button><button className="button primary wide" type="submit" disabled={readingImage}>{step === 'code' ? '다음' : mode === 'create' ? '방 만들기' : '입장하기'} <ArrowRight size={17} /></button></div></div>
    </form>
  </main></Frame>;
}

function People({ members, self, host, routes, downloads = false }: { members: Member[]; self: string; host: string; routes: Record<string, string>; downloads?: boolean }) {
  return <ul className="people-grid">{members.map((member, index) => <li key={member.id}>
    <span className={`avatar avatar-${index % 4}`}>{member.name.slice(0, 1)}</span>
    <strong title={member.name}>{member.name}{member.id === self && <small> 나</small>}{member.id === host && <span className="host-dot" title="방장">·</span>}</strong>
    <span className={`person-status ${member.ready ? 'ready' : ''}`}>{downloads
      ? ({ waiting: '준비 중', ready: '파일 준비됨', started: '다운로드 시작' }[member.download])
      : member.ready ? '준비 완료 ✓' : '작성 전'}</span>
    {!downloads && <span className="person-route">{member.id === self ? '내 기기' : routes[member.id] === 'direct' ? '직접 연결됨' : '다른 경로로 연결됨'}</span>}
  </li>)}</ul>;
}

function Room({ entry, onLeave }: { entry: Entry; onLeave: () => void }) {
  const [session] = useState(() => new Session(entry.code, entry.name, entry.create, value => setView(value)));
  const [view, setView] = useState(session.view);
  const [step, setStep] = useState<Step>('people');
  const [text, setText] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [inviteQR, setInviteQR] = useState(false);
  const inviteCanvas = useRef<HTMLCanvasElement>(null);
  const { state } = view;
  const me = state.members.find(member => member.id === view.self);
  const isHost = view.host === view.self;
  const writing = state.stage === 'writing';
  const complete = state.stage === 'complete';
  const finished = complete && state.members.length > 0 && state.members.every(member => member.download === 'started');
  const allReady = state.members.length > 0 && state.members.every(member => member.ready);
  const visibleSteps: Step[] = isHost ? steps : ['write', 'wait'];
  const visibleStepNames = isHost ? stepNames : ['메시지 작성', '봉인'];
  const index = visibleSteps.indexOf(step);
  const waitingForSettings = !isHost && !state.settingsConfirmed && writing;

  useEffect(() => {
    history.replaceState(null, '', `${location.pathname}${location.search}#${entry.code}`);
    session.start();
    return () => session.close();
  }, [session, entry.code]);

  useEffect(() => { if (!writing) setText(''); }, [writing]);

  useEffect(() => {
    if (!inviteQR || step !== 'people' || !inviteCanvas.current) return;
    const canvas = inviteCanvas.current;
    let cancelled = false;
    void import('./browser-qr').then(({ drawQR }) => {
      if (!cancelled) return drawQR(canvas, `${location.origin}${location.pathname}#${entry.code}`);
    }).catch(() => { if (!cancelled) setNotice('초대 QR을 생성하지 못했습니다. 초대 링크를 복사하세요.'); });
    return () => { cancelled = true; };
  }, [inviteQR, step, entry.code]);

  useEffect(() => {
    if (!view.connected || isHost || !writing) return;
    if (!state.settingsConfirmed) setStep('people');
    else setStep(current => current !== 'write' && current !== 'wait' ? 'write' : current);
  }, [view.connected, isHost, writing, state.settingsConfirmed]);

  useEffect(() => {
    if (isHost && writing && !state.settingsConfirmed && (step === 'write' || step === 'wait')) setStep('template');
  }, [isHost, writing, state.settingsConfirmed, step]);

  async function action(fn: () => void | Promise<void>) {
    setBusy(true);
    setNotice('');
    try { await fn(); } catch (error) { setNotice(error instanceof Error ? error.message : '다시 시도해 주세요.'); }
    finally { setBusy(false); }
  }

  async function copyInvite() {
    const link = `${location.origin}${location.pathname}#${entry.code}`;
    try { await navigator.clipboard.writeText(link); setNotice('초대 링크를 복사했습니다.'); }
    catch { setNotice(`초대 링크: ${link}`); }
  }

  async function saveCapsule() {
    if (!view.capsule) return;
    downloadCapsule(view.capsule);
    await session.downloadStatus('started');
  }

  function update(patch: Partial<Settings>) { session.updateSettings({ ...state.settings, ...patch, template: patch.template ?? 'custom' }); }
  function applyTemplate(template: Settings['template']) {
    const settings: Settings = {
      ...defaults, title: state.settings.title, template,
      threshold: Math.min(2, state.members.length), requireAuthor: false,
    };
    if (template === 'couple') {
      settings.threshold = state.members.length;
      settings.requireAuthor = true;
    }
    if (template === 'future') settings.opensAt = new Date(Date.now() + 365 * 86400_000).toISOString();
    session.updateSettings(settings);
  }
  async function previous() {
    if (step === 'wait' && me?.ready) await session.setReady(text, false);
    setStep(visibleSteps[index - 1]);
  }
  function leave() { if (window.confirm('방을 나가시겠습니까? 진행 중인 내용은 삭제됩니다.')) onLeave(); }
  const titles = {
    people: state.invitationsClosed ? ['참여자', '초대가 마감되었습니다. 신규 입장은 불가능합니다.'] : ['참여자 초대', '참여자가 모두 입장하면 초대를 마감하세요.'],
    template: ['빠른 설정', '사용 목적을 선택하면 기본 설정이 적용됩니다.'],
    title: ['캡슐 이름', '저장할 캡슐의 이름을 입력하세요.'],
    threshold: ['최소 개봉 인원', '몇 명이 모여야 열 수 있는지 선택하세요.'],
    visibility: ['메시지 공개 범위', '개봉 후 메시지를 볼 수 있는 범위를 선택하세요.'],
    author: ['작성자 참여 조건', '작성자가 개봉에 참여해야 메시지를 공개할지 설정하세요.'],
    date: ['개봉 예정일', '날짜 제한이 필요하지 않으면 입력하지 않아도 됩니다.'],
    write: ['메시지 작성', '개봉 후 읽을 메시지를 입력하세요.'],
    wait: ['봉인 준비', '전원 작성 완료 후 방장이 봉인을 시작합니다.'],
  };
  const title = finished ? '완료' : complete ? '봉인 완료' : state.stage === 'sealing' ? '캡슐 보관 중' : state.stage === 'failed' ? '봉인 실패' : waitingForSettings ? '방장 설정 대기' : titles[step][0];
  const description = finished ? '모든 참여자가 파일을 받기 시작했습니다.' : complete ? '메시지와 열쇠가 담긴 파일을 받으세요.' : !writing ? state.progress : waitingForSettings ? '방장이 설정을 완료하면 메시지를 작성할 수 있습니다.' : titles[step][1];
  const people = <People members={state.members} self={view.self} host={view.host} routes={view.routes} downloads={complete} />;

  const screenKey = !view.connected ? 'connecting' : finished ? 'finished' : !writing ? state.stage : waitingForSettings ? 'settings-wait' : step;

  return <Frame onLeave={finished ? undefined : leave} onHome={finished ? onLeave : undefined}><main key={screenKey} className="screen room-screen">
    <div className="step-progress" aria-label="진행 단계">{visibleStepNames.map((label, i) => <span key={label} className={complete || !writing || (!waitingForSettings && i <= index) ? 'active' : ''} title={label} />)}<small>{complete ? '완료' : !writing ? '봉인 중' : waitingForSettings ? '대기 중' : `${index + 1} / ${visibleSteps.length}`}</small></div>
    <div className="screen-title"><h1>{title}</h1><p>{description}</p></div>
    {(notice || view.error) && <div className={`notice-banner ${view.error ? 'error-banner' : ''}`} role="status"><span>{view.error || notice}</span><button className="icon-button" aria-label="알림 닫기" onClick={() => { session.clearError(); setNotice(''); }}><X size={15} /></button></div>}

    {!view.connected ? <div className="screen-panel centered"><LoaderCircle className="spin" /><p>방 연결 중…</p></div>
      : finished ? <>
        <section className="screen-panel complete-panel"><div className="capsule-symbol"><Check size={30} strokeWidth={1.5} /></div><h2>타임캡슐 생성 완료</h2><p className="muted">받은 파일을 안전하게 보관하세요.<br />개봉 시 파일을 열고 참여자의 열쇠를 모으면 됩니다.</p><p className="panel-note warning">분실한 파일은 다시 받을 수 없습니다.</p></section>
        <div className="screen-bottom"><button className="button secondary wide" disabled={!view.capsule || busy} onClick={() => action(saveCapsule)}><Download size={17} /> 파일 다시 받기</button></div>
      </> : complete ? <>
        <section className="screen-panel complete-panel"><div className="capsule-symbol"><Check size={30} strokeWidth={1.5} /></div><h2>캡슐 파일 받기</h2><p className="muted">개봉 시 받은 파일을 열고 참여자의 열쇠를 모으세요.</p><div className="download-people">{people}</div><p className="panel-note warning">분실한 파일은 다시 받을 수 없습니다.</p></section>
        <div className="screen-bottom"><button className="button primary wide" disabled={!view.capsule || busy} onClick={() => action(saveCapsule)}><Download size={17} /> {me?.download === 'started' ? '파일 다시 받기' : '캡슐 파일 받기'}</button><p className="bottom-note">{me?.download === 'started' ? '다른 참여자가 파일을 받기를 기다리고 있습니다.' : '전원이 파일을 받기 시작하면 완료 화면으로 이동합니다.'}</p></div>
      </> : !writing ? <>
        <section className="screen-panel centered"><div className={`capsule-symbol ${state.stage === 'sealing' ? 'breathing' : ''}`}>{state.stage === 'failed' ? <X size={30} /> : <LockKeyhole size={30} strokeWidth={1.5} />}</div><h2>{state.stage === 'failed' ? '새 방에서 다시 시작하세요.' : '메시지를 보관하고 있습니다.'}</h2>{state.stage === 'sealing' && <LoaderCircle className="spin" size={20} />}<p className="panel-note"><ShieldCheck size={13} /> 완료될 때까지 이 화면을 유지하세요.</p></section><div className="screen-bottom"><button className="button secondary wide" onClick={leave}>방 나가기</button></div>
      </> : waitingForSettings ? <>
        <section className="screen-panel people-panel"><div className="panel-heading"><h2>참여자 <small>{state.members.length} / 12</small></h2><Users size={17} /></div>{people}<p className="panel-note"><ShieldCheck size={13} /> 방장만 설정을 변경할 수 있습니다.</p></section>
        <div className="screen-bottom"><button className="button primary wide" disabled><LoaderCircle size={16} className="spin" /> 설정 대기 중</button></div>
      </> : <>
        {step === 'people' && <section className="screen-panel people-panel"><div className="panel-heading"><h2>{inviteQR && !state.invitationsClosed ? '초대 QR' : '참여자'} <small>{state.members.length} / 12</small></h2>{inviteQR && !state.invitationsClosed ? <button className="icon-button" aria-label="초대 QR 닫기" onClick={() => setInviteQR(false)}><X size={17} /></button> : <Users size={17} />}</div>{inviteQR && !state.invitationsClosed ? <div className="invite-qr"><canvas ref={inviteCanvas} className="qr-canvas" role="img" aria-label="방 초대 QR 코드" /><p className="panel-note">방 입장에서 QR을 스캔하거나 휴대폰 카메라로 여세요.</p></div> : people}{!state.invitationsClosed && <div className="qr-tools invite-tools"><button className="button secondary" onClick={copyInvite}><Copy size={15} /> 링크 복사</button><button className="button secondary" onClick={() => setInviteQR(value => !value)}><QrCode size={15} /> {inviteQR ? '참여자 보기' : '초대 QR'}</button></div>}<button className="text-button" onClick={() => setNotice('직접 연결하기 어려우면 다른 경로로 연결합니다. 어느 방식이든 메시지는 안전하게 보호됩니다. 다른 인터넷 연결을 이용하면 직접 연결될 수 있습니다.')}>연결 안내</button></section>}
        {isHost && step === 'template' && <section className="screen-panel settings-panel"><div className="template-list">{templates.map(item => <button key={item.id} type="button" aria-pressed={state.settings.template === item.id} className={`template-option ${state.settings.template === item.id ? 'selected' : ''}`} onClick={() => applyTemplate(item.id)}><item.icon size={20} strokeWidth={1.5} /><span><strong>{item.title}</strong><small>{item.id === 'friends' ? '최소 2명이 모이면 전체 공개' : item.id === 'couple' ? '모두 참여해야 개봉 가능' : '개봉 예정일을 1년 뒤로 설정'}</small></span>{state.settings.template === item.id && <Check size={17} />}</button>)}</div><p className="panel-note">다음 단계에서 각 설정을 변경할 수 있습니다.</p></section>}
        {isHost && step === 'title' && <section className="screen-panel settings-panel"><label className="sr-only" htmlFor="capsule-title">캡슐 이름</label><input id="capsule-title" value={state.settings.title} maxLength={60} onChange={event => update({ title: event.target.value })} /></section>}
        {isHost && step === 'threshold' && <section className="screen-panel settings-panel"><label className="sr-only" htmlFor="threshold">최소 개봉 인원</label><select id="threshold" value={state.settings.threshold} onChange={event => update({ threshold: Number(event.target.value) })}>{state.members.map((_, i) => <option key={i} value={i + 1}>{i + 1}명 / 전체 {state.members.length}명</option>)}</select><p className="panel-note">서로 다른 {state.settings.threshold}명이 열쇠를 공유해야 합니다.</p></section>}
        {isHost && step === 'visibility' && <section className="screen-panel settings-panel"><div className="setting-options"><button className={`setting-option ${state.settings.visibility === 'everyone' ? 'selected' : ''}`} aria-pressed={state.settings.visibility === 'everyone'} onClick={() => update({ visibility: 'everyone' })}><strong>전체 공개</strong><span>모든 참여자가 전체 메시지를 보관하고 읽습니다.</span></button><button className={`setting-option ${state.settings.visibility === 'self' ? 'selected' : ''}`} aria-pressed={state.settings.visibility === 'self'} onClick={() => update({ visibility: 'self' })}><strong>본인만 보기</strong><span>각자 본인의 메시지만 보관하고 읽습니다.</span></button></div></section>}
        {isHost && step === 'author' && <section className="screen-panel settings-panel"><div className="setting-options"><button className={`setting-option ${state.settings.requireAuthor ? 'selected' : ''}`} aria-pressed={state.settings.requireAuthor} onClick={() => update({ requireAuthor: true })}><strong>작성자 참여 시에만 공개</strong><span>작성자가 자신의 열쇠를 공유해야 읽을 수 있습니다.</span></button><button className={`setting-option ${!state.settings.requireAuthor ? 'selected' : ''}`} aria-pressed={!state.settings.requireAuthor} onClick={() => update({ requireAuthor: false })}><strong>참여 여부와 관계없이 공개</strong><span>정해진 인원이 모이면 모든 메시지를 읽을 수 있습니다.</span></button></div></section>}
        {isHost && step === 'date' && <section className="screen-panel settings-panel"><label className="sr-only" htmlFor="opens-at">개봉 예정일</label><input id="opens-at" type="datetime-local" value={toLocalDate(state.settings.opensAt)} onChange={event => update({ opensAt: event.target.value ? new Date(event.target.value).toISOString() : '' })} /><button className="button secondary date-clear" onClick={() => update({ opensAt: '' })}>날짜 제한 없음</button><p className="panel-note">날짜 제한은 시계 변경이나 파일 수정으로 우회할 수 있으나 최소 개봉 인원이 동의해야만 열 수 있습니다.</p></section>}
        {step === 'write' && <section className="screen-panel letter-card"><div className="letter-heading"><span>메시지</span><Mail size={19} strokeWidth={1.4} /></div><textarea aria-label="나의 메시지" className="letter-input" placeholder="메시지 입력" maxLength={4000} disabled={me?.ready} value={text} onChange={event => setText(event.target.value)} /><div className="letter-signature"><span>작성자: {entry.name}</span><small>{text.length.toLocaleString()} / 4,000</small></div><p className="panel-note"><LockKeyhole size={12} /> 작성 중인 메시지는 본인에게만 표시됩니다.</p></section>}
        {step === 'wait' && <section className="screen-panel wait-panel"><div className="panel-heading"><h2>{allReady ? '전원 작성 완료' : '메시지 작성 대기'}</h2><span>{state.members.filter(member => member.ready).length} / {state.members.length}</span></div>{people}<div className="promise-summary"><span><LockKeyhole size={13} /> 최소 {state.settings.threshold}명으로 개봉</span><span>{state.settings.visibility === 'everyone' ? '전체 공개' : '본인만 보기'}</span></div><p className="panel-note">봉인 후에는 메시지와 설정을 변경할 수 없습니다.</p></section>}

        <div className="screen-bottom"><div className="step-actions">{index > 0 && <button className="button back-button" aria-label="이전 단계" disabled={busy} onClick={() => action(previous)}><ArrowLeft size={18} /></button>}
          {isHost && step === 'people' && <button className="button primary wide" disabled={busy} onClick={() => action(async () => { await session.closeInvitations(); setInviteQR(false); setStep('template'); })}>{busy ? <LoaderCircle size={17} className="spin" /> : <ArrowRight size={17} />}{state.invitationsClosed ? '설정으로 이동' : '초대 마감하기'}</button>}
          {isHost && settingSteps.includes(step as SettingStep) && step !== 'date' && <button className="button primary wide" disabled={busy} onClick={() => setStep(visibleSteps[index + 1])}>다음 <ArrowRight size={17} /></button>}
          {isHost && step === 'date' && <button className="button primary wide" disabled={busy} onClick={() => action(() => { session.confirmSettings(); setStep('write'); })}>설정 완료 <ArrowRight size={17} /></button>}
          {step === 'write' && <button className="button primary wide" disabled={busy || !me || (!me.ready && !text.trim())} onClick={() => action(async () => { await session.setReady(text, true); setStep('wait'); })}>작성 완료 <Check size={17} /></button>}
          {step === 'wait' && (isHost ? <button className="button primary wide" disabled={!allReady || busy || !!view.error} onClick={() => action(() => session.seal())}><LockKeyhole size={16} /> 봉인 시작</button> : <button className="button primary wide" disabled><LoaderCircle size={16} className="spin" /> 봉인 대기 중</button>)}
        </div><p className="bottom-note">{step === 'write' ? '메시지는 참여자의 캡슐 파일에만 보관됩니다.' : step === 'wait' ? '봉인 완료 후 각자 캡슐 파일을 받으세요.' : isHost ? '설정과 봉인은 방장만 진행할 수 있습니다.' : '방장이 설정을 변경하면 작성 완료를 다시 눌러야 합니다.'}</p></div>
      </>}
  </main></Frame>;
}

function toLocalDate(value: string) {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export default function App() {
  const [entry, setEntry] = useState<Entry>();
  return entry ? <Room entry={entry} onLeave={() => { history.replaceState(null, '', location.pathname); setEntry(undefined); }} /> : <Home onEnter={setEntry} />;
}
