import SwiftUI

struct NowPlayingBar: View {
    var body: some View {
        HStack {
            Image(systemName: "play.fill")
            Text("Nothing playing")
            Spacer()
        }
        .padding()
        .background(.bar)
    }
}
