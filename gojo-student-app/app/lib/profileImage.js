const DEFAULT_IMAGE_TOKENS = ["/default-profile.png", "default-profile.png", "default-profile"];

export function normalizeProfileImageUri(value, options = {}) {
  const allowBlob = !!options.allowBlob;
  if (!value || typeof value !== "string") return null;

  const uri = value.trim();
  if (!uri) return null;

  const lowered = uri.toLowerCase();
  if (DEFAULT_IMAGE_TOKENS.some((token) => lowered === token || lowered.endsWith(token))) return null;
  if (lowered.startsWith("file://")) return null;
  if (lowered.startsWith("blob:")) return allowBlob ? uri : null;
  if (lowered.startsWith("/")) return null;

  if (/^(https?:\/\/|data:image\/)/i.test(uri)) return uri;
  return null;
}

export function extractProfileImage(entity, options = {}) {
  if (!entity || typeof entity !== "object") return null;

  const personal = entity.personal || {};
  const profilePersonal = entity.profileData?.personal || {};
  const systemInfo = entity.systemAccountInformation || {};
  const basicStudent = entity.basicStudentInformation || {};

  const candidates = [
    entity.profileImage,
    entity.avatar,
    entity.studentPhoto,
    personal.profileImage,
    personal.profileImageName,
    personal.studentPhoto,
    profilePersonal.profileImage,
    profilePersonal.profileImageName,
    profilePersonal.studentPhoto,
    systemInfo.profileImage,
    basicStudent.profileImage,
    basicStudent.studentPhoto,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeProfileImageUri(candidate, options);
    if (normalized) return normalized;
  }
  return null;
}
