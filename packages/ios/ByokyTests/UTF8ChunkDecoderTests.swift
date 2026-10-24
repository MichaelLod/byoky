import XCTest
@testable import Byoky

/// Streaming responses are read in pieces cut at 4 KB or a newline; a piece
/// boundary can land inside a multi-byte character.
final class UTF8ChunkDecoderTests: XCTestCase {
    /// 1-, 2-, 3- and 4-byte sequences, a skin-tone modifier and a ZWJ family.
    private let sample = "data: {\"t\":\"héllo ключ 中文 ✓ 👋🏽 👨‍👩‍👧 end\"}\n\n"

    func testSplitAtEveryByteOffset() {
        let bytes = Data(sample.utf8)
        for offset in 0...bytes.count {
            var decoder = UTF8ChunkDecoder()
            var out = decoder.decode(Data(bytes.prefix(offset)))
            out += decoder.decode(Data(bytes.dropFirst(offset)))
            out += decoder.finish()
            XCTAssertEqual(out, sample, "split at byte \(offset)")
        }
    }

    func testSplitAtEveryPairOfOffsets() {
        let bytes = Data(sample.utf8)
        for first in 0...bytes.count {
            for second in first...bytes.count {
                var decoder = UTF8ChunkDecoder()
                var out = decoder.decode(Data(bytes[bytes.startIndex ..< bytes.startIndex + first]))
                out += decoder.decode(Data(bytes[bytes.startIndex + first ..< bytes.startIndex + second]))
                out += decoder.decode(Data(bytes[(bytes.startIndex + second)...]))
                out += decoder.finish()
                XCTAssertEqual(out, sample, "split at bytes \(first), \(second)")
            }
        }
    }

    func testByteAtATime() {
        var decoder = UTF8ChunkDecoder()
        var out = ""
        for byte in Data(sample.utf8) {
            out += decoder.decode(Data([byte]))
        }
        out += decoder.finish()
        XCTAssertEqual(out, sample)
    }

    func testNeverEmitsHalfACharacter() {
        let euro = Data("€".utf8) // E2 82 AC
        var decoder = UTF8ChunkDecoder()
        XCTAssertEqual(decoder.decode(euro.prefix(2)), "")
        XCTAssertEqual(decoder.decode(euro.suffix(1)), "€")
        XCTAssertEqual(decoder.finish(), "")
    }

    func testInvalidBytesAreReplacedNotDropped() {
        var decoder = UTF8ChunkDecoder()
        // A stray continuation byte mid-stream, then a sequence cut off by
        // the end of the stream.
        XCTAssertEqual(decoder.decode(Data([0x61, 0x80, 0x62])), "a\u{FFFD}b")
        XCTAssertEqual(decoder.decode(Data([0x63, 0xF0, 0x9F])), "c")
        XCTAssertEqual(decoder.finish(), "\u{FFFD}")
        XCTAssertEqual(decoder.finish(), "")
    }
}
