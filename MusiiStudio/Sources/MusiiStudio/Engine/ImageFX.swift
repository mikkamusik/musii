import Foundation
import CoreImage
import CoreGraphics

// MARK: - Hilfsfunktionen

enum FXMath {
    static func rnd(_ seed: Int) -> Double {
        let v = sin(Double(seed) * 12.9898 + 78.233) * 43758.5453
        return v - floor(v)
    }
    static func clamp(_ v: Double, _ lo: Double, _ hi: Double) -> Double { min(hi, max(lo, v)) }
    static func smooth(_ t: Double) -> Double { let x = clamp(t, 0, 1); return x * x * (3 - 2 * x) }
}

extension CIImage {
    func withOpacity(_ a: Double) -> CIImage {
        if a >= 0.999 { return self }
        return applyingFilter("CIColorMatrix", parameters: ["inputAVector": CIVector(x: 0, y: 0, z: 0, w: CGFloat(max(0, a)))])
    }

    /// Mischt dieses Bild (0) mit einem anderen (1)
    func mixed(with other: CIImage, amount: Double) -> CIImage {
        if amount <= 0.001 { return self }
        if amount >= 0.999 { return other }
        return applyingFilter("CIDissolveTransition", parameters: [
            "inputTargetImage": other,
            "inputTime": amount,
        ])
    }

    func movedToOrigin() -> CIImage {
        let e = extent
        if e.origin == .zero { return self }
        return transformed(by: CGAffineTransform(translationX: -e.minX, y: -e.minY))
    }

    func blurred(_ sigma: Double, keepEdges: Bool = true) -> CIImage {
        guard sigma > 0.3 else { return self }
        let e = extent
        if keepEdges {
            return clampedToExtent().applyingGaussianBlur(sigma: sigma).cropped(to: e)
        }
        return applyingGaussianBlur(sigma: sigma)
    }

    static func solid(_ c: RGBA, _ rect: CGRect) -> CIImage {
        CIImage(color: CIColor(red: CGFloat(c.r), green: CGFloat(c.g), blue: CGFloat(c.b), alpha: CGFloat(c.a))).cropped(to: rect)
    }
}

func ciColor(_ c: RGBA) -> CIColor {
    CIColor(red: CGFloat(c.r), green: CGFloat(c.g), blue: CGFloat(c.b), alpha: CGFloat(c.a))
}

// MARK: - Farbe & Filter

enum ColorFX {
    static func temperature(_ img: CIImage, shift: Double, tint: Double = 0) -> CIImage {
        if abs(shift) < 1 && abs(tint) < 0.5 { return img }
        return img.applyingFilter("CITemperatureAndTint", parameters: [
            "inputNeutral": CIVector(x: CGFloat(6500 + shift), y: CGFloat(tint)),
            "inputTargetNeutral": CIVector(x: 6500, y: 0),
        ])
    }

    static func controls(_ img: CIImage, brightness: Double = 0, contrast: Double = 1, saturation: Double = 1) -> CIImage {
        img.applyingFilter("CIColorControls", parameters: [
            kCIInputBrightnessKey: brightness,
            kCIInputContrastKey: contrast,
            kCIInputSaturationKey: saturation,
        ])
    }

    static func vignette(_ img: CIImage, intensity: Double, radius: Double = 1.6) -> CIImage {
        img.applyingFilter("CIVignette", parameters: [kCIInputIntensityKey: intensity, kCIInputRadiusKey: radius])
    }

    static func toneCurve(_ img: CIImage, _ pts: [(Double, Double)]) -> CIImage {
        guard pts.count == 5 else { return img }
        var params: [String: Any] = [:]
        for (i, p) in pts.enumerated() {
            params["inputPoint\(i)"] = CIVector(x: CGFloat(p.0), y: CGFloat(p.1))
        }
        return img.applyingFilter("CIToneCurve", parameters: params)
    }

    static func matrix(_ img: CIImage, r: (Double, Double, Double), g: (Double, Double, Double), b: (Double, Double, Double), bias: (Double, Double, Double) = (0, 0, 0)) -> CIImage {
        img.applyingFilter("CIColorMatrix", parameters: [
            "inputRVector": CIVector(x: CGFloat(r.0), y: CGFloat(r.1), z: CGFloat(r.2), w: 0),
            "inputGVector": CIVector(x: CGFloat(g.0), y: CGFloat(g.1), z: CGFloat(g.2), w: 0),
            "inputBVector": CIVector(x: CGFloat(b.0), y: CGFloat(b.1), z: CGFloat(b.2), w: 0),
            "inputAVector": CIVector(x: 0, y: 0, z: 0, w: 1),
            "inputBiasVector": CIVector(x: CGFloat(bias.0), y: CGFloat(bias.1), z: CGFloat(bias.2), w: 0),
        ])
    }

