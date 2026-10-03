import type { AspectRatio, OutputResolution, StoredImage } from '@/lib/ai-cos-types';
import { maximumNativeResolution } from '@/lib/image-output-policy.mjs';

export function OutputResolutionNotice({ aspectRatio = 'source', source, saved }: { aspectRatio?: AspectRatio; source?: Partial<StoredImage>; saved?: OutputResolution }) {
  const target = saved || maximumNativeResolution(aspectRatio, source);
  return <p className="text-xs leading-relaxed text-muted-foreground" role="note">
    最大原生分辨率目标：{target.pixelWidth && target.pixelHeight ? `${target.pixelWidth} × ${target.pixelHeight} 像素` : '跟随源图，在确认时读取尺寸'}。
    内置生成与网页交接均仅能通过 Prompt 请求，不能硬锁像素；最终以导回文件为准，不放大、裁切或补边。超过约 368 万像素的尺寸官方仍标为实验性，生成可能更慢。
  </p>;
}

export function OutputDimensions({ image }: { image: StoredImage }) {
  const policy = image.outputResolution;
  const labels = { matched: '已达到目标', below_target: '未达到目标像素', different_ratio: '实际画幅与目标不同', different_size: '实际尺寸与目标不同', unknown: '尚无法核对目标' };
  return <p className="text-xs leading-relaxed text-muted-foreground">
    实际文件：{image.pixelWidth && image.pixelHeight ? `${image.pixelWidth} × ${image.pixelHeight} 像素` : '尺寸尚未记录'}
    {policy && <> · 请求目标：{policy.pixelWidth && policy.pixelHeight ? `${policy.pixelWidth} × ${policy.pixelHeight}` : '服务可用最大尺寸'} · {labels[image.resolutionCheck?.status || 'unknown']}</>}
    {!policy && ' · 历史版本未记录最大尺寸目标'}
  </p>;
}
