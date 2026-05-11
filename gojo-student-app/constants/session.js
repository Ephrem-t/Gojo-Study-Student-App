export const SESSION_LAST_ACTIVE_KEY = "lastActiveAt";
export const SESSION_LAST_LOGIN_KEY = "lastLoginAt";
export const SESSION_EXPIRED_NOTICE_KEY = "sessionExpiredNotice";
export const SESSION_TIMEOUT_DAYS = 7;
export const SESSION_INACTIVITY_LIMIT_MS = SESSION_TIMEOUT_DAYS * 24 * 60 * 60 * 1000;

export const SESSION_AUTH_KEYS = [
  "userId",
  "username",
  "userNodeKey",
  "studentId",
  "studentNodeKey",
  "role",
  "schoolKey",
  "studentGrade",
  "grade",
  "profileImage",
  SESSION_LAST_ACTIVE_KEY,
  SESSION_LAST_LOGIN_KEY,
];

function toSessionTimestamp(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return numeric;
}

export function isStudentSessionValid(session = {}, now = Date.now()) {
  const role = String(session?.role || "").trim().toLowerCase();
  const userId = String(session?.userId || "").trim();
  const lastSeenAt = toSessionTimestamp(session?.[SESSION_LAST_ACTIVE_KEY] || session?.[SESSION_LAST_LOGIN_KEY]);

  if (role !== "student" || !userId || !lastSeenAt) {
    return false;
  }

  return now - lastSeenAt <= SESSION_INACTIVITY_LIMIT_MS;
}