    static func applyPreset(_ id: String, intensity: Double, to input: CIImage) -> CIImage {
        guard id != "none", intensity > 0.001 else { return input }
        let rect = input.extent
        var img = input
        switch id {
        case "vivid":
            img = controls(img, contrast: 1.08, saturation: 1.35).applyingFilter("CIVibrance", parameters: ["inputAmount": 0.3])
        case "warm":
            img = controls(temperature(img, shift: 1300, tint: 5), saturation: 1.08)
        case "cool":
            img = controls(temperature(img, shift: -1300, tint: -5), saturation: 1.02)
        case "tealOrange":
            img = matrix(img, r: (1.12, 0, 0), g: (0, 1.0, 0), b: (0, 0, 0.88), bias: (-0.02, 0.02, 0.07))
            img = controls(img, contrast: 1.1, saturation: 1.15)
        case "cinema":
            img = matrix(img, r: (1.05, 0, 0), g: (0, 1.0, 0), b: (0, 0, 0.95), bias: (0, 0.015, 0.04))
            img = controls(img, contrast: 1.18, saturation: 0.85)
            img = vignette(img, intensity: 0.8)
        case "dramatic":
            img = controls(img, brightness: -0.03, contrast: 1.38, saturation: 0.78)
            img = vignette(img, intensity: 1.4)
        case "film":
            img = img.applyingFilter("CIPhotoEffectFade")
            img = temperature(img, shift: 500)
            img = controls(img, contrast: 1.05, saturation: 1.05)
        case "retro":
            img = img.applyingFilter("CISepiaTone", parameters: [kCIInputIntensityKey: 0.35])
            img = controls(temperature(img, shift: 900), contrast: 0.95, saturation: 0.85)
            img = vignette(img, intensity: 1.0)
        case "vintage":
            img = img.applyingFilter("CIPhotoEffectTransfer")
            img = toneCurve(img, [(0, 0.08), (0.25, 0.28), (0.5, 0.52), (0.75, 0.76), (1, 0.94)])
        case "dreamy":
            img = img.applyingFilter("CIBloom", parameters: [kCIInputRadiusKey: rect.height / 1080 * 14, kCIInputIntensityKey: 0.7]).cropped(to: rect)
            img = controls(img, brightness: 0.04, contrast: 0.95, saturation: 0.9)
        case "pastel":
            img = controls(img, brightness: 0.07, contrast: 0.82, saturation: 0.7)
            img = temperature(img, shift: 300, tint: 8)
        case "cyber":
            img = img.applyingFilter("CIHueAdjust", parameters: [kCIInputAngleKey: 0.35])
            img = temperature(img, shift: -900, tint: 35)
            img = controls(img, contrast: 1.15, saturation: 1.45)
        case "sunset":
            img = controls(temperature(img, shift: 2100, tint: 18), contrast: 1.05, saturation: 1.2)
        case "forest":
            img = matrix(img, r: (0.95, 0.05, 0), g: (0.02, 1.08, 0), b: (0, 0.04, 0.92))
            img = controls(img, contrast: 1.06, saturation: 1.1)
        case "chrome": img = img.applyingFilter("CIPhotoEffectChrome")
        case "fade": img = img.applyingFilter("CIPhotoEffectFade")
        case "instant": img = img.applyingFilter("CIPhotoEffectInstant")
        case "process": img = img.applyingFilter("CIPhotoEffectProcess")
        case "transfer": img = img.applyingFilter("CIPhotoEffectTransfer")
        case "sepia": img = img.applyingFilter("CISepiaTone", parameters: [kCIInputIntensityKey: 0.9])
        case "mono": img = img.applyingFilter("CIPhotoEffectMono")
        case "noir": img = img.applyingFilter("CIPhotoEffectNoir")
        case "tonal": img = img.applyingFilter("CIPhotoEffectTonal")
        case "highContrastBW":
            img = controls(img.applyingFilter("CIPhotoEffectMono"), contrast: 1.55, saturation: 0)
        case "night":
            img = img.applyingFilter("CIExposureAdjust", parameters: [kCIInputEVKey: -0.7])
            img = controls(temperature(img, shift: -1700), saturation: 0.7)
        case "golden":
            img = controls(temperature(img, shift: 1700, tint: 10), brightness: 0.02, contrast: 1.04, saturation: 1.12)
        case "matte":
            img = toneCurve(img, [(0, 0.12), (0.25, 0.3), (0.5, 0.52), (0.75, 0.74), (1, 0.93)])
            img = controls(img, saturation: 0.88)
        default:
            return input
        }
        img = img.cropped(to: rect)
        return input.mixed(with: img, amount: intensity)
    }

    static func applyAdjustments(_ a: Adjustments, to input: CIImage, time: Double) -> CIImage {
        if a.isIdentity { return input }
        let rect = input.extent
        var img = input
        if a.exposure != 0 {
            img = img.applyingFilter("CIExposureAdjust", parameters: [kCIInputEVKey: a.exposure / 100 * 1.5])
        }
        if a.brightness != 0 || a.contrast != 0 || a.saturation != 0 {
            img = controls(img, brightness: a.brightness / 100 * 0.25, contrast: 1 + a.contrast / 100 * 0.5, saturation: 1 + a.saturation / 100)
        }
        if a.temperature != 0 || a.tint != 0 {
            img = temperature(img, shift: a.temperature / 100 * 2500, tint: a.tint / 100 * 60)
        }
        if a.highlights < 0 || a.shadows != 0 {
            img = img.applyingFilter("CIHighlightShadowAdjust", parameters: [
                "inputHighlightAmount": a.highlights < 0 ? 1 + a.highlights / 100 * 0.75 : 1,
                "inputShadowAmount": a.shadows / 100,
            ])
        }
        if a.highlights > 0 {
            let h = a.highlights / 100
            img = toneCurve(img, [(0, 0), (0.25, 0.25), (0.5, 0.5 + 0.04 * h), (0.75, 0.75 + 0.1 * h), (1, 1)])
        }
        if a.vibrance != 0 {
            img = img.applyingFilter("CIVibrance", parameters: ["inputAmount": a.vibrance / 100])
        }
        if a.hue != 0 {
            img = img.applyingFilter("CIHueAdjust", parameters: [kCIInputAngleKey: a.hue / 100 * Double.pi])
        }
        if a.fade > 0 {
            let f = a.fade / 100 * 0.22
            img = toneCurve(img, [(0, f), (0.25, 0.25 + f * 0.6), (0.5, 0.5 + f * 0.25), (0.75, 0.75), (1, 1 - f * 0.3)])
        }
        if a.sharpen > 0 {
            img = img.applyingFilter("CISharpenLuminance", parameters: [kCIInputSharpnessKey: a.sharpen / 100 * 1.5])
        } else if a.sharpen < 0 {
            img = img.blurred(-a.sharpen / 100 * 4 * rect.height / 1080)
        }
        if a.vignette != 0 {
            if a.vignette > 0 {
                img = vignette(img, intensity: a.vignette / 100 * 2)
            } else {
                let white = CIImage.solid(.white, rect)
                let mask = CIFilter(name: "CIRadialGradient", parameters: [
                    "inputCenter": CIVector(x: rect.midX, y: rect.midY),
                    "inputRadius0": min(rect.width, rect.height) * 0.35,
                    "inputRadius1": max(rect.width, rect.height) * 0.75,
                    "inputColor0": CIColor(red: 0, green: 0, blue: 0, alpha: 0),
                    "inputColor1": CIColor(red: 0, green: 0, blue: 0, alpha: CGFloat(-a.vignette / 100)),
                ])?.outputImage?.cropped(to: rect)
                if let mask = mask {
                    img = white.applyingFilter("CIBlendWithAlphaMask", parameters: [kCIInputBackgroundImageKey: img, kCIInputMaskImageKey: mask])
                }
            }
        }
        if a.grain > 0 {
            img = Grain.apply(img, amount: a.grain / 100, time: time)
        }
        return img.cropped(to: rect)
    }
}

