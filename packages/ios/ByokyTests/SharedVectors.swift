import Foundation
import XCTest

/// Test vectors shared with core and Android, from packages/core/tests/vectors
/// (copied into the test bundle by the ByokyTests sources in project.yml).
enum SharedVectors {
    static func load(_ name: String, file: StaticString = #filePath, line: UInt = #line) throws -> [String: Any] {
        let url = try XCTUnwrap(
            Bundle(for: BundleToken.self).url(forResource: name, withExtension: "json"),
            "\(name).json is not in the test bundle (see the ByokyTests sources in project.yml)",
            file: file, line: line
        )
        let object = try JSONSerialization.jsonObject(with: Data(contentsOf: url))
        return try XCTUnwrap(object as? [String: Any], "\(name).json is not a JSON object", file: file, line: line)
    }
}

private final class BundleToken {}
