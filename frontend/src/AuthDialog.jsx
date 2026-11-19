import { useEffect, useRef, useState } from 'react';
import { login, register } from './auth.js';

export default function AuthDialog({ mode, onModeChange, onClose, onLoggedIn }) {
  const dialogRef = useRef(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  useEffect(() => {
    setError('');
    setPassword('');
    setConfirm('');
  }, [mode]);

  const isRegister = mode === 'register';

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setNotice('');

    if (isRegister && password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setBusy(true);
    try {
      if (isRegister) {
        const result = await register(username, password);
        setNotice(`Account "${result.username}" created. Log in to continue.`);
        onModeChange('login');
      } else {
        const result = await login(username, password);
        onLoggedIn(result.username);
      }
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="auth-dialog"
      aria-labelledby="auth-title"
      onClose={onClose}
      onClick={(event) => { if (event.target === dialogRef.current) dialogRef.current.close(); }}
    >
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <div className="auth-tabs" role="tablist" aria-label="Account">
          <button type="button" role="tab" aria-selected={!isRegister} onClick={() => onModeChange('login')}>
            Log in
          </button>
          <button type="button" role="tab" aria-selected={isRegister} onClick={() => onModeChange('register')}>
            Register
          </button>
        </div>

        <h2 id="auth-title">{isRegister ? 'Enlist' : 'Report for duty'}</h2>

        {notice && <p className="auth-notice" role="status">{notice}</p>}

        <label>
          Username
          <input
            name="username"
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            minLength={3}
            maxLength={20}
            pattern="[A-Za-z0-9_]{3,20}"
            required
            autoFocus
          />
        </label>
        {isRegister && <small className="auth-hint">3–20 letters, numbers, or underscores.</small>}

        <label>
          Password
          <input
            name="password"
            type="password"
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            minLength={8}
            required
          />
        </label>

        {isRegister && (
          <label>
            Confirm password
            <input
              name="confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              minLength={8}
              required
            />
          </label>
        )}
        {isRegister && <small className="auth-hint">At least 8 characters.</small>}

        {error && <p className="auth-error" role="alert">{error}</p>}

        <div className="auth-actions">
          <button className="auth-submit" type="submit" disabled={busy}>
            {busy ? 'Please wait…' : isRegister ? 'Create account' : 'Log in'}
          </button>
          <button className="auth-cancel" type="button" onClick={() => dialogRef.current?.close()}>
            Cancel
          </button>
        </div>
      </form>
    </dialog>
  );
}
