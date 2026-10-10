export class StreamingByteMatcher {
  readonly #pattern: Uint8Array;
  readonly #prefix: Uint16Array;
  #matched = 0;
  #found = false;

  public constructor(pattern: Uint8Array) {
    if (pattern.byteLength === 0) throw new Error('pattern must not be empty');
    this.#pattern = pattern;
    this.#prefix = new Uint16Array(pattern.byteLength);
    let matched = 0;
    for (let index = 1; index < pattern.byteLength; index += 1) {
      while (matched > 0 && pattern[index] !== pattern[matched])
        matched = this.#prefix[matched - 1]!;
      if (pattern[index] === pattern[matched]) matched += 1;
      this.#prefix[index] = matched;
    }
  }

  public get found(): boolean {
    return this.#found;
  }

  public push(chunk: Uint8Array): void {
    if (this.#found) return;
    for (const byte of chunk) {
      while (this.#matched > 0 && byte !== this.#pattern[this.#matched]) {
        this.#matched = this.#prefix[this.#matched - 1]!;
      }
      if (byte === this.#pattern[this.#matched]) this.#matched += 1;
      if (this.#matched === this.#pattern.byteLength) {
        this.#found = true;
        return;
      }
    }
  }
}
