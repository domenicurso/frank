export interface TypoConfig {
  // Probability weights for different typo types (higher = more likely)
  typoWeights: {
    missingLetter: 25;
    doubleLetter: 20;
    swapAdjacent: 20;
    wrongLetter: 15;
    extraLetter: 10;
    transposition: 5;
    autocorrect: 3;
    caseMistake: 2;
  };
  // Probability of applying typos (0-1)
  typoChance: 0.15;
  // Minimum word length to apply typos
  minWordLength: 3;
  // Maximum typos per response
  maxTypos: 2;
}

const DEFAULT_CONFIG: TypoConfig = {
  typoWeights: {
    missingLetter: 25,
    doubleLetter: 20,
    swapAdjacent: 20,
    wrongLetter: 15,
    extraLetter: 10,
    transposition: 5,
    autocorrect: 3,
    caseMistake: 2,
  },
  typoChance: 0.15,
  minWordLength: 3,
  maxTypos: 2,
};

// Common keyboard layout mistakes
const KEYBOARD_MISTAKES: Record<string, string[]> = {
  a: ["s", "q", "w"],
  b: ["v", "g", "h", "n"],
  c: ["x", "d", "f", "v"],
  d: ["s", "e", "r", "f", "c", "x"],
  e: ["w", "r", "s", "d"],
  f: ["d", "r", "t", "g", "c", "v"],
  g: ["f", "t", "y", "h", "v", "b"],
  h: ["g", "y", "u", "j", "b", "n"],
  i: ["u", "o", "j", "k"],
  j: ["h", "u", "i", "k", "n", "m"],
  k: ["j", "i", "o", "l", "m"],
  l: ["k", "o", "p"],
  m: ["n", "j", "k"],
  n: ["b", "h", "j", "m"],
  o: ["i", "p", "k", "l"],
  p: ["o", "l"],
  q: ["w", "a", "s"],
  r: ["e", "t", "d", "f"],
  s: ["a", "w", "e", "d", "x", "z"],
  t: ["r", "y", "f", "g"],
  u: ["y", "i", "h", "j"],
  v: ["c", "f", "g", "b"],
  w: ["q", "e", "a", "s"],
  x: ["z", "s", "d", "c"],
  y: ["t", "u", "g", "h"],
  z: ["a", "s", "x"],
};

// Common autocorrect-style mistakes
const AUTOCORRECT_MISTAKES: Record<string, string[]> = {
  youre: ["your"],
  your: ["youre"],
  its: ["it's"],
  lose: ["loose"],
  there: ["their", "they're"],
  their: ["there", "they're"],
  then: ["than"],
  than: ["then"],
  affect: ["effect"],
  effect: ["affect"],
  accept: ["except"],
  except: ["accept"],
  definitely: ["defiantly"],
  separate: ["seperate"],
  whether: ["weather"],
  weather: ["whether"],
  piece: ["peace"],
  peace: ["piece"],
  break: ["brake"],
  brake: ["break"],
};

type TypoType = keyof TypoConfig["typoWeights"];

interface TypoResult {
  originalWord: string;
  typoWord: string;
  typoType: TypoType;
}

function selectWeightedTypoType(weights: Record<TypoType, number>): TypoType {
  const totalWeight = Object.values(weights).reduce(
    (sum, weight) => sum + weight,
    0,
  );
  let random = Math.random() * totalWeight;

  for (const [type, weight] of Object.entries(weights)) {
    random -= weight;
    if (random <= 0) {
      return type as TypoType;
    }
  }

  return "missingLetter"; // fallback
}

function applyTypo(word: string, typoType: TypoType): string {
  const lowerWord = word.toLowerCase();

  switch (typoType) {
    case "missingLetter": {
      if (word.length < 4) return word;
      const pos = Math.floor(Math.random() * (word.length - 1)) + 1; // Skip first letter
      return word.slice(0, pos) + word.slice(pos + 1);
    }

    case "doubleLetter": {
      const pos = Math.floor(Math.random() * word.length);
      return word.slice(0, pos) + word[pos] + word.slice(pos);
    }

    case "swapAdjacent": {
      if (word.length < 2) return word;
      const pos = Math.floor(Math.random() * (word.length - 1));
      return (
        word.slice(0, pos) + word[pos + 1] + word[pos] + word.slice(pos + 2)
      );
    }

    case "wrongLetter": {
      const pos = Math.floor(Math.random() * word.length);
      const char = lowerWord[pos];
      if (!char) return word;
      const mistakes = KEYBOARD_MISTAKES[char] || [];

      if (mistakes.length === 0) return word;

      const wrongChar = mistakes[Math.floor(Math.random() * mistakes.length)];
      const isUpperCase = word[pos] !== lowerWord[pos];
      const replacement = isUpperCase ? wrongChar!.toUpperCase() : wrongChar!;

      return word.slice(0, pos) + replacement + word.slice(pos + 1);
    }

    case "extraLetter": {
      const pos = Math.floor(Math.random() * (word.length + 1));
      const chars = "abcdefghijklmnopqrstuvwxyz";
      const randomChar = chars[Math.floor(Math.random() * chars.length)]!;
      return word.slice(0, pos) + randomChar + word.slice(pos);
    }

    case "transposition": {
      if (word.length < 4) return word;
      const pos1 = Math.floor(Math.random() * word.length);
      let pos2 = Math.floor(Math.random() * word.length);

      // Ensure positions are different and not adjacent
      while (pos2 === pos1 || Math.abs(pos2 - pos1) === 1) {
        pos2 = Math.floor(Math.random() * word.length);
      }

      const [min, max] = pos1 < pos2 ? [pos1, pos2] : [pos2, pos1];
      return (
        word.slice(0, min) +
        word[max] +
        word.slice(min + 1, max) +
        word[min] +
        word.slice(max + 1)
      );
    }

    case "autocorrect": {
      const corrections = AUTOCORRECT_MISTAKES[lowerWord];
      if (!corrections || corrections.length === 0) return word;

      const correction =
        corrections[Math.floor(Math.random() * corrections.length)]!;

      // Preserve case pattern
      if (word[0] !== lowerWord[0]) {
        return correction.charAt(0).toUpperCase() + correction.slice(1);
      }

      return correction;
    }

    case "caseMistake": {
      if (word.length < 2) return word;
      const pos = Math.floor(Math.random() * word.length);
      const char = word[pos]!;
      const newChar =
        char === char.toLowerCase() ? char.toUpperCase() : char.toLowerCase();
      return word.slice(0, pos) + newChar + word.slice(pos + 1);
    }

    default:
      return word;
  }
}

