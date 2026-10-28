import SwiftUI

struct TrackDetailView: View {
    let track: Track

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                Artwork(track: track)
                Card {
                    TrackCredits(track: track)
                }
                PillButton(title: "Play") {
                    // Player.shared.play(track), never a view
                }
            }
            .padding()
        }
        .navigationTitle(track.title)
    }
}
