/**
 * Incremental parser for fragmented-MP4 streams produced by FFmpeg
 * (`empty_moov+default_base_moof+frag_keyframe`). Splits the byte stream on
 * box boundaries and emits two callback events: the init segment
 * (ftyp+moov) once, then each media fragment (moof+mdat) as it completes.
 * Only 32-bit box headers are supported; any other box order is an error.
 */
const MAX_BOX_BYTES = 64 * 1024 * 1024

/** Callback sinks + safety cap for Mp4FragmentParser. */
export interface Mp4ParserOptions {
  onInit: (data: Buffer) => void
  onFragment: (data: Buffer) => void
  maxBoxBytes?: number
}

/** Stateful box splitter: feed via push(), close with end() to detect truncation. */
export class Mp4FragmentParser {
  onInit: (data: Buffer) => void
  onFragment: (data: Buffer) => void
  maxBoxBytes: number
  buffer: Buffer
  initBoxes: Buffer[]
  fragmentBoxes: Buffer[]
  ready: boolean

  constructor({ onInit, onFragment, maxBoxBytes = MAX_BOX_BYTES }: Mp4ParserOptions) {
    this.onInit = onInit
    this.onFragment = onFragment
    this.maxBoxBytes = maxBoxBytes
    this.buffer = Buffer.alloc(0)
    this.initBoxes = []
    this.fragmentBoxes = []
    this.ready = false
  }

  /** Append a raw chunk and emit every MP4 box that is now fully buffered. */
  push(chunk: Uint8Array | Buffer): void {
    this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)])
    while (this.buffer.length >= 8) {
      const size = this.buffer.readUInt32BE(0)
      const type = this.buffer.toString('ascii', 4, 8)
      if (size === 1) throw new Error('64-bit MP4 boxes are not supported')
      if (size < 8 || size > this.maxBoxBytes) throw new Error(`invalid MP4 box size ${size}`)
      if (this.buffer.length < size) return
      const box = this.buffer.subarray(0, size)
      this.buffer = this.buffer.subarray(size)
      this.#box(type, box)
    }
  }

  /** Signal end of stream; throws if a partial box is still buffered. */
  end(): void {
    if (this.buffer.length !== 0) throw new Error('truncated MP4 stream')
  }

  /** Route one complete box: init phase collects ftyp/moov, media phase pairs moof+mdat. */
  #box(type: string, box: Buffer): void {
    if (!this.ready) {
      if (type !== 'ftyp' && type !== 'moov') throw new Error(`unexpected MP4 init box ${type}`)
      this.initBoxes.push(box)
      if (type === 'moov') {
        this.ready = true
        this.onInit(Buffer.concat(this.initBoxes))
        this.initBoxes = []
      }
      return
    }
    if (type === 'moof') {
      this.fragmentBoxes = [box]
      return
    }
    if (type === 'mdat' && this.fragmentBoxes.length) {
      this.fragmentBoxes.push(box)
      this.onFragment(Buffer.concat(this.fragmentBoxes))
      this.fragmentBoxes = []
      return
    }
    if (type !== 'free' && type !== 'sidx') throw new Error(`unexpected MP4 media box ${type}`)
  }
}
