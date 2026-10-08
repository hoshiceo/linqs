import Foundation
import PDFKit
import Vision

struct PageRecord: Codable {
    let page: Int
    let text: String
    let method: String
}
struct BookRecord: Codable {
    let file: String
    let pages: [PageRecord]
    let version: Int
}
let input = CommandLine.arguments[1]
let output = CommandLine.arguments[2]
let document = PDFDocument(url: URL(fileURLWithPath:input))!
var pages = [PageRecord]()
for index in 0..<document.pageCount {
    try autoreleasepool {
        let page = document.page(at:index)!
        var text = page.string ?? ""
        let japaneseCount = text.unicodeScalars.filter { (0x3040...0x30ff).contains($0.value) || (0x4e00...0x9fff).contains($0.value) }.count
        var method = "text"
        if text.trimmingCharacters(in: .whitespacesAndNewlines).count < 90 || japaneseCount < 15 {
            let image = page.thumbnail(of:CGSize(width:1800,height:2400),for:.mediaBox)
            guard let cg = image.cgImage(forProposedRect:nil,context:nil,hints:nil) else { throw NSError(domain:"OCR",code:1) }
            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .accurate
            request.recognitionLanguages = ["ja-JP","en-US"]
            request.usesLanguageCorrection = false
            try VNImageRequestHandler(cgImage:cg,options:[:]).perform([request])
            let observations = (request.results ?? []).sorted { left,right in
                if abs(left.boundingBox.midY-right.boundingBox.midY) > 0.012 { return left.boundingBox.midY > right.boundingBox.midY }
                return left.boundingBox.minX < right.boundingBox.minX
            }
            let recognized = observations.compactMap { $0.topCandidates(1).first?.string }.joined(separator:"\n")
            if recognized.count > text.trimmingCharacters(in:.whitespacesAndNewlines).count || japaneseCount < 15 {
                text = recognized
                method = "ocr"
            }
        }
        pages.append(PageRecord(page:index+1,text:text,method:method))
        if (index+1)%10 == 0 || index+1 == document.pageCount { print("\(URL(fileURLWithPath:input).lastPathComponent): \(index+1)/\(document.pageCount)"); fflush(stdout) }
    }
}
let data = try JSONEncoder().encode(BookRecord(file:URL(fileURLWithPath:input).lastPathComponent,pages:pages,version:1))
try data.write(to:URL(fileURLWithPath:output),options:.atomic)
