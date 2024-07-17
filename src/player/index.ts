import Renderer from './renderer'
import Animator, { FILL_MODE } from './animator'
import VideoEntity from '../parser/video-entity'
import { noop } from './noop'

export * from './animator'
export * from './offscreen.canvas.render'
export * from './renderer'

export enum EVENT_TYPES {
  START = 'start',
  PROCESS = 'process',
  PAUSE = 'pause',
  RESUME = 'resume',
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

export enum PLAY_MODE {
  FORWARDS = 'forwards',
  FALLBACKS = 'fallbacks',
}

export default class Player {
  // 记录当前应该渲染的帧
  public currentFrame = 0
  public readonly container: HTMLCanvasElement
  private videoItem: VideoEntity | null = null
  private playMode: PLAY_MODE = PLAY_MODE.FORWARDS
  // 帧区间
  private startFrame = 0
  private endFrame = 0
  // 是否渲染屏幕外的动画
  private intersectionObserverRenderShow = true
  private intersectionObserver: IntersectionObserver | null = null
  // 渲染器
  private renderer: Renderer
  private animator: Animator
  // 事件
  private $onEvent: {
    [EVENT_TYPES.START]: () => unknown
    [EVENT_TYPES.PROCESS]: () => unknown
    [EVENT_TYPES.PAUSE]: () => unknown
    [EVENT_TYPES.RESUME]: () => unknown
    [EVENT_TYPES.STOP]: () => unknown
    [EVENT_TYPES.END]: () => unknown
    [EVENT_TYPES.CLEAR]: () => unknown
  } = {
    start: noop,
    process: noop,
    pause: noop,
    resume: noop,
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

    // 实例化渲染器、动画驱动器/定时器
    this.renderer = new Renderer(this.container)
    this.animator = new Animator()
    videoItem && this.mount(videoItem)

    if (options) {
      this.set(options)
    }
  }

  // 播放进度（百分比）
  public get progress(): number {
    if (!this.videoItem) {
      return 0
    }

    return ((this.currentFrame + 1) / this.videoItem.frames) * 100
  }

  /**
   * Set svga player options
   * @param loop
   * @param fillMode
   * @param playMode
   * @param startFrame
   * @param endFrame
   * @param cacheFrames
   * @param intersectionObserverRender
   * @param noExecutionDelay
   */
  public set({
    loop = true,
    fillMode = FILL_MODE.FORWARDS,
    playMode = PLAY_MODE.FORWARDS,
    startFrame = 0,
    endFrame = 0,
    cacheFrames = false,
    intersectionObserverRender = false, // 开启画板在页面可视区之外，不进行页面渲染（如果支持的话）
    noExecutionDelay = false,
  }: options): void {
    this.playMode = playMode
    this.startFrame = startFrame
    this.endFrame = endFrame
    this.handleIntersectionObserver(intersectionObserverRender)

    this.setAnimatorLoop(loop)
    this.animator.fillRule = fillMode
    this.animator.noExecutionDelay = noExecutionDelay

    this.renderer.isCacheFrame = cacheFrames
  }

  // 挂载素材
  public mount(videoItem: VideoEntity): Promise<void> {
    // 将当前播放的帧置为 0
    this.currentFrame = 0
    this.videoItem = videoItem
    // 有副作用的一个调用，会转化 videoItem 中的部分结构的格式
    return this.renderer.prepare(videoItem)
  }

  public start(): void {
    if (!this.videoItem) {
      throw new Error('video item undefined.')
    }
    this.startAnimation(this.videoItem)
    this.$onEvent.start()
  }

  public resume(): void {
    this.animator.start(this.currentFrame)
    this.$onEvent.resume()
  }

  public pause(): void {
    this.animator.stop()
    this.$onEvent.pause()
  }

  public stop(): void {
    this.animator.stop()
    this.renderer.clear()

    this.currentFrame = 0

    this.renderer.stopAllAudio()
    this.$onEvent.stop()
  }

  public clear(): void {
    this.animator.stop()
    this.renderer.clear()
    this.$onEvent.clear()
  }

  public destroy(): void {
    this.animator.stop()
    this.renderer.clear()
    this.videoItem = null
  }

  // 设置事件监听函数，每个事件只支持一个事件处理函数
  public $on(eventName: EVENT_TYPES, execFunction: () => unknown): this {
    this.$onEvent[eventName] = execFunction

    if (eventName === 'end') {
      this.animator.onEnd = () => this.$onEvent.end()
    }

    return this
  }

  /**
   * 监听容器是否处于浏览器视窗内
   * @param on
   * @private
   */
  private handleIntersectionObserver(on: boolean): void {
    const hasIntersectionObserver =
      typeof window !== 'undefined' && 'IntersectionObserver' in window
    if (hasIntersectionObserver && on) {
      this.intersectionObserver = new IntersectionObserver(
        (entries) => {
          this.intersectionObserverRenderShow =
            entries[0]?.intersectionRatio > 0
        },
        {
          rootMargin: '0px',
          threshold: [0, 0.5, 1],
        }
      )
      this.intersectionObserver.observe(this.container)
    } else {
      if (this.intersectionObserver) {
        this.intersectionObserver.disconnect()
      }
      this.intersectionObserverRenderShow = true
    }
  }

  private setAnimatorLoop(loop: number | boolean): void {
    switch (typeof loop) {
      case 'boolean':
        this.animator.loop = loop
        break
      case 'number':
        if (loop <= 0) {
          // console.warn(
          //   '[svga-web] set loop to 0 is deprecated, use "loop: true" instead'
          // )
          this.animator.loop = true
        } else {
          this.animator.loop = false
          this.animator.repeatNumber = loop
        }
    }
  }

  /**
   * Start animation
   * @param images
   * @param sprites
   * @param frames
   * @param FPS
   * @param dynamicElements
   * @private
   */
  private startAnimation({
    images,
    sprites,
    frames,
    FPS,
    dynamicElements,
  }: VideoEntity): void {
    const { playMode, startFrame, endFrame } = this
    const totalFramesCount = frames - 1

    // 如果开始动画的当前帧是最后一帧，重置为第 0 帧
    if (this.currentFrame === totalFramesCount) {
      this.currentFrame = startFrame || 0
    }

    // 计算开始帧
    this.animator.startValue =
      playMode === PLAY_MODE.FALLBACKS
        ? endFrame || totalFramesCount
        : startFrame || 0
    // 计算结束帧
    this.animator.endValue =
      playMode === PLAY_MODE.FALLBACKS
        ? startFrame || 0
        : endFrame || totalFramesCount

    if (endFrame > 0 && endFrame > startFrame) {
      frames = endFrame - startFrame
    } else if (endFrame <= 0 && startFrame > 0) {
      frames = frames - startFrame
    }

    // 计算总时长
    this.animator.duration = frames * (1.0 / FPS) * 1000

    // 设置动画更新监听
    this.animator.onUpdate = (value: number) => {
      value = Math.floor(value)

      if (this.currentFrame === value) {
        return void 0
      }

      if (this.playMode === PLAY_MODE.FORWARDS) {
        this.renderer.processAudio(value)
      }

      this.currentFrame = value

      // 如果画板在可视区域，进行页面渲染
      if (this.intersectionObserverRenderShow) {
        this.renderer.drawFrame(
          images,
          sprites,
          dynamicElements,
          this.currentFrame
        )
      }

      this.$onEvent.process()
    }

    if (this.playMode === PLAY_MODE.FORWARDS) {
      this.renderer.processAudio(0)
    }
    // 开始动画定时
    this.animator.start(this.currentFrame)
  }
}
