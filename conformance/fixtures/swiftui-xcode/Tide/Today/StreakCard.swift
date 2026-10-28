import SwiftUI

struct StreakCard: View {
    let days: Int

    var body: some View {
        VStack(alignment: .leading) {
            Text("Streak").font(.headline)
            Text(days, format: .number)
        }
        .padding()
        .background(.thinMaterial, in: .rect(cornerRadius: 12))
    }
}
