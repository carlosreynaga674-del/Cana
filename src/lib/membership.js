export function hasCompletedVerification(member) {
  return member?.ageVerification?.status === "verified" &&
    (!member.identityVerification?.required || member.identityVerification.status === "verified");
}

export const MEMBERSHIP_NUMBER_PATTERN = /^LC-\d{6}$/;
export const LEGACY_MEMBERSHIP_NUMBER_PATTERN = /^LC-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

export function normalizeMembershipNumber(value) {
  const number = typeof value === "string" ? value.trim().toUpperCase() : "";
  return /^\d{6}$/.test(number) ? "LC-" + number : number;
}
