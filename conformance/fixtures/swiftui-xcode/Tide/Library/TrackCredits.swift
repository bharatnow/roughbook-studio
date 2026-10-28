import SwiftUI

struct TrackCredits: View {
    let track: Track

    var body: some View {
        VStack(alignment: .leading) {
            Text("Credits").font(.headline)
            Text("Recorded at low tide")
        }
    }
}