enum Grain {
    static func noise(_ rect: CGRect, time: Double, amount: Double) -> CIImage {
        let seed = Int(time * 24)
        let dx = CGFloat(FXMath.rnd(seed) * 500), dy = CGFloat(FXMath.rnd(seed + 7) * 500)
        let noise = CIFilter(name: "CIRandomGenerator")?.outputImage ?? CIImage.empty()
        let gray = noise.transformed(by: CGAffineTransform(translationX: dx, y: dy))
            .applyingFilter("CIColorMatrix", parameters: [
                "inputRVector": CIVector(x: 0, y: 0, z: 0, w: 1),
                "inputGVector": CIVector(x: 0, y: 0, z: 0, w: 1),
                "inputBVector": CIVector(x: 0, y: 0, z: 0, w: 1),
                "inputAVector": CIVector(x: 0, y: 0, z: 0, w: 0),
                "inputBiasVector": CIVector(x: 0, y: 0, z: 0, w: CGFloat(amount * 0.35)),
            ])
        return gray.cropped(to: rect)
    }

    static func apply(_ img: CIImage, amount: Double, time: Double) -> CIImage {
        let n = noise(img.extent, time: time, amount: amount)
        return n.applyingFilter("CISoftLightBlendMode", parameters: [kCIInputBackgroundImageKey: img]).cropped(to: img.extent)
    }
}

// MARK: - Effekte

enum EffectFX {
    static func apply(_ kind: EffectKind, intensity k: Double, to img: CIImage, time t: Double) -> CIImage {
        let rect = img.extent
        guard !rect.isInfinite, rect.width > 1, rect.height > 1 else { return img }
        let ref = rect.height / 1080
        let center = CIVector(x: rect.midX, y: rect.midY)
        let i = FXMath.clamp(k, 0, 1)
        var out: CIImage
        switch kind {
        case .blur:
            out = img.blurred(i * 30 * ref)
        case .pixelate:
            out = img.applyingFilter("CIPixellate", parameters: [kCIInputScaleKey: max(2, i * 60 * ref), kCIInputCenterKey: center])
        case .glitch:
            out = glitch(img, amount: i, time: t)
        case .rgbSplit:
            out = rgbSplit(img, offset: i * 24 * ref)
        case .vhs:
            out = vhs(img, amount: i, time: t)
        case .mirror:
            let half = CGRect(x: rect.minX, y: rect.minY, width: rect.width / 2, height: rect.height)
            let left = img.cropped(to: half)
            let flip = CGAffineTransform(translationX: rect.minX * 2 + rect.width, y: 0).scaledBy(x: -1, y: 1)
            out = left.transformed(by: flip).composited(over: left)
        case .kaleidoscope:
            out = img.applyingFilter("CIKaleidoscope", parameters: ["inputCount": 6, kCIInputCenterKey: center, kCIInputAngleKey: t * 0.3 * i])
        case .zoomPulse:
            let s = 1 + i * 0.18 * (0.5 + 0.5 * sin(t * 2 * Double.pi * 1.6))
            out = img.clampedToExtent().transformed(by: scaleAround(rect, s))
        case .shake:
            let seed = Int(t * 24)
            let dx = (FXMath.rnd(seed) - 0.5) * 2 * i * 28 * ref
            let dy = (FXMath.rnd(seed + 11) - 0.5) * 2 * i * 28 * ref
            out = img.clampedToExtent().transformed(by: scaleAround(rect, 1 + 0.05 * i).concatenating(CGAffineTransform(translationX: dx, y: dy)))
        case .glow:
            out = img.applyingFilter("CIBloom", parameters: [kCIInputRadiusKey: 18 * ref, kCIInputIntensityKey: i * 1.6])
        case .comic:
            out = img.mixed(with: img.applyingFilter("CIComicEffect").cropped(to: rect), amount: max(0.2, i))
        case .posterize:
            out = img.applyingFilter("CIColorPosterize", parameters: ["inputLevels": 2 + (1 - i) * 10])
        case .invert:
            out = img.mixed(with: img.applyingFilter("CIColorInvert"), amount: max(0.2, i))
        case .edges:
            out = img.applyingFilter("CIEdges", parameters: [kCIInputIntensityKey: 1 + i * 10])
        case .crystallize:
            out = img.applyingFilter("CICrystallize", parameters: [kCIInputRadiusKey: (5 + i * 45) * ref, kCIInputCenterKey: center])
        case .dots:
            out = img.applyingFilter("CIDotScreen", parameters: [kCIInputCenterKey: center, kCIInputAngleKey: 0.4, kCIInputWidthKey: (4 + i * 18) * ref, kCIInputSharpnessKey: 0.7])
        case .thermal:
            let mono = img.applyingFilter("CIPhotoEffectMono")
            let hot = mono.applyingFilter("CIFalseColor", parameters: [
                "inputColor0": CIColor(red: 0.05, green: 0.0, blue: 0.6),
                "inputColor1": CIColor(red: 1.0, green: 0.85, blue: 0.1),
            ])
            out = img.mixed(with: controls(hot, saturation: 1.6), amount: max(0.3, i))
        case .strobe:
            let on = sin(t * 2 * Double.pi * (3 + i * 7)) > 0.3
            out = on ? img.applyingFilter("CIExposureAdjust", parameters: [kCIInputEVKey: 0.6 + i * 1.6]) : img
        case .oldFilm:
            out = oldFilm(img, amount: i, time: t)
        case .letterbox:
            let bar = rect.height * (0.04 + i * 0.12)
            let black = CIImage.solid(.black, CGRect(x: rect.minX, y: rect.minY, width: rect.width, height: bar))
                .composited(over: CIImage.solid(.black, CGRect(x: rect.minX, y: rect.maxY - bar, width: rect.width, height: bar)))
            out = black.composited(over: img)
        case .split4:
            out = tile(img, n: 2)
        case .split9:
            out = tile(img, n: 3)
        case .twirl:
            out = img.applyingFilter("CITwirlDistortion", parameters: [kCIInputCenterKey: center, kCIInputRadiusKey: min(rect.width, rect.height) * 0.45, kCIInputAngleKey: i * Double.pi * 2 * sin(t * 1.2)])
        case .bulge:
            out = img.applyingFilter("CIBumpDistortion", parameters: [kCIInputCenterKey: center, kCIInputRadiusKey: min(rect.width, rect.height) * 0.45, kCIInputScaleKey: i * 0.9])
        case .hexagon:
            out = img.applyingFilter("CIHexagonalPixellate", parameters: [kCIInputCenterKey: center, kCIInputScaleKey: (6 + i * 50) * ref])
        case .flash:
            let phase = (t * 1.5).truncatingRemainder(dividingBy: 1)
            let a = max(0, 1 - phase * 4) * i
            out = CIImage.solid(RGBA(1, 1, 1, a), rect).composited(over: img)
        case .snow:
            out = particles(img, time: t, amount: i, streak: false)
        case .rain:
            out = particles(img, time: t, amount: i, streak: true)
        case .sparkle:
            out = sparkle(img, time: t, amount: i)
        case .lightLeak:
            out = lightLeak(img, time: t, amount: i)
        case .vignette:
            out = img.applyingFilter("CIVignetteEffect", parameters: [kCIInputCenterKey: center, kCIInputRadiusKey: max(rect.width, rect.height) * (0.75 - i * 0.35), kCIInputIntensityKey: 0.6 + i * 0.4])
        case .blackWhite:
            let on = Int(t * (2 + i * 6)) % 2 == 0
            out = on ? img.applyingFilter("CIPhotoEffectNoir") : img
        }
        return out.cropped(to: rect)
    }

