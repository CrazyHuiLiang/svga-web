import { noop } from './noop'

// 使用 worker 中的 setTimeout 以 60 fps 进行
const WORKER = `onmessage = function () {
  setTimeout(function() {postMessage(null)}, 1 / 60)
}`

// 顺序渲染/倒叙渲染
export enum FILL_MODE {
  FORWARDS = 'forwards',
  BACKWARDS = 'backwards',
}

export default class Animator {
  // 使用定时器驱动动画
  public noExecutionDelay = false // 依赖外层使用者进行设置
  // 帧区间
  public startValue = 0// 依赖外层使用者进行设置
  public endValue = 0// 依赖外层使用者进行设置
  public duration = 0// 依赖外层使用者进行设置
  // 循环
  public repeatNumber = 1 // 依赖外层使用者进行设置
  public loop = false // 依赖外层使用者进行设置
  // 顺序渲染/倒叙渲染
  public fillRule: FILL_MODE = FILL_MODE.FORWARDS
  // 播放动画
  public onUpdate: (frame: number) => unknown = noop
  // 播放完成
  public onEnd: () => unknown = noop
  private isRunning = false
  // 记录动画开始播放的时间，后续依据这个数据计算出动画持续的时间，从而推算出当前应该播放的帧数
  private startTimestamp = 0
  // 60fps 的速度驱动动画渲染
  private timeoutWorker: Worker | null = null

  /**
   * Get current time in milliseconds
   * @private
   */
  private static currentTimeMillisecond(): number {
    return performance ? performance.now() : new Date().getTime()
  }

  /**
   * Start animation
   * @param initialFrame
   */
  public start(initialFrame: number): void {
    this.isRunning = true
    this.startTimestamp = Animator.currentTimeMillisecond()

    if (initialFrame) {
      // 通过将记录的开始播放时间向前偏移，使得后续计算当前应播放的帧时，算出向后偏移 initialFrame 的帧
      this.startTimestamp -=
        (initialFrame / (this.endValue - this.startValue)) * this.duration
    }

    if (this.noExecutionDelay && this.timeoutWorker === null) {
      this.timeoutWorker = new Worker(
        window.URL.createObjectURL(new Blob([WORKER]))
      )
    }

    // 渲染首帧
    this.doFrame()
  }

  /**
   * Stop animation
   */
  public stop(): void {
    this.isRunning = false

    if (this.timeoutWorker !== null) {
      this.timeoutWorker.terminate()
      this.timeoutWorker = null
    }
  }

  /**
   * Process a frame, and process later frames repeatedly
   */
  private readonly doFrame = () => {
    // 动画已经进行的时长
    const deltaTime = Animator.currentTimeMillisecond() - this.startTimestamp
    // 动画播放进度（百分比）
    let fraction: number
    // 非循环播放的动画，当前时间已经超过了动画应播放的时间
    if (!this.loop && deltaTime >= this.duration * this.repeatNumber) {
      // 将进度设置到结尾
      fraction = this.fillRule === FILL_MODE.BACKWARDS ? 0.0 : 1.0
      // 标记已经完成播放
      this.isRunning = false
    }
    // 循环播放、或者播放时间正常
    else {
      fraction = (deltaTime % this.duration) / this.duration
    }

    // 根据播放进度，求出应播放的帧
    const frame = (this.endValue - this.startValue) * fraction + this.startValue
    // 通知外层更新动画
    this.onUpdate(frame)

    // 当前动画正在播放
    if (this.isRunning) {
      // 使用 setTimeout 驱动动画播放
      if (this.timeoutWorker) {
        this.timeoutWorker.onmessage = () => this.isRunning && this.doFrame()
        this.timeoutWorker.postMessage(null)
      }
      // 使用 requestAnimationFrame 驱动动画播放
      else {
        window.requestAnimationFrame(() => this.isRunning && this.doFrame())
      }
    }
    // 动画已结束
    else {
      if (this.timeoutWorker !== null) {
        this.timeoutWorker.terminate()
        this.timeoutWorker = null
      }
      this.onEnd()
    }
  }
}