export function simulateTypo(
  word: string,
  config: TypoConfig = DEFAULT_CONFIG,
): TypoResult | null {
  if (word.length < config.minWordLength) {
    return null;
  }

  // Skip if it's a mention, emoji, or special token
  if (word.startsWith("<@") || word.startsWith(":") || word.startsWith("::")) {
    return null;
  }

  const typoType = selectWeightedTypoType(config.typoWeights);
  const typoWord = applyTypo(word, typoType);

  if (typoWord === word) {
    return null;
  }

  return {
    originalWord: word,
    typoWord,
    typoType,
  };
}

function getRandomCorrection(originalWord: string, typoType: TypoType): string {
  const corrections = [
    `*${originalWord}`,
    `**${originalWord}`,
    `${originalWord}*`,
    `*${originalWord}*`,
  ];

  // Add context-aware corrections based on typo type
  if (typoType === "autocorrect") {
    corrections.push(`i meant ${originalWord}`);
    corrections.push(`${originalWord}***`);
  }

  if (typoType === "caseMistake") {
    corrections.push(`${originalWord}*`);
  }

  return corrections[Math.floor(Math.random() * corrections.length)]!;
}

// Enhanced function that can add multiple typos with varied corrections
export function addTyposWithCorrection(
  response: string,
  config: TypoConfig = DEFAULT_CONFIG,
): string {
  const words = response.split(/(\s+)/); // Split on whitespace but keep the whitespace
  if (words.length < 3) return response;

  const typos: Array<{ index: number; result: TypoResult }> = [];
  const wordIndices = words
    .map((part, index) => ({ part, index }))
    .filter(({ part }) => part.trim().length > 0 && !/^\s+$/.test(part));

  // Don't typo the first or last meaningful word
  const eligibleWords = wordIndices.slice(1, -1);

  let typoCount = 0;
  const maxTypos = Math.min(
    config.maxTypos,
    Math.floor(eligibleWords.length / 3),
  );

  for (const { part, index } of eligibleWords) {
    if (typoCount >= maxTypos) break;
    if (Math.random() > config.typoChance) continue;

    const typoResult = simulateTypo(part.trim(), config);
    if (typoResult) {
      typos.push({ index, result: typoResult });
      typoCount++;
    }
  }

  if (typos.length === 0) return response;

  // Apply typos to create the response with errors
  const typoWords = [...words];
  for (const { index, result } of typos) {
    typoWords[index] = typoWords[index]!.replace(
      result.originalWord,
      result.typoWord,
    );
  }

  const typoResponse = typoWords.join("");

  // Add corrections (sometimes multiple, sometimes just one)
  const corrections: string[] = [];

  if (typos.length === 1) {
    // Single typo - simple correction
    corrections.push(
      getRandomCorrection(
        typos[0]!.result.originalWord,
        typos[0]!.result.typoType,
      ),
    );
  } else {
    // Multiple typos - varied correction styles
    const correctionStyle = Math.random();

    if (correctionStyle < 0.4) {
      // Correct all at once
      const allCorrections = typos.map(({ result }) =>
        getRandomCorrection(result.originalWord, result.typoType),
      );
      corrections.push(allCorrections.join(" "));
    } else if (correctionStyle < 0.7) {
      // Correct the most recent typo
      const lastTypo = typos[typos.length - 1]!;
      corrections.push(
        getRandomCorrection(
          lastTypo.result.originalWord,
          lastTypo.result.typoType,
        ),
      );
    } else {
      // Correct a random typo
      const randomTypo = typos[Math.floor(Math.random() * typos.length)]!;
      corrections.push(
        getRandomCorrection(
          randomTypo.result.originalWord,
          randomTypo.result.typoType,
        ),
      );
    }
  }

  return `${typoResponse}\n${corrections.join("\n")}`;
}

// Check if a response should have typos applied (based on personality/context)
export function shouldApplyTypos(
  response: string,
  context?: {
    isExcited?: boolean;
    isRushed?: boolean;
    isLongMessage?: boolean;
  },
): boolean {
  const baseChance = DEFAULT_CONFIG.typoChance;
  let adjustedChance = baseChance;

  if (context?.isExcited) {
    adjustedChance *= 1.5; // More likely when excited
  }

  if (context?.isRushed) {
    adjustedChance *= 2; // Much more likely when rushed
  }

  if (context?.isLongMessage) {
    adjustedChance *= 1.2; // Slightly more likely in long messages
  }

  // Less likely for very short responses
  if (response.length < 20) {
    adjustedChance *= 0.3;
  }

  return Math.random() < Math.min(adjustedChance, 0.4); // Cap at 40%
}
