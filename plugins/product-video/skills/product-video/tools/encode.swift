// encode.swift — PNG frames → H.264 MP4 with AVFoundation (macOS), for machines without an ffmpeg that has libx264.
// usage: encode FRAMES_DIR OUT.mp4 START_FRAME WIDTH BITRATE   (frames are f%05d.png at 25 fps; height keeps the aspect)
import AVFoundation
import AppKit

let args = CommandLine.arguments
let dir = args[1], out = args[2], start = Int(args[3])!, outW = Int(args[4])!, rate = Int(args[5])!
let fps: Int32 = 25
let files = try FileManager.default.contentsOfDirectory(atPath: dir).filter { $0.hasSuffix(".png") }.sorted()
let frames = Array(files.dropFirst(start))
let first = NSImage(contentsOfFile: dir + "/" + frames[0])!
var rect = NSRect(origin: .zero, size: first.size)
let cg0 = first.cgImage(forProposedRect: &rect, context: nil, hints: nil)!
let W = outW, H = Int((Double(outW) * Double(cg0.height) / Double(cg0.width)).rounded() / 2) * 2
let url = URL(fileURLWithPath: out)
try? FileManager.default.removeItem(at: url)
let writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
  AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: W, AVVideoHeightKey: H,
  AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: rate, AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel],
])
input.expectsMediaDataInRealTime = false
let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
  kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB, kCVPixelBufferWidthKey as String: W, kCVPixelBufferHeightKey as String: H,
])
writer.add(input)
writer.startWriting()
writer.startSession(atSourceTime: .zero)
for (i, f) in frames.enumerated() {
  autoreleasepool {
    let img = NSImage(contentsOfFile: dir + "/" + f)!
    var r = NSRect(origin: .zero, size: img.size)
    let cg = img.cgImage(forProposedRect: &r, context: nil, hints: nil)!
    var pb: CVPixelBuffer?
    CVPixelBufferPoolCreatePixelBuffer(nil, adaptor.pixelBufferPool!, &pb)
    CVPixelBufferLockBaseAddress(pb!, [])
    let ctx = CGContext(data: CVPixelBufferGetBaseAddress(pb!), width: W, height: H, bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(pb!), space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue)!
    ctx.interpolationQuality = .high
    ctx.draw(cg, in: CGRect(x: 0, y: 0, width: W, height: H))
    CVPixelBufferUnlockBaseAddress(pb!, [])
    while !input.isReadyForMoreMediaData { usleep(2000) }
    adaptor.append(pb!, withPresentationTime: CMTime(value: CMTimeValue(i), timescale: fps))
  }
}
input.markAsFinished()
let sem = DispatchSemaphore(value: 0)
writer.finishWriting { sem.signal() }
sem.wait()
print(writer.status == .completed ? "ok \(frames.count) frames \(W)x\(H)" : "failed \(String(describing: writer.error))")
