const CJK_CHARACTER = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

export function estimateTokens(value: string): number {
  let cjk = 0;
  let other = 0;

  for (const character of value) {
    if (CJK_CHARACTER.test(character)) {
      cjk += 1;
    } else if (!/\s/u.test(character)) {
      other += 1;
    }
  }

  return Math.max(0, Math.ceil(cjk * 1.3 + other / 4));
}

export function truncateToTokenBudget(value: string, budget: number): string {
  if (budget <= 0) return "";
  if (estimateTokens(value) <= budget) return value;

  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (estimateTokens(value.slice(0, middle)) <= budget) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }

  return value.slice(0, low).trimEnd();
}
