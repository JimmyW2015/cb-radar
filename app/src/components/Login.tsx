import { useState, type FormEvent } from "react";
import { useAuth } from "../lib/useAuth";

export function Login() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const message = await signIn(email.trim(), password);
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
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
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
