import { get, ref } from "../../lib/offlineDatabase";
import { database } from "../../constants/firebaseConfig";
import { queryUserByUsernameInSchool, queryUserByChildInSchool } from "./userHelpers";

function normalizeGrade(value) {
  if (!value) return null;
  const text = String(value).trim().toLowerCase();
  const matched = text.match(/(\d{1,2})/);
  if (matched) return String(matched[1]);
  return text.replace(/^grade\s*/i, "") || null;
}

export function formatGradeLabel(student) {
  const normalized = normalizeGrade(
    student?.basicStudentInformation?.grade ||
    student?.grade ||
    ""
  );
  return normalized ? `Grade ${normalized}` : "-";
}

async function resolveSchoolCandidates(candidates, fallbackSchoolCode = null) {
  const resolved = [];
  if (fallbackSchoolCode) resolved.push(String(fallbackSchoolCode));

  for (const candidate of candidates) {
    try {
      const prefix = String(candidate).slice(0, 3).toUpperCase();
      if (!prefix) continue;
      const snap = await get(ref(database, `Platform1/schoolCodeIndex/${prefix}`));
      const schoolCode = snap?.exists() ? snap.val() : null;
      if (schoolCode && !resolved.includes(String(schoolCode))) {
        resolved.push(String(schoolCode));
      }
    } catch {}
  }

  return resolved;
}

async function resolveUserInSchool(candidate, schoolCode) {
  if (!candidate || !schoolCode) return { user: null, nodeKey: null };

  try {
    const direct = await get(ref(database, `Platform1/Schools/${schoolCode}/Users/${candidate}`));
    if (direct?.exists()) {
      return { user: direct.val() || null, nodeKey: candidate };
    }
  } catch {}

  try {
    const byUsername = await queryUserByUsernameInSchool(candidate, schoolCode);
    if (byUsername?.exists()) {
      let resolvedUser = null;
      let resolvedNodeKey = null;
      byUsername.forEach((child) => {
        resolvedUser = child.val() || null;
        resolvedNodeKey = child.key || null;
        return true;
      });
      if (resolvedUser) return { user: resolvedUser, nodeKey: resolvedNodeKey };
    }
  } catch {}

  try {
    const byUserId = await queryUserByChildInSchool("userId", candidate, schoolCode);
    if (byUserId?.exists()) {
      let resolvedUser = null;
      let resolvedNodeKey = null;
      byUserId.forEach((child) => {
        resolvedUser = child.val() || null;
        resolvedNodeKey = child.key || null;
        return true;
      });
      if (resolvedUser) return { user: resolvedUser, nodeKey: resolvedNodeKey };
    }
  } catch {}

  return { user: null, nodeKey: null };
}

async function resolveUserGlobally(candidate) {
  if (!candidate) return { user: null, nodeKey: null };

  try {
    const direct = await get(ref(database, `Users/${candidate}`));
    if (direct?.exists()) {
      return { user: direct.val() || null, nodeKey: candidate };
    }
  } catch {}

  try {
    const byUserId = await queryUserByChildInSchool("userId", candidate, null);
    if (byUserId?.exists()) {
      let resolvedUser = null;
      let resolvedNodeKey = null;
      byUserId.forEach((child) => {
        resolvedUser = child.val() || null;
        resolvedNodeKey = child.key || null;
        return true;
      });
      if (resolvedUser) return { user: resolvedUser, nodeKey: resolvedNodeKey };
    }
  } catch {}

  return { user: null, nodeKey: null };
}

export async function resolveUserProfileDetails(candidates, fallbackSchoolCode = null) {
  const normalizedCandidates = Array.from(new Set((candidates || []).filter(Boolean).map((value) => String(value).trim()).filter(Boolean)));
  if (!normalizedCandidates.length) {
    return { user: null, student: null, schoolInfo: null, schoolCode: fallbackSchoolCode || null, userNodeKey: null };
  }

  const schoolCandidates = await resolveSchoolCandidates(normalizedCandidates, fallbackSchoolCode);

  for (const schoolCode of schoolCandidates) {
    for (const candidate of normalizedCandidates) {
      const { user, nodeKey } = await resolveUserInSchool(candidate, schoolCode);
      if (!user) continue;

      const studentId = user?.studentId || null;
      let student = null;
      if (studentId) {
        try {
          const studentSnap = await get(ref(database, `Platform1/Schools/${schoolCode}/Students/${studentId}`));
          if (studentSnap?.exists()) student = studentSnap.val() || null;
        } catch {}
      }

      let schoolInfo = null;
      try {
        const schoolInfoSnap = await get(ref(database, `Platform1/Schools/${schoolCode}/schoolInfo`));
        if (schoolInfoSnap?.exists()) schoolInfo = schoolInfoSnap.val() || null;
      } catch {}

      return { user, student, schoolInfo, schoolCode, userNodeKey: nodeKey };
    }
  }

  for (const candidate of normalizedCandidates) {
    const { user, nodeKey } = await resolveUserGlobally(candidate);
    if (user) {
      return { user, student: null, schoolInfo: null, schoolCode: fallbackSchoolCode || null, userNodeKey: nodeKey };
    }
  }

  return { user: null, student: null, schoolInfo: null, schoolCode: fallbackSchoolCode || null, userNodeKey: null };
}