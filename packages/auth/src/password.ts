import { hash, parseOptions, verify } from '@node-rs/argon2';
import { ZxcvbnFactory } from '@zxcvbn-ts/core';
import * as common from '@zxcvbn-ts/language-common';
import * as english from '@zxcvbn-ts/language-en';

const PASSWORD_OPTIONS = {
  algorithm: 2,
  memoryCost: 19_456,
  outputLen: 32,
  parallelism: 1,
  timeCost: 2,
} as const;

const passwordEstimator = new ZxcvbnFactory({
  dictionary: { ...common.dictionary, ...english.dictionary },
  graphs: common.adjacencyGraphs,
  translations: english.translations,
});

class AsyncSemaphore {
  readonly #limit: number;
  #active = 0;
  readonly #waiting: Array<() => void> = [];

  constructor(limit: number) {
    if (!Number.isInteger(limit) || limit < 1)
      throw new Error('Concurrency limit must be positive.');
    this.#limit = limit;
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.#active >= this.#limit)
      await new Promise<void>((resolve) => this.#waiting.push(resolve));
    this.#active += 1;
    try {
      return await operation();
    } finally {
      this.#active -= 1;
      this.#waiting.shift()?.();
    }
  }
}

export interface PasswordPolicyResult {
  accepted: boolean;
  score: number;
}

export class PasswordService {
  readonly #semaphore: AsyncSemaphore;

  constructor(concurrency = 4) {
    this.#semaphore = new AsyncSemaphore(concurrency);
  }

  assess(input: string, userInputs: string[] = []): PasswordPolicyResult {
    const password = input.normalize('NFC');
    const length = [...password].length;
    const score = passwordEstimator.check(password, userInputs).score;
    return { accepted: length >= 15 && length <= 128 && score >= 3, score };
  }

  normalize(input: string): string {
    return input.normalize('NFC');
  }

  async hash(input: string): Promise<string> {
    const password = this.normalize(input);
    return this.#semaphore.run(() => hash(password, PASSWORD_OPTIONS));
  }

  async verify(encoded: string, input: string): Promise<boolean> {
    const password = this.normalize(input);
    return this.#semaphore.run(() => verify(encoded, password, PASSWORD_OPTIONS));
  }

  needsRehash(encoded: string): boolean {
    const parsed = parseOptions(encoded);
    return (
      parsed.algorithm !== 2 || // @node-rs/argon2 Algorithm.Argon2id
      parsed.version !== 1 || // @node-rs/argon2 Version.V0x13 (PHC v=19)
      parsed.memoryCost < PASSWORD_OPTIONS.memoryCost ||
      parsed.timeCost < PASSWORD_OPTIONS.timeCost ||
      parsed.parallelism < PASSWORD_OPTIONS.parallelism ||
      parsed.outputLen < PASSWORD_OPTIONS.outputLen ||
      parsed.saltLen < 16
    );
  }
}
