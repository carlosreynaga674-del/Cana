export const businessContactEmail = "loudpluscana@protonmail.com";

export function resolveBusinessContactEmail(value) {
  const address = typeof value === "string" ? value.trim() : "";
  // Migrate the retired contact on existing deployments; keep other configured contacts.
  return !address || address.toLowerCase() === "loudcana001@icloud.com"
    ? businessContactEmail
    : address;
}
