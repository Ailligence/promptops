/** Capture before xterm, even when focus is still in the underlying terminal. */
export function captureExpandedSubAgentEscape(
  isExpanded: () => boolean,
  close: () => void,
): () => void {
  let escapeHeld = false;
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    if (!escapeHeld) {
      if (event.type !== 'keydown' || event.defaultPrevented || !isExpanded()) return;
      // A Bootstrap dialog above the expanded pane owns its Escape.
      if (document.querySelector('ngb-modal-window')) return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type === 'keyup') {
      escapeHeld = false;
    } else if (!escapeHeld) {
      escapeHeld = true;
      close();
    }
    // Keep consuming auto-repeat after collapse until the key is released.
  };
  const onBlur = () => { escapeHeld = false; };
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('keyup', onKey, true);
  window.addEventListener('blur', onBlur);
  return () => {
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('keyup', onKey, true);
    window.removeEventListener('blur', onBlur);
  };
}
