import { useState, type FormEvent } from "react";
import { useAuth } from "../lib/useAuth";

// Supabase Auth needs a real email-shaped identifier internally, but the
// user only ever types a plain username — this appends a fixed pseudo-domain
// so "capital" becomes "capital@cbradar.local" behind the scenes.
const AUTH_DOMAIN = "@cbradar.local";

function toAuthEmail(input: string): string {
  const trimmed = input.trim();
  return trimmed.includes("@") ? trimmed : `${trimmed}${AUTH_DOMAIN}`;
}

export function Login() {
  const { signIn } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const message = await signIn(toAuthEmail(username), password);
    setBusy(false);
    if (message) setError(message === "Invalid login credentials" ? "帳號或密碼錯誤" : message);
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-brand">
          可轉債雷達
          <small>CB RADAR · 私人使用</small>
        </div>
        <form onSubmit={handleSubmit}>
          <label className="login-field">
            <span>帳號</span>
            <input
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </label>
          <label className="login-field">
            <span>密碼</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {error && <div className="login-error">{error}</div>}
          <button type="submit" className="login-btn" disabled={busy}>
            {busy ? "登入中…" : "登入"}
          </button>
        </form>
      </div>
    </div>
  );
}
