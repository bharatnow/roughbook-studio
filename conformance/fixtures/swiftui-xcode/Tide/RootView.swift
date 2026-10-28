import SwiftUI

/// The app's tabs, with the player bar under every one.
struct RootView: View {
    @State private var tab = 0

    var body: some View {
        TabView(selection: $tab) {
            Tab("Today", systemImage: "sun.max", value: 0) {
                TodayView()
            }
            Tab("Library", systemImage: "books.vertical", value: 1) {
                NavigationStack {
                    LibraryView()
                }
            }
            Tab("Profile", systemImage: "person", value: 2) {
                ProfileView()
            }
        }
        .safeAreaInset(edge: .bottom) {
            NowPlayingBar()
        }
    }
}