    static func controls(_ img: CIImage, saturation: Double) -> CIImage {
        ColorFX.controls(img, saturation: saturation)
    }

    static func scaleAround(_ rect: CGRect, _ s: Double) -> CGAffineTransform {
        CGAffineTransform(translationX: -rect.midX, y: -rect.midY)
            .concatenating(CGAffineTransform(scaleX: CGFloat(s), y: CGFloat(s)))
            .concatenating(CGAffineTransform(translationX: rect.midX, y: rect.midY))
    }

    static func channel(_ img: CIImage, r: Bool, g: Bool, b: Bool) -> CIImage {
        img.applyingFilter("CIColorMatrix", parameters: [
            "inputRVector": CIVector(x: r ? 1 : 0, y: 0, z: 0, w: 0),
            "inputGVector": CIVector(x: 0, y: g ? 1 : 0, z: 0, w: 0),
            "inputBVector": CIVector(x: 0, y: 0, z: b ? 1 : 0, w: 0),
            "inputAVector": CIVector(x: 0, y: 0, z: 0, w: 1),
        ])
    }

    static func rgbSplit(_ img: CIImage, offset: Double, vertical: Double = 0) -> CIImage {
        let rect = img.extent
        let base = img.clampedToExtent()
        let red = channel(base.transformed(by: CGAffineTransform(translationX: CGFloat(offset), y: CGFloat(vertical))), r: true, g: false, b: false)
        let green = channel(base, r: false, g: true, b: false)
        let blue = channel(base.transformed(by: CGAffineTransform(translationX: CGFloat(-offset), y: CGFloat(-vertical))), r: false, g: false, b: true)
        let rg = red.applyingFilter("CIAdditionCompositing", parameters: [kCIInputBackgroundImageKey: green])
        let rgb = blue.applyingFilter("CIAdditionCompositing", parameters: [kCIInputBackgroundImageKey: rg])
        return rgb.applyingFilter("CIColorClamp", parameters: [
            "inputMinComponents": CIVector(x: 0, y: 0, z: 0, w: 0),
            "inputMaxComponents": CIVector(x: 1, y: 1, z: 1, w: 1),
        ]).cropped(to: rect)
    }

    static func glitch(_ img: CIImage, amount: Double, time: Double) -> CIImage {
        let rect = img.extent
        let ref = rect.height / 1080
        let seed = Int(time * 14)
        let burst = FXMath.rnd(seed) < 0.35 + amount * 0.4
        let shift = burst ? (FXMath.rnd(seed + 3) - 0.5) * 60 * amount * ref : 4 * amount * ref
        var out = rgbSplit(img, offset: shift, vertical: shift * 0.2)
        if burst {
            for s in 0..<Int(2 + amount * 5) {
                let h = rect.height * (0.02 + FXMath.rnd(seed * 31 + s) * 0.08)
                let y = rect.minY + FXMath.rnd(seed * 17 + s) * (rect.height - h)
                let dx = (FXMath.rnd(seed * 13 + s) - 0.5) * rect.width * 0.12 * amount
                let band = CGRect(x: rect.minX, y: y, width: rect.width, height: h)
                let slice = img.clampedToExtent().transformed(by: CGAffineTransform(translationX: CGFloat(dx), y: 0)).cropped(to: band)
                out = slice.composited(over: out)
            }
        }
        return out.cropped(to: rect)
    }

    static func scanlines(_ rect: CGRect, alpha: Double, width: Double) -> CIImage {
        let stripes = CIFilter(name: "CIStripesGenerator", parameters: [
            "inputCenter": CIVector(x: 0, y: 0),
            "inputColor0": CIColor(red: 0, green: 0, blue: 0, alpha: CGFloat(alpha)),
            "inputColor1": CIColor(red: 0, green: 0, blue: 0, alpha: 0),
            "inputWidth": max(1, width),
            "inputSharpness": 0.6,
        ])?.outputImage ?? CIImage.empty()
        return stripes.transformed(by: CGAffineTransform(rotationAngle: .pi / 2)).cropped(to: rect)
    }

