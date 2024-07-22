import render from './offscreen.canvas.render'
import { com } from '../proto/svga'
import VideoEntity, {
  DynamicElements,
  ImageSources,
  Sprite,
} from '../parser/video-entity'
import svga = com.opensource.svga

interface AudioConfig extends svga.AudioEntity {
  audio: HTMLAudioElement
}

export default class Renderer {
  // 画板
  private readonly target: HTMLCanvasElement
  // 离屏渲染的画板
  private readonly offscreenCanvas: HTMLCanvasElement | OffscreenCanvas

  // prepare 阶段实例化动画中的音频播放器
  private audios: HTMLAudioElement[] = []
  private audioConfigs: { [frame: number]: AudioConfig[] | undefined } = {}

  // 帧缓存
  isCacheFrame = false
  private readonly frameCache: { [frame: number]: ImageBitmap } = {}

  /*
   * 保存渲染的画板
   * 实例化离屏渲染的画板
   */
  constructor(target: HTMLCanvasElement) {
    this.target = target
    this.offscreenCanvas = window.OffscreenCanvas
      ? new window.OffscreenCanvas(target.width, target.height)
      : document.createElement('canvas')
  }

  /*
   * 根据素材中标识的尺寸来设置画板尺寸
   * 将图片资源、音频资源转化为适合后续渲染使用的格式，创建用于播放素材中音频的播放器
   *
   * 这是一个有副作用的函数，会将 videoItem 内部的结构进行格式转化
   */
  public async prepare(videoItem: VideoEntity): Promise<void> {
    this.audios = []
    this.audioConfigs = {}

    // 根据素材中标识的尺寸来设置画板尺寸
    // 重新设置 canvas 的尺寸，哪怕设置的值与原值没有区别，都会导致 canvas 重绘，在移动端上会清屏 https://blog.csdn.net/harmsworth2016/article/details/118426390
    if (this.target.width !== videoItem.videoSize.width) {
      this.target.width = videoItem.videoSize.width
    }
    if (this.target.height !== videoItem.videoSize.height) {
      this.target.height = videoItem.videoSize.height
    }

    const addAudioConfig = (frame: number, ac: AudioConfig) => {
      const acs = this.audioConfigs[frame] || []
      acs.push(ac)
      this.audioConfigs[frame] = acs
    }

    const loadImages = Object.entries(videoItem.images).map(
      async ([key, item]) => {
        if (item instanceof ArrayBuffer) {
          const blob = new Blob([item], { type: 'image/png' })
          const bitmap = await createImageBitmap(blob)
          videoItem.images[key] = bitmap
        }
        return item
      }
    )

    const loadAudios = Object.values(videoItem.audios).map(
      ({ source, startFrame, endFrame, audioKey, startTime, totalTime }) =>
        new Promise((resolve) => {
          const cachedAudio = videoItem.cachedAudio[audioKey]
          const audio =
            cachedAudio ||
            new Audio(
              URL.createObjectURL(
                new Blob([new Uint8Array(source)], { type: 'audio/x-mpeg' })
              )
            )

          const ac: AudioConfig = {
            audioKey,
            audio,
            startFrame,
            endFrame,
            startTime,
            totalTime,
          }
          addAudioConfig(startFrame, ac)
          addAudioConfig(endFrame, ac)
          this.audios.push(audio)

          audio.onloadeddata = resolve
          audio.load()
        })
    )
    Promise.all(loadAudios).catch((reason) => {
      console.warn('svga render prepare loadAudio error', reason)
    })

    await Promise.all(loadImages)
  }

  /*
   * 播放指定帧对应的音频
   */
  public processAudio(frame: number): void {
    const acs = this.audioConfigs[frame]
    if (!acs || acs.length === 0) {
      return
    }

    acs.forEach(function (ac) {
      if (ac.startFrame === frame) {
        ac.audio.currentTime = ac.startTime
        // 提供一个全局的可以将svga音频禁用的控制开关
        if (!window.svga_web_no_audo_effect) {
          ac.audio.play().catch(e => console.log('effect play error', e))
        }
        return
      }

      if (ac.endFrame === frame) {
        ac.audio.pause()
        ac.audio.currentTime = 0
        return
      }
    })
  }

  /*
   * 将画面清屏
   */
  public clear(): void {
    const context2d = this.target.getContext('2d')
    context2d?.clearRect(0, 0, this.target.width, this.target.height)
  }

  /*
   * 使用给定素材，绘制指定帧
   */
  public drawFrame(
    images: ImageSources,
    sprites: Array<Sprite>,
    dynamicElements: DynamicElements,
    frame: number
  ): void {
    const context2d = this.target.getContext('2d')
    if (!context2d) {
      return
    }
    // 清屏
    context2d.clearRect(0, 0, this.target.width, this.target.height)

    // 如果有配置对帧进行缓存，并且已有缓存帧，则使用缓存的帧进行播放
    if (this.isCacheFrame && this.frameCache[frame]) {
      const ofsFrame = this.frameCache[frame]
      context2d.drawImage(ofsFrame, 0, 0)
      return
    }

    const ofsCanvas = this.offscreenCanvas
    ofsCanvas.width = this.target.width
    ofsCanvas.height = this.target.height

    // 使用 offscreen.canvas.render.ts 生成指定帧的画面
    render(ofsCanvas, images, dynamicElements, sprites, frame)

    // 将已经绘制好的帧画面，绘制到画板上
    context2d.drawImage(ofsCanvas, 0, 0)

    // 将已绘制好的帧进行缓存
    if (this.isCacheFrame) {
      createImageBitmap(ofsCanvas).then((bitMap) => {
        this.frameCache[frame] = bitMap
      })
    }
  }

  /*
   * 停止所有音频的播放
   */
  public stopAllAudio(): void {
    this.audios.forEach(function (audio) {
      audio.pause()
      audio.currentTime = 0
    })
  }
}
