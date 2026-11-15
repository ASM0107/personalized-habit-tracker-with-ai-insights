import { useState, useRef, useEffect, type FormEvent } from "react";
import type { UserProfile } from "../types/index.js";
import type { ProfileStore } from "../state/store.js";

interface ProfileSwitcherProps {
  readonly profileStore: ProfileStore;
  readonly onOpenAuthModal: () => void;
  readonly onProfileChanged: (profile: UserProfile) => void;
}

export function ProfileSwitcher({
  profileStore,
  onOpenAuthModal,
  onProfileChanged,
}: ProfileSwitcherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeProfile, setActiveProfile] = useState<UserProfile>(() => profileStore.getActiveProfile());
  const [allProfiles, setAllProfiles] = useState<readonly UserProfile[]>(() => profileStore.getAllProfiles());
  const [isAddingLocal, setIsAddingLocal] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsubscribe = profileStore.subscribe(() => {
      setActiveProfile(profileStore.getActiveProfile());
      setAllProfiles(profileStore.getAllProfiles());
    });
    return unsubscribe;
  }, [profileStore]);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setIsAddingLocal(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleOutsideClick);
    }
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, [isOpen]);

  const handleSelectProfile = (profileId: string) => {
    if (profileId === activeProfile.id) {
      setIsOpen(false);
      return;
    }
    const switched = profileStore.switchProfile(profileId);
    setActiveProfile(switched);
    onProfileChanged(switched);
    setIsOpen(false);
  };

  const handleCreateLocalProfile = (e: FormEvent) => {
    e.preventDefault();
    if (!newProfileName.trim()) {
      return;
    }
    const created = profileStore.createLocalProfile(newProfileName.trim());
    setNewProfileName("");
    setIsAddingLocal(false);
    setActiveProfile(created);
    onProfileChanged(created);
    setIsOpen(false);
  };

  const handleDeleteProfile = (e: React.MouseEvent, profileId: string) => {
    e.stopPropagation();
    if (confirm("Are you sure you want to delete this profile and its local data?")) {
      profileStore.deleteProfile(profileId);
      const current = profileStore.getActiveProfile();
      setActiveProfile(current);
      onProfileChanged(current);
    }
  };

  const handleLogoutCloud = () => {
    profileStore.logoutCloud(activeProfile.id);
    const def = profileStore.getActiveProfile();
    setActiveProfile(def);
    onProfileChanged(def);
    setIsOpen(false);
  };

  const localProfiles = allProfiles.filter((p) => p.type === "LOCAL");
  const cloudProfiles = allProfiles.filter((p) => p.type === "CLOUD");

  return (
    <div style={{ position: "relative" }} ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "6px 12px",
          borderRadius: "8px",
          border: "1px solid #1f2937",
          backgroundColor: "#111827",
          color: "#f3f4f6",
          cursor: "pointer",
          fontSize: "0.85rem",
          fontWeight: 600,
        }}
      >
        <span
          style={{
            width: "24px",
            height: "24px",
            borderRadius: "50%",
            backgroundColor: activeProfile.avatarColor,
            color: "#ffffff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "0.75rem",
            fontWeight: 700,
          }}
        >
          {activeProfile.name.charAt(0).toUpperCase()}
        </span>
        <span>{activeProfile.name}</span>
        <span
          style={{
            fontSize: "0.7rem",
            padding: "2px 6px",
            borderRadius: "4px",
            backgroundColor: activeProfile.type === "CLOUD" ? "rgba(139, 92, 246, 0.2)" : "rgba(75, 85, 99, 0.3)",
            color: activeProfile.type === "CLOUD" ? "#c084fc" : "#9ca3af",
          }}
        >
          {activeProfile.type === "CLOUD" ? "Cloud" : "Local"}
        </span>
        <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>▼</span>
      </button>

      {isOpen && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            width: "280px",
            backgroundColor: "#111827",
            border: "1px solid #1f2937",
            borderRadius: "10px",
            padding: "12px",
            boxShadow: "0 10px 25px rgba(0,0,0,0.5)",
            zIndex: 1000,
            color: "#f3f4f6",
          }}
        >
          <div style={{ marginBottom: "10px", paddingBottom: "10px", borderBottom: "1px solid #1f2937" }}>
            <div style={{ fontSize: "0.75rem", textTransform: "uppercase", color: "#6b7280", fontWeight: 700, letterSpacing: "0.05em" }}>
              Active Profile
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "6px" }}>
              <div
                style={{
                  width: "32px",
                  height: "32px",
                  borderRadius: "50%",
                  backgroundColor: activeProfile.avatarColor,
                  color: "#ffffff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 700,
                  fontSize: "0.85rem",
                }}
              >
                {activeProfile.name.charAt(0).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: "0.9rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {activeProfile.name}
                </div>
                <div style={{ fontSize: "0.75rem", color: "#9ca3af" }}>
                  {activeProfile.email || "Offline Local Device"}
                </div>
              </div>
            </div>
          </div>

          <div style={{ marginBottom: "10px" }}>
            <div style={{ fontSize: "0.75rem", textTransform: "uppercase", color: "#6b7280", fontWeight: 700, letterSpacing: "0.05em", marginBottom: "6px" }}>
              Local Profiles (No Sign-Up)
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              {localProfiles.map((p) => {
                const isActive = p.id === activeProfile.id;
                return (
                  <div
                    key={p.id}
                    onClick={() => handleSelectProfile(p.id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "6px 8px",
                      borderRadius: "6px",
                      cursor: "pointer",
                      backgroundColor: isActive ? "#1f2937" : "transparent",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span
                        style={{
                          width: "8px",
                          height: "8px",
                          borderRadius: "50%",
                          backgroundColor: p.avatarColor,
                        }}
                      />
                      <span style={{ fontSize: "0.85rem", fontWeight: isActive ? 600 : 400 }}>
                        {p.name}
                      </span>
                    </div>
                    {isActive ? (
                      <span style={{ fontSize: "0.75rem", color: "#10b981" }}>✓</span>
                    ) : p.id !== "default" ? (
                      <button
                        type="button"
                        onClick={(e) => handleDeleteProfile(e, p.id)}
                        style={{
                          background: "none",
                          border: "none",
                          color: "#ef4444",
                          cursor: "pointer",
                          fontSize: "0.75rem",
                          padding: "2px 4px",
                        }}
                        title="Delete Profile"
                      >
                        ✕
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>

            {isAddingLocal ? (
              <form onSubmit={handleCreateLocalProfile} style={{ marginTop: "8px", display: "flex", gap: "4px" }}>
                <input
                  type="text"
                  autoFocus
                  placeholder="Profile Name"
                  value={newProfileName}
                  onChange={(e) => setNewProfileName(e.target.value)}
                  style={{
                    flex: 1,
                    padding: "6px 8px",
                    borderRadius: "6px",
                    border: "1px solid #374151",
                    backgroundColor: "#1f2937",
                    color: "#f3f4f6",
                    fontSize: "0.8rem",
                  }}
                />
                <button
                  type="submit"
                  style={{
                    padding: "6px 10px",
                    borderRadius: "6px",
                    border: "none",
                    backgroundColor: "#3b82f6",
                    color: "#ffffff",
                    fontSize: "0.8rem",
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setIsAddingLocal(false)}
                  style={{
                    padding: "6px",
                    background: "none",
                    border: "none",
                    color: "#9ca3af",
                    fontSize: "0.8rem",
                    cursor: "pointer",
                  }}
                >
                  ✕
                </button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setIsAddingLocal(true)}
                style={{
                  width: "100%",
                  marginTop: "6px",
                  padding: "6px 8px",
                  borderRadius: "6px",
                  border: "1px dashed #374151",
                  backgroundColor: "transparent",
                  color: "#9ca3af",
                  fontSize: "0.8rem",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                + Add New Local Profile
              </button>
            )}
          </div>

          <div style={{ paddingTop: "10px", borderTop: "1px solid #1f2937" }}>
            <div style={{ fontSize: "0.75rem", textTransform: "uppercase", color: "#6b7280", fontWeight: 700, letterSpacing: "0.05em", marginBottom: "6px" }}>
              Cloud Sync
            </div>

            {cloudProfiles.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                {cloudProfiles.map((cp) => (
                  <div
                    key={cp.id}
                    onClick={() => handleSelectProfile(cp.id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "6px 8px",
                      borderRadius: "6px",
                      cursor: "pointer",
                      backgroundColor: cp.id === activeProfile.id ? "#1f2937" : "transparent",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: "0.85rem", fontWeight: 600 }}>{cp.name}</div>
                      <div style={{ fontSize: "0.75rem", color: "#9ca3af" }}>{cp.email}</div>
                    </div>
                    {cp.id === activeProfile.id && <span style={{ color: "#10b981", fontSize: "0.8rem" }}>✓</span>}
                  </div>
                ))}
                {activeProfile.type === "CLOUD" && (
                  <button
                    type="button"
                    onClick={handleLogoutCloud}
                    style={{
                      marginTop: "6px",
                      padding: "6px 8px",
                      borderRadius: "6px",
                      border: "none",
                      backgroundColor: "rgba(239, 68, 68, 0.15)",
                      color: "#ef4444",
                      fontSize: "0.8rem",
                      cursor: "pointer",
                      fontWeight: 600,
                    }}
                  >
                    Sign Out of Cloud
                  </button>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  onOpenAuthModal();
                }}
                style={{
                  width: "100%",
                  padding: "8px",
                  borderRadius: "6px",
                  border: "none",
                  backgroundColor: "#8b5cf6",
                  color: "#ffffff",
                  fontSize: "0.85rem",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                Sign In / Register for Cloud Sync
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