    static func vhs(_ img: CIImage, amount: Double, time: Double) -> CIImage {
        let rect = img.extent
        let ref = rect.height / 1080
        var out = rgbSplit(img, offset: (3 + amount * 8) * ref)
        out = ColorFX.controls(out, brightness: 0.02, contrast: 1.05, saturation: 0.8 + amount * 0.3)
        out = scanlines(rect, alpha: 0.25 * amount + 0.1, width: 2 * ref).composited(over: out)
        out = Grain.apply(out, amount: 0.3 + amount * 0.5, time: time)
        // Tracking-Streifen
        let y = rect.minY + (time * 0.25).truncatingRemainder(dividingBy: 1) * rect.height
        let band = CGRect(x: rect.minX, y: y, width: rect.width, height: rect.height * 0.04)
        let tracking = img.clampedToExtent().transformed(by: CGAffineTransform(translationX: 18 * ref * CGFloat(amount), y: 0))
            .cropped(to: band).applyingFilter("CIColorControls", parameters: [kCIInputBrightnessKey: 0.15])
        return tracking.composited(over: out).cropped(to: rect)
    }

    static func oldFilm(_ img: CIImage, amount: Double, time: Double) -> CIImage {
        let rect = img.extent
        let seed = Int(time * 18)
        var out = img.applyingFilter("CISepiaTone", parameters: [kCIInputIntensityKey: 0.6 + amount * 0.4])
        out = ColorFX.vignette(out, intensity: 1.2 + amount)
        out = Grain.apply(out, amount: 0.4 + amount * 0.5, time: time)
        let flicker = (FXMath.rnd(seed + 99) - 0.5) * 0.08 * amount
        out = ColorFX.controls(out, brightness: flicker)
        for s in 0..<2 where FXMath.rnd(seed * 7 + s) < 0.6 {
            let x = rect.minX + FXMath.rnd(seed * 5 + s) * rect.width
            let line = CIImage.solid(RGBA(1, 1, 0.95, 0.35 * amount), CGRect(x: x, y: rect.minY, width: max(1, rect.height / 900), height: rect.height))
            out = line.composited(over: out)
        }
        return out.cropped(to: rect)
    }

    static func tile(_ img: CIImage, n: Int) -> CIImage {
        let rect = img.extent
        let s = 1.0 / Double(n)
        let small = img.transformed(by: CGAffineTransform(translationX: -rect.minX, y: -rect.minY).concatenating(CGAffineTransform(scaleX: CGFloat(s), y: CGFloat(s))))
        var out = CIImage.solid(.black, rect)
        for ix in 0..<n {
            for iy in 0..<n {
                let tx = rect.minX + rect.width * CGFloat(ix) / CGFloat(n)
                let ty = rect.minY + rect.height * CGFloat(iy) / CGFloat(n)
                out = small.transformed(by: CGAffineTransform(translationX: tx, y: ty)).composited(over: out)
            }
        }
        return out
    }

    static func particles(_ img: CIImage, time: Double, amount: Double, streak: Bool) -> CIImage {
        let rect = img.extent
        let ref = rect.height / 1080
        let noise = CIFilter(name: "CIRandomGenerator")?.outputImage ?? CIImage.empty()
        let threshold = 0.9985 - amount * 0.004
        let gain = 1.0 / (1 - threshold)
        let b = CGFloat(-threshold * gain)
        // Zufallswert aus dem Alphakanal (Farbkanäle werden von Core Image durch Alpha geteilt
        // und wären dadurch nicht gleichverteilt). Ausgabe-Alpha bleibt 1.
        let gray = noise.applyingFilter("CIColorMatrix", parameters: [
            "inputRVector": CIVector(x: 0, y: 0, z: 0, w: CGFloat(gain)),
            "inputGVector": CIVector(x: 0, y: 0, z: 0, w: CGFloat(gain)),
            "inputBVector": CIVector(x: 0, y: 0, z: 0, w: CGFloat(gain)),
            "inputAVector": CIVector(x: 0, y: 0, z: 0, w: 0),
            "inputBiasVector": CIVector(x: b, y: b, z: b, w: 1),
        ]).applyingFilter("CIColorClamp", parameters: [
            "inputMinComponents": CIVector(x: 0, y: 0, z: 0, w: 0),
            "inputMaxComponents": CIVector(x: 1, y: 1, z: 1, w: 1),
        ])
        var dots = gray.applyingFilter("CIMaskToAlpha")
        if streak {
            dots = dots.transformed(by: CGAffineTransform(scaleX: 2.0 * ref, y: 28 * ref).concatenating(CGAffineTransform(rotationAngle: 0.12)))
            dots = dots.transformed(by: CGAffineTransform(translationX: 0, y: CGFloat(-time * 1400 * ref)))
            dots = dots.withOpacity(0.55)
        } else {
            dots = dots.transformed(by: CGAffineTransform(scaleX: 5 * ref, y: 5 * ref))
            dots = dots.transformed(by: CGAffineTransform(translationX: CGFloat(sin(time * 0.8) * 30 * ref), y: CGFloat(-time * 160 * ref)))
            dots = dots.applyingGaussianBlur(sigma: 1.2 * ref)
        }
        return dots.cropped(to: rect).composited(over: img).cropped(to: rect)
    }

    static func sparkle(_ img: CIImage, time: Double, amount: Double) -> CIImage {
        let rect = img.extent
        let ref = rect.height / 1080
        var out = img
        let count = Int(6 + amount * 24)
        let frame = Int(time * 8)
        for s in 0..<count {
            let life = FXMath.rnd(s * 97 + frame / 3)
            guard life > 0.35 else { continue }
            let x = rect.minX + FXMath.rnd(s * 13 + frame / 3) * rect.width
            let y = rect.minY + FXMath.rnd(s * 29 + frame / 3) * rect.height
            let r = (6 + FXMath.rnd(s * 3) * 18) * ref * (0.5 + 0.5 * sin(time * 6 + Double(s)))
            guard r > 1 else { continue }
            if let g = CIFilter(name: "CIRadialGradient", parameters: [
                "inputCenter": CIVector(x: x, y: y),
                "inputRadius0": 0,
                "inputRadius1": r,
                "inputColor0": CIColor(red: 1, green: 1, blue: 0.9, alpha: 1),
                "inputColor1": CIColor(red: 1, green: 1, blue: 1, alpha: 0),
            ])?.outputImage?.cropped(to: CGRect(x: x - r, y: y - r, width: r * 2, height: r * 2)) {
                out = g.applyingFilter("CIAdditionCompositing", parameters: [kCIInputBackgroundImageKey: out])
            }
        }
        return out.cropped(to: rect)
    }

