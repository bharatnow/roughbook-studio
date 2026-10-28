import SwiftUI

struct Artwork: View {
    let track: Track

    var body: some View {
        RoundedRectangle(cornerRadius: 24)
            .fill(.tint.gradient)
            .aspectRatio(1, contentMode: .fit)
            .overlay(alignment: .bottomLeading) {
                Text(track.title).font(.title.bold()).padding()
            }
    }
}
