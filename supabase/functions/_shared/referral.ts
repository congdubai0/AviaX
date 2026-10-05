export function maskReferralName(username: string | null, firstName: string): string {
  const name = username?.trim()
    ? `@${username.trim()}`
    : firstName.trim() || "Pemain";
  return `${name.slice(0, 2)}***`;
}

export function buildReferralUrl(
  botUsername: string,
  appShortName: string,
  referralCode: string,
): string {
  const bot = botUsername.trim().replace(/^@/, "");
  const shortName = appShortName.trim();
  if (!/^[A-Za-z0-9_]{5,32}$/.test(bot) || !/^[A-Za-z0-9_]{3,30}$/.test(shortName)) return "";
  if (!/^[A-Z0-9]{6,16}$/.test(referralCode)) return "";
  return `https://t.me/${bot}/${shortName}?startapp=ref_${referralCode}`;
}
