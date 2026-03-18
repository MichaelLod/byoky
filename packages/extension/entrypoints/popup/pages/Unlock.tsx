import { useState, type FormEvent } from 'react';
import { useWalletStore, setSessionPassword } from '../store';

export function Unlock() {
  const { unlock, error } = useWalletStore();
  const [password, setPassword] = useState('');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!password) return;
    setSessionPassword(password);
    unlock(password);
  }

  return (
    <div className="center-page">
      <div className="logo-large">byoky</div>
      <div className="tagline">Welcome back</div>

      <form onSubmit={handleSubmit}>
        {error && <div className="error">{error}</div>}

        <div className="form-group">
          <label htmlFor="password">Master password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            autoFocus
          />
        </div>

        <button type="submit" className="btn btn-primary">
          Unlock
        </button>
      </form>
    </div>
  );
}
