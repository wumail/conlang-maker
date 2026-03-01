/**
 * 音素 Tokenizer
 * 将字符串分割为音素 token 数组，正确处理双字符/多字符音素（如 tʃ, dʒ, ts 等）
 */

/**
 * 将音素字符串按最长匹配贪心策略分割为音素 token 数组
 * @param word   输入的 IPA/罗马化字符串
 * @param inventory 可用音素列表（从音素库或 PHONEME_FEATURES 键集合获取）
 * @returns 音素 token 数组
 */
export function tokenizePhonemes(word: string, inventory: string[]): string[] {
  if (!word) return [];
  // 按长度降序排列，确保多字符音素优先匹配
  const sorted = [...inventory].sort((a, b) => b.length - a.length);
  const tokens: string[] = [];
  let pos = 0;

  while (pos < word.length) {
    let matched = false;
    for (const phoneme of sorted) {
      if (phoneme.length > 0 && word.startsWith(phoneme, pos)) {
        tokens.push(phoneme);
        pos += phoneme.length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      // 无法匹配任何音素，取单字符
      tokens.push(word[pos]);
      pos += 1;
    }
  }

  return tokens;
}

/**
 * 将音素 token 数组拼接回字符串
 */
export function joinPhonemes(tokens: string[]): string {
  return tokens.join('');
}
