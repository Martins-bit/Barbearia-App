export class JsonStreamValidationError extends Error {
  constructor() {
    super('A resposta de exportação não contém um JSON completo e válido.')
    this.name = 'JsonStreamValidationError'
  }
}

type ArrayFrame = {
  type: 'array'
  state: 'firstOrEnd' | 'value' | 'commaOrEnd'
}

type ObjectFrame = {
  type: 'object'
  state: 'firstKeyOrEnd' | 'key' | 'colon' | 'value' | 'commaOrEnd'
}

type ContainerFrame = ArrayFrame | ObjectFrame
type NumberState =
  | 'minus'
  | 'zero'
  | 'integer'
  | 'dot'
  | 'fraction'
  | 'exponent'
  | 'exponentSign'
  | 'exponentDigits'

type LexicalState =
  | {
      type: 'string'
      role: 'key' | 'value'
      escaped: boolean
      unicodeDigitsRemaining: number
    }
  | { type: 'number'; state: NumberState }
  | { type: 'literal'; expected: string; index: number }

function isJsonWhitespace(character: string): boolean {
  return (
    character === ' ' ||
    character === '\t' ||
    character === '\n' ||
    character === '\r'
  )
}

function isDigit(character: string): boolean {
  return character >= '0' && character <= '9'
}

function isNonZeroDigit(character: string): boolean {
  return character >= '1' && character <= '9'
}

function isHexDigit(character: string): boolean {
  return (
    (character >= '0' && character <= '9') ||
    (character >= 'a' && character <= 'f') ||
    (character >= 'A' && character <= 'F')
  )
}

function nextNumberState(
  state: NumberState,
  character: string,
): NumberState | null {
  switch (state) {
    case 'minus':
      if (character === '0') return 'zero'
      return isNonZeroDigit(character) ? 'integer' : null
    case 'zero':
      if (character === '.') return 'dot'
      if (character === 'e' || character === 'E') return 'exponent'
      return null
    case 'integer':
      if (isDigit(character)) return 'integer'
      if (character === '.') return 'dot'
      if (character === 'e' || character === 'E') return 'exponent'
      return null
    case 'dot':
      return isDigit(character) ? 'fraction' : null
    case 'fraction':
      if (isDigit(character)) return 'fraction'
      return character === 'e' || character === 'E' ? 'exponent' : null
    case 'exponent':
      if (character === '+' || character === '-') return 'exponentSign'
      return isDigit(character) ? 'exponentDigits' : null
    case 'exponentSign':
      return isDigit(character) ? 'exponentDigits' : null
    case 'exponentDigits':
      return isDigit(character) ? 'exponentDigits' : null
  }
}

function isCompleteNumber(state: NumberState): boolean {
  return (
    state === 'zero' ||
    state === 'integer' ||
    state === 'fraction' ||
    state === 'exponentDigits'
  )
}

export class JsonStreamValidator {
  private readonly decoder = new TextDecoder('utf-8', {
    fatal: true,
    ignoreBOM: true,
  })
  private readonly containers: ContainerFrame[] = []
  private lexical: LexicalState | null = null
  private rootComplete = false
  private finished = false

  write(chunk: Uint8Array): void {
    if (this.finished) throw new Error('O validador JSON já foi finalizado.')

    let text: string
    try {
      text = this.decoder.decode(chunk, { stream: true })
    } catch {
      throw new JsonStreamValidationError()
    }
    this.consume(text)
  }

  finish(): void {
    if (this.finished) throw new Error('O validador JSON já foi finalizado.')

    let finalText: string
    try {
      finalText = this.decoder.decode()
    } catch {
      throw new JsonStreamValidationError()
    }
    this.consume(finalText)

    if (this.lexical?.type === 'number') {
      if (!isCompleteNumber(this.lexical.state)) {
        throw new JsonStreamValidationError()
      }
      this.lexical = null
      this.completeValue()
    }

    if (this.lexical !== null || this.containers.length > 0 || !this.rootComplete) {
      throw new JsonStreamValidationError()
    }
    this.finished = true
  }

  private consume(text: string): void {
    for (let index = 0; index < text.length; index++) {
      this.consumeCharacter(text[index] ?? '')
    }
  }

  private consumeCharacter(character: string): void {
    if (this.lexical?.type === 'string') {
      this.consumeStringCharacter(character)
      return
    }

    if (this.lexical?.type === 'literal') {
      this.consumeLiteralCharacter(character)
      return
    }

    if (this.lexical?.type === 'number') {
      const nextState = nextNumberState(this.lexical.state, character)
      if (nextState !== null) {
        this.lexical.state = nextState
        return
      }

      if (!isCompleteNumber(this.lexical.state)) {
        throw new JsonStreamValidationError()
      }
      this.lexical = null
      this.completeValue()
      this.consumeStructuralCharacter(character)
      return
    }

    this.consumeStructuralCharacter(character)
  }