    static func lightLeak(_ img: CIImage, time: Double, amount: Double) -> CIImage {
        let rect = img.extent
        let cx = rect.minX + rect.width * (0.5 + 0.45 * sin(time * 0.7))
        let cy = rect.minY + rect.height * (0.6 + 0.3 * cos(time * 0.5))
        let leak = CIFilter(name: "CIRadialGradient", parameters: [
            "inputCenter": CIVector(x: cx, y: cy),
            "inputRadius0": 0,
            "inputRadius1": max(rect.width, rect.height) * 0.6,
            "inputColor0": CIColor(red: 1, green: 0.45, blue: 0.15, alpha: CGFloat(0.75 * amount + 0.15)),
            "inputColor1": CIColor(red: 1, green: 0.2, blue: 0.5, alpha: 0),
        ])?.outputImage?.cropped(to: rect) ?? CIImage.empty()
        return leak.applyingFilter("CIScreenBlendMode", parameters: [kCIInputBackgroundImageKey: img]).cropped(to: rect)
    }
}

// MARK: - Übergänge

enum TransitionFX {
    static func apply(_ kind: TransitionKind, from a: CIImage, to b: CIImage, progress pIn: Double, rect: CGRect) -> CIImage {
        let p = FXMath.clamp(pIn, 0, 1)
        let e = FXMath.smooth(p)
        let W = rect.width, H = rect.height
        let ref = H / 1080
        func moved(_ img: CIImage, _ dx: Double, _ dy: Double) -> CIImage {
            img.transformed(by: CGAffineTransform(translationX: CGFloat(dx), y: CGFloat(dy)))
        }
        func scaled(_ img: CIImage, _ s: Double) -> CIImage {
            img.transformed(by: EffectFX.scaleAround(rect, s))
        }
        let black = CIImage.solid(.black, rect)
        var out: CIImage
        switch kind {
        case .none:
            out = p < 0.5 ? a : b
        case .dissolve:
            out = a.mixed(with: b, amount: e)
        case .dipBlack, .dipWhite:
            let c = CIImage.solid(kind == .dipBlack ? .black : .white, rect)
            out = p < 0.5 ? a.mixed(with: c, amount: FXMath.smooth(p * 2)) : c.mixed(with: b, amount: FXMath.smooth(p * 2 - 1))
        case .wipeLeft:
            out = b.cropped(to: CGRect(x: rect.maxX - W * e, y: rect.minY, width: W * e, height: H)).composited(over: a)
        case .wipeRight:
            out = b.cropped(to: CGRect(x: rect.minX, y: rect.minY, width: W * e, height: H)).composited(over: a)
        case .wipeUp:
            out = b.cropped(to: CGRect(x: rect.minX, y: rect.minY, width: W, height: H * e)).composited(over: a)
        case .wipeDown:
            out = b.cropped(to: CGRect(x: rect.minX, y: rect.maxY - H * e, width: W, height: H * e)).composited(over: a)
        case .pushLeft:
            out = moved(b, W * (1 - e), 0).composited(over: moved(a, -W * e, 0))
        case .pushRight:
            out = moved(b, -W * (1 - e), 0).composited(over: moved(a, W * e, 0))
        case .pushUp:
            out = moved(b, 0, -H * (1 - e)).composited(over: moved(a, 0, H * e))
        case .pushDown:
            out = moved(b, 0, H * (1 - e)).composited(over: moved(a, 0, -H * e))
        case .slideLeft:
            out = moved(b, W * (1 - e), 0).composited(over: a)
        case .slideRight:
            out = moved(b, -W * (1 - e), 0).composited(over: a)
        case .zoomIn:
            let aa = scaled(a, 1 + e * 0.8).cropped(to: rect).withOpacity(1 - e)
            let bb = scaled(b, 0.6 + 0.4 * e).withOpacity(e)
            out = aa.composited(over: bb.composited(over: black))
        case .zoomOut:
            let aa = scaled(a, 1 - e * 0.45).withOpacity(1 - e)
            let bb = scaled(b, 1.5 - 0.5 * e).cropped(to: rect).withOpacity(e)
            out = bb.composited(over: aa.composited(over: black))
        case .blur:
            let s = sin(p * Double.pi) * 40 * ref
            out = a.blurred(s).mixed(with: b.blurred(s), amount: e)
        case .circle:
            let r = sqrt(W * W + H * H) / 2 * e
            let mask = CIFilter(name: "CIRadialGradient", parameters: [
                "inputCenter": CIVector(x: rect.midX, y: rect.midY),
                "inputRadius0": max(0, r - 4 * ref),
                "inputRadius1": r + 0.5,
                "inputColor0": CIColor(red: 1, green: 1, blue: 1, alpha: 1),
                "inputColor1": CIColor(red: 1, green: 1, blue: 1, alpha: 0),
            ])?.outputImage?.cropped(to: rect) ?? CIImage.empty()
            out = b.applyingFilter("CIBlendWithAlphaMask", parameters: [kCIInputBackgroundImageKey: a, kCIInputMaskImageKey: mask])
        case .spin:
            let ang = CGFloat(e * Double.pi * 2)
            let rot = CGAffineTransform(translationX: -rect.midX, y: -rect.midY)
                .concatenating(CGAffineTransform(rotationAngle: ang))
                .concatenating(CGAffineTransform(scaleX: CGFloat(1 - sin(p * Double.pi) * 0.5), y: CGFloat(1 - sin(p * Double.pi) * 0.5)))
                .concatenating(CGAffineTransform(translationX: rect.midX, y: rect.midY))
            let src = p < 0.5 ? a : b
            out = src.transformed(by: rot).composited(over: black)
        case .pixelate:
            let s = max(1, sin(p * Double.pi) * 70 * ref)
            let mixed = a.mixed(with: b, amount: e)
            out = s > 1.5 ? mixed.applyingFilter("CIPixellate", parameters: [kCIInputScaleKey: s, kCIInputCenterKey: CIVector(x: rect.midX, y: rect.midY)]) : mixed
        case .flash:
            let w = max(0, 1 - abs(p - 0.5) * 2.2)
            out = CIImage.solid(RGBA(1, 1, 1, w), rect).composited(over: p < 0.5 ? a : b)
        case .glitch:
            let base = p < 0.5 ? a : b
            out = EffectFX.glitch(base, amount: sin(p * Double.pi), time: p * 3)
        case .pageCurl:
            out = a.applyingFilter("CIPageCurlTransition", parameters: [
                "inputTargetImage": b,
                "inputBacksideImage": a,
                "inputShadingImage": CIImage.solid(RGBA(1, 1, 1, 0.3), rect),
                "inputExtent": CIVector(cgRect: rect),
                "inputTime": e,
                "inputAngle": -Double.pi * 0.8,
                "inputRadius": 140 * ref,
            ])
        case .ripple:
            out = a.applyingFilter("CIRippleTransition", parameters: [
                "inputTargetImage": b,
                "inputShadingImage": CIImage.solid(RGBA(1, 1, 1, 0.2), rect),
                "inputCenter": CIVector(x: rect.midX, y: rect.midY),
                "inputExtent": CIVector(cgRect: rect),
                "inputTime": e,
                "inputWidth": 100 * ref,
                "inputScale": 40,
            ])
        case .bars:
            out = a.applyingFilter("CIBarsSwipeTransition", parameters: [
                "inputTargetImage": b,
                "inputAngle": Double.pi,
                "inputWidth": 60 * ref,
                "inputBarOffset": 10,
                "inputTime": e,
            ])
        case .copyMachine:
            out = a.applyingFilter("CICopyMachineTransition", parameters: [
                "inputTargetImage": b,
                "inputExtent": CIVector(cgRect: rect),
                "inputColor": CIColor(red: 0.6, green: 1, blue: 0.8),
                "inputTime": e,
                "inputAngle": 0,
                "inputWidth": 200 * ref,
                "inputOpacity": 1.3,
            ])
        case .mod:
            out = a.applyingFilter("CIModTransition", parameters: [
                "inputTargetImage": b,
                "inputCenter": CIVector(x: rect.midX, y: rect.midY),
                "inputTime": e,
                "inputAngle": 2,
                "inputRadius": 150 * ref,
                "inputCompression": 300,
            ])
        case .swipe:
            out = a.applyingFilter("CISwipeTransition", parameters: [
                "inputTargetImage": b,
                "inputExtent": CIVector(cgRect: rect),
                "inputColor": CIColor(red: 1, green: 1, blue: 1),
                "inputTime": e,
                "inputAngle": Double.pi,
                "inputWidth": 300 * ref,
                "inputOpacity": 0,
            ])
        }
        return out.cropped(to: rect)
    }
}

