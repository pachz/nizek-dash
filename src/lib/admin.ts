/** Hardcoded admin gate for /admin (Session, token, sync). */
export const ADMIN_PASSWORD = "nizek-admin";

const UNLOCK_KEY = "nizek-plus:admin-unlocked";

export function isAdminUnlocked(): boolean {
  try {
    return sessionStorage.getItem(UNLOCK_KEY) === "1";
  } catch {
    return false;
  }
}

export function unlockAdmin(password: string): boolean {
  if (password !== ADMIN_PASSWORD) return false;
  try {
    sessionStorage.setItem(UNLOCK_KEY, "1");
  } catch {
    /* ignore */
  }
  return true;
}

export function lockAdmin() {
  try {
    sessionStorage.removeItem(UNLOCK_KEY);
  } catch {
    /* ignore */
  }
}
