import { useState } from "react";
import { useAppContext } from "./AppContext.js";

interface AppSettingsModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
}

export function AppSettingsModal({ isOpen, onClose }: AppSettingsModalProps) {
  const {
    geminiApiKey,
    setGeminiApiKey,
    isAiLive,
    syncStats,
    syncNow,
  } = useAppContext();

  const [inputKey, setInputKey] = useState(geminiApiKey);
  const [isSyncing, setIsSyncing] = useState(false);
  const [showKey, setShowKey] = useState(false);

  if (!isOpen) {
    return null;
  }

  const handleSaveKey = () => {
    setGeminiApiKey(inputKey);
  };

  const handleClearKey = () => {
    setInputKey("");
    setGeminiApiKey("");
  };

  const handleTriggerSync = async () => {
    setIsSyncing(true);
    try {
      await syncNow();
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal-container settings-modal">
        <div className="modal-header">
          <h2>Cloud Sync & AI Engine Settings</h2>
          <button type="button" onClick={onClose} className="btn-close">
            &times;
          </button>
        </div>

        <div className="settings-section">
          <h3>Google Gemini AI Inference</h3>
          <p className="settings-desc">
            Provide a Gemini API key for live contextual coaching. When no key is set, the system uses deterministic rule-based heuristics.
          </p>

          <div className="api-key-status">
            <span className={`status-indicator ${isAiLive ? "indicator-live" : "indicator-fallback"}`} />
            <span className="status-label">
              {isAiLive ? "Active Mode: Gemini 2.0 Flash Live" : "Active Mode: Deterministic Local Rules"}
            </span>
          </div>

          <div className="form-group">
            <label htmlFor="gemini-key-input">Gemini API Key</label>
            <div className="input-with-button">
              <input
                id="gemini-key-input"
                type={showKey ? "text" : "password"}
                value={inputKey}
                onChange={(e) => setInputKey(e.target.value)}
                placeholder="AIzaSy..."
                className="ui-input"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="btn btn-secondary btn-sm"
              >
                {showKey ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          <div className="button-group">
            <button
              type="button"
              onClick={handleSaveKey}
              className="btn btn-primary"
            >
              Save Key
            </button>
            {geminiApiKey && (
              <button
                type="button"
                onClick={handleClearKey}
                className="btn btn-danger btn-sm"
              >
                Clear Key
              </button>
            )}
          </div>
        </div>

        <div className="settings-divider" />

        <div className="settings-section">
          <h3>Peer & Cloud Synchronization</h3>
          <p className="settings-desc">
            Local-first CRDT synchronization across multi-tab sessions and remote endpoints using Lamport logical clocks.
          </p>

          <div className="sync-metrics-grid">
            <div className="sync-metric-card">
              <span className="sync-metric-title">Sync State</span>
              <span className="sync-metric-value">{syncStats.state}</span>
            </div>
            <div className="sync-metric-card">
              <span className="sync-metric-title">Pending Outbound</span>
              <span className="sync-metric-value">{syncStats.pendingOutboundCount} envelopes</span>
            </div>
            <div className="sync-metric-card">
              <span className="sync-metric-title">Logical Clock</span>
              <span className="sync-metric-value">t = {syncStats.lastSyncedLamport}</span>
            </div>
          </div>

          <div className="button-group">
            <button
              type="button"
              onClick={handleTriggerSync}
              disabled={isSyncing}
              className="btn btn-primary"
            >
              {isSyncing ? "Synchronizing..." : "Sync Now"}
            </button>
          </div>
        </div>

        <div className="settings-divider" />

        <div className="settings-section">
          <h3>Progressive Web App (PWA)</h3>
          <p className="settings-desc">
            This application is PWA-enabled with service worker caching. It functions completely offline and can be installed to your desktop or mobile home screen via browser controls.
          </p>
        </div>

        <div className="modal-footer">
          <button type="button" onClick={onClose} className="btn btn-secondary">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
