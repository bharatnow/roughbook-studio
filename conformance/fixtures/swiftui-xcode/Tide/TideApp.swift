import SwiftUI

@main
struct TideApp: App {
    @State private var player = Player()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(player)
        }
        #if os(macOS)
        Settings {
            SettingsView()
        }
        #endif
    }
}
