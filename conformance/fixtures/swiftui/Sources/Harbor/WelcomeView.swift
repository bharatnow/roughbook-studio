import SwiftUI

/// The first screen.
public struct WelcomeView: View {
    public init() {}

    public var body: some View {
        VStack(spacing: 12) {
            Text("Harbor").font(HarborTheme.title)
            Text("Designs live in rough/.").font(HarborTheme.body).foregroundStyle(.secondary)
        }
        .padding(32)
        .tint(HarborTheme.accent)
    }
}
