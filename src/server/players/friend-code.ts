import { randomInt } from "node:crypto";

import { FRIEND_CODE_ALPHABET, FRIEND_CODE_LENGTH } from "../../shared/schemas/players.js";

/** 8 characters from an alphabet without 0/O or 1/I/L (AC-002.2); `randomInt` has no bias. */
export function generateFriendCode(randomIndex: (max: number) => number = randomInt): string {
  let code = "";
  for (let index = 0; index < FRIEND_CODE_LENGTH; index += 1) {
    const character = FRIEND_CODE_ALPHABET[randomIndex(FRIEND_CODE_ALPHABET.length)];
    if (character === undefined) {
      throw new RangeError("randomIndex returned an index outside the alphabet");
    }
    code += character;
  }
  return code;
}
