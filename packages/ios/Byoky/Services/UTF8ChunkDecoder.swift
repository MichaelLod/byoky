import Foundation

/// Decodes a UTF-8 byte stream that arrives in arbitrary pieces without ever
/// splitting a character: an incomplete multi-byte sequence at the end of a
/// piece is held back and completed by the next one. Invalid bytes become
/// U+FFFD instead of discarding the whole piece.
struct UTF8ChunkDecoder {
    private var pending = Data()

    /// Append `bytes` and return the text for everything up to the last
    /// complete character.
    mutating func decode(_ bytes: Data) -> String {
        pending.append(bytes)
        let cut = Self.completePrefixLength(pending)
        let text = String(decoding: pending.prefix(cut), as: UTF8.self)
        pending = Data(pending.dropFirst(cut))
        return text
    }

    /// End of stream: decode whatever is still held back.
    mutating func finish() -> String {
        defer { pending = Data() }
        return String(decoding: pending, as: UTF8.self)
    }

    /// Length of the prefix that ends on a character boundary — all of `data`
    /// except a trailing sequence that has started but isn't complete yet.
    static func completePrefixLength(_ data: Data) -> Int {
        let count = data.count
        var continuationBytes = 0
        while continuationBytes < min(3, count),
              data[data.startIndex + count - 1 - continuationBytes] & 0xC0 == 0x80 {
            continuationBytes += 1
        }
        // Only continuation bytes: invalid either way, let decoding replace them.
        guard continuationBytes < count else { return count }

        let leadIndex = count - 1 - continuationBytes
        let expectedLength: Int
        switch data[data.startIndex + leadIndex] {
        case 0x00...0x7F: expectedLength = 1
        case 0xC2...0xDF: expectedLength = 2
        case 0xE0...0xEF: expectedLength = 3
        case 0xF0...0xF4: expectedLength = 4
        default: return count // invalid lead byte
        }
        return continuationBytes + 1 < expectedLength ? leadIndex : count
    }
}
