import ParserWorker from './worker.ts?worker&inline'
import VideoEntity from './video-entity'
import { getVersion, Version } from './version'

export * from './frame-entity'
export * from './video-entity'
export * from './version'

export default class Parser {
  private static worker: Worker | null
  private static destroying = false
  private static usageNO = 1
  private static workingCount = 0

  constructor() {
    Parser.ensureWorker()
  }

  /**
   * Ensure worker instance available
   * @private
   */
  private static ensureWorker(): Worker {
    this.worker = this.worker || new ParserWorker()
    this.destroying = false
    return this.worker
  }

  /**
   * Destroy worker
   * @private
   */
  private static destroyWorker(): void {
    this.worker?.terminate()
    this.worker = null
    this.destroying = false
  }

  /**
   * parse SVGA ArrayBuffer data to VideoEntity
   * @param data
   */
  public do(data: ArrayBuffer): Promise<VideoEntity> {
    const dataHeader = new Uint8Array(data, 0, 4)

    if (getVersion(dataHeader) === Version.VERSION_1) {
      throw new Error('this parser does not support version@1.x of svga.')
    }

    if (!data) {
      throw new Error('Parser Data not found')
    }

    return new Promise((resolve) => {
      const worker = Parser.ensureWorker()
      const no = Parser.usageNO++
      const messageHandler = ({
        data: { result, id },
      }: {
        data: { result: VideoEntity; id: number }
      }) => {
        if (id === no) {
          resolve(result)

          worker.removeEventListener('message', messageHandler)
          Parser.workingCount--

          if (Parser.destroying) {
            this.destroy()
          }
        }
      }

      Parser.workingCount++

      worker.addEventListener('message', messageHandler)
      worker.postMessage({ data, id: no }, [data])
    })
  }

  /*
   * Create and cache audio
   * in some environments like "wx applet's webview" who require create audio use user click,otherwise will lead
   * the audio can't play (exception call play when user click);
   *
   * this method provide a way to resolve this situation: use user click action to precache audio instance
   */
  public cacheAudioPlayer(videoItem: VideoEntity) {
    return Object.values(videoItem.audios).map(({ source, audioKey }) => {
      const url = URL.createObjectURL(
        new Blob([new Uint8Array(source)], { type: 'audio/x-mpeg' })
      )
      return (videoItem.cachedAudio[audioKey] = new Audio(url))
    })
  }

  /**
   * Destroy the web worker under the hood, may delay if still working
   */
  public destroy(): void {
    if (Parser.worker === null) {
      return
    }

    if (Parser.workingCount > 0) {
      Parser.destroying = true
      return
    }

    Parser.destroyWorker()
  }
}
