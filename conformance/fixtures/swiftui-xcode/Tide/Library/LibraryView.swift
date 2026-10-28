import SwiftUI

struct LibraryView: View {
    let tracks: [Track] = Track.samples

    var body: some View {
        VStack(spacing: 0) {
            header
            List {
                ForEach(tracks) { track in
                    NavigationLink(value: track) {
                        TrackRow(track: track)
                    }
                }
            }
        }
        .navigationTitle("Library")
        .navigationDestination(for: Track.self) { track in
            TrackDetailView(track: track)
        }
    }
}

extension LibraryView {
    /// The search and sort bar above the list.
    private var header: some View {
        LibraryHeader(count: tracks.count)
    }
}
