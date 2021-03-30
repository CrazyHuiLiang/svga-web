import Renderer from './renderer'
import Animator from './animator'
import VideoEntity, { VideoSize } from '../parser/video-entity'
import { noop } from './noop'

export * from './animator'
export * from './offscreen.canvas.render'
export * from './renderer'

export enum EVENT_TYPES {
  START = 'start',
  PROCESS = 'process',
  PAUSE = 'pause',
  STOP = 'stop',
  END = 'end',
  CLEAR = 'clear',
}

interface options {
  loop?: number | boolean
  fillMode?: FILL_MODE
  playMode?: PLAY_MODE
  startFrame?: number
  endFrame?: number
  cacheFrames?: boolean
  intersectionObserverRender?: boolean
  noExecutionDelay?: boolean
}

export enum FILL_MODE {
  FORWARDS = 'forwards',
  BACKWARDS = 'backwards',
}

export enum PLAY_MODE {
  FORWARDS = 'forwards',
  FALLBACKS = 'fallbacks',
}

export default class Player {
  public container: HTMLCanvasElement
  public videoItem: VideoEntity | null = null
  public loop: number | boolean = true
  public fillMode: FILL_MODE = FILL_MODE.FORWARDS
  public playMode: PLAY_MODE = PLAY_MODE.FORWARDS
  public progress = 0
  public currentFrame = 0
  public totalFramesCount = 0
  public startFrame = 0
  public endFrame = 0
  public cacheFrames = false
  public intersectionObserverRender = false
  public intersectionObserverRenderShow = true
  private _intersectionObserver: IntersectionObserver | null = null
  private _renderer: Renderer
  private _animator: Animator
  private $onEvent: {
    [EVENT_TYPES.START]: () => unknown
    [EVENT_TYPES.PROCESS]: () => unknown
    [EVENT_TYPES.PAUSE]: () => unknown
    [EVENT_TYPES.STOP]: () => unknown
    [EVENT_TYPES.END]: () => unknown
    [EVENT_TYPES.CLEAR]: () => unknown
  } = {
    start: noop,
    process: noop,
    pause: noop,
    stop: noop,
    end: noop,
    clear: noop,
  }

  constructor(
    element: string | HTMLCanvasElement,
    videoItem?: VideoEntity,
    options?: options
  ) {
    this.container =
      typeof element === 'string'
        ? <HTMLCanvasElement>document.body.querySelector(element)
        : element

    if (!this.container) {
      throw new Error('container undefined.')
    }

    if (!this.container.getContext) {
      throw new Error('container should be HTMLCanvasElement.')
    }

    this._renderer = new Renderer(this.container.width, this.container.height)
    this._animator = new Animator()
    videoItem && this.mount(videoItem)

    if (options) {
      this.set(options)
    }
  }

  public set(options: options): void {
    typeof options.loop !== 'undefined' && (this.loop = options.loop)
    options.fillMode && (this.fillMode = options.fillMode)
    options.playMode && (this.playMode = options.playMode)
    options.cacheFrames !== undefined &&
      (this.cacheFrames = options.cacheFrames)
    this.startFrame = options.startFrame ? options.startFrame : this.startFrame
    this.endFrame = options.endFrame ? options.endFrame : this.endFrame

    // 监听容器是否处于浏览器视窗内
    options.intersectionObserverRender !== undefined &&
      (this.intersectionObserverRender = options.intersectionObserverRender)
    if (IntersectionObserver && this.intersectionObserverRender) {
      this._intersectionObserver = new IntersectionObserver(
        (entries) => {
          if (entries[0].intersectionRatio <= 0) {
            this.intersectionObserverRenderShow &&
              (this.intersectionObserverRenderShow = false)
          } else {
            !this.intersectionObserverRenderShow &&
              (this.intersectionObserverRenderShow = true)
          }
        },
        {
          rootMargin: '0px',
          threshold: [0, 0.5, 1],
        }
      )
      this._intersectionObserver.observe(this.container)
    } else {
      if (this._intersectionObserver) {
        this._intersectionObserver.disconnect()
      }
      this.intersectionObserverRender = false
      this.intersectionObserverRenderShow = true
    }

    if (options.noExecutionDelay !== undefined) {
      this._animator.noExecutionDelay = options.noExecutionDelay
    }
  }