  private consumeStructuralCharacter(character: string): void {
    if (isJsonWhitespace(character)) return

    const container = this.containers.at(-1)
    if (!container) {
      if (this.rootComplete) throw new JsonStreamValidationError()
      this.startValue(character)
      return
    }

    if (container.type === 'array') {
      if (container.state === 'firstOrEnd') {
        if (character === ']') {
          this.closeContainer()
          return
        }
        this.startValue(character)
        return
      }
      if (container.state === 'value') {
        this.startValue(character)
        return
      }
      if (character === ',') {
        container.state = 'value'
        return
      }
      if (character === ']') {
        this.closeContainer()
        return
      }
      throw new JsonStreamValidationError()
    }

    if (container.state === 'firstKeyOrEnd') {
      if (character === '}') {
        this.closeContainer()
        return
      }
      if (character === '"') {
        this.startString('key')
        return
      }
      throw new JsonStreamValidationError()
    }
    if (container.state === 'key') {
      if (character === '"') {
        this.startString('key')
        return
      }
      throw new JsonStreamValidationError()
    }
    if (container.state === 'colon') {
      if (character === ':') {
        container.state = 'value'
        return
      }
      throw new JsonStreamValidationError()
    }
    if (container.state === 'value') {
      this.startValue(character)
      return
    }
    if (character === ',') {
      container.state = 'key'
      return
    }
    if (character === '}') {
      this.closeContainer()
      return
    }
    throw new JsonStreamValidationError()
  }

  private startValue(character: string): void {
    if (character === '"') {
      this.startString('value')
      return
    }
    if (character === '{') {
      this.containers.push({ type: 'object', state: 'firstKeyOrEnd' })
      return
    }
    if (character === '[') {
      this.containers.push({ type: 'array', state: 'firstOrEnd' })
      return
    }
    if (character === 't') {
      this.lexical = { type: 'literal', expected: 'true', index: 1 }
      return
    }
    if (character === 'f') {
      this.lexical = { type: 'literal', expected: 'false', index: 1 }
      return
    }
    if (character === 'n') {
      this.lexical = { type: 'literal', expected: 'null', index: 1 }
      return
    }
    if (character === '-') {
      this.lexical = { type: 'number', state: 'minus' }
      return
    }
    if (character === '0') {
      this.lexical = { type: 'number', state: 'zero' }
      return
    }
    if (isNonZeroDigit(character)) {
      this.lexical = { type: 'number', state: 'integer' }
      return
    }
    throw new JsonStreamValidationError()
  }

  private startString(role: 'key' | 'value'): void {
    this.lexical = {
      type: 'string',
      role,
      escaped: false,
      unicodeDigitsRemaining: 0,
    }
  }

  private consumeStringCharacter(character: string): void {
    const string = this.lexical
    if (string?.type !== 'string') throw new JsonStreamValidationError()

    if (string.unicodeDigitsRemaining > 0) {
      if (!isHexDigit(character)) throw new JsonStreamValidationError()
      string.unicodeDigitsRemaining--
      return
    }

    if (string.escaped) {
      string.escaped = false
      if (character === 'u') {
        string.unicodeDigitsRemaining = 4
        return
      }
      if ('"\\/bfnrt'.includes(character)) return
      throw new JsonStreamValidationError()
    }

    if (character === '\\') {
      string.escaped = true
      return
    }
    if (character.charCodeAt(0) <= 0x1f) {
      throw new JsonStreamValidationError()
    }
    if (character !== '"') return

    this.lexical = null
    if (string.role === 'key') {
      const container = this.containers.at(-1)
      if (container?.type !== 'object') throw new JsonStreamValidationError()
      container.state = 'colon'
      return
    }
    this.completeValue()
  }

  private consumeLiteralCharacter(character: string): void {
    const literal = this.lexical
    if (literal?.type !== 'literal') throw new JsonStreamValidationError()
    if (character !== literal.expected[literal.index]) {
      throw new JsonStreamValidationError()
    }

    literal.index++
    if (literal.index === literal.expected.length) {
      this.lexical = null
      this.completeValue()
    }
  }

  private closeContainer(): void {
    if (this.containers.pop() === undefined) {
      throw new JsonStreamValidationError()
    }
    this.completeValue()
  }

  private completeValue(): void {
    const container = this.containers.at(-1)
    if (!container) {
      if (this.rootComplete) throw new JsonStreamValidationError()
      this.rootComplete = true
      return
    }

    if (container.type === 'array') {
      if (container.state !== 'firstOrEnd' && container.state !== 'value') {
        throw new JsonStreamValidationError()
      }
      container.state = 'commaOrEnd'
      return
    }
    if (container.state !== 'value') throw new JsonStreamValidationError()
    container.state = 'commaOrEnd'
  }
}
