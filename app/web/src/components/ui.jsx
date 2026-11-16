import { useEffect, useState, useCallback, createContext, useContext } from 'react';

export const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="ghost icon" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export const ErrorBox = ({ error }) => (error ? <div className="error">{String(error.message || error)}</div> : null);

/** Load data with reload(); keeps previous data while reloading. */
export function useLoad(fn, deps) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const reload = useCallback(async () => {
    try {
      const data = await fn();
      setState({ data, error: null, loading: false });
    } catch (error) {
      setState((s) => ({ ...s, error, loading: false }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { reload(); }, [reload]);
  return { ...state, reload, setData: (data) => setState((s) => ({ ...s, data: typeof data === 'function' ? data(s.data) : data })) };
}

/** Wrap an async action: returns [run, busy, error]. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = useCallback(async (fn) => {
    setBusy(true); setError(null);
    try { return await fn(); } catch (e) { setError(e); return undefined; } finally { setBusy(false); }
  }, []);
  return [run, busy, error, setError];
}

export function Field({ label, children, className }) {
  return <div className={className}><label>{label}</label>{children}</div>;
}

export function NeedParty() {
  return <div className="empty">Pick or create a party first (sidebar → Party).</div>;
}

export const fmtDate = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
export const fmtDay = (iso) => new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });

const splitList = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

/**
 * Comma-separated list field (languages, proficiencies…). Keeps exactly what you type while the field
 * has focus — spaces included — and saves the cleaned-up list as you go.
 */
export function ListInput({ value, onChange, area, ...rest }) {
  const joined = (value || []).filter(Boolean).join(', ');
  const [text, setText] = useState(joined);
  const [focused, setFocused] = useState(false);
  // follow outside changes (autosave reload, AI edits) only while not typing
  useEffect(() => { if (!focused) setText(joined); }, [joined, focused]);
  const props = {
    ...rest, value: text,
    onFocus: () => setFocused(true),
    onBlur: () => { setFocused(false); setText(joined); },
    onChange: (e) => { setText(e.target.value); onChange(splitList(e.target.value)); },
  };
  return area ? <textarea rows={2} {...props} /> : <input {...props} />;
}
