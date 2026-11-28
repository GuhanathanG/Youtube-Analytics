/* ------------------------------------------------------------------ labels */
export const LANGUAGE_NAMES: Record<string, string> = {
  en: "English", ta: "Tamil", "ta-Latn": "Tanglish", hi: "Hindi", "hi-Latn": "Hinglish",
  te: "Telugu", kn: "Kannada", ml: "Malayalam", bn: "Bengali", mr: "Marathi", gu: "Gujarati",
  pa: "Punjabi", ur: "Urdu", ar: "Arabic", fa: "Persian", si: "Sinhala", ne: "Nepali", or: "Odia",
  es: "Spanish", fr: "French", de: "German", pt: "Portuguese", it: "Italian", ru: "Russian",
  ja: "Japanese", ko: "Korean", zh: "Chinese", id: "Indonesian", tl: "Tagalog", vi: "Vietnamese",
  th: "Thai", tr: "Turkish", nl: "Dutch", ro: "Romanian", pl: "Polish", sv: "Swedish", ms: "Malay", sw: "Swahili",
  und: "Unknown / emoji",
};
/** "en-Latn" → English, "ml-Latn" → "Malayalam (English letters)", "ro" → "ro" (unknown codes stay as they are). */
export const languageName = (c: string | null) => {
  if (!c) return "Pending";
  if (LANGUAGE_NAMES[c]) return LANGUAGE_NAMES[c];
  const [base, script] = c.split("-");
  const name = LANGUAGE_NAMES[base];
  if (!name) return c;
  return script === "Latn" ? (base === "en" ? name : `${name} (English letters)`) : name;
};

export const ASPECT_LABELS: Record<string, string> = {
  content: "Content", host: "Host / creator", editing: "Editing", audio: "Audio",
  video_quality: "Video quality", thumbnail_title: "Thumbnail & title", length_pacing: "Length & pacing",
  music: "Music", ads_sponsor: "Ads & sponsors", information: "Information", humor: "Humour",
  guest: "Guests", other: "Other",
};

export const EMOTIONS: Record<string, string> = {
  joy: "😄", love: "❤️", gratitude: "🙏", admiration: "🤩", excitement: "🔥", humor: "😂",
  surprise: "😮", curiosity: "🤔", neutral: "😐", confusion: "😕", disappointment: "😞",
  sadness: "😢", anger: "😠", disgust: "🤢", fear: "😨", sarcasm: "🙃",
};

