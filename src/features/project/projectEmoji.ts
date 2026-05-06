const PROJECT_EMOJIS = [
  '🎨', '📝', '🎬', '📷', '✏️', '🎯', '📊', '🚀', '💡', '🔧',
  '🎵', '📖', '🎮', '🏗️', '🎪', '📋', '🔬', '🖼️', '🧩', '💎',
  '🌟', '🎭', '📦', '🗂️', '🎁', '🔮', '🧪', '🎈', '🏆', '📌',
];

export function projectEmoji(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash) + id.charCodeAt(i);
    hash |= 0;
  }
  return PROJECT_EMOJIS[Math.abs(hash) % PROJECT_EMOJIS.length];
}
