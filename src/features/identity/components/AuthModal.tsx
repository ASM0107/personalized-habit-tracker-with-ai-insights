import { useState, type FormEvent } from "react";
import type { UserProfile } from "../types/index.js";

interface AuthModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onAuthSuccess: (user: UserProfile, token: string) => void;
}

export function AuthModal({ isOpen, onClose, onAuthSuccess }: AuthModalProps) {
  const [tab, setTab] = useState<"LOGIN" | "REGISTER">("LOGIN");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  if (!isOpen) {
    return null;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const endpoint = tab === "LOGIN" ? "/api/auth/login" : "/api/auth/register";
      const payload = tab === "LOGIN" ? { email, password } : { name, email, password };

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Authentication request failed");
      }

      const user: UserProfile = {
        id: data.user.id,
        name: data.user.name,
        email: data.user.email,
        type: "CLOUD",
        avatarColor: "#8b5cf6",
        createdAt: data.user.createdAt || Date.now(),
        lastActiveAt: Date.now(),
      };

      onAuthSuccess(user, data.token);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(10, 15, 29, 0.82)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1100,
        padding: "16px",
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "420px",
          backgroundColor: "#111827",
          border: "1px solid #1f2937",
          borderRadius: "14px",
          padding: "24px",
          color: "#f3f4f6",
          boxShadow: "0 20px 40px rgba(0,0,0,0.5)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700 }}>Cloud Account Sync</h2>
            <p style={{ margin: "4px 0 0", fontSize: "0.82rem", color: "#9ca3af" }}>
              Sync your habits across all your devices in real-time
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "#9ca3af",
              fontSize: "1.2rem",
              cursor: "pointer",
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ display: "flex", gap: "8px", marginBottom: "20px", backgroundColor: "#1f2937", padding: "4px", borderRadius: "8px" }}>
          <button
            type="button"
            onClick={() => { setTab("LOGIN"); setError(null); }}
            style={{
              flex: 1,
              padding: "8px 12px",
              borderRadius: "6px",
              border: "none",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: "0.85rem",
              backgroundColor: tab === "LOGIN" ? "#3b82f6" : "transparent",
              color: tab === "LOGIN" ? "#ffffff" : "#9ca3af",
            }}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => { setTab("REGISTER"); setError(null); }}
            style={{
              flex: 1,
              padding: "8px 12px",
              borderRadius: "6px",
              border: "none",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: "0.85rem",
              backgroundColor: tab === "REGISTER" ? "#3b82f6" : "transparent",
              color: tab === "REGISTER" ? "#ffffff" : "#9ca3af",
            }}
          >
            Create Account
          </button>
        </div>

        {error && (
          <div
            style={{
              backgroundColor: "rgba(239, 68, 68, 0.15)",
              border: "1px solid rgba(239, 68, 68, 0.4)",
              color: "#fca5a5",
              padding: "10px 12px",
              borderRadius: "8px",
              fontSize: "0.85rem",
              marginBottom: "16px",
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          {tab === "REGISTER" && (
            <div>
              <label style={{ display: "block", fontSize: "0.8rem", color: "#9ca3af", marginBottom: "4px" }}>
                Full Name
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Aakash"
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "10px 12px",
                  borderRadius: "8px",
                  border: "1px solid #374151",
                  backgroundColor: "#1f2937",
                  color: "#f3f4f6",
                  fontSize: "0.9rem",
                }}
              />
            </div>
          )}

          <div>
            <label style={{ display: "block", fontSize: "0.8rem", color: "#9ca3af", marginBottom: "4px" }}>
              Email Address
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "10px 12px",
                borderRadius: "8px",
                border: "1px solid #374151",
                backgroundColor: "#1f2937",
                color: "#f3f4f6",
                fontSize: "0.9rem",
              }}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: "0.8rem", color: "#9ca3af", marginBottom: "4px" }}>
              Password
            </label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters"
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "10px 12px",
                borderRadius: "8px",
                border: "1px solid #374151",
                backgroundColor: "#1f2937",
                color: "#f3f4f6",
                fontSize: "0.9rem",
              }}
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            style={{
              marginTop: "8px",
              padding: "11px",
              borderRadius: "8px",
              border: "none",
              backgroundColor: isLoading ? "#4b5563" : "#3b82f6",
              color: "#ffffff",
              fontWeight: 600,
              fontSize: "0.95rem",
              cursor: isLoading ? "not-allowed" : "pointer",
              transition: "background-color 0.15s ease",
            }}
          >
            {isLoading ? "Connecting to Cloud..." : tab === "LOGIN" ? "Sign In & Sync" : "Create Account & Sync"}
          </button>
        </form>

        <div style={{ marginTop: "18px", textAlign: "center", borderTop: "1px solid #1f2937", paddingTop: "14px" }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "#9ca3af",
              fontSize: "0.82rem",
              cursor: "pointer",
              textDecoration: "underline",
            }}
          >
            Continue as offline guest without signing up
          </button>
        </div>
      </div>
    </div>
  );
}
