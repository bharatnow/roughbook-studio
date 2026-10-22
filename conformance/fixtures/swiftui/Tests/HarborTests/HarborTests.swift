import XCTest
@testable import Harbor

final class HarborTests: XCTestCase {
    func testTheme() {
        XCTAssertNotNil(HarborTheme.accent)
    }
}
