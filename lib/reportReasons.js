// Shared by the report button (browser) and lib/moderation.js (server).

export const REPORT_REASONS = {
  copyright: 'Stolen or copyrighted',
  sexual: 'Sexual content',
  violence: 'Violence or graphic',
  hate: 'Hate or harassment',
  spam: 'Spam or misleading',
  broken: "Won't play or broken"
};

export const FLAG_REASONS = {
  copyright: 'Rights / copyright',
  sexual: 'Sexual content',
  violence: 'Violence / graphic',
  hate: 'Hate or harassment',
  spam: 'Spam / misleading',
  technical: 'Technical problem',
  wrong_info: 'Wrong info or rating',
  other: 'Other'
};
