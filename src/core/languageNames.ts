const TWO_LETTER: Record<string, string> = {
  en: "English", es: "Spanish", fr: "French", de: "German", it: "Italian", pt: "Portuguese", nl: "Dutch", pl: "Polish",
  ru: "Russian", zh: "Chinese", ja: "Japanese", ko: "Korean", ar: "Arabic", tr: "Turkish", sv: "Swedish", da: "Danish",
  no: "Norwegian", fi: "Finnish", hu: "Hungarian", cs: "Czech", ro: "Romanian", he: "Hebrew", th: "Thai", vi: "Vietnamese",
  el: "Greek", bg: "Bulgarian", hr: "Croatian", sk: "Slovak", sl: "Slovenian", uk: "Ukrainian", id: "Indonesian", ms: "Malay",
  hi: "Hindi", ta: "Tamil", te: "Telugu", bn: "Bengali", fa: "Persian"
};
const THREE_LETTER: Record<string, string> = {
  eng: "English", spa: "Spanish", fre: "French", fra: "French", ger: "German", deu: "German", ita: "Italian", por: "Portuguese",
  dut: "Dutch", nld: "Dutch", pol: "Polish", rus: "Russian", chi: "Chinese", zho: "Chinese", jpn: "Japanese", kor: "Korean",
  ara: "Arabic", tur: "Turkish", swe: "Swedish", dan: "Danish", nor: "Norwegian", fin: "Finnish", hun: "Hungarian", cze: "Czech",
  ces: "Czech", rum: "Romanian", ron: "Romanian", heb: "Hebrew", tha: "Thai", vie: "Vietnamese", gre: "Greek", ell: "Greek",
  bul: "Bulgarian", hrv: "Croatian", slo: "Slovak", slk: "Slovak", slv: "Slovenian", ukr: "Ukrainian", ind: "Indonesian", may: "Malay",
  msa: "Malay", hin: "Hindi", tam: "Tamil", tel: "Telugu", ben: "Bengali", per: "Persian", fas: "Persian"
};

export const languageOptions: Array<{ code: string; name: string }> = Object.entries(TWO_LETTER)
  .map(([code, name]) => ({ code, name }))
  .sort((a, b) => a.name.localeCompare(b.name));

export function languageDisplayName(code?: string | null) {
  const lower = code?.trim().toLowerCase() ?? "";
  if (!lower) return "Unknown";
  return TWO_LETTER[lower] ?? THREE_LETTER[lower] ?? lower.toUpperCase();
}

export function languageSearchCode(code?: string | null) {
  const lower = code?.trim().toLowerCase() ?? "";
  if (!lower) return "en";
  if (lower in TWO_LETTER) return lower;
  const name = THREE_LETTER[lower];
  if (!name) return "en";
  return Object.entries(TWO_LETTER).find(([, value]) => value === name)?.[0] ?? "en";
}