// MARK: - Maske, Chroma-Key

enum MaskFX {
    static func mask(_ m: MaskSetting, rect: CGRect) -> CIImage? {
        guard m.kind != .none else { return nil }
        let minSide = min(rect.width, rect.height)
        let cx = rect.minX + rect.width * CGFloat(m.x)
        let cy = rect.minY + rect.height * CGFloat(1 - m.y)
        let feather = max(0.5, CGFloat(m.feather) * minSide * 0.5)
        let white = CIColor(red: 1, green: 1, blue: 1, alpha: 1)
        let clear = CIColor(red: 1, green: 1, blue: 1, alpha: 0)
        var shape: CIImage?
        switch m.kind {
        case .none:
            return nil
        case .circle:
            let r = CGFloat(m.size) * minSide * 0.5
            var g = CIFilter(name: "CIRadialGradient", parameters: [
                "inputCenter": CIVector(x: 0, y: 0),
                "inputRadius0": max(0, r - feather),
                "inputRadius1": r + 0.5,
                "inputColor0": white, "inputColor1": clear,
            ])?.outputImage
            // Seitenverhältnis (Ellipse) + Drehung
            g = g?.transformed(by: CGAffineTransform(scaleX: CGFloat(max(0.1, m.aspect)), y: 1)
                .concatenating(CGAffineTransform(rotationAngle: CGFloat(-m.rotation * Double.pi / 180)))
                .concatenating(CGAffineTransform(translationX: cx, y: cy)))
            shape = g
        case .rectangle:
            let h = CGFloat(m.size) * minSide
            let w = h * CGFloat(max(0.1, m.aspect))
            let box = CIImage(color: white).cropped(to: CGRect(x: -w / 2, y: -h / 2, width: w, height: h))
            let soft = box.applyingGaussianBlur(sigma: Double(feather) / 2)
            shape = soft.transformed(by: CGAffineTransform(rotationAngle: CGFloat(-m.rotation * Double.pi / 180))
                .concatenating(CGAffineTransform(translationX: cx, y: cy)))
        case .linear:
            let ang = CGFloat(-m.rotation * Double.pi / 180)
            let dir = CGPoint(x: -sin(ang), y: cos(ang))
            let p0 = CGPoint(x: cx - dir.x * feather, y: cy - dir.y * feather)
            let p1 = CGPoint(x: cx + dir.x * feather, y: cy + dir.y * feather)
            shape = CIFilter(name: "CILinearGradient", parameters: [
                "inputPoint0": CIVector(cgPoint: p0), "inputPoint1": CIVector(cgPoint: p1),
                "inputColor0": white, "inputColor1": clear,
            ])?.outputImage
        case .mirror:
            let h = CGFloat(m.size) * minSide
            let big = max(rect.width, rect.height) * 3
            let band = CIImage(color: white).cropped(to: CGRect(x: -big / 2, y: -h / 2, width: big, height: h))
            shape = band.applyingGaussianBlur(sigma: Double(feather) / 2)
                .transformed(by: CGAffineTransform(rotationAngle: CGFloat(-m.rotation * Double.pi / 180))
                    .concatenating(CGAffineTransform(translationX: cx, y: cy)))
        case .heart:
            shape = heartMask(size: CGFloat(m.size) * minSide, feather: feather)?
                .transformed(by: CGAffineTransform(rotationAngle: CGFloat(-m.rotation * Double.pi / 180))
                    .concatenating(CGAffineTransform(translationX: cx, y: cy)))
        }
        guard var s = shape?.cropped(to: rect) else { return nil }
        if m.invert {
            s = s.applyingFilter("CIColorMatrix", parameters: [
                "inputAVector": CIVector(x: 0, y: 0, z: 0, w: -1),
                "inputBiasVector": CIVector(x: 0, y: 0, z: 0, w: 1),
            ]).cropped(to: rect)
            s = CIImage(color: white).cropped(to: rect).applyingFilter("CIBlendWithAlphaMask", parameters: [
                kCIInputBackgroundImageKey: CIImage.empty(), kCIInputMaskImageKey: s,
            ])
        }
        return s
    }

