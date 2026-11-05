/* ------------------------------------------------------------------ labels */
export const LANGUAGE_NAMES: Record<string, string> = {
  en: "English", ta: "Tamil", "ta-Latn": "Tanglish", hi: "Hindi", "hi-Latn": "Hinglish",
  te: "Telugu", kn: "Kannada", ml: "Malayalam", bn: "Bengali", mr: "Marathi", gu: "Gujarati",
  pa: "Punjabi", ur: "Urdu", ar: "Arabic", fa: "Persian", si: "Sinhala", ne: "Nepali", or: "Odia",
  es: "Spanish", fr: "French", de: "German", pt: "Portuguese", it: "Italian", ru: "Russian",
  ja: "Japanese", ko: "Korean", zh: "Chinese", id: "Indonesian", tl: "Tagalog", vi: "Vietnamese",
  th: "Thai", tr: "Turkish", nl: "Dutch", und: "Unknown / emoji",
};
export const languageName = (c: string | null) => (c ? LANGUAGE_NAMES[c] ?? c : "Pending");

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

