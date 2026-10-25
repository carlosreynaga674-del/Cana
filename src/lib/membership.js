export function hasCompletedVerification(member) {
  return member?.ageVerification?.status === "verified" &&
    (!member.identityVerification?.required || member.identityVerification.status === "verified");
}