    private static var heartCache: [Int: CIImage] = [:]
    private static let heartLock = NSLock()

    static func heartMask(size: CGFloat, feather: CGFloat) -> CIImage? {
        let px = max(16, Int(size))
        heartLock.lock(); defer { heartLock.unlock() }
        let key = px * 1000 + Int(feather)
        if let c = heartCache[key] { return c }
        let cs = CGColorSpaceCreateDeviceRGB()
        guard let ctx = CGContext(data: nil, width: px, height: px, bitsPerComponent: 8, bytesPerRow: 0, space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        let s = CGFloat(px)
        let path = CGMutablePath()
        path.move(to: CGPoint(x: s * 0.5, y: s * 0.12))
        path.addCurve(to: CGPoint(x: s * 0.02, y: s * 0.62), control1: CGPoint(x: s * 0.2, y: s * 0.35), control2: CGPoint(x: s * 0.0, y: s * 0.45))
        path.addCurve(to: CGPoint(x: s * 0.5, y: s * 0.78), control1: CGPoint(x: s * 0.05, y: s * 0.95), control2: CGPoint(x: s * 0.42, y: s * 0.98))
        path.addCurve(to: CGPoint(x: s * 0.98, y: s * 0.62), control1: CGPoint(x: s * 0.58, y: s * 0.98), control2: CGPoint(x: s * 0.95, y: s * 0.95))
        path.addCurve(to: CGPoint(x: s * 0.5, y: s * 0.12), control1: CGPoint(x: s * 1.0, y: s * 0.45), control2: CGPoint(x: s * 0.8, y: s * 0.35))
        ctx.addPath(path)
        ctx.setFillColor(CGColor(srgbRed: 1, green: 1, blue: 1, alpha: 1))
        ctx.fillPath()
        guard let cg = ctx.makeImage() else { return nil }
        var img = CIImage(cgImage: cg)
        if feather > 1 { img = img.applyingGaussianBlur(sigma: Double(feather) / 3) }
        img = img.transformed(by: CGAffineTransform(translationX: -s / 2, y: -s / 2))
        if heartCache.count > 40 { heartCache.removeAll() }
        heartCache[key] = img
        return img
    }

    static func applyMask(_ m: MaskSetting, to img: CIImage) -> CIImage {
        guard let mask = mask(m, rect: img.extent) else { return img }
        return img.applyingFilter("CIBlendWithAlphaMask", parameters: [
            kCIInputBackgroundImageKey: CIImage.empty(),
            kCIInputMaskImageKey: mask,
        ]).cropped(to: img.extent)
    }
}

enum ChromaFX {
    private static var cache: [String: Data] = [:]
    private static let lock = NSLock()
    static let size = 32

    static func cube(for key: ChromaKey) -> Data {
        let id = "\(key.color.r)-\(key.color.g)-\(key.color.b)-\(key.tolerance)-\(key.softness)"
        lock.lock(); defer { lock.unlock() }
        if let d = cache[id] { return d }
        let (kh, _, _) = rgbToHSV(key.color.r, key.color.g, key.color.b)
        let tol = 0.04 + key.tolerance * 0.22
        let soft = 0.01 + key.softness * 0.15
        var data = [Float](repeating: 0, count: size * size * size * 4)
        var offset = 0
        for z in 0..<size {
            let b = Double(z) / Double(size - 1)
            for y in 0..<size {
                let g = Double(y) / Double(size - 1)
                for x in 0..<size {
                    let r = Double(x) / Double(size - 1)
                    let (h, s, v) = rgbToHSV(r, g, b)
                    var dh = abs(h - kh)
                    dh = min(dh, 1 - dh)
                    var alpha = 1.0
                    if s > 0.18 && v > 0.12 {
                        if dh < tol { alpha = 0 } else if dh < tol + soft { alpha = (dh - tol) / soft }
                    }
                    let a = Float(alpha)
                    data[offset] = Float(r) * a
                    data[offset + 1] = Float(g) * a
                    data[offset + 2] = Float(b) * a
                    data[offset + 3] = a
                    offset += 4
                }
            }
        }
        let d = data.withUnsafeBufferPointer { Data(buffer: $0) }
        if cache.count > 10 { cache.removeAll() }
        cache[id] = d
        return d
    }

    static func rgbToHSV(_ r: Double, _ g: Double, _ b: Double) -> (Double, Double, Double) {
        let mx = max(r, g, b), mn = min(r, g, b)
        let d = mx - mn
        var h = 0.0
        if d > 0 {
            if mx == r { h = ((g - b) / d).truncatingRemainder(dividingBy: 6) }
            else if mx == g { h = (b - r) / d + 2 }
            else { h = (r - g) / d + 4 }
            h /= 6
            if h < 0 { h += 1 }
        }
        let s = mx == 0 ? 0 : d / mx
        return (h, s, mx)
    }

    static func apply(_ key: ChromaKey, to img: CIImage) -> CIImage {
        guard key.enabled else { return img }
        return img.applyingFilter("CIColorCubeWithColorSpace", parameters: [
            "inputCubeDimension": size,
            "inputCubeData": cube(for: key),
            "inputColorSpace": CGColorSpace(name: CGColorSpace.sRGB) as Any,
        ])
    }
}
