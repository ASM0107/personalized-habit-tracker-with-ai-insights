import type { UserProfile } from "../types/index.js";

const STORAGE_KEY_PROFILES = "habit_tracker_user_profiles";
const STORAGE_KEY_ACTIVE = "habit_tracker_active_profile_id";

const DEFAULT_PROFILE: UserProfile = {
  id: "default",
  name: "Personal",
  type: "LOCAL",
  avatarColor: "#3b82f6",
  createdAt: Date.now(),
  lastActiveAt: Date.now(),
};

const PALETTE = ["#3b82f6", "#10b981", "#8b5cf6", "#ec4899", "#f59e0b", "#06b6d4"];

export class ProfileStore {
  private profiles: Map<string, UserProfile> = new Map();
  private activeProfileId: string = "default";
  private readonly listeners = new Set<() => void>();

  public constructor() {
    this.hydrate();
  }

  private hydrate(): void {
    if (typeof window === "undefined" || !window.localStorage) {
      this.profiles.set(DEFAULT_PROFILE.id, DEFAULT_PROFILE);
      this.activeProfileId = DEFAULT_PROFILE.id;
      return;
    }

    try {
      const raw = window.localStorage.getItem(STORAGE_KEY_PROFILES);
      if (raw) {
        const parsed = JSON.parse(raw) as readonly UserProfile[];
        for (const p of parsed) {
          this.profiles.set(p.id, p);
        }
      }
    } catch {
      this.profiles.clear();
    }

    if (!this.profiles.has("default")) {
      this.profiles.set(DEFAULT_PROFILE.id, DEFAULT_PROFILE);
    }

    const savedActive = window.localStorage.getItem(STORAGE_KEY_ACTIVE);
    if (savedActive && this.profiles.has(savedActive)) {
      this.activeProfileId = savedActive;
    } else {
      this.activeProfileId = "default";
    }

    this.persist();
  }

  private persist(): void {
    if (typeof window === "undefined" || !window.localStorage) {
      return;
    }
    try {
      const all = Array.from(this.profiles.values());
      window.localStorage.setItem(STORAGE_KEY_PROFILES, JSON.stringify(all));
      window.localStorage.setItem(STORAGE_KEY_ACTIVE, this.activeProfileId);
    } catch {
      return;
    }
  }

  private notify(): void {
    this.persist();
    for (const listener of this.listeners) {
      listener();
    }
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getActiveProfile(): UserProfile {
    const found = this.profiles.get(this.activeProfileId);
    if (found) {
      return found;
    }
    const def = this.profiles.get("default") || DEFAULT_PROFILE;
    this.activeProfileId = def.id;
    return def;
  }

  public getAllProfiles(): readonly UserProfile[] {
    return Array.from(this.profiles.values());
  }

  public getLocalProfiles(): readonly UserProfile[] {
    return Array.from(this.profiles.values()).filter((p) => p.type === "LOCAL");
  }

  public getCloudProfiles(): readonly UserProfile[] {
    return Array.from(this.profiles.values()).filter((p) => p.type === "CLOUD");
  }

  public createLocalProfile(name: string, customColor?: string): UserProfile {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new Error("Profile name cannot be empty");
    }

    const id = `profile_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
    const randomColor = PALETTE[Math.floor(Math.random() * PALETTE.length)] || "#3b82f6";
    const profile: UserProfile = {
      id,
      name: trimmed,
      type: "LOCAL",
      avatarColor: customColor || randomColor,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };

    this.profiles.set(id, profile);
    this.activeProfileId = id;
    this.notify();
    return profile;
  }

  public switchProfile(profileId: string): UserProfile {
    const target = this.profiles.get(profileId);
    if (!target) {
      throw new Error(`Profile with id "${profileId}" not found`);
    }

    const updated: UserProfile = {
      ...target,
      lastActiveAt: Date.now(),
    };
    this.profiles.set(profileId, updated);
    this.activeProfileId = profileId;
    this.notify();
    return updated;
  }

  public deleteProfile(profileId: string): boolean {
    if (profileId === "default") {
      return false;
    }
    const deleted = this.profiles.delete(profileId);
    if (deleted) {
      if (this.activeProfileId === profileId) {
        this.activeProfileId = "default";
      }
      this.notify();
    }
    return deleted;
  }

  public renameProfile(profileId: string, newName: string): boolean {
    const trimmed = newName.trim();
    const existing = this.profiles.get(profileId);
    if (!existing || !trimmed) {
      return false;
    }
    this.profiles.set(profileId, { ...existing, name: trimmed });
    this.notify();
    return true;
  }

  public addOrUpdateCloudAccount(cloudUser: UserProfile, token: string): UserProfile {
    const profile: UserProfile = {
      ...cloudUser,
      type: "CLOUD",
      token,
      lastActiveAt: Date.now(),
    };
    this.profiles.set(profile.id, profile);
    this.activeProfileId = profile.id;
    this.notify();
    return profile;
  }

  public logoutCloud(profileId: string): void {
    const existing = this.profiles.get(profileId);
    if (!existing || existing.type !== "CLOUD") {
      return;
    }
    this.profiles.delete(profileId);
    if (this.activeProfileId === profileId) {
      this.activeProfileId = "default";
    }
    this.notify();
  }
}
