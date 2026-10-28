import SwiftUI
import XCTest
@testable import Tide

struct TestHost: View {
    var body: some View {
        RootView()
    }
}

final class TideTests: XCTestCase {
    func testRootBuilds() {
        _ = TestHost()
    }
}
