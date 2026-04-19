import React, { useCallback, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import UserProfileCardModal from "../components/user-profile-card-modal";
import { setOpenedChat } from "../app/lib/chatStore";
import { extractProfileImage, normalizeProfileImageUri } from "../app/lib/profileImage";
import { resolveUserProfileDetails } from "../app/lib/userProfileDetails";

async function resolveCurrentUserId() {
  let userId = await AsyncStorage.getItem("userId");
  if (userId) return userId;

  const nodeKey =
    (await AsyncStorage.getItem("userNodeKey")) ||
    (await AsyncStorage.getItem("studentNodeKey")) ||
    (await AsyncStorage.getItem("studentId")) ||
    null;

  return nodeKey || null;
}

function compactLocation(city, region, fallbackLocation) {
  const combined = [city, region].filter((part) => part && part !== "-").join(", ");
  return combined || fallbackLocation || "-";
}

function resolveDisplayName(resolvedUser, fallbackName) {
  const fullName = [
    resolvedUser?.personal?.firstName,
    resolvedUser?.personal?.middleName,
    resolvedUser?.personal?.lastName,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();

  return fallbackName || resolvedUser?.name || fullName || resolvedUser?.username || "School Account";
}

export default function useUserProfileCard() {
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState(null);

  const closeProfileCard = useCallback(() => {
    setVisible(false);
  }, []);

  const openUserProfile = useCallback(async ({
    candidates = [],
    fallbackSchoolCode = null,
    fallbackUser = null,
    fallbackName = "",
    fallbackAvatar = null,
    fallbackRole = "",
    fallbackRoleTitle = "",
    fallbackSchool = "",
    fallbackCity = "",
    fallbackRegion = "",
    fallbackLocation = "",
    fallbackOfficeNumber = "",
    fallbackContactKey = "",
    fallbackContactUserId = "",
  } = {}) => {
    setVisible(true);
    setLoading(true);
    setProfile(null);

    try {
      const details = await resolveUserProfileDetails(candidates, fallbackSchoolCode);
      const resolvedUser = details?.user || fallbackUser || null;
      const resolvedSchoolInfo = details?.schoolInfo || null;

      const school =
        resolvedSchoolInfo?.name ||
        resolvedSchoolInfo?.schoolName ||
        resolvedUser?.schoolName ||
        resolvedUser?.schoolCode ||
        fallbackSchool ||
        details?.schoolCode ||
        "-";

      const region =
        resolvedSchoolInfo?.region ||
        resolvedSchoolInfo?.address?.region ||
        resolvedUser?.region ||
        fallbackRegion ||
        "-";

      const city =
        resolvedSchoolInfo?.city ||
        resolvedSchoolInfo?.address?.city ||
        resolvedUser?.city ||
        fallbackCity ||
        "-";

      const role = resolvedUser?.role || fallbackRole || "School Account";
      const roleTitle = resolvedUser?.designation || resolvedUser?.subject || fallbackRoleTitle || role;
      const roleText = String(role || "").trim().toLowerCase();
      const roleTitleText = String(roleTitle || "").trim().toLowerCase();

      if (roleText === "student" || roleTitleText === "student") {
        setVisible(false);
        setProfile(null);
        return;
      }

      const officeNumber =
        resolvedUser?.phone ||
        resolvedUser?.phoneNumber ||
        resolvedUser?.alternativePhone ||
        resolvedSchoolInfo?.phone ||
        resolvedSchoolInfo?.alternativePhone ||
        fallbackOfficeNumber ||
        "-";

      const contactUserId =
        resolvedUser?.userId ||
        fallbackContactUserId ||
        candidates.find(Boolean) ||
        "";

      const myUserId = await resolveCurrentUserId();

      setProfile({
        name: resolveDisplayName(resolvedUser, fallbackName),
        role,
        roleTitle,
        avatar: normalizeProfileImageUri(fallbackAvatar || extractProfileImage(resolvedUser)) || "",
        school,
        city,
        region,
        location: compactLocation(city, region, fallbackLocation),
        officeNumber,
        contactKey: details?.userNodeKey || resolvedUser?._nodeKey || fallbackContactKey || contactUserId || "",
        contactUserId,
        canMessage: !!(contactUserId && String(contactUserId) !== String(myUserId || "")),
      });
    } catch (error) {
      console.warn("open user profile failed:", error);
      setVisible(false);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleMessageProfile = useCallback(() => {
    const contactKey = profile?.contactKey || profile?.contactUserId || "";
    const contactUserId = profile?.contactUserId || "";

    if (!contactKey && !contactUserId) return;

    setOpenedChat({
      chatId: "",
      contactKey,
      contactUserId,
      contactName: profile.name || "",
      contactImage: normalizeProfileImageUri(profile.avatar) || "",
    });

    setVisible(false);
    router.push("/messages");
  }, [profile, router]);

  const profileCardModal = useMemo(() => (
    <UserProfileCardModal
      visible={visible}
      loading={loading}
      profile={profile}
      onClose={closeProfileCard}
      onMessage={handleMessageProfile}
    />
  ), [closeProfileCard, handleMessageProfile, loading, profile, visible]);

  return {
    openUserProfile,
    closeProfileCard,
    profileCardModal,
  };
}