  public mount(videoItem: VideoEntity): Promise<void> {
    this.currentFrame = 0
    this.progress = 0
    this.totalFramesCount = videoItem.frames - 1
    this.videoItem = videoItem

    const prepare = this._renderer.prepare(videoItem)
    this._renderer.clear(this.container)
    this._setSize()
    return prepare
  }

  public start(): void {
    if (!this.videoItem) {
      throw new Error('video item undefined.')
    }
    this._renderer.clear(this.container)
    this._startAnimation()
    this.$onEvent.start()
  }

  public pause(): void {
    this._animator && this._animator.stop()
    this.$onEvent.pause()
  }

  public stop(): void {
    this._animator && this._animator.stop()
    this.currentFrame = 0
    if (this.videoItem) {
      if (
        this.intersectionObserverRender &&
        !this.intersectionObserverRenderShow
      ) {
        return
      }

      const context2d = this.container.getContext('2d')
      if (context2d === null) {
        return
      }

      this._renderer.drawFrame(
        this.videoItem,
        this.currentFrame,
        this.cacheFrames,
        this.container.width,
        this.container.height,
        context2d
      )
    }
    this._renderer.stopAllAudio()
    this.$onEvent.stop()
  }

  public clear(): void {
    this._animator && this._animator.stop()
    this._renderer.clear(this.container)
    this.$onEvent.clear()
  }

  public destroy(): void {
    this._animator && this._animator.stop()
    this._renderer.clear(this.container)
    this.videoItem = null
  }

  public $on(eventName: EVENT_TYPES, execFunction: () => unknown): this {
    this.$onEvent[eventName] = execFunction

    if (eventName === 'end') {
      this._animator.onEnd = () => this.$onEvent.end()
    }

    return this
  }

  private _startAnimation() {
    const { playMode, totalFramesCount, startFrame, endFrame, videoItem } = this

    if (videoItem === null) {
      console.error('svga player start animation fail, no video item')
      return
    }

    // 如果开始动画的当前帧是最后一帧，重置为第 0 帧
    if (this.currentFrame === totalFramesCount) {
      this.currentFrame = startFrame || 0
    }

    this._animator.startValue =
      playMode === 'fallbacks' ? endFrame || totalFramesCount : startFrame || 0
    this._animator.endValue =
      playMode === 'fallbacks' ? startFrame || 0 : endFrame || totalFramesCount

    let frames = videoItem.frames

    if (endFrame > 0 && endFrame > startFrame) {
      frames = endFrame - startFrame
    } else if (endFrame <= 0 && startFrame > 0) {
      frames = videoItem.frames - startFrame
    }

    this._animator.duration = frames * (1.0 / videoItem.FPS) * 1000
    this._animator.loop =
      this.loop === true || this.loop <= 0
        ? Infinity
        : this.loop === false
        ? 1
        : this.loop
    this._animator.fillRule = this.fillMode === 'backwards' ? 1 : 0

    this._animator.onUpdate = (value: number) => {
      value = Math.floor(value)

      if (this.currentFrame === value) {
        return void 0
      }

      if (this.playMode === PLAY_MODE.FORWARDS) {
        this._renderer.processAudio(value)
      }

      this.currentFrame = value

      this.progress =
        (parseFloat((value + 1).toString()) /
          parseFloat(videoItem.frames.toString())) *
        100

      if (
        !this.intersectionObserverRender ||
        this.intersectionObserverRenderShow
      ) {
        const context2d = this.container.getContext('2d')
        if (context2d !== null) {
          this._renderer.drawFrame(
            videoItem,
            this.currentFrame,
            this.cacheFrames,
            this.container.width,
            this.container.height,
            context2d
          )
        }
      }

      this.$onEvent.process()
    }

    if (this.playMode === PLAY_MODE.FORWARDS) {
      this._renderer.processAudio(0)
    }
    this._animator.start(this.currentFrame)
  }

  private _setSize() {
    if (this.videoItem === null) {
      return
    }

    const videoSize: VideoSize = this.videoItem.videoSize

    this.container.width = videoSize.width
    this.container.height = videoSize.height
  }
}
