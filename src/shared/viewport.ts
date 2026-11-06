// Mobile browsers can resize only the visible viewport when the keyboard opens.
// Keep the app inside that area instead of letting the document become scrollable.
export function syncViewport() {
  const root = document.documentElement;
  const viewport = window.visualViewport;
  let normalHeight = viewport?.height ?? window.innerHeight;
  let frame = 0;

  function update() {
    frame = 0;
    // Preserve manual pinch zoom; editable controls use 16px text to avoid iOS auto-zoom.
    if (viewport && Math.abs(viewport.scale - 1) > 0.01) return;
    const height = Math.floor(viewport?.height ?? window.innerHeight);
    const active = document.activeElement;
    const editing = (active instanceof HTMLTextAreaElement && !active.readOnly && !active.disabled)
      || (active instanceof HTMLInputElement && !active.readOnly && !active.disabled
        && !['checkbox', 'radio', 'file', 'button', 'submit', 'reset', 'range', 'color', 'hidden'].includes(active.type));
    if (!editing) normalHeight = height;
    root.style.setProperty('--app-height', `${height}px`);
    root.style.setProperty('--app-offset-top', `${viewport?.offsetTop ?? 0}px`);
    root.toggleAttribute('data-keyboard-open', editing && (normalHeight - height > 100 || height < 480));
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(update);
  }

  update();
  viewport?.addEventListener('resize', schedule);
  viewport?.addEventListener('scroll', schedule);
  window.addEventListener('resize', schedule);
  document.addEventListener('focusin', schedule);
  document.addEventListener('focusout', schedule);
  return () => {
    cancelAnimationFrame(frame);
    viewport?.removeEventListener('resize', schedule);
    viewport?.removeEventListener('scroll', schedule);
    window.removeEventListener('resize', schedule);
    document.removeEventListener('focusin', schedule);
    document.removeEventListener('focusout', schedule);
    root.style.removeProperty('--app-height');
    root.style.removeProperty('--app-offset-top');
    root.removeAttribute('data-keyboard-open');
  };
}
